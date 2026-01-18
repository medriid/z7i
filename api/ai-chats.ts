import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';
import { verifyToken } from './lib/auth.js';
import {
  generateChatResponse,
  generateHuggingFaceImage,
  isBlobConfigured,
  isGeminiConfigured,
  isHuggingFaceConfigured,
} from './lib/ai-service.js';

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
    isGated: false,
    isDefault: true,
  },
  {
    key: 'concept-coach',
    label: 'Concept Coach',
    description: 'Deep clarity with analogies and simplified reasoning.',
    promptHint: 'Use this for fundamentals and clarity before practice.',
    systemPrompt: 'Explain concepts with intuition, analogies, and gentle checks.',
    isGated: false,
    isDefault: true,
  },
  {
    key: 'practice-drill',
    label: 'Practice Drill',
    description: 'Short, timed practice sets and rapid feedback.',
    promptHint: 'Great for quick revision sprints and timed tests.',
    systemPrompt: 'Deliver short practice prompts with quick feedback.',
    isGated: false,
    isDefault: true,
  },
  {
    key: 'error-analyst',
    label: 'Error Analyst',
    description: 'Finds mistake patterns and builds correction routines.',
    promptHint: 'Use after tests to isolate recurring errors.',
    systemPrompt: 'Analyze mistakes and prescribe correction routines.',
    isGated: false,
    isDefault: true,
  },
  {
    key: 'exam-strategist',
    label: 'Exam Strategist',
    description: 'Plans your attempt order, time split, and accuracy goals.',
    promptHint: 'Ask for strategy based on your strengths.',
    systemPrompt: 'Create exam-time strategy and pacing plans.',
    isGated: false,
    isDefault: true,
  },
  {
    key: 'solution-architect',
    label: 'Solution Architect',
    description: 'Advanced solution crafting with alternate methods.',
    promptHint: 'Ideal for deeper solutions and multiple approaches.',
    systemPrompt: 'Offer advanced solution paths and alternate methods.',
    isGated: true,
    isDefault: true,
  },
  {
    key: 'paper-setter',
    label: 'Mock Paper Setter',
    description: 'Creates curated JEE-style mock sets with difficulty tags.',
    promptHint: 'Ask for a custom mix of easy/medium/hard questions.',
    systemPrompt: 'Generate mock paper questions with difficulty tags.',
    isGated: true,
    isDefault: true,
  },
  {
    key: 'ranking-mentor',
    label: 'Rank Mentor',
    description: 'Goal-focused mentorship for score improvement.',
    promptHint: 'Use for weekly targets and improvement plans.',
    systemPrompt: 'Mentor for rank improvement with actionable plans.',
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

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, canUseAiSolutions: true, canAccessAiChatRoom: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.canUseAiSolutions || !user.canAccessAiChatRoom) {
      return res.status(403).json({ error: 'AI chatroom access is disabled for this account' });
    }

    if (req.method === 'GET' && action === 'configs') {
      await ensureDefaultConfigs();
      const configs = await prisma.aiChatPersonalityConfig.findMany({
        where: {
          OR: [{ isDefault: true }, { createdByUserId: user.id }],
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

      const filtered = user.canUseAiSolutions
        ? configs
        : configs.filter(config => !config.isGated);

      return res.status(200).json({ success: true, configs: filtered });
    }

    if (req.method === 'POST' && action === 'create-config') {
      if (!user.canUseAiSolutions) {
        return res.status(403).json({ error: 'AI configuration creation requires permission' });
      }

      const { label, description, promptHint, systemPrompt, isGated } = req.body ?? {};
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
          isGated: Boolean(isGated),
          isDefault: false,
          createdByUserId: user.id,
        },
      });

      return res.status(201).json({ success: true, config });
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
          return res.status(503).json({
            error: 'Hugging Face service is not configured. Please set HF_TOKEN0 environment variable.',
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

        const image = await generateHuggingFaceImage({ prompt: promptMessage.trim(), modelId });
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

      const reply = await generateChatResponse({
        messages,
        systemPrompt: resolvedSystemPrompt,
        modelId,
        attachments: Array.isArray(attachments) ? attachments : undefined,
      });

      return res.status(200).json({ success: true, message: reply.text, modelUsed: reply.modelUsed });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (error) {
    console.error('AI chats error:', error);
    return res.status(500).json({ error: 'Failed to process AI chats request' });
  }
}
