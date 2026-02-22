import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/api/prisma.js';
import { verifyToken } from '../../lib/api/auth.js';
import {
  generateChatResponse,
  generateHuggingFaceImage,
  isBlobConfigured,
  isGeminiConfigured,
  isHuggingFaceConfigured,
} from '../../lib/api/ai-service.js';
import { enforceRateLimitAsync } from '../../lib/api/rate-limit.js';
import { logger } from '../../lib/api/logger.js';
import { incrementMetric, observeMetric } from '../../lib/api/metrics.js';
import { retryTransient, withTimeout } from '../../lib/api/resilience.js';
import { enqueueJob } from '../../lib/api/queue.js';
import { redisDel, redisGetJson, redisSetJson } from '../../lib/api/redis-cache.js';
import { logUserHistoryAction } from '../../lib/api/user-history.js';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getAuth(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.substring(7));
}

const DEFAULT_CONFIGS = [
  {
    key: 'jee-tutor',
    label: 'JEE Tutor',
    description: 'Step-by-step coaching with focus on JEE patterns.',
    promptHint: 'Ask for a concept breakdown, shortcuts, and exam tricks.',
    systemPrompt: 'You are an expert JEE tutor focused on exam-ready explanations.',
    avatarUrl: null,
    isGated: false,
    isDefault: true,
  },
  {
    key: 'concept-coach',
    label: 'Concept Coach',
    description: 'Deep clarity with analogies and simplified reasoning.',
    promptHint: 'Use this for fundamentals and clarity before practice.',
    systemPrompt: 'Explain concepts with intuition, analogies, and gentle checks.',
    avatarUrl: null,
    isGated: false,
    isDefault: true,
  },
  {
    key: 'paper-setter',
    label: 'Mock Paper Setter',
    description: 'Creates curated JEE-style mock sets with difficulty tags.',
    promptHint: 'Ask for a custom mix of easy/medium/hard questions.',
    systemPrompt: 'Generate mock paper questions with difficulty tags.',
    avatarUrl: null,
    isGated: true,
    isDefault: true,
  },
];

async function ensureDefaultConfigs() {
  await Promise.all(
    DEFAULT_CONFIGS.map(config =>
      prisma.aiChatPersonalityConfig.upsert({
        where: { key: config.key },
        update: {
          label: config.label,
          description: config.description,
          promptHint: config.promptHint,
          systemPrompt: config.systemPrompt,
          isGated: config.isGated,
          avatarUrl: config.avatarUrl ?? null,
          isDefault: true,
        },
        create: config,
      })
    )
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const payload = getAuth(req);
  if (!payload) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const action = typeof req.query.action === 'string' ? req.query.action : '';
  const aiRateLimit = action === 'send-message' || action === 'generate-image' ? { limit: 20, windowMs: 60_000 } : { limit: 80, windowMs: 60_000 };
  const aiRateLimitResult = await enforceRateLimitAsync(req, `ai:${action || 'unknown'}:${payload.userId}:${req.method || 'UNKNOWN'}`, aiRateLimit.limit, aiRateLimit.windowMs);
  if (!aiRateLimitResult.allowed) {
    res.setHeader('Retry-After', String(aiRateLimitResult.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many requests', retryAfterSeconds: aiRateLimitResult.retryAfterSeconds });
  }

  const requestStartedAt = Date.now();
  incrementMetric('api.ai_chats.request_total');

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, canUseAiSolutions: true, canAccessAiChatRoom: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.canAccessAiChatRoom) {
      return res.status(403).json({ error: 'AI chatroom access is disabled for this account' });
    }

    if (req.method === 'GET' && action === 'configs') {
      await ensureDefaultConfigs();
      const cacheKey = `ai:configs:${user.id}:${user.canUseAiSolutions ? 'full' : 'restricted'}`;
      const cachedConfigs = await redisGetJson<any[]>(cacheKey);
      if (cachedConfigs) {
        incrementMetric('api.ai_chats.cache_hit.configs');
        return res.status(200).json({ success: true, configs: cachedConfigs, cached: true });
      }

      incrementMetric('api.ai_chats.cache_miss.configs');
      const configs = await prisma.aiChatPersonalityConfig.findMany({
        where: {
          OR: [{ isDefault: true }, { createdByUserId: user.id }],
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

      const filtered = user.canUseAiSolutions
        ? configs
        : configs.filter(config => !config.isGated);

      await redisSetJson(cacheKey, filtered, 120);
      return res.status(200).json({ success: true, configs: filtered, cached: false });
    }

    if (req.method === 'POST' && action === 'create-config') {
      if (!user.canUseAiSolutions) {
        return res.status(403).json({ error: 'AI configuration creation requires permission' });
      }

      const { label, description, promptHint, systemPrompt, avatarUrl, isGated } = req.body ?? {};
      if (!label || !description || !promptHint) {
        return res.status(400).json({ error: 'Label, description, and prompt hint are required' });
      }

      const config = await prisma.aiChatPersonalityConfig.create({
        data: {
          key: `user-${user.id}-${crypto.randomUUID()}`,
          label,
          description,
          promptHint,
          systemPrompt: systemPrompt || null,
          avatarUrl: typeof avatarUrl === 'string' ? avatarUrl.trim() || null : null,
          isGated: Boolean(isGated),
          isDefault: false,
          createdByUserId: user.id,
        },
      });

      await Promise.all([
        redisDel(`ai:configs:${user.id}:full`),
        redisDel(`ai:configs:${user.id}:restricted`),
      ]);

      await logUserHistoryAction({
        userId: user.id,
        actionType: 'AI_PERSONALITY_CREATED',
        title: 'Created AI personality',
        description: `Created ${config.label}`,
        metadata: { personalityKey: config.key, isGated: config.isGated },
      });
      return res.status(201).json({ success: true, config });
    }

    if (req.method === 'POST' && action === 'update-config') {
      const { key, label, description, promptHint, systemPrompt, avatarUrl, isGated } = req.body ?? {};
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'Personality key is required' });
      }

      const existing = await prisma.aiChatPersonalityConfig.findUnique({
        where: { key },
      });

      if (!existing) {
        return res.status(404).json({ error: 'Personality config not found' });
      }

      const isOwner = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isOwner: true },
      });

      const canEdit = Boolean(isOwner?.isOwner) || existing.createdByUserId === user.id;
      if (!canEdit) {
        return res.status(403).json({ error: 'You do not have permission to edit this personality' });
      }

      if (existing.isDefault && !isOwner?.isOwner) {
        return res.status(403).json({ error: 'Default personalities can only be edited by the owner' });
      }

      const updateData: {
        label?: string;
        description?: string;
        promptHint?: string;
        systemPrompt?: string | null;
        avatarUrl?: string | null;
        isGated?: boolean;
      } = {};

      if (typeof label === 'string' && label.trim()) updateData.label = label.trim();
      if (typeof description === 'string' && description.trim()) updateData.description = description.trim();
      if (typeof promptHint === 'string' && promptHint.trim()) updateData.promptHint = promptHint.trim();
      if (typeof systemPrompt === 'string') updateData.systemPrompt = systemPrompt.trim() || null;
      if (typeof avatarUrl === 'string') updateData.avatarUrl = avatarUrl.trim() || null;
      if (typeof isGated === 'boolean') updateData.isGated = isGated;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No changes provided' });
      }

      const updated = await prisma.aiChatPersonalityConfig.update({
        where: { key },
        data: updateData,
      });

      await Promise.all([
        redisDel(`ai:configs:${user.id}:full`),
        redisDel(`ai:configs:${user.id}:restricted`),
      ]);
      return res.status(200).json({ success: true, config: updated });
    }

    if (req.method === 'GET' && action === 'sessions') {
      const includeMessages = req.query.includeMessages === 'true';
      const sessions = await prisma.aiChatSession.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        include: includeMessages
          ? {
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 200,
              },
            }
          : undefined,
      });

      return res.status(200).json({ success: true, sessions });
    }

    if (req.method === 'POST' && action === 'create-session') {
      const { title, modelId, personalityId } = req.body ?? {};
      if (!title || !modelId || !personalityId) {
        return res.status(400).json({ error: 'Title, modelId, and personalityId are required' });
      }

      await ensureDefaultConfigs();
      const personality = await prisma.aiChatPersonalityConfig.findUnique({
        where: { key: personalityId },
      });

      if (!personality) {
        return res.status(404).json({ error: 'Personality config not found' });
      }

      if (personality.isGated && !user.canUseAiSolutions) {
        return res.status(403).json({ error: 'Personality requires AI solutions permission' });
      }

      const session = await prisma.aiChatSession.create({
        data: {
          userId: user.id,
          title,
          modelId,
          personalityId,
        },
      });

      await logUserHistoryAction({
        userId: user.id,
        actionType: 'AI_CHAT_SESSION_CREATED',
        title: 'Created AI chat session',
        description: `Created chat ${session.title}`,
        metadata: { sessionId: session.id, modelId: session.modelId, personalityId: session.personalityId },
      });

      return res.status(201).json({ success: true, session });
    }

    if (req.method === 'POST' && action === 'update-session') {
      const { sessionId, title, modelId, personalityId } = req.body ?? {};
      if (!sessionId) {
        return res.status(400).json({ error: 'SessionId is required' });
      }

      const session = await prisma.aiChatSession.findFirst({
        where: { id: sessionId, userId: user.id },
        select: { id: true },
      });

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      if (personalityId) {
        await ensureDefaultConfigs();
        const personality = await prisma.aiChatPersonalityConfig.findUnique({
          where: { key: personalityId },
        });

        if (!personality) {
          return res.status(404).json({ error: 'Personality config not found' });
        }

        if (personality.isGated && !user.canUseAiSolutions) {
          return res.status(403).json({ error: 'Personality requires AI solutions permission' });
        }
      }

      const updatedSession = await prisma.aiChatSession.update({
        where: { id: session.id },
        data: {
          ...(title ? { title } : {}),
          ...(modelId ? { modelId } : {}),
          ...(personalityId ? { personalityId } : {}),
        },
      });

      return res.status(200).json({ success: true, session: updatedSession });
    }

    if (req.method === 'POST' && action === 'delete-session') {
      const { sessionId } = req.body ?? {};
      if (!sessionId) {
        return res.status(400).json({ error: 'SessionId is required' });
      }

      const deleted = await prisma.aiChatSession.deleteMany({
        where: { id: sessionId, userId: user.id },
      });

      if (!deleted.count) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      return res.status(200).json({ success: true });
    }

    if (req.method === 'POST' && action === 'add-message') {
      const { sessionId, role, content } = req.body ?? {};
      if (!sessionId || !role || !content) {
        return res.status(400).json({ error: 'SessionId, role, and content are required' });
      }

      const session = await prisma.aiChatSession.findFirst({
        where: { id: sessionId, userId: user.id },
        select: { id: true },
      });

      if (!session) {
        return res.status(404).json({ error: 'Chat session not found' });
      }

      const message = await prisma.aiChatMessage.create({
        data: {
          sessionId: session.id,
          role,
          content,
        },
      });

      await prisma.aiChatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      return res.status(201).json({ success: true, message });
    }

    if (req.method === 'POST' && action === 'generate') {
      const { messages, modelId, personalityId, systemPrompt, attachments } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages are required' });
      }

      const isHuggingFaceModel = typeof modelId === 'string' && modelId.startsWith('hf:');

      if (isHuggingFaceModel) {
        if (!isHuggingFaceConfigured()) {
          await enqueueJob('ai-image-generation', { userId: user.id, modelId, status: 'provider_not_configured' });
          return res.status(503).json({
            error: 'Image generation service is currently unavailable. Request has been queued.',
          });
        }
        if (!isBlobConfigured()) {
          return res.status(503).json({
            error: 'Blob storage is not configured. Please set BLOB_READ_WRITE_TOKEN environment variable.',
          });
        }

        const userMessages = messages.filter(
          (message: any) => message?.role === 'user' && typeof message?.content === 'string'
        );
        const promptMessage = userMessages.length ? userMessages[userMessages.length - 1].content : '';

        if (!promptMessage.trim()) {
          return res.status(400).json({ error: 'Image prompt is required' });
        }


        const image = await retryTransient(() => withTimeout(generateHuggingFaceImage({ prompt: promptMessage.trim(), modelId }), 30_000, 'Image generation timed out'));
        return res.status(200).json({
          success: true,
          message: `![Generated image](${image.url})`,
          modelUsed: image.modelUsed,
          isImage: true,
        });
      }

      if (!isGeminiConfigured()) {
        return res.status(503).json({
          error: 'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.',
        });
      }

      let resolvedSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt : '';

      if (personalityId) {
        await ensureDefaultConfigs();
        const personality = await prisma.aiChatPersonalityConfig.findUnique({
          where: { key: personalityId },
        });
        if (!personality) {
          return res.status(404).json({ error: 'Personality config not found' });
        }
        if (personality.isGated && !user.canUseAiSolutions) {
          return res.status(403).json({ error: 'Personality requires AI solutions permission' });
        }
        resolvedSystemPrompt = personality.systemPrompt || resolvedSystemPrompt;
      }

      if (!resolvedSystemPrompt.trim()) {
        resolvedSystemPrompt = 'You are a helpful JEE tutor.';
      }

      const reply = await retryTransient(() => withTimeout(generateChatResponse({
        messages,
        systemPrompt: resolvedSystemPrompt,
        modelId,
        attachments: Array.isArray(attachments) ? attachments : undefined,
      }), 30_000, 'AI response timed out'));

      return res.status(200).json({ success: true, message: reply.text, modelUsed: reply.modelUsed });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (error) {
    incrementMetric('api.ai_chats.errors');
    logger.error('AI chats error', {
      error: error instanceof Error ? error.message : String(error),
      userId: payload.userId,
      action,
      method: req.method,
    });
    return res.status(500).json({ error: 'Failed to process AI chats request' });
  } finally {
    observeMetric('api.ai_chats.request_duration_ms', Date.now() - requestStartedAt);
  }
}
