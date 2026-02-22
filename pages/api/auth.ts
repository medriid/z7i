import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/api/prisma.js';
import { hashPassword, verifyPassword, generateToken, verifyToken, encryptZ7iPassword, decryptZ7iPassword } from '../../lib/api/auth.js';
import { z7iLogin } from '../../lib/api/z7i-service.js';
import { generateCustomTestQuestions, extractQuestionsFromPdf } from '../../lib/api/ai-service.js';
import { createHash, randomInt } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { sendPasswordResetOtpEmail, sendTwoFactorOtpEmail } from '../../lib/api/mailer.js';
import { enforceRateLimitAsync } from '../../lib/api/rate-limit.js';
import { logUserHistoryAction } from '../../lib/api/user-history.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const TWO_FACTOR_OTP_LENGTH = 6;
const TWO_FACTOR_OTP_EXPIRY_MINUTES = 10;
const TWO_FACTOR_RESEND_COOLDOWN_SECONDS = 45;
const TWO_FACTOR_CHALLENGE_EXPIRY = '15m';
const TWO_FACTOR_CHALLENGE_SECRET = process.env.TWO_FACTOR_CHALLENGE_SECRET || process.env.JWT_SECRET || 'z7i-2fa-challenge-secret';
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 45;

type TwoFactorChallengePayload = {
  userId: string;
  email: string;
  type: 'otp';
};

function generateTwoFactorChallengeToken(payload: TwoFactorChallengePayload): string {
  return jwt.sign(payload, TWO_FACTOR_CHALLENGE_SECRET, { expiresIn: TWO_FACTOR_CHALLENGE_EXPIRY });
}

function verifyTwoFactorChallengeToken(token: string): TwoFactorChallengePayload | null {
  try {
    const payload = jwt.verify(token, TWO_FACTOR_CHALLENGE_SECRET) as Partial<TwoFactorChallengePayload>;
    if (!payload.userId || !payload.email || payload.type !== 'otp') return null;
    return {
      userId: payload.userId,
      email: payload.email,
      type: 'otp',
    };
  } catch {
    return null;
  }
}

function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(TWO_FACTOR_OTP_LENGTH, '0');
}

function hashOtpCode(userId: string, code: string) {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

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

async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOwner: true }
  });
  return Boolean(user?.isOwner);
}



function getAuthRateLimit(action: string) {
  if (action === 'login' || action === 'register' || action === 'request-password-reset' || action === 'verify-login-otp' || action === 'verify-password-reset-otp' || action === 'reset-password-with-otp') {
    return { limit: 10, windowMs: 60_000 };
  }
  if (action.startsWith('custom-tests')) {
    return { limit: 40, windowMs: 60_000 };
  }
  return { limit: 80, windowMs: 60_000 };
}

function normalizeIpAddress(req: VercelRequest): string {
  const ipAddress = (req.headers['x-forwarded-for'] as string) || (req.headers['x-real-ip'] as string) || 'unknown';
  return Array.isArray(ipAddress) ? ipAddress[0] : ipAddress.split(',')[0].trim();
}

async function recordUserIp(userId: string, ip: string) {
  if (!ip || ip === 'unknown') return;
  try {
    await prisma.userIpLog.upsert({
      where: { userId_ip: { userId, ip } },
      update: { lastSeenAt: new Date() },
      create: { userId, ip }
    });
  } catch (error) {
    console.error('IP log update error:', error);
  }
}

const MCQ_TYPES = ['MCQ', 'SINGLE'];
const NUMERICAL_TYPES = ['NAT', 'NUMERICAL', 'INTEGER'];

type LeagueTier = {
  name: string;
  stages: number[];
};

const LEAGUE_TIERS: LeagueTier[] = [
  { name: 'Bronze', stages: [100, 100, 100, 100, 100] },
  { name: 'Silver', stages: [250, 250, 250, 250] },
  { name: 'Gold', stages: [300, 300, 400] },
  { name: 'Diamond', stages: [500, 500] },
  { name: 'Platinum', stages: [1000] },
];

const MYTHIC_LEAGUE = '???';
const AUTO_AI_LEAGUES = new Set(['Platinum', MYTHIC_LEAGUE]);

function isNumericalType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return NUMERICAL_TYPES.some(type => normalized.includes(type));
}

function isMcqType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return MCQ_TYPES.some(type => normalized.includes(type));
}

type LeagueProgress = {
  league: string;
  stage: number | null;
};

function computeLeagueProgress(totalExp: number): LeagueProgress {
  let cumulative = 0;

  for (const tier of LEAGUE_TIERS) {
    for (let index = 0; index < tier.stages.length; index += 1) {
      const stageExp = tier.stages[index];
      const stageEnd = cumulative + stageExp;
      if (totalExp < stageEnd) {
        return {
          league: tier.name,
          stage: index + 1,
        };
      }
      cumulative = stageEnd;
    }
  }

  return {
    league: MYTHIC_LEAGUE,
    stage: null,
  };
}

function getLeagueNameFromProfile(profile?: { totalExp?: number | null; league?: string | null } | null) {
  if (!profile) return null;
  if (profile.league) return profile.league;
  return computeLeagueProgress(profile.totalExp ?? 0).league;
}

function hasLeagueAiAccess(profile?: { totalExp?: number | null; league?: string | null } | null) {
  const leagueName = getLeagueNameFromProfile(profile);
  if (!leagueName) return false;
  return AUTO_AI_LEAGUES.has(leagueName);
}

function sanitizeUserResponse(user: {
  id: string;
  email: string;
  name: string | null;
  profileImageUrl: string | null;
  isOwner: boolean;
  z7iAccount?: { enrollmentNo: string; lastSyncAt: Date | null; syncStatus: string; isGuest: boolean } | null;
  canUseAiSolutions: boolean;
  canAccessAiChatRoom: boolean;
  canUseGuestSync: boolean;
  dashboardBrandName: string | null;
  dashboardBrandColor: string | null;
  leagueUnranked: boolean;
  leagueUnrankedUpdatedAt: Date | null;
  themeMode: string;
  themeCustomEnabled: boolean;
  themeAccent: string | null;
  themeAccentSecondary: string | null;
  themeSuccess: string | null;
  themeError: string | null;
  themeWarning: string | null;
  themeUnattempted: string | null;
  themeNavBgColor: string | null;
  themeNavGifUrl: string | null;
  themeHomeBgGifUrl: string | null;
  themeHomeBgPositionX: number | null;
  themeHomeBgPositionY: number | null;
  themeAiChatsBgGifUrl: string | null;
  themeAiChatsBgPositionX: number | null;
  themeAiChatsBgPositionY: number | null;
  themePyqBgGifUrl: string | null;
  themePyqBgPositionX: number | null;
  themePyqBgPositionY: number | null;
  themeForumBgGifUrl: string | null;
  themeForumBgPositionX: number | null;
  themeForumBgPositionY: number | null;
  themeTestCardBgGifUrl: string | null;
  themeTestCardBgPositionX: number | null;
  themeTestCardBgPositionY: number | null;
  twoFactorEnabled: boolean;
}, autoAiAccess: boolean) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    profileImageUrl: user.profileImageUrl,
    isOwner: user.isOwner,
    z7iLinked: !!user.z7iAccount,
    z7iEnrollment: user.z7iAccount?.enrollmentNo,
    z7iIsGuest: user.z7iAccount?.isGuest || false,
    lastSyncAt: user.z7iAccount?.lastSyncAt,
    syncStatus: user.z7iAccount?.syncStatus,
    canUseAiSolutions: user.canUseAiSolutions || autoAiAccess,
    canAccessAiChatRoom: user.canAccessAiChatRoom,
    canUseGuestSync: user.canUseGuestSync,
    dashboardBrandName: user.dashboardBrandName,
    dashboardBrandColor: user.dashboardBrandColor,
    leagueUnranked: user.leagueUnranked,
    leagueUnrankedUpdatedAt: user.leagueUnrankedUpdatedAt,
    themeMode: user.themeMode,
    themeCustomEnabled: user.themeCustomEnabled,
    themeAccent: user.themeAccent,
    themeAccentSecondary: user.themeAccentSecondary,
    themeSuccess: user.themeSuccess,
    themeError: user.themeError,
    themeWarning: user.themeWarning,
    themeUnattempted: user.themeUnattempted,
    themeNavBgColor: user.themeNavBgColor,
    themeNavGifUrl: user.themeNavGifUrl,
    themeHomeBgGifUrl: user.themeHomeBgGifUrl,
    themeHomeBgPositionX: user.themeHomeBgPositionX,
    themeHomeBgPositionY: user.themeHomeBgPositionY,
    themeAiChatsBgGifUrl: user.themeAiChatsBgGifUrl,
    themeAiChatsBgPositionX: user.themeAiChatsBgPositionX,
    themeAiChatsBgPositionY: user.themeAiChatsBgPositionY,
    themePyqBgGifUrl: user.themePyqBgGifUrl,
    themePyqBgPositionX: user.themePyqBgPositionX,
    themePyqBgPositionY: user.themePyqBgPositionY,
    themeForumBgGifUrl: user.themeForumBgGifUrl,
    themeForumBgPositionX: user.themeForumBgPositionX,
    themeForumBgPositionY: user.themeForumBgPositionY,
    themeTestCardBgGifUrl: user.themeTestCardBgGifUrl,
    themeTestCardBgPositionX: user.themeTestCardBgPositionX,
    themeTestCardBgPositionY: user.themeTestCardBgPositionY,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

async function sendLoginOtp(user: { id: string; email: string; themeAccent?: string | null; dashboardBrandColor?: string | null; twoFactorCodeRequestedAt?: Date | null }) {
  const now = new Date();
  if (user.twoFactorCodeRequestedAt) {
    const cooldownMs = TWO_FACTOR_RESEND_COOLDOWN_SECONDS * 1000;
    if (now.getTime() - user.twoFactorCodeRequestedAt.getTime() < cooldownMs) {
      const secondsRemaining = Math.ceil((cooldownMs - (now.getTime() - user.twoFactorCodeRequestedAt.getTime())) / 1000);
      const error = new Error(`Please wait ${secondsRemaining}s before requesting another code.`);
      (error as Error & { status?: number }).status = 429;
      throw error;
    }
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(user.id, code);
  const expiresAt = new Date(now.getTime() + TWO_FACTOR_OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorCodeHash: codeHash,
      twoFactorCodeExpiresAt: expiresAt,
      twoFactorCodeRequestedAt: now,
    }
  });

  await sendTwoFactorOtpEmail({
    to: user.email,
    code,
    accentColor: user.themeAccent || user.dashboardBrandColor,
  });
}


async function sendPasswordResetOtp(user: { id: string; email: string; themeAccent?: string | null; dashboardBrandColor?: string | null; passwordResetCodeRequestedAt?: Date | null }) {
  const now = new Date();
  if (user.passwordResetCodeRequestedAt) {
    const cooldownMs = PASSWORD_RESET_RESEND_COOLDOWN_SECONDS * 1000;
    if (now.getTime() - user.passwordResetCodeRequestedAt.getTime() < cooldownMs) {
      return;
    }
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(user.id, code);
  const expiresAt = new Date(now.getTime() + TWO_FACTOR_OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetCodeHash: codeHash,
      passwordResetCodeExpiresAt: expiresAt,
      passwordResetCodeRequestedAt: now,
    }
  });

  await sendPasswordResetOtpEmail({
    to: user.email,
    code,
    accentColor: user.themeAccent || user.dashboardBrandColor,
  });
}



const UNICODE_TO_LATEX: [RegExp, string][] = [

  [/×/g, '\\times'], [/÷/g, '\\div'], [/±/g, '\\pm'], [/∓/g, '\\mp'],
  [/≤/g, '\\leq'], [/≥/g, '\\geq'], [/≠/g, '\\neq'], [/≈/g, '\\approx'],
  [/∞/g, '\\infty'], [/∝/g, '\\propto'], [/√/g, '\\sqrt{}'],
  [/∑/g, '\\sum'], [/∫/g, '\\int'], [/∂/g, '\\partial'], [/∇/g, '\\nabla'],
  [/°/g, '^\\circ'],
];

const UNICODE_SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n',
  'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
};

function normalizeSubscriptText(value: string): string {
  let result = value;

  result = result.replace(/([A-Za-z\)\]\}])([₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+)/g, (_m, base, subscript) => {
    const converted = Array.from(subscript)
      .map((char) => UNICODE_SUBSCRIPT_MAP[char] || '')
      .join('');
    if (!converted) return `${base}${subscript}`;
    return `\\(${base}_{${converted}}\\)`;
  });

  result = result.replace(/(^|[^\\A-Za-z0-9])([A-Za-z])_([A-Za-z0-9]{1,6})(?=$|[^A-Za-z0-9])/g, (_m, prefix, base, sub) => {
    return `${prefix}\\(${base}_{${sub}}\\)`;
  });

  return result;
}

function wrapBareUnicodeSymbols(text: string): string {

  const latexSpans: string[] = [];
  let s = text;
  const guard = (re: RegExp) => {
    s = s.replace(re, (m) => {
      const idx = latexSpans.length;
      latexSpans.push(m);
      return `__UNI_GUARD_${idx}__`;
    });
  };
  guard(/\\\[[\s\S]*?\\\]/g);
  guard(/\\\([\s\S]*?\\\)/g);
  guard(/\$\$[\s\S]*?\$\$/g);
  guard(/\$(?!\$)(?:[^$\\]|\\.)+?\$/g);


  for (const [re, latex] of UNICODE_TO_LATEX) {
    s = s.replace(re, `\\(${latex}\\)`);
  }


  for (let i = 0; i < latexSpans.length; i++) {
    s = s.replace(`__UNI_GUARD_${i}__`, latexSpans[i]);
  }
  return s;
}

function normalizeGeneratedQuestionField(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';


  const normalizedSubscripts = normalizeSubscriptText(raw);


  const withLatexSymbols = wrapBareUnicodeSymbols(normalizedSubscripts);



  const latexTokens: string[] = [];
  let tokenized = withLatexSymbols;


  tokenized = tokenized.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
    const idx = latexTokens.length;
    latexTokens.push(match);
    return `__LATEX_TOKEN_${idx}__`;
  });


  tokenized = tokenized.replace(/\\\([\s\S]*?\\\)/g, (match) => {
    const idx = latexTokens.length;
    latexTokens.push(match);
    return `__LATEX_TOKEN_${idx}__`;
  });


  tokenized = tokenized.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    const idx = latexTokens.length;
    latexTokens.push(match);
    return `__LATEX_TOKEN_${idx}__`;
  });


  tokenized = tokenized.replace(/\$(?!\$)(?:[^$\\]|\\.)+?\$/g, (match) => {
    const idx = latexTokens.length;
    latexTokens.push(match);
    return `__LATEX_TOKEN_${idx}__`;
  });


  let result = tokenized.replace(/\r\n?/g, '\n');


  result = result.replace(/([^\n])\n(?=[^\n])/g, '$1 ');


  result = result.replace(/\n{2,}/g, '<br /><br />');


  for (let i = 0; i < latexTokens.length; i++) {
    result = result.replace(`__LATEX_TOKEN_${i}__`, latexTokens[i]);
  }

  return result.trim();
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

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = await hashPassword(password);
    const normalizedIp = normalizeIpAddress(req);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name: name || null,
        lastIpAddress: normalizedIp,
        canAccessAiChatRoom: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
        profileImageUrl: true,
        dashboardBrandName: true,
        dashboardBrandColor: true,
        leagueUnranked: true,
        leagueUnrankedUpdatedAt: true,
        createdAt: true,
        isOwner: true,
        themeMode: true,
        themeCustomEnabled: true,
        themeAccent: true,
        themeAccentSecondary: true,
        themeSuccess: true,
        themeError: true,
        themeWarning: true,
        themeUnattempted: true,
        themeNavBgColor: true,
        themeNavGifUrl: true,
        themeHomeBgGifUrl: true,
        themeHomeBgPositionX: true,
        themeHomeBgPositionY: true,
        themeAiChatsBgGifUrl: true,
        themeAiChatsBgPositionX: true,
        themeAiChatsBgPositionY: true,
        themePyqBgGifUrl: true,
        themePyqBgPositionX: true,
        themePyqBgPositionY: true,
        themeForumBgGifUrl: true,
        themeForumBgPositionX: true,
        themeForumBgPositionY: true,
        themeTestCardBgGifUrl: true,
        themeTestCardBgPositionX: true,
        themeTestCardBgPositionY: true,
        twoFactorEnabled: true
      }
    });

    await recordUserIp(user.id, normalizedIp);
    await logUserHistoryAction({
      userId: user.id,
      actionType: 'USER_REGISTERED',
      title: 'User account created',
      description: 'Registered a new account.',
      metadata: { email: user.email },
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

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true, isGuest: true }
        },
        leagueProfile: {
          select: { totalExp: true, league: true }
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

    const ipAddress = normalizeIpAddress(req);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: ipAddress }
    });
    await recordUserIp(user.id, ipAddress);

    const autoAiAccess = hasLeagueAiAccess(user.leagueProfile);

    if (user.twoFactorEnabled) {
      try {
        await sendLoginOtp(user);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status) {
          return res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to send OTP code' });
        }
        throw error;
      }

      const challengeToken = generateTwoFactorChallengeToken({
        userId: user.id,
        email: user.email,
        type: 'otp',
      });

      return res.status(200).json({
        success: true,
        requiresTwoFactor: true,
        challengeToken,
        otpLength: TWO_FACTOR_OTP_LENGTH,
        message: 'Verification code sent to your email.',
      });
    }

    const token = generateToken({ userId: user.id, email: user.email });

    return res.status(200).json({
      success: true,
      user: sanitizeUserResponse(user, autoAiAccess),
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleVerifyLoginOtp(req: VercelRequest, res: VercelResponse) {
  const { challengeToken, otp } = req.body as { challengeToken?: string; otp?: string };

  if (!challengeToken || !otp) {
    return res.status(400).json({ error: 'Challenge token and OTP are required' });
  }

  const challenge = verifyTwoFactorChallengeToken(challengeToken);
  if (!challenge) {
    return res.status(401).json({ error: 'Invalid or expired OTP challenge' });
  }

  if (!/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'OTP must be a 6-digit code' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      include: {
        z7iAccount: {
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true, isGuest: true }
        },
        leagueProfile: {
          select: { totalExp: true, league: true }
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA is not enabled for this account' });
    if (!user.twoFactorCodeHash || !user.twoFactorCodeExpiresAt) {
      return res.status(400).json({ error: 'No active OTP found. Please request a new code.' });
    }
    if (user.twoFactorCodeExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new code.' });
    }

    const incomingHash = hashOtpCode(user.id, otp.trim());
    if (incomingHash !== user.twoFactorCodeHash) {
      return res.status(401).json({ error: 'Invalid OTP code' });
    }

    const ipAddress = normalizeIpAddress(req);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastIpAddress: ipAddress,
        twoFactorCodeHash: null,
        twoFactorCodeExpiresAt: null,
        twoFactorCodeRequestedAt: null,
      }
    });
    await recordUserIp(user.id, ipAddress);

    const token = generateToken({ userId: user.id, email: user.email });
    const autoAiAccess = hasLeagueAiAccess(user.leagueProfile);

    return res.status(200).json({
      success: true,
      user: sanitizeUserResponse(user, autoAiAccess),
      token,
    });
  } catch (error) {
    console.error('Verify login OTP error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleResendLoginOtp(req: VercelRequest, res: VercelResponse) {
  const { challengeToken } = req.body as { challengeToken?: string };
  if (!challengeToken) {
    return res.status(400).json({ error: 'Challenge token is required' });
  }

  const challenge = verifyTwoFactorChallengeToken(challengeToken);
  if (!challenge) {
    return res.status(401).json({ error: 'Invalid or expired OTP challenge' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        email: true,
        twoFactorEnabled: true,
        twoFactorCodeRequestedAt: true,
        themeAccent: true,
        dashboardBrandColor: true,
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: '2FA is not enabled for this account' });

    await sendLoginOtp(user);

    return res.status(200).json({
      success: true,
      message: 'A new OTP was sent to your email.',
      otpLength: TWO_FACTOR_OTP_LENGTH,
    });
  } catch (error) {
    console.error('Resend login OTP error:', error);
    const status = (error as Error & { status?: number }).status;
    if (status) {
      return res.status(status).json({ error: error instanceof Error ? error.message : 'Failed to resend OTP code' });
    }
    return res.status(500).json({ error: 'Failed to resend OTP code' });
  }
}

async function handleRequestPasswordReset(req: VercelRequest, res: VercelResponse) {
  const { email } = req.body as { email?: string };
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        themeAccent: true,
        dashboardBrandColor: true,
        passwordResetCodeRequestedAt: true,
      }
    });

    if (user) {
      await sendPasswordResetOtp(user);
    }

    return res.status(200).json({
      success: true,
      message: 'If an account exists for this email, an OTP has been sent.',
    });
  } catch (error) {
    console.error('Request password reset error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request' });
  }
}

async function handleVerifyPasswordResetOtp(req: VercelRequest, res: VercelResponse) {
  const { email, otp } = req.body as { email?: string; otp?: string };
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedEmail || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  if (!/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'OTP must be a 6-digit code' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        passwordResetCodeHash: true,
        passwordResetCodeExpiresAt: true,
      }
    });

    if (!user || !user.passwordResetCodeHash || !user.passwordResetCodeExpiresAt) {
      return res.status(400).json({ error: 'Invalid or expired OTP code' });
    }

    if (user.passwordResetCodeExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP has expired. Request a new one.' });
    }

    const incomingHash = hashOtpCode(user.id, otp.trim());
    if (incomingHash !== user.passwordResetCodeHash) {
      return res.status(401).json({ error: 'Invalid OTP code' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Verify password reset OTP error:', error);
    return res.status(500).json({ error: 'Failed to verify OTP' });
  }
}

async function handleResetPasswordWithOtp(req: VercelRequest, res: VercelResponse) {
  const { email, otp, newPassword } = req.body as { email?: string; otp?: string; newPassword?: string };
  const normalizedEmail = (email || '').trim().toLowerCase();

  if (!normalizedEmail || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        passwordResetCodeHash: true,
        passwordResetCodeExpiresAt: true,
      }
    });

    if (!user || !user.passwordResetCodeHash || !user.passwordResetCodeExpiresAt) {
      return res.status(400).json({ error: 'Invalid or expired OTP code' });
    }

    if (user.passwordResetCodeExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP has expired. Request a new one.' });
    }

    const incomingHash = hashOtpCode(user.id, otp.trim());
    if (incomingHash !== user.passwordResetCodeHash) {
      return res.status(401).json({ error: 'Invalid OTP code' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
        passwordResetCodeRequestedAt: null,
      }
    });

    return res.status(200).json({ success: true, message: 'Password reset successful. Please sign in.' });
  } catch (error) {
    console.error('Reset password with OTP error:', error);
    return res.status(500).json({ error: 'Failed to reset password' });
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
          select: { id: true, enrollmentNo: true, lastSyncAt: true, syncStatus: true, isGuest: true }
        },
        leagueProfile: {
          select: { totalExp: true, league: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const ipAddress = normalizeIpAddress(req);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastIpAddress: ipAddress }
    });
    await recordUserIp(user.id, ipAddress);

    const autoAiAccess = hasLeagueAiAccess(user.leagueProfile);

    return res.status(200).json({
      success: true,
      user: sanitizeUserResponse(user, autoAiAccess),
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

  const { name, currentPassword, newPassword, dashboardBrandName, dashboardBrandColor, profileImageUrl, leagueUnranked, twoFactorEnabled } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        z7iAccount: { select: { enrollmentNo: true } }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updateData: {
      name?: string | null;
      password?: string;
      profileImageUrl?: string | null;
      dashboardBrandName?: string | null;
      dashboardBrandColor?: string | null;
      leagueUnranked?: boolean;
      leagueUnrankedUpdatedAt?: Date;
      twoFactorEnabled?: boolean;
      twoFactorCodeHash?: string | null;
      twoFactorCodeExpiresAt?: Date | null;
      twoFactorCodeRequestedAt?: Date | null;
    } = {};

    if (name !== undefined) {
      updateData.name = name || null;
    }

    let normalizedBrandName = user.dashboardBrandName || null;
    if (dashboardBrandName !== undefined) {
      if (typeof dashboardBrandName !== 'string') {
        return res.status(400).json({ error: 'Invalid dashboard brand name' });
      }
      const trimmed = dashboardBrandName.trim();
      if (trimmed.length > 32) {
        return res.status(400).json({ error: 'Dashboard brand name must be 32 characters or less' });
      }
      normalizedBrandName = trimmed.length > 0 ? trimmed : null;
      updateData.dashboardBrandName = normalizedBrandName;
      if (!normalizedBrandName) {
        updateData.dashboardBrandColor = null;
      }
    }

    if (dashboardBrandColor !== undefined) {
      if (dashboardBrandColor === null || dashboardBrandColor === '') {
        updateData.dashboardBrandColor = null;
      } else if (typeof dashboardBrandColor !== 'string' || !HEX_COLOR_REGEX.test(dashboardBrandColor)) {
        return res.status(400).json({ error: 'Dashboard brand color must be a hex value' });
      } else if (normalizedBrandName) {
        updateData.dashboardBrandColor = dashboardBrandColor;
      } else {
        updateData.dashboardBrandColor = null;
      }
    }

    if (profileImageUrl !== undefined) {
      try {
        updateData.profileImageUrl = validateProfileImageUrl(profileImageUrl);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid profile image') {
          return res.status(400).json({ error: 'Profile image must be a valid URL or data image.' });
        }
        throw error;
      }
    }

    if (leagueUnranked !== undefined) {
      if (typeof leagueUnranked !== 'boolean') {
        return res.status(400).json({ error: 'Invalid unranked preference' });
      }
      if (leagueUnranked !== user.leagueUnranked) {
        const lastChanged = user.leagueUnrankedUpdatedAt;
        if (lastChanged) {
          const cooldownMs = 7 * 24 * 60 * 60 * 1000;
          const nextAllowed = new Date(lastChanged.getTime() + cooldownMs);
          if (Date.now() < nextAllowed.getTime()) {
            return res.status(400).json({
              error: `Unranked preference can be changed after ${nextAllowed.toISOString()}`,
            });
          }
        }
        updateData.leagueUnranked = leagueUnranked;
        updateData.leagueUnrankedUpdatedAt = new Date();
      }
    }

    if (twoFactorEnabled !== undefined) {
      if (typeof twoFactorEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid 2FA value' });
      }

      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change 2FA settings' });
      }

      const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      updateData.twoFactorEnabled = twoFactorEnabled;
      if (!twoFactorEnabled) {
        updateData.twoFactorCodeHash = null;
        updateData.twoFactorCodeExpiresAt = null;
        updateData.twoFactorCodeRequestedAt = null;
      }
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
      select: {
        id: true,
        email: true,
        name: true,
        profileImageUrl: true,
        dashboardBrandName: true,
        dashboardBrandColor: true,
        leagueUnranked: true,
        leagueUnrankedUpdatedAt: true,
        twoFactorEnabled: true,
      }
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

function validateProfileImageUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Invalid profile image');
  }
  const trimmed = value.trim();
  const isDataImage = /^data:image\/(gif|png|jpe?g|webp);base64,/i.test(trimmed);
  const isHttpImage = /^https?:\/\//i.test(trimmed);
  if (!isDataImage && !isHttpImage) {
    throw new Error('Invalid profile image');
  }
  if (isDataImage && trimmed.length > 7_000_000) {
    throw new Error('Invalid profile image');
  }
  return trimmed;
}

function isVideoMedia(value: string) {
  return (
    /^data:video\/(mp4|webm);base64,/i.test(value) ||
    /^https?:\/\/.+\.(mp4|webm)(\?.*)?$/i.test(value)
  );
}

function isGifMedia(value: string) {
  return (
    /^data:image\/gif;base64,/i.test(value) ||
    /^https?:\/\/.+\.(gif)(\?.*)?$/i.test(value)
  );
}

function validateThemeGif(value: unknown, allowVideo = false): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Invalid gif value');
  }
  const trimmed = value.trim();
  const isGif = isGifMedia(trimmed);
  const isVideo = allowVideo && isVideoMedia(trimmed);
  if (!isGif && !isVideo) {
    throw new Error('Invalid gif value');
  }
  return trimmed;
}

function validateThemeMedia(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('Invalid media value');
  }
  const trimmed = value.trim();
  const isDataGif = /^data:image\/gif;base64,/i.test(trimmed);
  const isDataVideo = /^data:video\/(mp4|webm);base64,/i.test(trimmed);
  const isHttpUrl = /^https?:\/\/.+/i.test(trimmed);
  if (!isDataGif && !isDataVideo && !isHttpUrl) {
    throw new Error('Invalid media value');
  }
  return trimmed;
}

function validateThemePosition(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'string' ? Number(value) : value;
  if (typeof numericValue !== 'number' || Number.isNaN(numericValue)) {
    throw new Error('Invalid position value');
  }
  if (numericValue < 0 || numericValue > 100) {
    throw new Error('Invalid position value');
  }
  return Math.round(numericValue);
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
    themeUnattempted,
    themeNavBgColor,
    themeNavGifUrl,
    themeHomeBgGifUrl,
    themeHomeBgPositionX,
    themeHomeBgPositionY,
    themeAiChatsBgGifUrl,
    themeAiChatsBgPositionX,
    themeAiChatsBgPositionY,
    themePyqBgGifUrl,
    themePyqBgPositionX,
    themePyqBgPositionY,
    themeForumBgGifUrl,
    themeForumBgPositionX,
    themeForumBgPositionY,
    themeTestCardBgGifUrl,
    themeTestCardBgPositionX,
    themeTestCardBgPositionY
  } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { isOwner: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const allowVideo = Boolean(user.isOwner);
    const updateData: {
      themeMode?: string;
      themeCustomEnabled?: boolean;
      themeAccent?: string | null;
      themeAccentSecondary?: string | null;
      themeSuccess?: string | null;
      themeError?: string | null;
      themeWarning?: string | null;
      themeUnattempted?: string | null;
      themeNavBgColor?: string | null;
      themeNavGifUrl?: string | null;
      themeHomeBgGifUrl?: string | null;
      themeHomeBgPositionX?: number | null;
      themeHomeBgPositionY?: number | null;
      themeAiChatsBgGifUrl?: string | null;
      themeAiChatsBgPositionX?: number | null;
      themeAiChatsBgPositionY?: number | null;
      themePyqBgGifUrl?: string | null;
      themePyqBgPositionX?: number | null;
      themePyqBgPositionY?: number | null;
      themeForumBgGifUrl?: string | null;
      themeForumBgPositionX?: number | null;
      themeForumBgPositionY?: number | null;
      themeTestCardBgGifUrl?: string | null;
      themeTestCardBgPositionX?: number | null;
      themeTestCardBgPositionY?: number | null;
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
      themeUnattempted !== undefined ||
      themeNavBgColor !== undefined
    ) {
      try {
        updateData.themeAccent = validateThemeColor(themeAccent);
        updateData.themeAccentSecondary = validateThemeColor(themeAccentSecondary);
        updateData.themeSuccess = validateThemeColor(themeSuccess);
        updateData.themeError = validateThemeColor(themeError);
        updateData.themeWarning = validateThemeColor(themeWarning);
        updateData.themeUnattempted = validateThemeColor(themeUnattempted);
        updateData.themeNavBgColor = validateThemeColor(themeNavBgColor);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid color value') {
          return res.status(400).json({ error: 'Theme colors must be valid hex values' });
        }
        throw error;
      }
    }

    if (themeNavGifUrl !== undefined) {
      try {
        updateData.themeNavGifUrl = validateThemeGif(themeNavGifUrl, false);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid gif value') {
          return res.status(400).json({ error: 'Theme media must be a valid URL or data image.' });
        }
        throw error;
      }
    }

    const videoAllowedKeys = new Set([
      'themeHomeBgGifUrl',
      'themeAiChatsBgGifUrl',
      'themePyqBgGifUrl',
      'themeForumBgGifUrl'
    ]);

    const gifFields: Array<{
      url: unknown;
      x: unknown;
      y: unknown;
      urlKey: keyof typeof updateData;
      xKey: keyof typeof updateData;
      yKey: keyof typeof updateData;
    }> = [
      {
        url: themeHomeBgGifUrl,
        x: themeHomeBgPositionX,
        y: themeHomeBgPositionY,
        urlKey: 'themeHomeBgGifUrl',
        xKey: 'themeHomeBgPositionX',
        yKey: 'themeHomeBgPositionY'
      },
      {
        url: themeAiChatsBgGifUrl,
        x: themeAiChatsBgPositionX,
        y: themeAiChatsBgPositionY,
        urlKey: 'themeAiChatsBgGifUrl',
        xKey: 'themeAiChatsBgPositionX',
        yKey: 'themeAiChatsBgPositionY'
      },
      {
        url: themePyqBgGifUrl,
        x: themePyqBgPositionX,
        y: themePyqBgPositionY,
        urlKey: 'themePyqBgGifUrl',
        xKey: 'themePyqBgPositionX',
        yKey: 'themePyqBgPositionY'
      },
      {
        url: themeForumBgGifUrl,
        x: themeForumBgPositionX,
        y: themeForumBgPositionY,
        urlKey: 'themeForumBgGifUrl',
        xKey: 'themeForumBgPositionX',
        yKey: 'themeForumBgPositionY'
      },
      {
        url: themeTestCardBgGifUrl,
        x: themeTestCardBgPositionX,
        y: themeTestCardBgPositionY,
        urlKey: 'themeTestCardBgGifUrl',
        xKey: 'themeTestCardBgPositionX',
        yKey: 'themeTestCardBgPositionY'
      }
    ];

    for (const field of gifFields) {
      const allowVideoForField = allowVideo && videoAllowedKeys.has(field.urlKey as string);
      if (field.url !== undefined) {
        try {
          (updateData as Record<string, string | number | boolean | null | undefined>)[field.urlKey] =
            validateThemeGif(field.url, allowVideoForField);
        } catch (error) {
          if (error instanceof Error && error.message === 'Invalid gif value') {
            if (!allowVideoForField) {
              return res.status(400).json({ error: 'Theme media must be a valid URL or data GIF.' });
            }
            return res.status(400).json({ error: 'Theme media must be a valid URL or data GIF/MP4/WebM.' });
          }
          throw error;
        }
      }

      if (field.x !== undefined) {
        try {
          (updateData as Record<string, string | number | boolean | null | undefined>)[field.xKey] = validateThemePosition(field.x);
        } catch (error) {
          if (error instanceof Error && error.message === 'Invalid position value') {
            return res.status(400).json({ error: 'Theme GIF positions must be between 0 and 100.' });
          }
          throw error;
        }
      }

      if (field.y !== undefined) {
        try {
          (updateData as Record<string, string | number | boolean | null | undefined>)[field.yKey] = validateThemePosition(field.y);
        } catch (error) {
          if (error instanceof Error && error.message === 'Invalid position value') {
            return res.status(400).json({ error: 'Theme GIF positions must be between 0 and 100.' });
          }
          throw error;
        }
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
        themeUnattempted: true,
        themeNavBgColor: true,
        themeNavGifUrl: true,
        themeHomeBgGifUrl: true,
        themeHomeBgPositionX: true,
        themeHomeBgPositionY: true,
        themeAiChatsBgGifUrl: true,
        themeAiChatsBgPositionX: true,
        themeAiChatsBgPositionY: true,
        themePyqBgGifUrl: true,
        themePyqBgPositionX: true,
        themePyqBgPositionY: true,
        themeForumBgGifUrl: true,
        themeForumBgPositionX: true,
        themeForumBgPositionY: true,
        themeTestCardBgGifUrl: true,
        themeTestCardBgPositionX: true,
        themeTestCardBgPositionY: true
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

  const { enrollmentNo, z7iPassword, syncAsGuest } = req.body;
  const isGuest = syncAsGuest === true;

  if (!isGuest && (!enrollmentNo || !z7iPassword)) {
    return res.status(400).json({ error: 'Enrollment number and Z7I password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { z7iAccount: true }
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (isGuest && !user.canUseGuestSync) {
    return res.status(403).json({ error: 'Guest sync access is not enabled for this account' });
  }

  let effectiveEnrollment = enrollmentNo;
  let effectivePassword = z7iPassword;

  if (isGuest) {

    const randomSyncedUser = await prisma.z7iAccount.findFirst({
      where: {
        syncStatus: 'success',
        ...(user.z7iAccount ? { NOT: { id: user.z7iAccount.id } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 1
    });

    if (!randomSyncedUser) {
      return res.status(400).json({ error: 'No synced users available for guest sync' });
    }

    effectiveEnrollment = randomSyncedUser.enrollmentNo;
    effectivePassword = decryptZ7iPassword(randomSyncedUser.encryptedPassword);
  }

  if (!effectiveEnrollment || !effectivePassword) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  try {
    const loginResult = await z7iLogin(effectiveEnrollment, effectivePassword);
    if (!loginResult) {
      return res.status(400).json({ error: isGuest ? 'Guest sync account is unavailable right now.' : 'Invalid Z7I credentials. Please check and try again.' });
    }

    const encryptedPassword = encryptZ7iPassword(effectivePassword);

    if (user.z7iAccount) {
      await prisma.z7iAccount.update({
        where: { id: user.z7iAccount.id },
        data: { 
          enrollmentNo: effectiveEnrollment, 
          encryptedPassword,
          isGuest,
          syncStatus: 'pending'
        }
      });
    } else {
      await prisma.z7iAccount.create({
        data: {
          userId: user.id,
          enrollmentNo: effectiveEnrollment,
          encryptedPassword,
          isGuest,
          syncStatus: 'pending'
        }
      });
    }

    return res.status(200).json({
      success: true,
      enrollmentNo: effectiveEnrollment,
      isGuest,
      message: isGuest ? 'Guest sync enabled successfully' : 'Z7I credentials updated successfully'
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
      where: { id: payload.userId },
      include: { z7iAccount: { select: { enrollmentNo: true } } }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Incorrect password' });
    }

    const ipLogs = await prisma.userIpLog.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
      select: { ip: true, firstSeenAt: true, lastSeenAt: true }
    });

    await prisma.deletedAccount.create({
      data: {
        email: user.email,
        name: user.name,
        enrollmentNo: user.z7iAccount?.enrollmentNo || null,
        ips: ipLogs.map(log => ({
          ip: log.ip,
          firstSeenAt: log.firstSeenAt,
          lastSeenAt: log.lastSeenAt
        }))
      }
    });

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
        createdByUserId: payload.userId,
        questions: {
          create: questions.map((question, index) => ({
            questionOrder: index + 1,
            subject: question.subject || null,
            chapter: question.chapter || null,
            difficulty: question.difficulty || null,
            questionType: question.type || 'MCQ',
            questionHtml: normalizeGeneratedQuestionField(question.question),
            option1: normalizeGeneratedQuestionField(question.options?.[0] || null) || null,
            option2: normalizeGeneratedQuestionField(question.options?.[1] || null) || null,
            option3: normalizeGeneratedQuestionField(question.options?.[2] || null) || null,
            option4: normalizeGeneratedQuestionField(question.options?.[3] || null) || null,
            correctAnswer: String(question.answer ?? '').trim() || (String(question.type || '').toUpperCase() === 'NAT' ? '0' : 'A'),
            marksPositive: question.marksPositive ?? 4,
            marksNegative: question.marksNegative ?? (String(question.type || '').toUpperCase() === 'NAT' ? 0 : 1),
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

async function handleCustomTestsCreateFromPdf(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { name, timeLimit, modelId, pdfBase64 } = req.body as {
    name?: string;
    timeLimit?: number;
    modelId?: string;
    pdfBase64?: string;
  };

  if (!name || !timeLimit || !pdfBase64) {
    return res.status(400).json({ error: 'Name, time limit, and PDF data are required.' });
  }

  try {
    const { questions, logs, hasSubjective } = await extractQuestionsFromPdf({
      pdfBase64,
      modelId: modelId || '2.5-flash',
    });

    if (questions.length === 0) {
      return res.status(400).json({ error: 'Could not extract any questions from the PDF.' });
    }

    const created = await prisma.customTest.create({
      data: {
        name,
        prompt: hasSubjective ? '[PDF Import — contains subjective questions, marks not counted]' : '[PDF Import]',
        modelId: modelId || '2.5-flash',
        timeLimit,
        totalQuestions: questions.length,
        status: 'ready',
        createdByUserId: payload.userId,
        questions: {
          create: questions.map((question, index) => {
            const qHtml = normalizeGeneratedQuestionField(question.question);
            let questionHtml = qHtml;
            if (question.caseStudyPassage && question.caseStudyGroup && question.caseStudyGroup > 0) {
              const passageHtml = normalizeGeneratedQuestionField(question.caseStudyPassage);
              questionHtml = `<!-- PASSAGE -->${passageHtml}<!-- /PASSAGE -->${qHtml}`;
            }
            return {
              questionOrder: index + 1,
              subject: question.subject || null,
              chapter: question.chapter || null,
              difficulty: question.difficulty || null,
              questionType: question.type || 'MCQ',
              questionHtml,
              option1: normalizeGeneratedQuestionField(question.options?.[0] || null) || null,
              option2: normalizeGeneratedQuestionField(question.options?.[1] || null) || null,
              option3: normalizeGeneratedQuestionField(question.options?.[2] || null) || null,
              option4: normalizeGeneratedQuestionField(question.options?.[3] || null) || null,
              correctAnswer: question.answer || '',
              marksPositive: question.marksPositive ?? 4,
              marksNegative: question.marksNegative ?? 1,
              diagramImageDataUrl: question.diagramDataUrl || null,
            };
          }),
        },
      },
      select: {
        id: true,
        name: true,
        totalQuestions: true,
        questions: {
          orderBy: { questionOrder: 'asc' },
          select: { id: true, questionOrder: true },
        },
      },
    });


    const diagramMeta = created.questions
      .map((dbQ, idx) => {
        const srcQ = questions[idx];
        if (srcQ && srcQ.diagramPage && srcQ.diagramPage > 0 && srcQ.diagramBounds) {
          return {
            questionId: dbQ.id,
            questionOrder: dbQ.questionOrder,
            diagramPage: srcQ.diagramPage,
            diagramBounds: srcQ.diagramBounds,
          };
        }
        return null;
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      test: { id: created.id, name: created.name, totalQuestions: created.totalQuestions },
      logs,
      hasSubjective,
      diagramMeta,
    });
  } catch (error) {
    console.error('Custom test PDF create error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to extract questions from PDF.' });
  }
}

async function handleCustomTestsList(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const tests = await prisma.customTest.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
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
    return res.status(200).json({ success: true, skipped: true, reason: 'Attempt is already submitted.' });
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
  ], { timeout: 30000 });

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


  const SUBJECTIVE_TYPES = ['SUBJECTIVE', 'DESCRIPTIVE', 'LONG ANSWER'];
  const hasSubjective = attempt.test.questions.some(q => {
    const t = (q.questionType || '').toUpperCase();
    return SUBJECTIVE_TYPES.some(st => t.includes(st));
  });
  const gradableQuestions = hasSubjective
    ? []
    : attempt.test.questions;
  const maxScore = hasSubjective
    ? null
    : attempt.test.questions.reduce((acc, question) => acc + question.marksPositive, 0);

  const responseUpdates = attempt.test.questions.map(question => {
    const response = responsesByQuestion.get(question.id);
    const answer = response?.answer?.trim() ?? '';
    let answerStatus = 'unattempted';
    let marksObtained = 0;

    const qTypeUpper = (question.questionType || '').toUpperCase();
    const isSubjectiveQ = SUBJECTIVE_TYPES.some(st => qTypeUpper.includes(st));

    if (answer && !hasSubjective && !isSubjectiveQ) {
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
  const accuracy = hasSubjective
    ? null
    : attempt.test.questions.length
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
  ], { timeout: 30000 });

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
      hasSubjective,
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

async function handleCustomTestsUpdateQuestionImages(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { updates } = req.body as {
    updates?: Array<{ questionId: string; imageDataUrl: string }>;
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'No image updates provided.' });
  }


  const limited = updates.slice(0, 50);
  let updated = 0;

  for (const { questionId, imageDataUrl } of limited) {
    if (!questionId || !imageDataUrl) continue;

    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(imageDataUrl)) continue;

    if (imageDataUrl.length > 2_800_000) continue;

    try {
      const question = await prisma.customTestQuestion.findUnique({
        where: { id: questionId },
        select: { id: true, questionHtml: true },
      });
      if (!question) continue;


      let html = question.questionHtml.replace(/\[Figure:[^\]]*\]\s*/g, '');

      const imgTag = `<img src="${imageDataUrl}" alt="Question diagram" style="max-width:100%;margin:0.5rem 0;" />`;


      const passageEndIdx = html.indexOf('<!-- /PASSAGE -->');
      if (passageEndIdx !== -1) {
        const insertAt = passageEndIdx + '<!-- /PASSAGE -->'.length;
        html = html.slice(0, insertAt) + imgTag + html.slice(insertAt);
      } else {

        html = imgTag + html;
      }

      await prisma.customTestQuestion.update({
        where: { id: questionId },
        data: { questionHtml: html },
      });
      updated++;
    } catch (e) {
      console.error(`Failed to update question image ${questionId}:`, e);
    }
  }

  return res.status(200).json({ success: true, updated });
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

  const existing = await prisma.customTest.findUnique({ where: { id: testId }, select: { id: true } });
  if (!existing) {
    return res.status(404).json({ error: 'Custom test not found.' });
  }

  await prisma.customTest.delete({ where: { id: testId } });
  return res.status(200).json({ success: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action as string;
  const authRateLimit = getAuthRateLimit(action);
  const authRateLimitResult = await enforceRateLimitAsync(req, `auth:${action || 'unknown'}:${req.method || 'UNKNOWN'}`, authRateLimit.limit, authRateLimit.windowMs);
  if (!authRateLimitResult.allowed) {
    res.setHeader('Retry-After', String(authRateLimitResult.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many requests', retryAfterSeconds: authRateLimitResult.retryAfterSeconds });
  }

  switch (action) {
    case 'register':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleRegister(req, res);
    case 'login':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLogin(req, res);
    case 'verify-login-otp':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleVerifyLoginOtp(req, res);
    case 'resend-login-otp':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleResendLoginOtp(req, res);
    case 'request-password-reset':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleRequestPasswordReset(req, res);
    case 'verify-password-reset-otp':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleVerifyPasswordResetOtp(req, res);
    case 'reset-password-with-otp':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleResetPasswordWithOtp(req, res);
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
    case 'custom-tests-create-from-pdf':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsCreateFromPdf(req, res);
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
    case 'custom-tests-delete':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsDelete(req, res);
    case 'custom-tests-update-question-images':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCustomTestsUpdateQuestionImages(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action' });
  }
}
