import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';
import { hashPassword, verifyPassword, generateToken, verifyToken, encryptZ7iPassword, decryptZ7iPassword } from './lib/auth.js';
import { z7iLogin } from './lib/z7i-service.js';
import { generateCustomTestQuestions, validateCustomTestQuestion } from './lib/ai-service.js';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_CORS_MAX_AGE = 60 * 60 * 24;

function parseAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const allowedOrigins = parseAllowedOrigins();
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const allowAny = allowedOrigins.length === 0 || allowedOrigins.includes('*');
  const allowOrigin = allowAny
    ? origin || '*'
    : allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }
  if (origin) {
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', DEFAULT_CORS_MAX_AGE);
}

function getAuth(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.substring(7));
}

async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOwner: true }
  });
  return Boolean(user?.isOwner);
}

async function updateDailyStreak(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { streakCount: true, lastStreakAt: true },
  });
  if (!user) return null;
  const now = new Date();
  const last = user.lastStreakAt;
  const todayKey = now.toISOString().slice(0, 10);
  const lastKey = last ? last.toISOString().slice(0, 10) : null;
  if (lastKey === todayKey) {
    return { streakCount: user.streakCount, lastStreakAt: user.lastStreakAt };
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const nextStreak = lastKey === yesterdayKey ? user.streakCount + 1 : 1;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { streakCount: nextStreak, lastStreakAt: now },
    select: { streakCount: true, lastStreakAt: true },
  });
  return updated;
}

const MCQ_TYPES = ['MCQ', 'SINGLE'];
const NUMERICAL_TYPES = ['NAT', 'NUMERICAL', 'INTEGER'];

function isNumericalType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return NUMERICAL_TYPES.some(type => normalized.includes(type));
}

function isMcqType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return MCQ_TYPES.some(type => normalized.includes(type));
}

type NumericRange = { min: number; max: number };

function parseNumericRanges(value: string): NumericRange[] {
  if (!value) return [];
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => {
      const rangeMatch = part.match(/^([+-]?\d*\.?\d+)\s*(?:-|–|—|\.\.)\s*([+-]?\d*\.?\d+)$/);
      if (rangeMatch) {
        const min = Number(rangeMatch[1]);
        const max = Number(rangeMatch[2]);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
          return [{ min: Math.min(min, max), max: Math.max(min, max) }];
        }
        return [];
      }
      const numericValue = Number(part);
      if (!Number.isNaN(numericValue)) {
        return [{ min: numericValue, max: numericValue }];
      }
      return [];
    });
}

function isAnswerMatch(studentAnswer: string, correctAnswer: string, questionType?: string | null) {
  if (isNumericalType(questionType)) {
    const studentValue = Number(studentAnswer);
    if (Number.isNaN(studentValue)) return false;
    const ranges = parseNumericRanges(correctAnswer);
    if (ranges.length === 0) {
      return studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
    }
    return ranges.some(range => studentValue >= range.min && studentValue <= range.max);
  }

  if (isMcqType(questionType)) {
    return studentAnswer.trim().toUpperCase() === correctAnswer.trim().toUpperCase();
  }

  return studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
}

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  const { email, password, name } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        name: name || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        isOwner: true,
        streakCount: true,
        lastStreakAt: true,
        themeMode: true,
        themeCustomEnabled: true,
        themeAccent: true,
        themeAccentSecondary: true,
        themeSuccess: true,
        themeError: true,
        themeWarning: true,
        themeUnattempted: true
      }
    });

    const token = generateToken({ userId: user.id, email: user.email });
    return res.status(201).json({ success: true, user, token });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true }
        }
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ipAddress = req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || 'unknown';
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim() }
    });

    const token = generateToken({ userId: user.id, email: user.email });
    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isOwner: user.isOwner,
        z7iLinked: !!user.z7iAccount,
        z7iEnrollment: user.z7iAccount?.enrollmentNo,
        lastSyncAt: user.z7iAccount?.lastSyncAt,
        canUseAiSolutions: user.canUseAiSolutions,
        canAccessAiChatRoom: user.canAccessAiChatRoom,
        streakCount: user.streakCount,
        lastStreakAt: user.lastStreakAt,
        themeMode: user.themeMode,
        themeCustomEnabled: user.themeCustomEnabled,
        themeAccent: user.themeAccent,
        themeAccentSecondary: user.themeAccentSecondary,
        themeSuccess: user.themeSuccess,
        themeError: user.themeError,
        themeWarning: user.themeWarning,
        themeUnattempted: user.themeUnattempted
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleMe(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ipAddress = req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || 'unknown';
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim() }
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isOwner: user.isOwner,
        z7iLinked: !!user.z7iAccount,
        z7iEnrollment: user.z7iAccount?.enrollmentNo,
        lastSyncAt: user.z7iAccount?.lastSyncAt,
        syncStatus: user.z7iAccount?.syncStatus,
        canUseAiSolutions: user.canUseAiSolutions,
        canAccessAiChatRoom: user.canAccessAiChatRoom,
        themeMode: user.themeMode,
        themeCustomEnabled: user.themeCustomEnabled,
        themeAccent: user.themeAccent,
        themeAccentSecondary: user.themeAccentSecondary,
        themeSuccess: user.themeSuccess,
        themeError: user.themeError,
        themeWarning: user.themeWarning,
        themeUnattempted: user.themeUnattempted
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUpdateProfile(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { name, currentPassword, newPassword } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData: { name?: string; password?: string } = {};

    if (name !== undefined) {
      updateData.name = name || null;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password' });
      }

      const isValid = await verifyPassword(currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }

      updateData.password = await hashPassword(newPassword);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: payload.userId },
      data: updateData,
      select: { id: true, email: true, name: true }
    });

    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: newPassword ? 'Profile and password updated' : 'Profile updated'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function validateThemeColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !HEX_COLOR_REGEX.test(value)) {
    throw new Error('Invalid color value');
  }
  return value;
}

async function handleUpdateTheme(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const {
    themeMode,
    themeCustomEnabled,
    themeAccent,
    themeAccentSecondary,
    themeSuccess,
    themeError,
    themeWarning,
    themeUnattempted
  } = req.body;

  try {
    const updateData: {
      themeMode?: string;
      themeCustomEnabled?: boolean;
      themeAccent?: string | null;
      themeAccentSecondary?: string | null;
      themeSuccess?: string | null;
      themeError?: string | null;
      themeWarning?: string | null;
      themeUnattempted?: string | null;
    } = {};

    if (themeMode !== undefined) {
      if (themeMode !== 'dark' && themeMode !== 'light') {
        return res.status(400).json({ error: 'Invalid theme mode' });
      }
      updateData.themeMode = themeMode;
    }

    if (themeCustomEnabled !== undefined) {
      if (typeof themeCustomEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid custom theme toggle' });
      }
      updateData.themeCustomEnabled = themeCustomEnabled;
    }

    if (
      themeAccent !== undefined ||
      themeAccentSecondary !== undefined ||
      themeSuccess !== undefined ||
      themeError !== undefined ||
      themeWarning !== undefined ||
      themeUnattempted !== undefined
    ) {
      try {
        updateData.themeAccent = validateThemeColor(themeAccent);
        updateData.themeAccentSecondary = validateThemeColor(themeAccentSecondary);
        updateData.themeSuccess = validateThemeColor(themeSuccess);
        updateData.themeError = validateThemeColor(themeError);
        updateData.themeWarning = validateThemeColor(themeWarning);
        updateData.themeUnattempted = validateThemeColor(themeUnattempted);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid color value') {
          return res.status(400).json({ error: 'Theme colors must be valid hex values' });
        }
        throw error;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No theme updates provided' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: payload.userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        themeMode: true,
        themeCustomEnabled: true,
        themeAccent: true,
        themeAccentSecondary: true,
        themeSuccess: true,
        themeError: true,
        themeWarning: true,
        themeUnattempted: true
      }
    });

    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: 'Theme updated'
    });
  } catch (error) {
    console.error('Update theme error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUpdateZ7i(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { enrollmentNo, z7iPassword } = req.body;

  if (!enrollmentNo || !z7iPassword) {
    return res.status(400).json({ error: 'Enrollment number and Z7I password are required' });
  }

  try {
    const loginResult = await z7iLogin(enrollmentNo, z7iPassword);
    if (!loginResult) {
      return res.status(400).json({ error: 'Invalid Z7I credentials. Please check and try again.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const encryptedPassword = encryptZ7iPassword(z7iPassword);

    if (user.z7iAccount) {
      await prisma.z7iAccount.update({
        where: { id: user.z7iAccount.id },
        data: { 
          enrollmentNo, 
          encryptedPassword,
          syncStatus: 'pending' // Mark for re-sync
        }
      });
    } else {
      await prisma.z7iAccount.create({
        data: {
          userId: user.id,
          enrollmentNo,
          encryptedPassword,
          syncStatus: 'pending'
        }
      });
    }

    return res.status(200).json({
      success: true,
      enrollmentNo,
      message: 'Z7I credentials updated successfully'
    });
  } catch (error) {
    console.error('Update Z7I error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleUnlinkZ7i(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    await prisma.z7iAccount.delete({
      where: { id: user.z7iAccount.id }
    });

    return res.status(200).json({
      success: true,
      message: 'Z7I account unlinked. All synced data has been removed.'
    });
  } catch (error) {
    console.error('Unlink Z7I error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeleteAccount(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required to delete account' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    await prisma.user.delete({
      where: { id: payload.userId }
    });

    return res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCustomTestsCreate(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, timeLimit, modelId, prompt } = req.body as {
    name?: string;
    timeLimit?: number;
    modelId?: string;
    prompt?: string;
  };

  if (!name || !timeLimit || !modelId || !prompt) {
    return res.status(400).json({ error: 'Name, time limit, model, and prompt are required.' });
  }

  try {
    const { questions, logs } = await generateCustomTestQuestions({ prompt, modelId });
    if (questions.length === 0) {
      return res.status(400).json({ error: 'AI returned no questions.' });
    }

    const created = await prisma.customTest.create({
      data: {
        name,
        prompt,
        modelId,
        timeLimit,
        totalQuestions: questions.length,
        status: 'ready',
        isShared: true,
        isManual: false,
        createdByUserId: payload.userId,
        questions: {
          create: questions.map((question, index) => ({
            questionOrder: index + 1,
            subject: question.subject || null,
            chapter: question.chapter || null,
            difficulty: question.difficulty || null,
            questionType: question.type || 'MCQ',
            questionHtml: question.question,
            option1: question.options?.[0] || null,
            option2: question.options?.[1] || null,
            option3: question.options?.[2] || null,
            option4: question.options?.[3] || null,
            correctAnswer: question.answer,
            marksPositive: question.marksPositive ?? 4,
            marksNegative: question.marksNegative ?? 1,
          })),
        },
      },
      select: { id: true, name: true, totalQuestions: true },
    });

    return res.status(200).json({ success: true, test: created, logs });
  } catch (error) {
    console.error('Custom test create error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create test.' });
  }
}

type ManualQuestionInput = {
  subject?: string;
  chapter?: string;
  difficulty?: string;
  type: string;
  question: string;
  options?: string[];
  answer: string;
  marksPositive?: number;
  marksNegative?: number;
};

function normalizeManualQuestion(input: ManualQuestionInput) {
  return {
    subject: input.subject || null,
    chapter: input.chapter || null,
    difficulty: input.difficulty || null,
    type: input.type || 'MCQ',
    question: input.question,
    options: input.options,
    answer: input.answer,
    marksPositive: input.marksPositive ?? 4,
    marksNegative: input.marksNegative ?? 1,
  };
}

async function handleCustomTestsPreview(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });
  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { modelId, prompt } = req.body as { modelId?: string; prompt?: string };
  if (!modelId || !prompt) {
    return res.status(400).json({ error: 'Model and prompt are required.' });
  }
  try {
    const { questions, logs } = await generateCustomTestQuestions({ prompt, modelId });
    return res.status(200).json({ success: true, questions, logs });
  } catch (error) {
    console.error('Custom test preview error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to preview test.' });
  }
}

async function handleCustomTestsRegenerate(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });
  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { modelId, prompt, indices } = req.body as { modelId?: string; prompt?: string; indices?: number[] };
  if (!modelId || !prompt || !Array.isArray(indices) || indices.length === 0) {
    return res.status(400).json({ error: 'Model, prompt, and indices are required.' });
  }
  try {
    const { questions } = await generateCustomTestQuestions({ prompt, modelId });
    const replacements = indices
      .map(index => ({ index, question: questions[index] }))
      .filter(item => item.question);
    return res.status(200).json({ success: true, replacements });
  } catch (error) {
    console.error('Custom test regenerate error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to regenerate questions.' });
  }
}

async function handleCustomTestsSave(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });
  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { name, timeLimit, modelId, prompt, questions } = req.body as {
    name?: string;
    timeLimit?: number;
    modelId?: string;
    prompt?: string;
    questions?: ManualQuestionInput[];
  };
  if (!name || !timeLimit || !modelId || !prompt || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Name, time limit, model, prompt, and questions are required.' });
  }
  const normalized = questions.map(normalizeManualQuestion);
  for (const question of normalized) {
    const validation = validateCustomTestQuestion(question);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason || 'Question validation failed.' });
    }
  }
  try {
    const created = await prisma.customTest.create({
      data: {
        name,
        prompt,
        modelId,
        timeLimit,
        totalQuestions: normalized.length,
        status: 'ready',
        isShared: true,
        isManual: false,
        createdByUserId: payload.userId,
        questions: {
          create: normalized.map((question, index) => ({
            questionOrder: index + 1,
            subject: question.subject,
            chapter: question.chapter,
            difficulty: question.difficulty,
            questionType: question.type || 'MCQ',
            questionHtml: question.question,
            option1: question.options?.[0] || null,
            option2: question.options?.[1] || null,
            option3: question.options?.[2] || null,
            option4: question.options?.[3] || null,
            correctAnswer: question.answer,
            marksPositive: question.marksPositive ?? 4,
            marksNegative: question.marksNegative ?? 1,
          })),
        },
      },
      select: { id: true, name: true, totalQuestions: true },
    });
    return res.status(200).json({ success: true, test: created });
  } catch (error) {
    console.error('Custom test save error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save test.' });
  }
}

async function handleCustomTestsCreateManual(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { name, timeLimit, questions } = req.body as {
    name?: string;
    timeLimit?: number;
    questions?: ManualQuestionInput[];
  };

  if (!name || !timeLimit || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Name, time limit, and questions are required.' });
  }

  const normalized = questions.map(normalizeManualQuestion);
  for (const question of normalized) {
    const validation = validateCustomTestQuestion(question);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.reason || 'Question validation failed.' });
    }
  }

  try {
    const created = await prisma.customTest.create({
      data: {
        name,
        prompt: 'manual',
        modelId: 'manual',
        timeLimit,
        totalQuestions: normalized.length,
        status: 'ready',
        isShared: true,
        isManual: true,
        createdByUserId: payload.userId,
        questions: {
          create: normalized.map((question, index) => ({
            questionOrder: index + 1,
            subject: question.subject,
            chapter: question.chapter,
            difficulty: question.difficulty,
            questionType: question.type || 'MCQ',
            questionHtml: question.question,
            option1: question.options?.[0] || null,
            option2: question.options?.[1] || null,
            option3: question.options?.[2] || null,
            option4: question.options?.[3] || null,
            correctAnswer: question.answer,
            marksPositive: question.marksPositive ?? 4,
            marksNegative: question.marksNegative ?? 1,
          })),
        },
      },
      select: { id: true, name: true, totalQuestions: true },
    });

    return res.status(200).json({ success: true, test: created });
  } catch (error) {
    console.error('Manual custom test create error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create manual test.' });
  }
}

async function handleCustomTestsDelete(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });
  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { testId } = req.body as { testId?: string };
  if (!testId) {
    return res.status(400).json({ error: 'Test ID is required.' });
  }
  try {
    await prisma.customTest.delete({ where: { id: testId } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Custom test delete error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete test.' });
  }
}

async function handleCustomTestsList(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const tests = await prisma.customTest.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      timeLimit: true,
      totalQuestions: true,
      status: true,
      isShared: true,
      isManual: true,
      createdAt: true,
      attempts: {
        where: { userId: payload.userId },
        select: {
          id: true,
          status: true,
          correct: true,
          incorrect: true,
          unattempted: true,
          totalScore: true,
          maxScore: true,
          timeTaken: true,
          accuracy: true,
          updatedAt: true,
        }
      }
    }
  });

  const formatted = tests.map(test => {
    const attempt = test.attempts[0];
    return {
      id: test.id,
      name: test.name,
      timeLimit: test.timeLimit,
      totalQuestions: test.totalQuestions,
      status: test.status,
      isShared: test.isShared,
      isManual: test.isManual,
      createdAt: test.createdAt,
      attempt: attempt
        ? {
            id: attempt.id,
            status: attempt.status,
            correct: attempt.correct,
            incorrect: attempt.incorrect,
            unattempted: attempt.unattempted,
            totalScore: attempt.totalScore,
            maxScore: attempt.maxScore,
            timeTaken: attempt.timeTaken,
            accuracy: attempt.accuracy,
            updatedAt: attempt.updatedAt,
          }
        : null
    };
  });

  return res.status(200).json({ success: true, tests: formatted });
}

async function handleCustomTestsStart(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { testId } = req.body as { testId?: string };
  if (!testId) {
    return res.status(400).json({ error: 'Test ID is required.' });
  }

  const test = await prisma.customTest.findUnique({
    where: { id: testId },
    include: {
      questions: { orderBy: { questionOrder: 'asc' } },
      attempts: {
        where: { userId: payload.userId },
        include: { responses: true }
      }
    }
  });

  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }

  if (test.status !== 'ready') {
    return res.status(400).json({ error: 'Test is still being prepared.' });
  }

  let attempt = test.attempts[0];
  if (!attempt) {
    attempt = await prisma.customTestAttempt.create({
      data: {
        testId,
        userId: payload.userId,
      },
      include: { responses: true }
    });
  }

  return res.status(200).json({
    success: true,
    test: {
      id: test.id,
      name: test.name,
      timeLimit: test.timeLimit,
      totalQuestions: test.totalQuestions,
    },
    attempt,
    questions: test.questions,
  });
}

async function handleCustomTestsSaveProgress(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { attemptId, elapsedTime, currentQuestionIndex, responses } = req.body as {
    attemptId?: string;
    elapsedTime?: number;
    currentQuestionIndex?: number;
    responses?: Array<{
      questionId: string;
      answer: string | null;
      flagged: boolean;
      timeSpent: number;
      visited: boolean;
    }>;
  };

  if (!attemptId || !Array.isArray(responses)) {
    return res.status(400).json({ error: 'Attempt ID and responses are required.' });
  }

  const attempt = await prisma.customTestAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, userId: true, status: true },
  });
  if (!attempt || attempt.userId !== payload.userId) {
    return res.status(404).json({ error: 'Attempt not found.' });
  }

  if (attempt.status !== 'in_progress') {
    return res.status(400).json({ error: 'Attempt is already submitted.' });
  }

  await prisma.$transaction([
    prisma.customTestAttempt.update({
      where: { id: attemptId },
      data: {
        timeTaken: typeof elapsedTime === 'number' ? elapsedTime : undefined,
        currentQuestionIndex: typeof currentQuestionIndex === 'number' ? currentQuestionIndex : undefined,
      }
    }),
    ...responses.map(response =>
      prisma.customTestResponse.upsert({
        where: { attemptId_questionId: { attemptId, questionId: response.questionId } },
        update: {
          answer: response.answer,
          flagged: response.flagged,
          timeSpent: response.timeSpent,
          visited: response.visited,
        },
        create: {
          attemptId,
          questionId: response.questionId,
          answer: response.answer,
          flagged: response.flagged,
          timeSpent: response.timeSpent,
          visited: response.visited,
        }
      })
    )
  ]);

  return res.status(200).json({ success: true });
}

async function handleCustomTestsSubmit(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { attemptId, elapsedTime } = req.body as { attemptId?: string; elapsedTime?: number };
  if (!attemptId) {
    return res.status(400).json({ error: 'Attempt ID is required.' });
  }

  const attempt = await prisma.customTestAttempt.findUnique({
    where: { id: attemptId },
    include: {
      test: { include: { questions: true } },
      responses: true,
    }
  });

  if (!attempt || attempt.userId !== payload.userId) {
    return res.status(404).json({ error: 'Attempt not found.' });
  }

  if (attempt.status === 'submitted') {
    return res.status(400).json({ error: 'Attempt already submitted.' });
  }

  const responsesByQuestion = new Map(attempt.responses.map(response => [response.questionId, response]));
  let correct = 0;
  let incorrect = 0;
  let score = 0;
  const maxScore = attempt.test.questions.reduce((acc, question) => acc + question.marksPositive, 0);

  const responseUpdates = attempt.test.questions.map(question => {
    const response = responsesByQuestion.get(question.id);
    const answer = response?.answer?.trim() ?? '';
    let answerStatus = 'unattempted';
    let marksObtained = 0;

    if (answer) {
      const isCorrect = isAnswerMatch(answer, question.correctAnswer, question.questionType);
      if (isCorrect) {
        correct += 1;
        score += question.marksPositive;
        answerStatus = 'correct';
        marksObtained = question.marksPositive;
      } else {
        incorrect += 1;
        score -= question.marksNegative;
        answerStatus = 'incorrect';
        marksObtained = -question.marksNegative;
      }
    }

    return prisma.customTestResponse.upsert({
      where: { attemptId_questionId: { attemptId, questionId: question.id } },
      update: { answerStatus, marksObtained },
      create: {
        attemptId,
        questionId: question.id,
        answer: answer || null,
        answerStatus,
        marksObtained,
      }
    });
  });

  const unattempted = attempt.test.questions.length - correct - incorrect;
  const accuracy = attempt.test.questions.length
    ? Math.round((correct / attempt.test.questions.length) * 100)
    : 0;

  await prisma.$transaction([
    ...responseUpdates,
    prisma.customTestAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        timeTaken: typeof elapsedTime === 'number' ? elapsedTime : attempt.timeTaken,
        correct,
        incorrect,
        unattempted,
        totalScore: score,
        maxScore,
        accuracy,
      }
    })
  ]);

  await updateDailyStreak(payload.userId);

  return res.status(200).json({
    success: true,
    results: {
      correct,
      incorrect,
      unattempted,
      score,
      maxScore,
      accuracy,
      timeTaken: typeof elapsedTime === 'number' ? elapsedTime : attempt.timeTaken ?? 0,
    }
  });
}

async function handleCustomTestsAttempt(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const attemptId = req.query.attemptId as string;
  if (!attemptId) {
    return res.status(400).json({ error: 'Attempt ID is required.' });
  }

  const attempt = await prisma.customTestAttempt.findUnique({
    where: { id: attemptId },
    include: {
      test: { include: { questions: { orderBy: { questionOrder: 'asc' } } } },
      responses: true,
    }
  });

  if (!attempt || attempt.userId !== payload.userId) {
    return res.status(404).json({ error: 'Attempt not found.' });
  }

  return res.status(200).json({
    success: true,
    attempt,
    test: {
      id: attempt.test.id,
      name: attempt.test.name,
      timeLimit: attempt.test.timeLimit,
      totalQuestions: attempt.test.totalQuestions,
    },
    questions: attempt.test.questions,
    responses: attempt.responses,
  });
}

async function handleStreak(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });
  try {
    const updated = await updateDailyStreak(payload.userId);
    return res.status(200).json({ success: true, streak: updated });
  } catch (error) {
    console.error('Streak update error:', error);
    return res.status(500).json({ error: 'Failed to update streak' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action as string;

  switch (action) {
    case 'register':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleRegister(req, res);
    case 'login':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLogin(req, res);
    case 'me':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleMe(req, res);
    case 'update-profile':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateProfile(req, res);
    case 'update-theme':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateTheme(req, res);
    case 'update-z7i':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUpdateZ7i(req, res);
    case 'unlink-z7i':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleUnlinkZ7i(req, res);
    case 'delete-account':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteAccount(req, res);
    case 'custom-tests-create':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsCreate(req, res);
    case 'custom-tests-list':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsList(req, res);
    case 'custom-tests-start':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsStart(req, res);
    case 'custom-tests-save-progress':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsSaveProgress(req, res);
    case 'custom-tests-submit':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsSubmit(req, res);
    case 'custom-tests-attempt':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsAttempt(req, res);
    case 'custom-tests-preview':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsPreview(req, res);
    case 'custom-tests-regenerate':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsRegenerate(req, res);
    case 'custom-tests-save':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsSave(req, res);
    case 'custom-tests-create-manual':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsCreateManual(req, res);
    case 'custom-tests-delete':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsDelete(req, res);
    case 'streak':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleStreak(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action' });
  }
}
