import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { prisma } from '../../lib/api/prisma.js';
import { verifyToken, encryptZ7iPassword, decryptZ7iPassword } from '../../lib/api/auth.js';
import { z7iLogin, z7iGetPackages, z7iGetPackageDetails, z7iGetScoreOverview, z7iGetQuestionwise, SUBJECT_MAP } from '../../lib/api/z7i-service.js';
import { z7iGetFirstName } from '../../lib/api/z7i-service.js';
import type { QuestionData } from '../../lib/api/ai-service.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb'
    }
  }
};

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

function isMcqType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return MCQ_TYPES.some(type => normalized.includes(type));
}

function isNumericalType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return NUMERICAL_TYPES.some(type => normalized.includes(type));
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

async function getTopExpUserIds(limit = 5) {
  const topProfiles = await prisma.userLeagueProfile.findMany({
    select: { userId: true },
    orderBy: [{ totalExp: 'desc' }, { updatedAt: 'asc' }],
    take: limit,
  });
  return new Set(topProfiles.map(profile => profile.userId));
}

// ── Admin EXP refresh helpers ──

function getTestExp(score: number, maxScore: number | null | undefined): number {
  if (!maxScore) return 0;
  if (maxScore === 300) {
    if (score >= 250) return 400;
    if (score >= 200) return 200;
    if (score >= 150) return 100;
    return 0;
  }
  if (maxScore === 180) {
    if (score >= 150) return 400;
    if (score >= 120) return 200;
    if (score >= 90) return 100;
    return 0;
  }
  return 0;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function diffDays(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((utcB - utcA) / (24 * 60 * 60 * 1000));
}

async function adminRefreshLeagueExp(userId: string) {
  // Ensure profile exists
  let profile = await prisma.userLeagueProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.userLeagueProfile.create({ data: { userId } });
  }

  // ── Process test EXP ──
  const account = await prisma.z7iAccount.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (account) {
    const attempts = await prisma.testAttempt.findMany({
      where: { z7iAccountId: account.id },
      select: {
        id: true,
        totalScore: true,
        maxScore: true,
        test: { select: { maxScore: true } },
      },
    });

    const attemptIds = attempts.map(a => a.id);
    const firstRevisionByAttemptId = new Map<string, { totalScore: number }>();
    if (attemptIds.length > 0) {
      const revisions = await prisma.testRevision.findMany({
        where: { attemptId: { in: attemptIds } },
        select: { attemptId: true, totalScore: true, createdAt: true },
        orderBy: [{ attemptId: 'asc' }, { createdAt: 'asc' }],
      });
      revisions.forEach((rev) => {
        if (!firstRevisionByAttemptId.has(rev.attemptId)) {
          firstRevisionByAttemptId.set(rev.attemptId, { totalScore: rev.totalScore });
        }
      });
    }

    if (attempts.length > 0) {
      const existing = await prisma.userExpEvent.findMany({
        where: { userId, type: 'test_attempt', sourceId: { in: attemptIds } },
        select: { sourceId: true },
      });
      const existingIds = new Set(existing.map(e => e.sourceId));

      const newEvents = attempts
        .filter(a => !existingIds.has(a.id))
        .map(a => {
          const maxScore = a.maxScore ?? a.test?.maxScore ?? null;
          const firstRevision = firstRevisionByAttemptId.get(a.id);
          const shouldUseFirstRevision = a.totalScore <= 0 && firstRevision && firstRevision.totalScore > 0;
          const scoreForExp = shouldUseFirstRevision ? firstRevision.totalScore : a.totalScore;
          const exp = getTestExp(scoreForExp, maxScore);
          if (exp <= 0) return null;
          return {
            userId,
            type: 'test_attempt',
            sourceId: a.id,
            exp,
            metadata: {
              totalScore: a.totalScore,
              maxScore,
              expScore: scoreForExp,
              usedFirstRevision: Boolean(shouldUseFirstRevision),
            }
          };
        })
        .filter(Boolean) as Array<{ userId: string; type: string; sourceId: string; exp: number; metadata: object }>;

      if (newEvents.length > 0) {
        await prisma.userExpEvent.createMany({ data: newEvents, skipDuplicates: true });
      }
    }
  }

  // ── Process PYQ EXP ──
  const existingPyqEvents = await prisma.userExpEvent.findMany({
    where: { userId, type: 'pyq_daily' },
    select: { sourceId: true },
    orderBy: { sourceId: 'desc' },
    take: 1,
  });

  const lastEventDateKey = existingPyqEvents[0]?.sourceId || null;
  let startDate: Date | null = null;

  if (lastEventDateKey) {
    startDate = addDays(fromDateKey(lastEventDateKey), 1);
  } else {
    const firstAttempt = await prisma.pyqQuestionAttempt.findFirst({
      where: { userId },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    startDate = firstAttempt?.createdAt ?? null;
  }

  if (startDate) {
    const pyqAttempts = await prisma.pyqQuestionAttempt.findMany({
      where: { userId, createdAt: { gte: startDate } },
      select: { createdAt: true, timeTaken: true },
    });

    if (pyqAttempts.length > 0) {
      const existingDayEvents = await prisma.userExpEvent.findMany({
        where: { userId, type: 'pyq_daily', createdAt: { gte: startDate } },
        select: { sourceId: true },
      });
      const existingDaySet = new Set(existingDayEvents.map(e => e.sourceId));

      const dailyStats = new Map<string, { count: number; timeSum: number }>();
      pyqAttempts.forEach(a => {
        const key = toDateKey(a.createdAt);
        const entry = dailyStats.get(key) || { count: 0, timeSum: 0 };
        entry.count += 1;
        entry.timeSum += typeof a.timeTaken === 'number' ? a.timeTaken : 0;
        dailyStats.set(key, entry);
      });

      const qualifyingDays = Array.from(dailyStats.entries())
        .filter(([, stats]) => stats.count >= 100 && stats.timeSum >= 7200)
        .map(([key]) => key)
        .sort();

      if (qualifyingDays.length > 0) {
        let lastQualifiedAt = profile.lastPyqQualifiedAt ? new Date(profile.lastPyqQualifiedAt) : null;
        let streakCount = profile.streakCount || 0;
        let streakBonus = profile.streakBonus || 0;
        const newPyqEvents: Array<{ userId: string; type: string; sourceId: string; exp: number; metadata: object }> = [];

        qualifyingDays.forEach(dayKey => {
          if (existingDaySet.has(dayKey)) return;
          const dayDate = fromDateKey(dayKey);
          let exp = 100;
          if (!lastQualifiedAt) {
            streakCount = 1;
            streakBonus = 0;
          } else {
            const gap = diffDays(lastQualifiedAt, dayDate);
            if (gap === 1) {
              streakCount += 1;
              streakBonus = Math.min(100, streakBonus + 10);
              exp = 100 + streakBonus;
            } else if (gap > 1) {
              streakBonus = Math.max(0, streakBonus - 10 * (gap - 1));
              streakCount = 1;
              exp = 100 + streakBonus;
            } else {
              exp = 100 + streakBonus;
            }
          }
          lastQualifiedAt = dayDate;
          const stats = dailyStats.get(dayKey) || { count: 0, timeSum: 0 };
          newPyqEvents.push({
            userId, type: 'pyq_daily', sourceId: dayKey, exp,
            metadata: { questionCount: stats.count, timeSeconds: stats.timeSum, streakCount, streakBonus },
          });
        });

        if (newPyqEvents.length > 0) {
          await prisma.userExpEvent.createMany({ data: newPyqEvents, skipDuplicates: true });
        }

        // Update streak info on profile
        await prisma.userLeagueProfile.update({
          where: { userId },
          data: { lastPyqQualifiedAt: lastQualifiedAt, streakCount, streakBonus },
        });
      }
    }
  }

  // ── Aggregate total EXP and update league ──
  const totalExpAgg = await prisma.userExpEvent.aggregate({
    where: { userId },
    _sum: { exp: true },
  });
  const totalExp = Math.max(0, totalExpAgg._sum.exp ?? 0);
  const leagueProgress = computeLeagueProgress(totalExp);

  await prisma.userLeagueProfile.update({
    where: { userId },
    data: { totalExp, league: leagueProgress.league, stage: leagueProgress.stage },
  });
}

async function getAiPrivileges(userId: string) {
  const [user, profile, isOwner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { canUseAiSolutions: true },
    }),
    prisma.userLeagueProfile.findUnique({
      where: { userId },
      select: { totalExp: true, league: true },
    }),
    isAdmin(userId),
  ]);

  const autoAiAccess = hasLeagueAiAccess(profile);
  const topExpUserIds = await getTopExpUserIds();
  const isTopExp = topExpUserIds.has(userId);

  const canUseAi = Boolean(isOwner || user?.canUseAiSolutions || autoAiAccess);
  const canGenerateAi = Boolean(isOwner || user?.canUseAiSolutions || isTopExp);
  const canEditKey = Boolean(isOwner || isTopExp);

  return {
    isOwner,
    isTopExp,
    autoAiAccess,
    canUseAi,
    canGenerateAi,
    canEditKey,
  };
}

function parseMcqAnswers(value: string) {
  if (!value) return [];
  const options = value
    .split(/[,\s/|]+/)
    .map(opt => opt.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(options)).sort();
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

function normalizeAnswerKey(value: string, questionType?: string | null) {
  if (isMcqType(questionType)) {
    return parseMcqAnswers(value).join(',');
  }
  return value.trim().toLowerCase();
}

function isAnswerMatch(studentAnswer: string | null | undefined, correctAnswer: string, questionType?: string | null) {
  if (!studentAnswer) return false;
  const normalizedStudent = studentAnswer.trim().toLowerCase();
  if (!normalizedStudent) return false;

  if (isMcqType(questionType)) {
    return parseMcqAnswers(correctAnswer).includes(normalizedStudent);
  }

  if (isNumericalType(questionType)) {
    const studentValue = Number(normalizedStudent);
    if (Number.isNaN(studentValue)) return false;
    const ranges = parseNumericRanges(correctAnswer);
    if (ranges.length === 0) {
      return normalizedStudent === correctAnswer.trim().toLowerCase();
    }
    return ranges.some(range => studentValue >= range.min && studentValue <= range.max);
  }

  return normalizedStudent === correctAnswer.trim().toLowerCase();
}

type AnswerStatus = 'correct' | 'incorrect' | 'unattempted';

type ScoreOverviewSummary = {
  correct?: number;
  incorrect?: number;
  attempted?: number;
  test?: Array<{ total_qs?: string | number }>;
};

function normalizeAnswerStatus(status: string | null | undefined): AnswerStatus {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'correct' || normalized === 'incorrect') {
    return normalized as AnswerStatus;
  }
  return 'unattempted';
}

function deriveAnswerStatus(status: string | null | undefined, hasAnswer: boolean): AnswerStatus {
  if (!hasAnswer) return 'unattempted';
  return normalizeAnswerStatus(status);
}

type QuestionResponseInput = {
  z7iQuestionId: string;
  attemptId: string;
  questionOrder: number;
  subjectId: string | null;
  subjectName: string;
  questionType: string;
  questionHtml: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  correctAnswer: string;
  studentAnswer: string | null;
  answerStatus: AnswerStatus;
  marksPositive: number;
  marksNegative: number;
  scoreObtained: number;
  timeTaken: number | null;
  solutionHtml: string | null;
};

async function upsertQuestionResponses(questionRows: QuestionResponseInput[]) {
  if (questionRows.length === 0) return;
  await prisma.$transaction(
    questionRows.map((row) =>
      prisma.questionResponse.upsert({
        where: {
          z7iQuestionId_attemptId: {
            z7iQuestionId: row.z7iQuestionId,
            attemptId: row.attemptId,
          },
        },
        create: row,
        update: row,
      })
    )
  );
}

function shouldUseLatestRevisionForAttempt(baseScore: number, revisionCount: number) {
  return baseScore === 0 && revisionCount > 0;
}

function getUnattemptedCount(scoreOverview: ScoreOverviewSummary | null, fallbackTotal?: number) {
  const totalRaw = scoreOverview?.test?.[0]?.total_qs;
  const totalQuestions = Number(totalRaw ?? fallbackTotal ?? 0);
  const correct = Number(scoreOverview?.correct ?? 0);
  const incorrect = Number(scoreOverview?.incorrect ?? 0);
  if (Number.isFinite(totalQuestions) && totalQuestions > 0) {
    return Math.max(0, totalQuestions - correct - incorrect);
  }
  const attempted = Number(scoreOverview?.attempted ?? 0);
  if (Number.isFinite(attempted) && Number.isFinite(fallbackTotal) && fallbackTotal) {
    return Math.max(0, fallbackTotal - attempted);
  }
  return 0;
}

async function updateQuestionResponses(
  z7iQuestionId: string,
  correctAnswer: string
) {
  const responses = await prisma.questionResponse.findMany({
    where: { z7iQuestionId },
    select: { id: true, studentAnswer: true, questionType: true, marksPositive: true, marksNegative: true }
  });

  if (responses.length === 0) return;

  await prisma.$transaction(
    responses.map(response => {
      const answerStatus = response.studentAnswer
        ? (isAnswerMatch(response.studentAnswer, correctAnswer, response.questionType) ? 'correct' : 'incorrect')
        : 'unattempted';
      const scoreObtained = answerStatus === 'correct'
        ? response.marksPositive
        : answerStatus === 'incorrect'
          ? -response.marksNegative
          : 0;
      return prisma.questionResponse.update({
        where: { id: response.id },
        data: { answerStatus, scoreObtained }
      });
    })
  );
}

async function getQuestionUserStats(z7iQuestionId: string) {
  const [aggregatedStats, statusCounts] = await Promise.all([
    prisma.questionResponse.aggregate({
      where: { z7iQuestionId },
      _count: { id: true },
      _avg: { timeTaken: true }
    }),
    prisma.questionResponse.groupBy({
      by: ['answerStatus'],
      where: { z7iQuestionId },
      _count: { id: true }
    })
  ]);

  const userStats = {
    totalUsers: aggregatedStats._count.id,
    correct: 0,
    incorrect: 0,
    unattempted: 0,
    avgTime: aggregatedStats._avg.timeTaken
  };

  statusCounts.forEach(stat => {
    if (stat.answerStatus === 'correct') userStats.correct = stat._count.id;
    else if (stat.answerStatus === 'incorrect') userStats.incorrect = stat._count.id;
    else userStats.unattempted = stat._count.id;
  });

  return userStats;
}

const PACKAGE_DETAIL_CONCURRENCY = 4;
const PACKAGE_DETAIL_MAX_RETRIES = 2;
const PACKAGE_DETAIL_RETRY_BASE_MS = 500;

type PackageDetailFailure = {
  packageId: string;
  name: string;
  error: string;
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === 'number') {
    return status >= 500 || status === 429;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econn') ||
      message.includes('socket')
    );
  }
  return false;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isTransientError(error)) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 100);
      await sleep(delay + jitter);
      attempt += 1;
    }
  }
}

async function fetchPackageDetailsWithConcurrency(cookies: string[], packages: any[]) {
  const details: Array<{ tests: any[] } | null> = new Array(packages.length).fill(null);
  const failures: PackageDetailFailure[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(PACKAGE_DETAIL_CONCURRENCY, packages.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= packages.length) return;
      const pkg = packages[index];
      try {
        const data = await retryWithBackoff(
          () => z7iGetPackageDetails(cookies, pkg._id.$oid),
          PACKAGE_DETAIL_MAX_RETRIES,
          PACKAGE_DETAIL_RETRY_BASE_MS
        );
        details[index] = data;
        if (!data) {
          failures.push({
            packageId: pkg._id.$oid,
            name: pkg.name,
            error: 'No package details returned'
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          packageId: pkg._id.$oid,
          name: pkg.name,
          error: message
        });
      }
    }
  });

  await Promise.all(workers);
  return { details, failures };
}
async function handleAdminListTests(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const tests = await prisma.test.findMany({
      include: {
        package: { select: { name: true, z7iAccountId: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const formatted = tests.map(test => ({
      id: test.id,
      z7iId: test.z7iId,
      name: test.name,
      packageName: test.package?.name || '',
      packageId: test.packageId,
      z7iAccountId: test.package?.z7iAccountId || '',
      testType: test.testType,
      createdAt: test.createdAt,
      totalQuestions: test.totalQuestions
    }));
    return res.status(200).json({ success: true, tests: formatted });
  } catch (error) {
    console.error('Admin list tests error:', error);
    return res.status(500).json({ error: 'Failed to list tests' });
  }
}

async function handleLink(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

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
    // Fetch a random synced user's credentials for guest sync
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
      return res.status(400).json({ error: isGuest ? 'Guest sync account is unavailable right now.' : 'Invalid Z7I credentials' });
    }
    let firstName: string | null = null;
    try {
      firstName = await z7iGetFirstName(loginResult.cookies);
    } catch {}

    const encryptedPassword = encryptZ7iPassword(effectivePassword);

    if (user.z7iAccount) {
      await prisma.z7iAccount.update({
        where: { id: user.z7iAccount.id },
        data: { enrollmentNo: effectiveEnrollment, encryptedPassword, isGuest, syncStatus: 'pending', firstName }
      });
    } else {
      await prisma.z7iAccount.create({
        data: { userId: user.id, enrollmentNo: effectiveEnrollment, encryptedPassword, isGuest, syncStatus: 'pending', firstName }
      });
    }

    return res.status(200).json({ success: true, message: isGuest ? 'Guest sync enabled' : 'Z7I account linked', enrollmentNo: effectiveEnrollment, isGuest });
  } catch (error) {
    console.error('Link Z7I error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleSync(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    const z7iAccount = user.z7iAccount;
    const isGuestSync = z7iAccount.isGuest;
    if (isGuestSync && !user.canUseGuestSync) {
      return res.status(403).json({ error: 'Guest sync access is not enabled for this account' });
    }

    await prisma.z7iAccount.update({
      where: { id: z7iAccount.id },
      data: { syncStatus: 'syncing' }
    });

    const z7iPassword = decryptZ7iPassword(z7iAccount.encryptedPassword);
    const loginResult = await z7iLogin(z7iAccount.enrollmentNo, z7iPassword);
    if (!loginResult) {
      await prisma.z7iAccount.update({ where: { id: z7iAccount.id }, data: { syncStatus: 'failed' } });
      return res.status(400).json({ error: 'Failed to login to Z7I' });
    }
    const cookies = loginResult.cookies;
    try {
      const firstName = await z7iGetFirstName(cookies);
      if (firstName) {
        await prisma.z7iAccount.update({ where: { id: z7iAccount.id }, data: { firstName } });
      }
    } catch {}
    let testsProcessed = 0;
    let questionsProcessed = 0;
    let skippedTests = 0;

    const existingAttempts = await prisma.testAttempt.findMany({
      where: { z7iAccountId: z7iAccount.id },
      select: { z7iId: true },
    });
    const existingAttemptIds = new Set(existingAttempts.map((a: { z7iId: string }) => a.z7iId));

    const packages = await z7iGetPackages(cookies);

    const { details: packageDetails, failures: packageFailures } =
      await fetchPackageDetailsWithConcurrency(cookies, packages);

    const packageNameMap = new Map();
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      if (!packageNameMap.has(pkg.name)) packageNameMap.set(pkg.name, []);
      packageNameMap.get(pkg.name).push({ pkg, details: packageDetails[i], index: i });
    }

    const mergedPackages: Array<{ pkg: any, details: any, index: number, mergedInto?: number }> = [];
    for (const [name, arr] of packageNameMap.entries()) {
      if (arr.length === 1) {
        mergedPackages.push(arr[0]);
      } else {
        const withQuestions = arr.find((x: any) => x.details && x.details.tests && x.details.tests.length > 0);
        const withoutQuestions = arr.find((x: any) => !x.details || !x.details.tests || x.details.tests.length === 0);
        if (withQuestions && withoutQuestions) {
          mergedPackages.push({ ...withQuestions });
        } else {
          mergedPackages.push(arr[0]);
        }
      }
    }

    for (const { pkg, details } of mergedPackages) {
      const pkgId = pkg._id.$oid;
      if (!details) continue;

      const dbPackage = await prisma.package.upsert({
        where: { z7iId_z7iAccountId: { z7iId: pkgId, z7iAccountId: z7iAccount.id } },
        create: {
          z7iId: pkgId,
          z7iAccountId: z7iAccount.id,
          name: pkg.name,
          description: pkg.description?.replace(/<[^>]*>/g, '') || null,
          expiryDate: pkg.expiry_date ? new Date(pkg.expiry_date * 1000) : null,
        },
        update: {
          name: pkg.name,
          description: pkg.description?.replace(/<[^>]*>/g, '') || null,
          expiryDate: pkg.expiry_date ? new Date(pkg.expiry_date * 1000) : null,
        }
      });

      for (const test of details.tests as any[]) {
        const testId = test._id.$oid;
        const subjectsData = test.subjects
          ? (test.subjects as any[]).map((s: any) => ({
            id: s.subject.$oid,
            name: s.subject_name,
            questionCount: parseInt(s.no_of_question)
          }))
          : undefined;

        const dbTest = await prisma.test.upsert({
          where: { z7iId_packageId: { z7iId: testId, packageId: dbPackage.id } },
          create: {
            z7iId: testId,
            packageId: dbPackage.id,
            name: test.test_name,
            description: test.description || null,
            testType: test.test_type || null,
            timeLimit: test.time_limit ? parseInt(test.time_limit) : null,
            maxScore: test.max_score || null,
            totalQuestions: test.questions?.length || null,
            subjects: subjectsData,
          },
          update: {
            name: test.test_name,
            description: test.description || null,
            testType: test.test_type || null,
            timeLimit: test.time_limit ? parseInt(test.time_limit) : null,
            maxScore: test.max_score || null,
            totalQuestions: test.questions?.length || null,
            subjects: subjectsData,
          }
        });

        const scoreOverview = await z7iGetScoreOverview(cookies, testId);
        if (scoreOverview) {
          const attemptId = scoreOverview._id.$oid;
          const unattemptedCount = isGuestSync ? (test.questions?.length || test.total_questions || 0) : getUnattemptedCount(scoreOverview);
          if (existingAttemptIds.has(attemptId)) {
            skippedTests++;
            continue;
          }
          const existingUnattempted = await prisma.testAttempt.findFirst({
            where: {
              testId: dbTest.id,
              z7iAccountId: z7iAccount.id,
              submitDate: null
            }
          });
          let dbAttempt;
          if (existingUnattempted) {
            dbAttempt = await prisma.testAttempt.update({
              where: { id: existingUnattempted.id },
              data: {
                z7iId: attemptId,
                timeTaken: scoreOverview.time_taken,
                submitDate: new Date(scoreOverview.submit_date * 1000),
                correct: isGuestSync ? 0 : scoreOverview.correct,
                incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
                unattempted: unattemptedCount,
                totalScore: isGuestSync ? 0 : scoreOverview.total_score,
                maxScore: scoreOverview.test?.[0]?.max_score || null,
                rank: isGuestSync ? null : (scoreOverview.rank || null),
                percentile: isGuestSync ? null : (scoreOverview.percentile || null),
                bonusMarks: isGuestSync ? null : (scoreOverview.bonus_marks || null),
              }
            });
          } else {
            dbAttempt = await prisma.testAttempt.upsert({
              where: { z7iId_z7iAccountId: { z7iId: attemptId, z7iAccountId: z7iAccount.id } },
              create: {
                z7iId: attemptId,
                z7iAccountId: z7iAccount.id,
                testId: dbTest.id,
                timeTaken: scoreOverview.time_taken,
                submitDate: new Date(scoreOverview.submit_date * 1000),
                correct: isGuestSync ? 0 : scoreOverview.correct,
                incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
                unattempted: unattemptedCount,
                totalScore: isGuestSync ? 0 : scoreOverview.total_score,
                maxScore: scoreOverview.test?.[0]?.max_score || null,
                rank: isGuestSync ? null : (scoreOverview.rank || null),
                percentile: isGuestSync ? null : (scoreOverview.percentile || null),
                bonusMarks: isGuestSync ? null : (scoreOverview.bonus_marks || null),
              },
              update: {
                timeTaken: isGuestSync ? null : scoreOverview.time_taken,
                correct: isGuestSync ? 0 : scoreOverview.correct,
                incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
                unattempted: unattemptedCount,
                totalScore: isGuestSync ? 0 : scoreOverview.total_score,
                rank: isGuestSync ? null : (scoreOverview.rank || null),
                percentile: isGuestSync ? null : (scoreOverview.percentile || null),
                bonusMarks: isGuestSync ? null : (scoreOverview.bonus_marks || null),
              }
            });
          }
          testsProcessed++;

          const questions = await z7iGetQuestionwise(cookies, testId);
          if (questions.length > 0) {
            const questionRows = (questions as any[]).map((q: any) => {
              const qId = q._id.$oid;
              const subjectId = q.subject.$oid;
              const hasAnswer = q.std_ans !== null && q.std_ans !== undefined && String(q.std_ans).trim() !== '';
              return {
                z7iQuestionId: qId,
                attemptId: dbAttempt.id,
                questionOrder: q.__order,
                subjectId,
                subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                questionType: q.question_type,
                questionHtml: q.question,
                option1: q.opt1 || null,
                option2: q.opt2 || null,
                option3: q.opt3 || null,
                option4: q.opt4 || null,
                correctAnswer: q.ans,
                studentAnswer: isGuestSync ? null : (hasAnswer ? String(q.std_ans) : null),
                answerStatus: isGuestSync ? 'unattempted' : deriveAnswerStatus(q.ans_status, hasAnswer),
                marksPositive: parseFloat(q.marks_positive),
                marksNegative: parseFloat(q.marks_negative),
                scoreObtained: isGuestSync ? 0 : (hasAnswer ? (q.p_score + q.n_score) : 0),
                timeTaken: isGuestSync ? null : (q.time_taken || null),
                solutionHtml: q.find_hint || null,
              };
            });
            await upsertQuestionResponses(questionRows);
            questionsProcessed += questionRows.length;
          }
        } else {
          if (existingAttemptIds.has(testId)) {
            skippedTests++;
            continue;
          }
          const unattendedAttempt = await prisma.testAttempt.upsert({
            where: { z7iId_z7iAccountId: { z7iId: testId, z7iAccountId: z7iAccount.id } },
            create: {
              z7iId: testId,
              z7iAccountId: z7iAccount.id,
              testId: dbTest.id,
              timeTaken: null,
              submitDate: null,
              correct: 0,
              incorrect: 0,
              unattempted: 0,
              totalScore: 0,
              maxScore: test.max_score || null,
              rank: null,
              percentile: null,
              bonusMarks: null
            },
            update: {
              timeTaken: null,
              correct: 0,
              incorrect: 0,
              unattempted: 0,
              totalScore: 0,
              rank: null,
              percentile: null,
              bonusMarks: null
            }
          });
          const questions = await z7iGetQuestionwise(cookies, testId);
          if (questions.length > 0) {
            const questionRows = (questions as any[]).map((q: any) => {
              const qId = q._id.$oid;
              const subjectId = q.subject.$oid;
              return {
                z7iQuestionId: qId,
                attemptId: unattendedAttempt.id,
                questionOrder: q.__order,
                subjectId,
                subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                questionType: q.question_type,
                questionHtml: q.question,
                option1: q.opt1 || null,
                option2: q.opt2 || null,
                option3: q.opt3 || null,
                option4: q.opt4 || null,
                correctAnswer: q.ans,
                studentAnswer: null,
                answerStatus: 'unattempted',
                marksPositive: parseFloat(q.marks_positive),
                marksNegative: parseFloat(q.marks_negative),
                scoreObtained: 0,
                timeTaken: null,
                solutionHtml: q.find_hint || null,
              };
            });
            await upsertQuestionResponses(questionRows);
            questionsProcessed += questionRows.length;
          }
          if (questions.length > 0) {
            await prisma.testAttempt.update({
              where: { id: unattendedAttempt.id },
              data: { unattempted: questions.length }
            });
          }
          testsProcessed++;
        }
      }
    }

    await prisma.z7iAccount.update({
      where: { id: z7iAccount.id },
      data: { syncStatus: 'success', lastSyncAt: new Date() }
    });

    return res.status(200).json({
      success: true,
      message: 'Sync completed',
      stats: { packages: packages.length, tests: testsProcessed, questions: questionsProcessed, skipped: skippedTests },
      failures: { packages: packageFailures }
    });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Sync failed' });
  }
}

async function handleResyncTest(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { testZ7iId, attemptId } = req.body;
  if (!testZ7iId || !attemptId) {
    return res.status(400).json({ error: 'Test Z7I ID and attempt ID are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    const z7iAccount = user.z7iAccount;
    const z7iPassword = decryptZ7iPassword(z7iAccount.encryptedPassword);
    const loginResult = await z7iLogin(z7iAccount.enrollmentNo, z7iPassword);

    if (!loginResult) {
      return res.status(400).json({ error: 'Failed to login to Z7I' });
    }

    const cookies = loginResult.cookies;

    const scoreOverview = await z7iGetScoreOverview(cookies, testZ7iId);
    const isGuestSync = Boolean(z7iAccount.isGuest);
    let updatedAttempt;
    if (scoreOverview) {
      const unattemptedCount = getUnattemptedCount(scoreOverview);
      updatedAttempt = await prisma.testAttempt.update({
        where: { id: attemptId },
        data: {
          timeTaken: isGuestSync ? null : scoreOverview.time_taken,
          correct: isGuestSync ? 0 : scoreOverview.correct,
          incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
          unattempted: unattemptedCount,
          totalScore: isGuestSync ? 0 : scoreOverview.total_score,
          maxScore: scoreOverview.test?.[0]?.max_score || null,
          rank: isGuestSync ? null : (scoreOverview.rank || null),
          percentile: isGuestSync ? null : (scoreOverview.percentile || null),
          bonusMarks: isGuestSync ? null : (scoreOverview.bonus_marks || null),
        },
        include: {
          test: true
        }
      });
    } else {
      updatedAttempt = await prisma.testAttempt.update({
        where: { id: attemptId },
        data: {
          timeTaken: null,
          correct: 0,
          incorrect: 0,
          unattempted: 0,
          totalScore: 0,
          maxScore: null,
          rank: null,
          percentile: null,
          bonusMarks: null,
        },
        include: {
          test: true
        }
      });
    }

    const questions = await z7iGetQuestionwise(cookies, testZ7iId);
    if (!scoreOverview && questions.length > 0) {
      updatedAttempt = await prisma.testAttempt.update({
        where: { id: attemptId },
        data: { unattempted: questions.length },
        include: { test: true }
      });
    }
    const batchSize = 50;
    for (let i = 0; i < questions.length; i += batchSize) {
      const batch = questions.slice(i, i + batchSize);
      await Promise.all(
        batch.map(q => {
          const qId = q._id.$oid;
          const subjectId = q.subject.$oid;
          const hasAnswer = q.std_ans !== null && q.std_ans !== undefined && String(q.std_ans).trim() !== '';
          return prisma.questionResponse.upsert({
            where: { z7iQuestionId_attemptId: { z7iQuestionId: qId, attemptId: updatedAttempt.id } },
            create: {
              z7iQuestionId: qId,
              attemptId: updatedAttempt.id,
              questionOrder: q.__order,
              subjectId,
              subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
              questionType: q.question_type,
              questionHtml: q.question,
              option1: q.opt1 || null,
              option2: q.opt2 || null,
              option3: q.opt3 || null,
              option4: q.opt4 || null,
              correctAnswer: q.ans,
              studentAnswer: isGuestSync ? null : (hasAnswer ? String(q.std_ans) : null),
              answerStatus: isGuestSync ? 'unattempted' : deriveAnswerStatus(q.ans_status, hasAnswer),
              marksPositive: parseFloat(q.marks_positive),
              marksNegative: parseFloat(q.marks_negative),
              scoreObtained: isGuestSync ? 0 : (hasAnswer ? (q.p_score + q.n_score) : 0),
              timeTaken: isGuestSync ? null : (q.time_taken || null),
              solutionHtml: q.find_hint || null,
            },
            update: {
              questionOrder: q.__order,
              subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
              questionType: q.question_type,
              questionHtml: q.question,
              option1: q.opt1 || null,
              option2: q.opt2 || null,
              option3: q.opt3 || null,
              option4: q.opt4 || null,
              correctAnswer: q.ans,
              studentAnswer: isGuestSync ? null : (hasAnswer ? String(q.std_ans) : null),
              answerStatus: isGuestSync ? 'unattempted' : deriveAnswerStatus(q.ans_status, hasAnswer),
              scoreObtained: isGuestSync ? 0 : (hasAnswer ? (q.p_score + q.n_score) : 0),
              timeTaken: isGuestSync ? null : (q.time_taken || null),
            }
          });
        })
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Test resynced successfully',
      attempt: {
        id: updatedAttempt.id,
        testName: updatedAttempt.test.name,
        totalScore: updatedAttempt.totalScore,
        maxScore: updatedAttempt.maxScore,
        rank: updatedAttempt.rank,
        percentile: updatedAttempt.percentile,
        correct: updatedAttempt.correct,
        incorrect: updatedAttempt.incorrect,
        unattempted: updatedAttempt.unattempted,
      }
    });
  } catch (error) {
    console.error('Resync test error:', error);
    return res.status(500).json({ error: 'Failed to resync test' });
  }
}

async function handleTests(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    const attempts = await prisma.testAttempt.findMany({
      where: { z7iAccountId: user.z7iAccount.id },
      include: {
        test: { include: { package: { select: { name: true } } } },
        _count: { select: { responses: true } },
        responses: {
          select: {
            z7iQuestionId: true,
            studentAnswer: true,
            correctAnswer: true,
            questionType: true,
            answerStatus: true,
            scoreObtained: true,
            marksPositive: true,
            marksNegative: true,
          }
        }
      },
      orderBy: { submitDate: 'desc' }
    });

    const attemptIds = attempts.map(attempt => attempt.id);
    const revisions = attemptIds.length > 0
      ? await prisma.testRevision.findMany({
          where: { attemptId: { in: attemptIds } },
          orderBy: { createdAt: 'desc' }
        })
      : [];
    const latestRevisionByAttemptId = new Map<string, (typeof revisions)[number]>();
    revisions.forEach(revision => {
      if (!latestRevisionByAttemptId.has(revision.attemptId)) {
        latestRevisionByAttemptId.set(revision.attemptId, revision);
      }
    });

    const testZ7iIds = [...new Set(attempts.map(a => a.test.z7iId).filter(Boolean))] as string[];

    const keyChanges = await prisma.answerKeyChange.findMany({
      where: {
        testZ7iId: { in: testZ7iIds }
      }
    });

    const keyChangesByTestZ7iId = new Map<string, typeof keyChanges>();
    keyChanges.forEach(kc => {
      const existing = keyChangesByTestZ7iId.get(kc.testZ7iId) || [];
      existing.push(kc);
      keyChangesByTestZ7iId.set(kc.testZ7iId, existing);
    });

    const bonusQuestions = await prisma.bonusQuestion.findMany({
      where: {
        testZ7iId: { in: testZ7iIds }
      }
    });

    const bonusQsByTest = new Map<string, Set<string>>();
    bonusQuestions.forEach(bq => {
      const existing = bonusQsByTest.get(bq.testZ7iId) || new Set();
      existing.add(bq.z7iQuestionId);
      bonusQsByTest.set(bq.testZ7iId, existing);
    });

    const leaderboardRankByTest = new Map<string, Map<string, number>>();
    if (testZ7iIds.length > 0) {
      const testsForLeaderboard = await prisma.test.findMany({
        where: { z7iId: { in: testZ7iIds } },
        select: { id: true, z7iId: true }
      });
      const testIdToZ7i = new Map(testsForLeaderboard.map((t) => [t.id, t.z7iId]));
      const leaderboardTestIds = testsForLeaderboard.map((t) => t.id);

      const leaderboardAttempts = leaderboardTestIds.length > 0
        ? await prisma.testAttempt.findMany({
            where: { testId: { in: leaderboardTestIds } },
            select: {
              id: true,
              testId: true,
              totalScore: true,
              submitDate: true,
              createdAt: true,
              z7iAccount: { select: { enrollmentNo: true, isGuest: true, user: { select: { id: true } } } },
              responses: {
                select: {
                  z7iQuestionId: true,
                  studentAnswer: true,
                  answerStatus: true,
                  questionType: true,
                }
              }
            }
          })
        : [];

      const leaderboardAttemptIds = leaderboardAttempts.map((a) => a.id);
      const leaderboardRevisions = leaderboardAttemptIds.length > 0
        ? await prisma.testRevision.findMany({
            where: { attemptId: { in: leaderboardAttemptIds } },
            select: { attemptId: true, totalScore: true }
          })
        : [];

      const revisionBestByAttemptId = new Map<string, number>();
      leaderboardRevisions.forEach((revision) => {
        const existing = revisionBestByAttemptId.get(revision.attemptId);
        if (existing == null || revision.totalScore > existing) {
          revisionBestByAttemptId.set(revision.attemptId, revision.totalScore);
        }
      });

      const scoreByTestAndEnrollment = new Map<string, Map<string, number>>();

      for (const attempt of leaderboardAttempts) {
        const testZ7iId = testIdToZ7i.get(attempt.testId);
        if (!testZ7iId) continue;

        const keyChangesForTest = keyChangesByTestZ7iId.get(testZ7iId) || [];
        const keyChangeMap = new Map<string, { newAnswer: string; originalAnswer: string }>();
        keyChangesForTest.forEach((kc) => {
          keyChangeMap.set(kc.z7iQuestionId, { newAnswer: kc.newAnswer, originalAnswer: kc.originalAnswer });
        });

        const bonusSet = bonusQsByTest.get(testZ7iId) || new Set<string>();
        let scoreAdjustment = 0;
        let bonusMarks = 0;

        for (const response of attempt.responses) {
          const keyChange = keyChangeMap.get(response.z7iQuestionId);
          const rawStatus = normalizeAnswerStatus(response.answerStatus);

          if (bonusSet.has(response.z7iQuestionId) && rawStatus === 'incorrect') {
            bonusMarks += 5;
          }

          if (keyChange && response.studentAnswer) {
            const matchesNew = isAnswerMatch(response.studentAnswer, keyChange.newAnswer, response.questionType);
            const matchesOriginal = isAnswerMatch(response.studentAnswer, keyChange.originalAnswer, response.questionType);
            if (matchesNew && !matchesOriginal) {
              scoreAdjustment += 5;
            } else if (matchesOriginal && !matchesNew) {
              scoreAdjustment -= 5;
            }
          }
        }

        const baseAdjusted = attempt.totalScore + scoreAdjustment + bonusMarks;
        const revisionBest = revisionBestByAttemptId.get(attempt.id);
        const effectiveScore = revisionBest != null ? Math.max(baseAdjusted, revisionBest + scoreAdjustment + bonusMarks) : baseAdjusted;
        const enrollment = attempt.z7iAccount.isGuest
          ? attempt.z7iAccount.user.id
          : (attempt.z7iAccount.enrollmentNo || attempt.z7iAccount.user.id);

        const byEnrollment = scoreByTestAndEnrollment.get(testZ7iId) || new Map<string, number>();
        const existing = byEnrollment.get(enrollment);
        if (existing == null || effectiveScore > existing) {
          byEnrollment.set(enrollment, effectiveScore);
        }
        scoreByTestAndEnrollment.set(testZ7iId, byEnrollment);
      }

      for (const [testZ7iId, scoreByEnrollment] of scoreByTestAndEnrollment.entries()) {
        const ranked = Array.from(scoreByEnrollment.entries())
          .sort((a, b) => b[1] - a[1]);
        const rankMap = new Map<string, number>();
        ranked.forEach(([enrollment], idx) => rankMap.set(enrollment, idx + 1));
        leaderboardRankByTest.set(testZ7iId, rankMap);
      }
    }

    const tests = attempts.map(attempt => {
      const latestRevision = latestRevisionByAttemptId.get(attempt.id);
      const shouldUseRevision = shouldUseLatestRevisionForAttempt(attempt.totalScore, latestRevision ? 1 : 0);
      const testZ7iId = attempt.test.z7iId;
      const attemptKeyChanges = testZ7iId ? (keyChangesByTestZ7iId.get(testZ7iId) || []) : [];
      const bonusQs = testZ7iId ? (bonusQsByTest.get(testZ7iId) || new Set()) : new Set();

      const keyChangeMap = new Map<string, { newAnswer: string; originalAnswer: string }>();
      attemptKeyChanges.forEach(kc => {
        keyChangeMap.set(kc.z7iQuestionId, { newAnswer: kc.newAnswer, originalAnswer: kc.originalAnswer });
      });

      let scoreAdjustment = 0;
      let bonusMarks = 0;
      let derivedCorrect = 0;
      let derivedIncorrect = 0;

      for (const response of attempt.responses) {
        const keyChange = keyChangeMap.get(response.z7iQuestionId);
        const isBonus = bonusQs.has(response.z7iQuestionId);
        const studentAnswer = response.studentAnswer;
        const hasAnswer = Boolean(studentAnswer && String(studentAnswer).trim());
        const normalizedStatus = deriveAnswerStatus(response.answerStatus, hasAnswer);
        const rawStatus = normalizeAnswerStatus(response.answerStatus);
        const wasCorrect = normalizedStatus === 'correct';
        const wasIncorrect = normalizedStatus === 'incorrect';
        if (wasCorrect) derivedCorrect++;
        if (wasIncorrect) derivedIncorrect++;

        if (isBonus && rawStatus === 'incorrect') {
          bonusMarks += 5;
        }

        if (keyChange && studentAnswer) {
          const matchesNew = isAnswerMatch(studentAnswer, keyChange.newAnswer, response.questionType);
          const matchesOriginal = isAnswerMatch(studentAnswer, keyChange.originalAnswer, response.questionType);

          if (matchesNew && !matchesOriginal) {
            scoreAdjustment += 5;
          } else if (matchesOriginal && !matchesNew) {
            scoreAdjustment -= 5;
          }
        }
      }

      const totalResponses = attempt.responses.length;
      const adjustedScore = shouldUseRevision
        ? (latestRevision!.totalScore + scoreAdjustment + bonusMarks)
        : (attempt.totalScore + scoreAdjustment + bonusMarks);
      const effectiveCorrect = shouldUseRevision ? latestRevision!.correct : derivedCorrect;
      const effectiveIncorrect = shouldUseRevision ? latestRevision!.incorrect : derivedIncorrect;
      const effectiveUnattempted = shouldUseRevision
        ? latestRevision!.unattempted
        : Math.max(0, totalResponses - effectiveCorrect - effectiveIncorrect);
      const effectiveTimeTaken = shouldUseRevision ? latestRevision!.timeTaken : attempt.timeTaken;

      const currentUserLeaderboardKey = user.z7iAccount.isGuest
        ? user.id
        : (user.z7iAccount.enrollmentNo || user.id);
      const rankFromLeaderboard = shouldUseRevision && testZ7iId
        ? leaderboardRankByTest.get(testZ7iId)?.get(currentUserLeaderboardKey) ?? null
        : null;

      return {
        id: attempt.id,
        testId: attempt.testId,
        testName: attempt.test.name,
        packageName: attempt.test.package.name,
        testType: attempt.test.testType,
        submitDate: attempt.submitDate,
        timeTaken: effectiveTimeTaken,
        correct: effectiveCorrect,
        incorrect: effectiveIncorrect,
        unattempted: effectiveUnattempted,
        totalScore: attempt.totalScore,
        maxScore: attempt.maxScore || attempt.test.maxScore,
        rank: rankFromLeaderboard ?? (shouldUseRevision ? null : attempt.rank),
        percentile: attempt.percentile,
        totalQuestions: totalResponses,
        subjects: attempt.test.subjects,
        hasKeyChanges: attemptKeyChanges.length > 0,
        keyChangeCount: attemptKeyChanges.length,
        bonusMarks,
        adjustedScore,
        usingRevisionScore: shouldUseRevision,
      };
    });

    return res.status(200).json({ success: true, tests });
  } catch (error) {
    console.error('Get tests error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleQuestions(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { attemptId, subject, asUserId } = req.query;
  if (!attemptId || typeof attemptId !== 'string') {
    return res.status(400).json({ error: 'Attempt ID is required' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const requester = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!requester || !requester.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    const privileges = await getAiPrivileges(payload.userId);
    const userIsAdmin = privileges.isOwner;
    const targetUserId = typeof asUserId === 'string' && asUserId ? asUserId : payload.userId;
    if (targetUserId !== payload.userId && !userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required for perspective view' });
    }

    let targetZ7iAccountId = requester.z7iAccount.id;
    if (targetUserId !== payload.userId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        include: { z7iAccount: true }
      });
      if (!targetUser?.z7iAccount) {
        return res.status(404).json({ error: 'Target user has no linked Z7I account' });
      }
      targetZ7iAccountId = targetUser.z7iAccount.id;
    }

    const attempt = await prisma.testAttempt.findFirst({
      where: { id: attemptId, z7iAccountId: targetZ7iAccountId },
      include: {
        test: { select: { name: true, testType: true, maxScore: true, subjects: true, timeLimit: true, package: { select: { name: true } } } }
      }
    });

    if (!attempt) return res.status(404).json({ error: 'Test attempt not found' });

    const whereClause: { attemptId: string; subjectName?: string } = { attemptId };
    if (subject && typeof subject === 'string' && subject !== 'all') {
      whereClause.subjectName = subject.toUpperCase();
    }

    const questions = await prisma.questionResponse.findMany({
      where: whereClause,
      orderBy: { questionOrder: 'asc' }
    });
    const latestRevision = await prisma.testRevision.findFirst({
      where: {
        attemptId,
        userId: targetUserId,
      },
      include: { responses: true },
      orderBy: { createdAt: 'desc' }
    });
    const shouldUseRevision = shouldUseLatestRevisionForAttempt(attempt.totalScore, latestRevision ? 1 : 0);
    const revisionResponseByQuestionId = new Map(
      (latestRevision?.responses || []).map(response => [response.z7iQuestionId, response])
    );
    const derivedCounts = questions.reduce(
      (acc, q) => {
        const revisionResponse = shouldUseRevision ? revisionResponseByQuestionId.get(q.z7iQuestionId) : null;
        const normalized = revisionResponse
          ? normalizeAnswerStatus(revisionResponse.status)
          : deriveAnswerStatus(q.answerStatus, !!(q.studentAnswer && q.studentAnswer.trim()));
        if (normalized === 'correct') acc.correct += 1;
        if (normalized === 'incorrect') acc.incorrect += 1;
        return acc;
      },
      { correct: 0, incorrect: 0 }
    );
    const derivedUnattempted = Math.max(0, questions.length - derivedCounts.correct - derivedCounts.incorrect);

    const subjectStatsMap = new Map<string, { total: number; score: number }>();
    questions.forEach(q => {
      const key = q.subjectName;
      const existing = subjectStatsMap.get(key) || { total: 0, score: 0 };
      const revisionResponse = shouldUseRevision ? revisionResponseByQuestionId.get(q.z7iQuestionId) : null;
      existing.total += 1;
      existing.score += Number(revisionResponse ? revisionResponse.marksObtained : q.scoreObtained || 0);
      subjectStatsMap.set(key, existing);
    });
    const subjects = Array.from(subjectStatsMap.entries()).map(([name, value]) => ({
      name,
      total: value.total,
      score: value.score,
    }));

    const questionIds = questions.map(q => q.id);
    
    const bookmarks = await prisma.questionBookmark.findMany({
      where: { userId: payload.userId, questionId: { in: questionIds } },
      select: { questionId: true }
    });
    
    const notes = await prisma.questionNote.findMany({
      where: { userId: payload.userId, questionId: { in: questionIds } },
      select: { questionId: true, content: true }
    });
    
    const comments = await prisma.questionComment.findMany({
      where: { questionId: { in: questionIds } },
      select: { id: true, questionId: true, userId: true, userName: true, content: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    
    const bookmarkSet = new Set(bookmarks.map(b => b.questionId));
    const notesMap = new Map(notes.map(n => [n.questionId, n.content]));
    const commentsMap = new Map<string, typeof comments>();
    for (const c of comments) {
      if (!commentsMap.has(c.questionId)) commentsMap.set(c.questionId, []);
      commentsMap.get(c.questionId)!.push(c);
    }

    const z7iQuestionIds = questions.map(q => q.z7iQuestionId);
    const bonusQuestions = await prisma.bonusQuestion.findMany({
      where: { z7iQuestionId: { in: z7iQuestionIds } }
    });
    const bonusSet = new Set(bonusQuestions.map(b => b.z7iQuestionId));

    const answerKeyChanges = await prisma.answerKeyChange.findMany({
      where: { z7iQuestionId: { in: z7iQuestionIds } }
    });
    const keyChangeMap = new Map(answerKeyChanges.map(k => [k.z7iQuestionId, { newAnswer: k.newAnswer, originalAnswer: k.originalAnswer }]));

    const aggregatedStats = await prisma.questionResponse.groupBy({
      by: ['z7iQuestionId'],
      where: { z7iQuestionId: { in: z7iQuestionIds } },
      _count: { id: true },
      _avg: { timeTaken: true },
    });

    const statusCounts = await prisma.questionResponse.groupBy({
      by: ['z7iQuestionId', 'answerStatus'],
      where: { z7iQuestionId: { in: z7iQuestionIds } },
      _count: { id: true },
    });

    const userStatsMap = new Map<string, { 
      totalUsers: number; 
      correct: number; 
      incorrect: number; 
      unattempted: number;
      avgTime: number | null;
    }>();
    
    for (const stat of aggregatedStats) {
      userStatsMap.set(stat.z7iQuestionId, {
        totalUsers: stat._count.id,
        correct: 0,
        incorrect: 0,
        unattempted: 0,
        avgTime: stat._avg.timeTaken,
      });
    }
    
    for (const sc of statusCounts) {
      const existing = userStatsMap.get(sc.z7iQuestionId);
      if (existing) {
        if (sc.answerStatus === 'correct') existing.correct = sc._count.id;
        else if (sc.answerStatus === 'incorrect') existing.incorrect = sc._count.id;
        else existing.unattempted = sc._count.id;
      }
    }

    const canUseAi = privileges.canUseAi;
    const canGenerateAi = privileges.canGenerateAi;
    const canEditKey = privileges.canEditKey;

    const testRecord = await prisma.test.findUnique({
      where: { id: attempt.testId },
      select: { z7iId: true }
    });

    return res.status(200).json({
      success: true,
      perspectiveUserId: targetUserId,
      isAdmin: userIsAdmin,
      isOwner: userIsAdmin,
      canGenerateAi,
      canEditKey,
      testZ7iId: testRecord?.z7iId || null,
      attempt: {
        id: attempt.id,
        testName: attempt.test.name,
        packageName: attempt.test.package.name,
        testType: attempt.test.testType,
        timeLimit: attempt.test.timeLimit || 180, // Default 180 minutes for JEE
        submitDate: attempt.submitDate,
        timeTaken: shouldUseRevision ? (latestRevision?.timeTaken || attempt.timeTaken) : attempt.timeTaken,
        correct: derivedCounts.correct,
        incorrect: derivedCounts.incorrect,
        unattempted: derivedUnattempted,
        totalScore: shouldUseRevision ? (latestRevision?.totalScore || attempt.totalScore) : attempt.totalScore,
        maxScore: attempt.maxScore || attempt.test.maxScore,
        rank: shouldUseRevision ? null : attempt.rank,
        percentile: attempt.percentile,
        usingRevisionScore: shouldUseRevision,
      },
      subjects,
      questions: await Promise.all(questions.map(async q => {
        const revisionResponse = shouldUseRevision ? revisionResponseByQuestionId.get(q.z7iQuestionId) : null;
        const isBonus = bonusSet.has(q.z7iQuestionId);
        const keyChange = keyChangeMap.get(q.z7iQuestionId);
        const effectiveCorrectAnswer = keyChange ? keyChange.newAnswer : q.correctAnswer;
        const originalCorrectAnswer = q.correctAnswer;
        const hasKeyChange = !!keyChange;
        const studentAnswer = revisionResponse?.userAnswer ?? q.studentAnswer;
        const hasStudentAnswer = !!(studentAnswer && studentAnswer.trim());
        let effectiveStatus = revisionResponse
          ? normalizeAnswerStatus(revisionResponse.status)
          : deriveAnswerStatus(q.answerStatus, hasStudentAnswer);
        let effectiveScore = revisionResponse ? revisionResponse.marksObtained : q.scoreObtained;
        let keyChangeAdjustment = 0;
        if (hasKeyChange && hasStudentAnswer && studentAnswer) {
          const matchesNew = isAnswerMatch(studentAnswer, effectiveCorrectAnswer, q.questionType);
          const matchesOriginal = isAnswerMatch(studentAnswer, originalCorrectAnswer, q.questionType);
          if (matchesNew) {
            effectiveStatus = 'correct';
            effectiveScore = q.marksPositive;
          } else {
            effectiveStatus = 'incorrect';
            effectiveScore = -q.marksNegative;
          }
          if (matchesNew && !matchesOriginal) {
            keyChangeAdjustment = 5;
          } else if (matchesOriginal && !matchesNew) {
            keyChangeAdjustment = -5;
          }
        }
        const wasIncorrect = normalizeAnswerStatus(q.answerStatus) === 'incorrect';
        const bonusMarks = isBonus && wasIncorrect ? 5 : 0;

        let aiSolution = q.aiSolutionHtml;
        let aiGeneratedAt = q.aiGeneratedAt;
        if (!aiSolution) {
          const globalAi = await prisma.questionResponse.findFirst({
            where: {
              z7iQuestionId: q.z7iQuestionId,
              aiSolutionHtml: { not: null }
            },
            select: { aiSolutionHtml: true, aiGeneratedAt: true },
            orderBy: { aiGeneratedAt: 'desc' }
          });
          if (globalAi) {
            aiSolution = globalAi.aiSolutionHtml;
            aiGeneratedAt = globalAi.aiGeneratedAt;
          }
        }

        return {
          id: q.id,
          z7iQuestionId: q.z7iQuestionId,
          order: q.questionOrder + 1,
          subject: q.subjectName,
          type: q.questionType,
          questionHtml: q.questionHtml,
          option1: q.option1,
          option2: q.option2,
          option3: q.option3,
          option4: q.option4,
          correctAnswer: effectiveCorrectAnswer,
          originalCorrectAnswer: hasKeyChange ? originalCorrectAnswer : null,
          hasKeyChange,
          keyChangeAdjustment,
          studentAnswer,
          status: effectiveStatus,
          originalStatus: hasKeyChange ? q.answerStatus : null,
          marksPositive: q.marksPositive,
          marksNegative: q.marksNegative,
          scoreObtained: effectiveScore,
          originalScoreObtained: hasKeyChange ? q.scoreObtained : null,
          timeTaken: revisionResponse?.timeSpent ?? q.timeTaken,
          avgTimeTaken: q.avgTimeTaken,
          percentCorrect: q.percentCorrect,
          solution: q.solutionHtml,
          aiSolution,
          aiGeneratedAt,
          isBookmarked: bookmarkSet.has(q.id),
          note: notesMap.get(q.id) || null,
          comments: commentsMap.get(q.id) || [],
          isBonus,
          bonusMarks,
          userStats: userStatsMap.get(q.z7iQuestionId) || null,
        };
      })),
    });
  } catch (error) {
    console.error('Get questions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleBookmark(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { questionId } = req.body;
  if (!questionId) return res.status(400).json({ error: 'Question ID is required' });

  try {
    const existing = await prisma.questionBookmark.findUnique({
      where: { userId_questionId: { userId: payload.userId, questionId } }
    });

    if (existing) {
      await prisma.questionBookmark.delete({
        where: { id: existing.id }
      });
      return res.status(200).json({ success: true, bookmarked: false });
    } else {
      await prisma.questionBookmark.create({
        data: { userId: payload.userId, questionId }
      });
      return res.status(200).json({ success: true, bookmarked: true });
    }
  } catch (error) {
    console.error('Bookmark error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetBookmarks(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const bookmarks = await prisma.questionBookmark.findMany({
      where: { userId: payload.userId },
      include: {
        question: {
          include: {
            attempt: {
              include: {
                test: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedBookmarks = bookmarks
      .map(b => {
        const question = b.question;
        const attempt = question?.attempt;
        const test = attempt?.test;
        if (!question || !attempt || !test) return null;

        return {
          id: b.id,
          questionId: b.questionId,
          createdAt: b.createdAt,
          question: {
            id: question.id,
            z7iQuestionId: question.z7iQuestionId,
            order: question.questionOrder,
            subject: question.subjectName,
            type: question.questionType,
            questionHtml: question.questionHtml,
            option1: question.option1,
            option2: question.option2,
            option3: question.option3,
            option4: question.option4,
            correctAnswer: question.correctAnswer,
            studentAnswer: question.studentAnswer,
            answerStatus: question.answerStatus,
            marksPositive: question.marksPositive,
            marksNegative: question.marksNegative,
            scoreObtained: question.scoreObtained,
          },
          test: {
            id: test.id,
            testName: test.name,
            packageId: test.packageId,
            submitDate: attempt.submitDate,
          }
        };
      })
      .filter((bookmark): bookmark is NonNullable<typeof bookmark> => Boolean(bookmark));

    return res.status(200).json({ 
      success: true, 
      bookmarks: formattedBookmarks,
      count: formattedBookmarks.length
    });
  } catch (error) {
    console.error('Get bookmarks error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleNote(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { questionId, content } = req.body;
  if (!questionId) return res.status(400).json({ error: 'Question ID is required' });

  try {
    if (!content || content.trim() === '') {
      await prisma.questionNote.deleteMany({
        where: { userId: payload.userId, questionId }
      });
      return res.status(200).json({ success: true, note: null });
    }

    const note = await prisma.questionNote.upsert({
      where: { userId_questionId: { userId: payload.userId, questionId } },
      create: { userId: payload.userId, questionId, content: content.trim() },
      update: { content: content.trim() }
    });

    return res.status(200).json({ success: true, note: note.content });
  } catch (error) {
    console.error('Note error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleComment(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { questionId, content } = req.body;
  if (!questionId || !content || content.trim() === '') {
    return res.status(400).json({ error: 'Question ID and content are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    const comment = await prisma.questionComment.create({
      data: {
        userId: payload.userId,
        userName: user?.name || user?.email?.split('@')[0] || 'Anonymous',
        questionId,
        content: content.trim()
      }
    });

    return res.status(200).json({
      success: true,
      comment: {
        id: comment.id,
        userId: comment.userId,
        userName: comment.userName,
        content: comment.content,
        createdAt: comment.createdAt
      }
    });
  } catch (error) {
    console.error('Comment error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeleteComment(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { commentId } = req.body;
  if (!commentId) return res.status(400).json({ error: 'Comment ID is required' });

  try {
    const comment = await prisma.questionComment.findUnique({
      where: { id: commentId }
    });

    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    const userIsAdmin = await isAdmin(payload.userId);
    if (comment.userId !== payload.userId && !userIsAdmin) {
      return res.status(403).json({ error: 'Cannot delete other users comments' });
    }

    await prisma.questionComment.delete({ where: { id: commentId } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleToggleBonus(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { z7iQuestionId, testZ7iId, reason } = req.body;
  if (!z7iQuestionId) {
    return res.status(400).json({ error: 'Question ID is required' });
  }

  try {
    const adminUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    const existing = await prisma.bonusQuestion.findUnique({
      where: { z7iQuestionId }
    });

    if (existing) {
      await prisma.bonusQuestion.delete({
        where: { id: existing.id }
      });
      const keyChange = await prisma.answerKeyChange.findUnique({
        where: { z7iQuestionId }
      });
      const responseMeta = await prisma.questionResponse.findFirst({
        where: { z7iQuestionId },
        select: { correctAnswer: true }
      });
      const effectiveCorrectAnswer = keyChange?.newAnswer || responseMeta?.correctAnswer || '';
      if (effectiveCorrectAnswer) {
        await updateQuestionResponses(z7iQuestionId, effectiveCorrectAnswer);
      }
      const userStats = await getQuestionUserStats(z7iQuestionId);
      return res.status(200).json({ success: true, isBonus: false, userStats });
    } else {
      await prisma.bonusQuestion.create({
        data: {
          z7iQuestionId,
          testZ7iId: testZ7iId || '',
          reason: reason || 'Marked as bonus by admin',
          markedBy: payload.userId,
          markedByName: adminUser?.name || adminUser?.email || 'Admin'
        }
      });
      const keyChange = await prisma.answerKeyChange.findUnique({
        where: { z7iQuestionId }
      });
      const responseMeta = await prisma.questionResponse.findFirst({
        where: { z7iQuestionId },
        select: { correctAnswer: true }
      });
      const effectiveCorrectAnswer = keyChange?.newAnswer || responseMeta?.correctAnswer || '';
      if (effectiveCorrectAnswer) {
        await updateQuestionResponses(z7iQuestionId, effectiveCorrectAnswer);
      }
      const userStats = await getQuestionUserStats(z7iQuestionId);
      return res.status(200).json({ success: true, isBonus: true, userStats });
    }
  } catch (error) {
    console.error('Toggle bonus error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLeaderboard(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const { testZ7iId, page, limit, reattemptOnly } = req.query;
    if (!testZ7iId || typeof testZ7iId !== 'string') {
      return res.status(400).json({ error: 'Test Z7I ID is required' });
    }

    const pageNum = parseInt(page as string) || 1;
    const pageSize = Math.min(parseInt(limit as string) || 40, 100); // max 100 per page
    const skip = (pageNum - 1) * pageSize;
    const reattemptOnlyMode = reattemptOnly === '1' || reattemptOnly === 'true';

    const tests = await prisma.test.findMany({
      where: { z7iId: testZ7iId },
      select: { id: true }
    });

    const testIds = tests.map((t: { id: string }) => t.id);

    const [attempts, totalParticipants] = await Promise.all([
      prisma.testAttempt.findMany({
        where: { testId: { in: testIds } },
        select: {
          id: true,
          z7iAccountId: true,
          submitDate: true,
          createdAt: true,
          z7iAccount: {
            select: {
              enrollmentNo: true,
              isGuest: true,
              user: { select: { id: true, name: true, email: true, profileImageUrl: true } }
            }
          },
          totalScore: true,
          rank: true,
          percentile: true,
          correct: true,
          incorrect: true,
          unattempted: true,
          timeTaken: true,
          responses: {
            select: {
              z7iQuestionId: true,
              studentAnswer: true,
              answerStatus: true,
              marksPositive: true,
              marksNegative: true,
              questionType: true,
              scoreObtained: true,
              subjectName: true,
            }
          }
        },
        orderBy: { totalScore: 'desc' }
      }),
      prisma.testAttempt.count({ where: { testId: { in: testIds } } })
    ]);

    // Fetch revisions for all attempts to support reattempt-only mode
    const attemptIds = attempts.map((a: any) => a.id);
    const revisionsList = await prisma.testRevision.findMany({
      where: { attemptId: { in: attemptIds } },
      select: {
        id: true,
        userId: true,
        attemptId: true,
        totalScore: true,
        correct: true,
        incorrect: true,
        unattempted: true,
        timeTaken: true,
        createdAt: true,
      }
    });
    const revisionsByAttemptId = new Map<string, typeof revisionsList>();
    for (const rev of revisionsList) {
      const existing = revisionsByAttemptId.get(rev.attemptId) || [];
      existing.push(rev);
      revisionsByAttemptId.set(rev.attemptId, existing);
    }

    const bonusQuestions = await prisma.bonusQuestion.findMany({
      where: { testZ7iId }
    });
    const bonusSet = new Set(bonusQuestions.map((b: any) => b.z7iQuestionId));

    const answerKeyChanges = await prisma.answerKeyChange.findMany({
      where: { testZ7iId }
    });
    const keyChangesMap = new Map(answerKeyChanges.map((k: any) => [k.z7iQuestionId, { newAnswer: k.newAnswer, originalAnswer: k.originalAnswer }]));

    // Group by enrollment number so accounts with the same enrollment are combined
    const enrollmentMap = new Map<
      string,
      { attempts: Array<{ entry: any; submittedAt: number }>; revisions: Array<{ entry: any; submittedAt: number }>; names: Set<string>; profileImages: Map<string, string | null> }
    >();
    attempts.forEach((attempt: any) => {
      let scoreAdjustment = 0;
      let bonusMarks = 0;
      const subjectScoreMap = new Map<string, number>();
      let attendedCount = 0;

      for (const response of attempt.responses) {
        const keyChange = keyChangesMap.get(response.z7iQuestionId);
        const isBonus = bonusSet.has(response.z7iQuestionId);
        const hasAttempted = !!(response.studentAnswer && response.studentAnswer.trim());
        if (hasAttempted) attendedCount += 1;

        if (isBonus && response.answerStatus === 'incorrect') {
          bonusMarks += 5;
        }

        if (keyChange && response.studentAnswer) {
          const matchesNew = isAnswerMatch(response.studentAnswer, keyChange.newAnswer, response.questionType);
          const matchesOriginal = isAnswerMatch(response.studentAnswer, keyChange.originalAnswer, response.questionType);

          if (matchesNew && !matchesOriginal) {
            scoreAdjustment += 5;
          } else if (matchesOriginal && !matchesNew) {
            scoreAdjustment -= 5;
          }
        }

        const currentSubjectScore = subjectScoreMap.get(response.subjectName || 'UNKNOWN') || 0;
        subjectScoreMap.set(response.subjectName || 'UNKNOWN', currentSubjectScore + (response.scoreObtained || 0));
      }

      const adjustedScore = attempt.totalScore + scoreAdjustment + bonusMarks;
      const userId = attempt.z7iAccount.user.id;
      const enrollmentNo = attempt.z7iAccount.isGuest
        ? userId
        : (attempt.z7iAccount.enrollmentNo || userId); // keep guests isolated from enrolled users
      const userName = attempt.z7iAccount.user.name || 'Unknown';
      const entry = {
        userId,
        z7iAccountId: attempt.z7iAccountId,
        userName,
        userEmail: attempt.z7iAccount.user.email,
        profileImageUrl: attempt.z7iAccount.user.profileImageUrl,
        adjustedScore,
        originalScore: attempt.totalScore,
        bonusMarks,
        manualAdjustment: scoreAdjustment,
        attemptId: attempt.id,
        totalScore: attempt.totalScore,
        rank: 0, // will be set below
        percentile: attempt.percentile,
        correct: attempt.correct,
        incorrect: attempt.incorrect,
        unattempted: attempt.unattempted,
        attendedCount,
        timeTaken: attempt.timeTaken,
        enrollmentNo,
        aliasNames: [] as string[],
        subjectStats: Array.from(subjectScoreMap.entries())
          .map(([name, marks]) => ({ name, marks }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        scoreLabel: null as string | null,
      };
      const submittedAt = attempt.submitDate
        ? new Date(attempt.submitDate).getTime()
        : new Date(attempt.createdAt).getTime();
      const existing = enrollmentMap.get(enrollmentNo);
      if (!existing) {
        const names = new Set<string>();
        names.add(userName);
        const profileImages = new Map<string, string | null>();
        profileImages.set(userName, attempt.z7iAccount.user.profileImageUrl);
        enrollmentMap.set(enrollmentNo, { attempts: [{ entry, submittedAt }], revisions: [], names, profileImages });
        return;
      }
      existing.attempts.push({ entry, submittedAt });
      existing.names.add(userName);
      existing.profileImages.set(userName, attempt.z7iAccount.user.profileImageUrl);
    });

    // Attach revision entries to each enrollment group
    for (const [, group] of enrollmentMap) {
      for (const { entry } of group.attempts) {
        const attemptRevisions = revisionsByAttemptId.get(entry.attemptId) || [];
        for (const rev of attemptRevisions) {
          const revEntry = {
            ...entry,
            adjustedScore: rev.totalScore + entry.manualAdjustment + entry.bonusMarks,
            totalScore: rev.totalScore,
            originalScore: rev.totalScore,
            correct: rev.correct,
            incorrect: rev.incorrect,
            unattempted: rev.unattempted,
            attendedCount: rev.correct + rev.incorrect,
            timeTaken: rev.timeTaken ? rev.timeTaken / 60 : entry.timeTaken,
            isRevision: true,
            scoreLabel: 'Reattempt',
          };
          group.revisions.push({ entry: revEntry, submittedAt: new Date(rev.createdAt).getTime() });
        }
      }
    }

    const leaderboardData = Array.from(enrollmentMap.values())
      .filter(({ attempts, revisions }) => (!reattemptOnlyMode ? true : (attempts.length > 1 || revisions.length > 0)))
      .map(({ attempts, revisions, names, profileImages }) => {
        let bestEntry;
        if (!reattemptOnlyMode) {
          const bestAttempt = attempts.reduce((best, current) =>
            current.entry.adjustedScore > best.entry.adjustedScore ? current : best
          );
          const bestRevision = revisions.length > 0
            ? revisions.reduce((best, current) =>
              current.entry.adjustedScore > best.entry.adjustedScore ? current : best
            )
            : null;
          if (bestRevision && bestRevision.entry.adjustedScore > bestAttempt.entry.adjustedScore) {
            bestEntry = {
              ...bestRevision.entry,
              scoreLabel: 'Reattempt',
              originalAttemptScore: bestAttempt.entry.adjustedScore,
            };
          } else if (bestRevision && bestAttempt.entry.totalScore === 0) {
            bestEntry = { ...bestRevision.entry, scoreLabel: 'Reattempt' };
          } else {
            bestEntry = bestAttempt.entry;
          }
        } else {
          // Reattempt-only mode should show marks from the latest reattempt.
          if (revisions.length > 0) {
            const latestRevision = revisions.reduce((latest, current) =>
              current.submittedAt > latest.submittedAt ? current : latest
            );
            bestEntry = { ...latestRevision.entry, scoreLabel: 'Reattempt' };
          } else {
            // No revision exists; use the latest attempt after the original attempt.
            const sortedAttempts = [...attempts].sort((a, b) => a.submittedAt - b.submittedAt);
            const latestReattemptAttempt = sortedAttempts[sortedAttempts.length - 1];
            bestEntry = latestReattemptAttempt.entry;
          }
        }
        // Alphabetically sort all names; first becomes primary, rest become aliases
        const sortedNames = Array.from(names).sort((a, b) => a.localeCompare(b));
        bestEntry.userName = sortedNames[0];
        bestEntry.aliasNames = sortedNames.slice(1);
        // Use the profile image of the primary (alphabetically first) name
        bestEntry.profileImageUrl = profileImages.get(sortedNames[0]) ?? bestEntry.profileImageUrl;
        return bestEntry;
      })
      .sort((a: any, b: any) => b.adjustedScore - a.adjustedScore || a.userName.localeCompare(b.userName));

    const leaderboardMap = enrollmentMap;

    const pagedLeaderboard = leaderboardData.slice(skip, skip + pageSize);

    pagedLeaderboard.forEach((entry: any, index: number) => {
      entry.rank = skip + index + 1;
    });

    // Find the current user's enrollment number so we can locate them in the merged leaderboard
    const currentUserZ7iAccount = await prisma.z7iAccount.findUnique({
      where: { userId: payload.userId },
      select: { enrollmentNo: true, isGuest: true }
    });
    const currentUserEnrollment = currentUserZ7iAccount?.isGuest
      ? payload.userId
      : (currentUserZ7iAccount?.enrollmentNo || payload.userId);
    const currentUserIndex = leaderboardData.findIndex((e: any) => e.enrollmentNo === currentUserEnrollment);
    const filteredParticipantCount = leaderboardData.length;
    const uniqueParticipantCount = leaderboardMap.size;

    return res.status(200).json({
      success: true,
      leaderboard: pagedLeaderboard,
      currentUserRank: currentUserIndex !== -1 ? skip + currentUserIndex + 1 : null,
      currentUserId: payload.userId,
      currentUserEnrollment: currentUserEnrollment,
      totalParticipants: reattemptOnlyMode ? filteredParticipantCount : uniqueParticipantCount
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleChangeAnswerKey(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const privileges = await getAiPrivileges(payload.userId);
  if (!privileges.canEditKey) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { z7iQuestionId, testZ7iId, newAnswer, originalAnswer, reason } = req.body;
  if (!z7iQuestionId || !newAnswer) {
    return res.status(400).json({ error: 'Question ID and new answer are required' });
  }

  try {
    const questionMeta = await prisma.questionResponse.findFirst({
      where: { z7iQuestionId },
      select: { questionType: true }
    });
    const questionType = questionMeta?.questionType || null;
    const normalizedNewAnswer = normalizeAnswerKey(newAnswer, questionType);
    const normalizedOriginalAnswer = normalizeAnswerKey(originalAnswer || '', questionType);

    const adminUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    const existing = await prisma.answerKeyChange.findUnique({
      where: { z7iQuestionId }
    });

    let changed = false;
    let message = '';

    if (existing) {
      if (normalizedNewAnswer === normalizedOriginalAnswer) {
        await prisma.answerKeyChange.delete({
          where: { id: existing.id }
        });
        changed = false;
        message = 'Answer key reverted to original';
      } else {
        await prisma.answerKeyChange.update({
          where: { id: existing.id },
          data: {
            newAnswer: normalizedNewAnswer,
            reason: reason || 'Answer key changed by admin',
            changedBy: payload.userId,
            changedByName: adminUser?.name || adminUser?.email || 'Admin'
          }
        });
        changed = true;
        message = 'Answer key updated';
      }
    } else {
      await prisma.answerKeyChange.create({
        data: {
          z7iQuestionId,
          testZ7iId: testZ7iId || '',
          originalAnswer: normalizedOriginalAnswer || originalAnswer || '',
          newAnswer: normalizedNewAnswer,
          reason: reason || 'Answer key changed by admin',
          changedBy: payload.userId,
          changedByName: adminUser?.name || adminUser?.email || 'Admin'
        }
      });
      changed = true;
      message = 'Answer key changed';
    }

    await updateQuestionResponses(z7iQuestionId, normalizedNewAnswer);
    const userStats = await getQuestionUserStats(z7iQuestionId);

    return res.status(200).json({ 
      success: true, 
      changed, 
      newAnswer: normalizedNewAnswer,
      message,
      userStats
    });
  } catch (error) {
    console.error('Change answer key error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleAdjustScore(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { testZ7iId, z7iAccountId, adjustment, reason } = req.body;
  if (!testZ7iId || !z7iAccountId || adjustment === undefined) {
    return res.status(400).json({ error: 'Test Z7I ID, Z7I Account ID, and adjustment are required' });
  }

  try {
    const adminUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    if (adjustment === 0) {
      await prisma.scoreAdjustment.deleteMany({
        where: { testZ7iId, z7iAccountId }
      });
      return res.status(200).json({ 
        success: true, 
        message: 'Score adjustment removed' 
      });
    }

    await prisma.scoreAdjustment.upsert({
      where: { testZ7iId_z7iAccountId: { testZ7iId, z7iAccountId } },
      update: {
        adjustment,
        reason: reason || 'Score adjusted by admin',
        changedBy: payload.userId,
        changedByName: adminUser?.name || adminUser?.email || 'Admin'
      },
      create: {
        testZ7iId,
        z7iAccountId,
        adjustment,
        reason: reason || 'Score adjusted by admin',
        changedBy: payload.userId,
        changedByName: adminUser?.name || adminUser?.email || 'Admin'
      }
    });

    return res.status(200).json({ 
      success: true, 
      adjustment,
      message: `Score adjusted by ${adjustment > 0 ? '+' : ''}${adjustment} marks` 
    });
  } catch (error) {
    console.error('Adjust score error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleSaveRevision(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { attemptId, responses, results } = req.body;
  
  if (!attemptId || !responses || !results) {
    return res.status(400).json({ error: 'Missing required fields: attemptId, responses, results' });
  }

  try {
    const revision = await prisma.testRevision.create({
      data: {
        userId: payload.userId,
        attemptId,
        correct: results.correct || 0,
        incorrect: results.incorrect || 0,
        unattempted: results.unattempted || 0,
        totalScore: results.score || 0,
        maxScore: results.maxScore || 0,
        timeTaken: results.timeTaken || 0,
        originalScore: results.originalScore || 0,
        improvement: results.improvement || 0,
        accuracy: results.accuracy || 0
      }
    });

    const responseData = responses.map((r: {
      z7iQuestionId: string;
      questionOrder: number;
      userAnswer: string | null;
      correctAnswer: string;
      status: string;
      marksObtained: number;
      marksPositive: number;
      marksNegative: number;
      timeSpent: number;
      wasFlagged: boolean;
    }) => ({
      revisionId: revision.id,
      z7iQuestionId: r.z7iQuestionId,
      questionOrder: r.questionOrder,
      userAnswer: r.userAnswer,
      correctAnswer: r.correctAnswer,
      status: r.status,
      marksObtained: r.marksObtained || 0,
      marksPositive: r.marksPositive || 4,
      marksNegative: r.marksNegative || 1,
      timeSpent: r.timeSpent || 0,
      wasFlagged: r.wasFlagged || false
    }));

    await prisma.revisionResponse.createMany({
      data: responseData
    });

    return res.status(200).json({ 
      success: true, 
      revisionId: revision.id,
      message: 'Test revision saved successfully' 
    });
  } catch (error) {
    console.error('Save revision error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetRevisions(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const attemptId = req.query.attemptId as string | undefined;

  try {
    const whereClause: { userId: string; attemptId?: string } = { userId: payload.userId };
    if (attemptId) {
      whereClause.attemptId = attemptId;
    }

    const revisions = await prisma.testRevision.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        responses: attemptId ? true : false // Only include responses when fetching specific attempt
      }
    });

    if (!attemptId) {
      const attemptIds = [...new Set(revisions.map(r => r.attemptId))];
      const attempts = await prisma.testAttempt.findMany({
        where: { id: { in: attemptIds } },
        include: { test: { select: { name: true } } }
      });
      
      const attemptMap = new Map(attempts.map(a => [a.id, a.test.name]));
      
      const revisionsWithNames = revisions.map(r => ({
        ...r,
        testName: attemptMap.get(r.attemptId) || 'Unknown Test'
      }));
      
      return res.status(200).json({ success: true, revisions: revisionsWithNames });
    }

    return res.status(200).json({ success: true, revisions });
  } catch (error) {
    console.error('Get revisions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumPosts(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const search = req.query.search as string | undefined;
  const filter = req.query.filter as string | undefined; // 'all', 'mine', 'resolved', 'unresolved', 'with-question'

  try {
    const skip = (page - 1) * limit;
    
    const where: any = {};
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    if (filter === 'mine') {
      where.userId = payload.userId;
    } else if (filter === 'resolved') {
      where.isResolved = true;
    } else if (filter === 'unresolved') {
      where.isResolved = false;
    } else if (filter === 'with-question') {
      where.questionId = { not: null };
    }

    const [posts, total, unreadMentions] = await Promise.all([
      prisma.forumPost.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'desc' }
        ],
        include: {
          replies: {
            select: { id: true }
          },
          postLikes: {
            where: { userId: payload.userId },
            select: { id: true }
          },
          question: {
            select: {
              id: true,
              questionOrder: true,
              subjectName: true,
              questionType: true,
              attempt: {
                select: {
                  test: {
                    select: { name: true }
                  }
                }
              }
            }
          }
        }
      }),
      prisma.forumPost.count({ where }),
      prisma.forumMention.findMany({
        where: { mentionedUserId: payload.userId, isRead: false },
        select: { postId: true }
      })
    ]);

    const mentionedPostIds = [...new Set(unreadMentions.map(m => m.postId))];

    const formattedPosts = posts.map(post => ({
      id: post.id,
      userId: post.userId,
      userName: post.userName,
      title: post.title,
      content: post.content,
      likes: post.likes,
      viewCount: post.viewCount,
      isPinned: post.isPinned,
      isResolved: post.isResolved,
      replyCount: post.replies.length,
      isLiked: post.postLikes.length > 0,
      isOwner: post.userId === payload.userId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      attachmentName: post.attachmentName,
      attachedQuestion: post.question ? {
        id: post.question.id,
        questionNumber: post.question.questionOrder + 1,
        subject: post.question.subjectName,
        type: post.question.questionType,
        testName: post.question.attempt.test.name
      } : null
    }));

    return res.status(200).json({ 
      success: true, 
      posts: formattedPosts,
      mentionedPostIds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get forum posts error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumPost(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const postId = req.query.postId as string;
  if (!postId) return res.status(400).json({ error: 'Post ID required' });

  try {
    const post = await prisma.forumPost.findUnique({
      where: { id: postId },
      include: {
        replies: {
          orderBy: [
            { isAccepted: 'desc' },
            { likes: 'desc' },
            { createdAt: 'asc' }
          ],
          include: {
            replyLikes: {
              where: { userId: payload.userId },
              select: { id: true }
            }
          }
        },
        postLikes: {
          where: { userId: payload.userId },
          select: { id: true }
        },
        question: {
          select: {
            id: true,
            questionOrder: true,
            subjectName: true,
            questionType: true,
            questionHtml: true,
            option1: true,
            option2: true,
            option3: true,
            option4: true,
            correctAnswer: true,
            studentAnswer: true,
            answerStatus: true,
            solutionHtml: true,
            attempt: {
              select: {
                test: {
                  select: { name: true }
                }
              }
            }
          }
        }
      }
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await prisma.forumPost.update({
      where: { id: postId },
      data: { viewCount: { increment: 1 } }
    });

    const formattedPost = {
      id: post.id,
      userId: post.userId,
      userName: post.userName,
      title: post.title,
      content: post.content,
      likes: post.likes,
      viewCount: post.viewCount + 1,
      isPinned: post.isPinned,
      isResolved: post.isResolved,
      isLiked: post.postLikes.length > 0,
      isOwner: post.userId === payload.userId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      attachmentName: post.attachmentName,
      attachmentData: post.attachmentData,
      attachedQuestion: post.question ? {
        id: post.question.id,
        questionNumber: post.question.questionOrder + 1,
        subject: post.question.subjectName,
        type: post.question.questionType,
        testName: post.question.attempt.test.name,
        questionHtml: post.question.questionHtml,
        options: [post.question.option1, post.question.option2, post.question.option3, post.question.option4].filter(Boolean),
        correctAnswer: post.question.correctAnswer,
        studentAnswer: post.question.studentAnswer,
        status: post.question.answerStatus,
        solution: post.question.solutionHtml
      } : null,
      replies: post.replies.map(reply => ({
        id: reply.id,
        userId: reply.userId,
        userName: reply.userName,
        content: reply.content,
        isAccepted: reply.isAccepted,
        likes: reply.likes,
        isLiked: reply.replyLikes.length > 0,
        isOwner: reply.userId === payload.userId,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt
      }))
    };

    return res.status(200).json({ success: true, post: formattedPost });
  } catch (error) {
    console.error('Get forum post error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreatePost(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { title, content, questionId, attachmentName, attachmentData } = req.body;
  
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  const maxAttachmentBase64Bytes = 8_000_000;

  if (attachmentData) {
    if (typeof attachmentData !== 'string' || attachmentData.length === 0) {
      return res.status(400).json({ error: 'Invalid PDF attachment.' });
    }
    if (attachmentData.length > maxAttachmentBase64Bytes) {
      console.error('Forum PDF rejected: payload too large', {
        contentLength: req.headers['content-length'] || null,
        attachmentBase64Length: attachmentData.length,
        maxAttachmentBase64Bytes
      });
      return res.status(413).json({ error: 'PDF attachment is too large. Keep file size under 6 MB.' });
    }
  }

  if (attachmentName && typeof attachmentName !== 'string') {
    return res.status(400).json({ error: 'Invalid attachment name.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (questionId) {
      const question = await prisma.questionResponse.findUnique({
        where: { id: questionId }
      });
      if (!question) {
        return res.status(400).json({ error: 'Invalid question ID' });
      }
    }

    const post = await prisma.forumPost.create({
      data: {
        userId: payload.userId,
        userName: user.name || user.email.split('@')[0],
        title,
        content,
        questionId: questionId || null,
        attachmentName: attachmentName || null,
        attachmentData: attachmentData || null
      }
    });

    // Create mention records for @[Name](userId) patterns
    const mentionedIds = extractMentionedUserIds(content);
    if (mentionedIds.length > 0) {
      await createMentions(mentionedIds, post.id, null, payload.userId);
    }

    return res.status(200).json({ success: true, postId: post.id });
  } catch (error) {
    console.error('Create forum post error:', {
      error,
      contentLength: req.headers['content-length'] || null,
      hasAttachment: Boolean(attachmentData),
      attachmentBase64Length: typeof attachmentData === 'string' ? attachmentData.length : null
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreateReply(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId, content } = req.body;
  
  if (!postId || !content) {
    return res.status(400).json({ error: 'Post ID and content are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, email: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const post = await prisma.forumPost.findUnique({
      where: { id: postId }
    });
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const reply = await prisma.forumReply.create({
      data: {
        postId,
        userId: payload.userId,
        userName: user.name || user.email.split('@')[0],
        content
      }
    });

    // Create mention records for @[Name](userId) patterns
    const mentionedIds = extractMentionedUserIds(content);
    if (mentionedIds.length > 0) {
      await createMentions(mentionedIds, postId, reply.id, payload.userId);
    }

    return res.status(200).json({ 
      success: true, 
      reply: {
        id: reply.id,
        userId: reply.userId,
        userName: reply.userName,
        content: reply.content,
        isAccepted: reply.isAccepted,
        likes: reply.likes,
        isLiked: false,
        isOwner: true,
        createdAt: reply.createdAt,
        updatedAt: reply.updatedAt
      }
    });
  } catch (error) {
    console.error('Create forum reply error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLikePost(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'Post ID required' });

  try {
    const existingLike = await prisma.forumPostLike.findUnique({
      where: {
        postId_userId: { postId, userId: payload.userId }
      }
    });

    if (existingLike) {
      await prisma.forumPostLike.delete({
        where: { id: existingLike.id }
      });
      await prisma.forumPost.update({
        where: { id: postId },
        data: { likes: { decrement: 1 } }
      });
      return res.status(200).json({ success: true, liked: false });
    } else {
      await prisma.forumPostLike.create({
        data: { postId, userId: payload.userId }
      });
      await prisma.forumPost.update({
        where: { id: postId },
        data: { likes: { increment: 1 } }
      });
      return res.status(200).json({ success: true, liked: true });
    }
  } catch (error) {
    console.error('Like post error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleLikeReply(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { replyId } = req.body;
  if (!replyId) return res.status(400).json({ error: 'Reply ID required' });

  try {
    const existingLike = await prisma.forumReplyLike.findUnique({
      where: {
        replyId_userId: { replyId, userId: payload.userId }
      }
    });

    if (existingLike) {
      await prisma.forumReplyLike.delete({
        where: { id: existingLike.id }
      });
      await prisma.forumReply.update({
        where: { id: replyId },
        data: { likes: { decrement: 1 } }
      });
      return res.status(200).json({ success: true, liked: false });
    } else {
      await prisma.forumReplyLike.create({
        data: { replyId, userId: payload.userId }
      });
      await prisma.forumReply.update({
        where: { id: replyId },
        data: { likes: { increment: 1 } }
      });
      return res.status(200).json({ success: true, liked: true });
    }
  } catch (error) {
    console.error('Like reply error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeletePost(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'Post ID required' });

  try {
    const post = await prisma.forumPost.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const admin = await isAdmin(payload.userId);
    if (post.userId !== payload.userId && !admin) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await prisma.forumPost.delete({
      where: { id: postId }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleEditPost(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId, title, content } = req.body;
  if (!postId) return res.status(400).json({ error: 'Post ID required' });
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

  try {
    const post = await prisma.forumPost.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const admin = await isAdmin(payload.userId);
    if (post.userId !== payload.userId && !admin) {
      return res.status(403).json({ error: 'Not authorized to edit this post' });
    }

    const updated = await prisma.forumPost.update({
      where: { id: postId },
      data: {
        title: String(title).trim(),
        content: String(content).trim()
      }
    });

    return res.status(200).json({
      success: true,
      post: {
        title: updated.title,
        content: updated.content,
        updatedAt: updated.updatedAt
      }
    });
  } catch (error) {
    console.error('Edit post error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleDeleteReply(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { replyId } = req.body;
  if (!replyId) return res.status(400).json({ error: 'Reply ID required' });

  try {
    const reply = await prisma.forumReply.findUnique({
      where: { id: replyId }
    });

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    const admin = await isAdmin(payload.userId);
    if (reply.userId !== payload.userId && !admin) {
      return res.status(403).json({ error: 'Not authorized to delete this reply' });
    }

    await prisma.forumReply.delete({
      where: { id: replyId }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete reply error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleToggleResolved(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'Post ID required' });

  try {
    const post = await prisma.forumPost.findUnique({
      where: { id: postId }
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.userId !== payload.userId) {
      return res.status(403).json({ error: 'Only post owner can mark as resolved' });
    }

    const updated = await prisma.forumPost.update({
      where: { id: postId },
      data: { isResolved: !post.isResolved }
    });

    return res.status(200).json({ success: true, isResolved: updated.isResolved });
  } catch (error) {
    console.error('Toggle resolved error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleAcceptReply(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { replyId } = req.body;
  if (!replyId) return res.status(400).json({ error: 'Reply ID required' });

  try {
    const reply = await prisma.forumReply.findUnique({
      where: { id: replyId },
      include: { post: true }
    });

    if (!reply) {
      return res.status(404).json({ error: 'Reply not found' });
    }

    if (reply.post.userId !== payload.userId) {
      return res.status(403).json({ error: 'Only post owner can accept replies' });
    }

    await prisma.forumReply.updateMany({
      where: { postId: reply.postId, isAccepted: true },
      data: { isAccepted: false }
    });

    const updated = await prisma.forumReply.update({
      where: { id: replyId },
      data: { isAccepted: !reply.isAccepted }
    });

    if (updated.isAccepted) {
      await prisma.forumPost.update({
        where: { id: reply.postId },
        data: { isResolved: true }
      });
    }

    return res.status(200).json({ success: true, isAccepted: updated.isAccepted });
  } catch (error) {
    console.error('Accept reply error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumTests(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user?.z7iAccount) {
      return res.status(200).json({ success: true, tests: [] });
    }

    const attempts = await prisma.testAttempt.findMany({
      where: { z7iAccountId: user.z7iAccount.id },
      include: {
        test: {
          select: { name: true }
        }
      },
      orderBy: { submitDate: 'desc' }
    });

    const tests = attempts.map(a => ({
      attemptId: a.id,
      testName: a.test.name,
      totalQuestions: a.correct + a.incorrect + a.unattempted
    }));

    return res.status(200).json({ success: true, tests });
  } catch (error) {
    console.error('Forum tests error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumQuestions(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const attemptId = req.query.attemptId as string;
  if (!attemptId) return res.status(400).json({ error: 'Attempt ID required' });

  try {
    const questions = await prisma.questionResponse.groupBy({
      where: { attemptId },
      by: ['id', 'questionOrder', 'subjectName', 'questionType'],
      orderBy: { questionOrder: 'asc' }
    });

    return res.status(200).json({ success: true, questions });
  } catch (error) {
    console.error('Forum questions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleTimeIntelligence(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user?.z7iAccount) {
      return res.status(400).json({ error: 'Z7I account not linked' });
    }

    const attempts = await prisma.testAttempt.findMany({
      where: { z7iAccountId: user.z7iAccount.id },
      include: {
        test: {
          select: { name: true, z7iId: true }
        }
      },
      orderBy: { submitDate: 'desc' }
    });

    const attemptIds = attempts.map(a => a.id);
    const allQuestions = await prisma.questionResponse.findMany({
      where: { 
        attemptId: { in: attemptIds },
        timeTaken: { not: null }
      },
      select: {
        id: true,
        attemptId: true,
        questionType: true,
        subjectName: true,
        answerStatus: true,
        timeTaken: true,
        avgTimeTaken: true,
        marksPositive: true,
        marksNegative: true,
        scoreObtained: true
      }
    });

    const timeAccuracyData: Array<{
      timeRange: string;
      accuracy: number;
      count: number;
    }> = [];

    const timeRanges = [
      { label: '0-30s', min: 0, max: 30 },
      { label: '30-60s', min: 30, max: 60 },
      { label: '1-2m', min: 60, max: 120 },
      { label: '2-3m', min: 120, max: 180 },
      { label: '3-5m', min: 180, max: 300 },
      { label: '5m+', min: 300, max: Infinity }
    ];

    for (const range of timeRanges) {
      const questionsInRange = allQuestions.filter(q => 
        q.timeTaken && q.timeTaken >= range.min && q.timeTaken < range.max
      );
      
      if (questionsInRange.length > 0) {
        const correct = questionsInRange.filter(q => q.answerStatus === 'correct').length;
        timeAccuracyData.push({
          timeRange: range.label,
          accuracy: Math.round((correct / questionsInRange.length) * 100),
          count: questionsInRange.length
        });
      }
    }

    const timeSinks = allQuestions
      .filter(q => q.timeTaken && q.timeTaken > 120 && q.answerStatus === 'incorrect')
      .sort((a, b) => (b.timeTaken || 0) - (a.timeTaken || 0))
      .slice(0, 10)
      .map(q => ({
        id: q.id,
        attemptId: q.attemptId,
        subject: q.subjectName,
        type: q.questionType,
        timeTaken: Math.round((q.timeTaken || 0) / 60 * 10) / 10,
        avgTime: q.avgTimeTaken ? Math.round(q.avgTimeTaken / 60 * 10) / 10 : null
      }));

    const speedTraps = allQuestions
      .filter(q => {
        if (!q.timeTaken || !q.avgTimeTaken) return false;
        return q.timeTaken < q.avgTimeTaken * 0.5 && q.answerStatus === 'incorrect';
      })
      .sort((a, b) => {
        const aRatio = (a.timeTaken || 0) / (a.avgTimeTaken || 1);
        const bRatio = (b.timeTaken || 0) / (b.avgTimeTaken || 1);
        return aRatio - bRatio;
      })
      .slice(0, 10)
      .map(q => ({
        id: q.id,
        attemptId: q.attemptId,
        subject: q.subjectName,
        type: q.questionType,
        timeTaken: Math.round((q.timeTaken || 0)),
        avgTime: Math.round(q.avgTimeTaken || 0),
        speedRatio: Math.round(((q.timeTaken || 0) / (q.avgTimeTaken || 1)) * 100)
      }));

    const subjectStats = ['PHYSICS', 'CHEMISTRY', 'MATHS', 'MATHEMATICS'].map(subject => {
      const subjectQuestions = allQuestions.filter(q => 
        q.subjectName?.toUpperCase().includes(subject)
      );
      
      if (subjectQuestions.length === 0) return null;

      const avgTime = subjectQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / subjectQuestions.length;
      const correct = subjectQuestions.filter(q => q.answerStatus === 'correct');
      const avgTimeCorrect = correct.length > 0 
        ? correct.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / correct.length
        : 0;
      
      const incorrect = subjectQuestions.filter(q => q.answerStatus === 'incorrect');
      const avgTimeIncorrect = incorrect.length > 0
        ? incorrect.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / incorrect.length
        : 0;

      return {
        subject: subject === 'MATHS' || subject === 'MATHEMATICS' ? 'MATHS' : subject,
        avgTime: Math.round(avgTime),
        avgTimeCorrect: Math.round(avgTimeCorrect),
        avgTimeIncorrect: Math.round(avgTimeIncorrect),
        totalQuestions: subjectQuestions.length,
        accuracy: Math.round((correct.length / subjectQuestions.length) * 100)
      };
    }).filter(Boolean);

    const mcqQuestions = allQuestions.filter(q => 
      q.questionType?.toUpperCase().includes('MCQ') || q.questionType?.toUpperCase().includes('SINGLE')
    );
    const natQuestions = allQuestions.filter(q => 
      q.questionType?.toUpperCase().includes('NAT') || q.questionType?.toUpperCase().includes('NUMERICAL')
    );

    const typeStats = [
      {
        type: 'MCQ',
        avgTime: mcqQuestions.length > 0 
          ? Math.round(mcqQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / mcqQuestions.length)
          : 0,
        accuracy: mcqQuestions.length > 0
          ? Math.round((mcqQuestions.filter(q => q.answerStatus === 'correct').length / mcqQuestions.length) * 100)
          : 0,
        count: mcqQuestions.length
      },
      {
        type: 'NAT',
        avgTime: natQuestions.length > 0
          ? Math.round(natQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / natQuestions.length)
          : 0,
        accuracy: natQuestions.length > 0
          ? Math.round((natQuestions.filter(q => q.answerStatus === 'correct').length / natQuestions.length) * 100)
          : 0,
        count: natQuestions.length
      }
    ];

    const optimalTimePerQuestion = {
      mcq: mcqQuestions.filter(q => q.answerStatus === 'correct').length > 0
        ? Math.round(mcqQuestions.filter(q => q.answerStatus === 'correct').reduce((sum, q) => sum + (q.timeTaken || 0), 0) / mcqQuestions.filter(q => q.answerStatus === 'correct').length)
        : 90,
      nat: natQuestions.filter(q => q.answerStatus === 'correct').length > 0
        ? Math.round(natQuestions.filter(q => q.answerStatus === 'correct').reduce((sum, q) => sum + (q.timeTaken || 0), 0) / natQuestions.filter(q => q.answerStatus === 'correct').length)
        : 150
    };

    return res.status(200).json({
      success: true,
      data: {
        timeAccuracyCorrelation: timeAccuracyData,
        timeSinks,
        speedTraps,
        subjectStats,
        typeStats,
        optimalTime: optimalTimePerQuestion,
        totalQuestionsAnalyzed: allQuestions.length
      }
    });
  } catch (error) {
    console.error('Time intelligence error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetQuestionsForAI(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const privileges = await getAiPrivileges(payload.userId);
  if (!privileges.canGenerateAi) {
    return res.status(403).json({ error: 'AI solutions access required' });
  }

  const { attemptId } = req.query;
  if (!attemptId || typeof attemptId !== 'string') {
    return res.status(400).json({ error: 'Attempt ID is required' });
  }

  try {
    const questions = await prisma.questionResponse.findMany({
      where: { 
        attemptId,
        aiSolutionHtml: null
      },
      select: { id: true, questionOrder: true, subjectName: true, questionType: true },
      orderBy: { questionOrder: 'asc' }
    });

    const totalCount = await prisma.questionResponse.count({
      where: { attemptId }
    });

    const bySubject = new Map<string, { name: string; questionIds: string[]; mcqCount: number; natCount: number }>();
    for (const q of questions) {
      const name = q.subjectName || 'UNKNOWN';
      if (!bySubject.has(name)) {
        bySubject.set(name, { name, questionIds: [], mcqCount: 0, natCount: 0 });
      }
      const group = bySubject.get(name)!;
      group.questionIds.push(q.id);
      if ((q.questionType || '').toUpperCase().includes('NAT')) group.natCount++;
      else group.mcqCount++;
    }

    return res.status(200).json({
      success: true,
      questionIds: questions.map(q => q.id),
      needsGeneration: questions.length,
      totalQuestions: totalCount,
      subjects: Array.from(bySubject.values())
    });
  } catch (error) {
    console.error('Get questions for AI error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGenerateAISolution(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const privileges = await getAiPrivileges(payload.userId);
  if (!privileges.canGenerateAi) {
    return res.status(403).json({ error: 'AI solutions access required' });
  }

  const { questionId, model } = req.body as { questionId?: string; model?: 'flash' | 'lite' | '3-12b' };
  if (!questionId) {
    return res.status(400).json({ error: 'Question ID is required' });
  }

  try {
    const { generateSolution, isGeminiConfigured } = await import('../../lib/api/ai-service.js');

    if (!isGeminiConfigured()) {
      return res.status(503).json({ 
        error: 'AI service not configured', 
        details: 'Gemini API key is not set. Please configure GEMINI_API_KEY environment variable.' 
      });
    }

    const question = await prisma.questionResponse.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        questionHtml: true,
        option1: true,
        option2: true,
        option3: true,
        option4: true,
        correctAnswer: true,
        questionType: true,
        subjectName: true,
        questionOrder: true,
        z7iQuestionId: true,
      }
    });

    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const bonusCheck = await prisma.bonusQuestion.findUnique({
      where: { z7iQuestionId: question.z7iQuestionId }
    });

    const result = await generateSolution({
      questionHtml: question.questionHtml,
      option1: question.option1,
      option2: question.option2,
      option3: question.option3,
      option4: question.option4,
      correctAnswer: question.correctAnswer,
      questionType: question.questionType,
      subjectName: question.subjectName,
      isBonus: Boolean(bonusCheck),
    }, { model: model === 'lite' ? 'lite' : 'flash' });

    if (result.isCorrect) {
      await prisma.questionResponse.update({
        where: { id: questionId },
        data: {
          aiSolutionHtml: result.html,
          aiGeneratedAt: new Date()
        }
      });

      return res.status(200).json({
        success: true,
        questionId,
        questionOrder: question.questionOrder + 1,
        aiSolutionHtml: result.html,
        aiAnswer: result.aiAnswer,
        isCorrect: true,
        modelUsed: result.modelUsed
      });
    } else {
      console.warn(`[AI Solutions] Answer mismatch for Q${question.questionOrder + 1}: AI="${result.aiAnswer}" vs Correct="${question.correctAnswer}"`);
      
      return res.status(200).json({
        success: false,
        mistaken: true,
        questionId,
        questionOrder: question.questionOrder + 1,
        aiAnswer: result.aiAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect: false,
        modelUsed: result.modelUsed,
        error: `AI answer (${result.aiAnswer || 'unknown'}) does not match correct answer (${question.correctAnswer})`
      });
    }
  } catch (error) {
    console.error('Generate AI solution error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to generate solution', details: errorMessage });
  }
}

async function handleAiDoubt(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const privileges = await getAiPrivileges(payload.userId);
  if (!privileges.canUseAi) {
    return res.status(403).json({ error: 'AI solutions access required' });
  }

  const { questionId, aiSolution, doubt, model } = req.body as {
    questionId?: string;
    aiSolution?: string;
    doubt?: string;
    model?: 'flash' | 'lite' | '3-12b';
  };

  if (!questionId || !aiSolution || !doubt) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { generateDoubtResponse, isGeminiConfigured } = await import('../../lib/api/ai-service.js');

    if (!isGeminiConfigured()) {
      return res.status(503).json({
        error: 'AI service not configured',
        details: 'Gemini API key is not set. Please configure GEMINI_API_KEY environment variable.'
      });
    }

    const questionResponse = await prisma.questionResponse.findUnique({
      where: { id: questionId },
      select: {
        questionHtml: true,
        option1: true,
        option2: true,
        option3: true,
        option4: true,
        correctAnswer: true,
        questionType: true,
        subjectName: true,
      }
    });

    if (!questionResponse) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const question: QuestionData = {
      questionHtml: questionResponse.questionHtml,
      option1: questionResponse.option1,
      option2: questionResponse.option2,
      option3: questionResponse.option3,
      option4: questionResponse.option4,
      correctAnswer: questionResponse.correctAnswer,
      questionType: questionResponse.questionType,
      subjectName: questionResponse.subjectName,
    };

    const response = await generateDoubtResponse(question, aiSolution, doubt, { model });
    return res.status(200).json({ success: true, response });
  } catch (error: any) {
    console.error('AI doubt error:', error);
    return res.status(500).json({ error: error.message || 'Failed to get AI doubt response.' });
  }
}

async function handleDeleteAISolution(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const privileges = await getAiPrivileges(payload.userId);
  if (!privileges.canGenerateAi) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { questionId } = req.body as { questionId?: string };
  if (!questionId) {
    return res.status(400).json({ error: 'Question ID is required' });
  }

  try {
    await prisma.questionResponse.update({
      where: { id: questionId },
      data: {
        aiSolutionHtml: null,
        aiGeneratedAt: null
      }
    });

    return res.status(200).json({ success: true, questionId });
  } catch (error) {
    console.error('Delete AI solution error:', error);
    return res.status(500).json({ error: 'Failed to delete AI solution' });
  }
}

async function handleAdminUsers(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const topExpUserIds = await getTopExpUserIds();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        profileImageUrl: true,
        createdAt: true,
        lastIpAddress: true,
        canUseAiSolutions: true,
        canAccessAiChatRoom: true,
        canUseGuestSync: true,
        leagueProfile: {
          select: { totalExp: true, league: true, stage: true }
        },
        z7iAccount: {
          select: {
            enrollmentNo: true,
            lastSyncAt: true,
            firstName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedUsers = users.map(u => {
      const leagueName = getLeagueNameFromProfile(u.leagueProfile);
      const autoAiAccess = hasLeagueAiAccess(u.leagueProfile);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        profileImageUrl: u.profileImageUrl || null,
        createdAt: u.createdAt.toISOString(),
        lastIpAddress: u.lastIpAddress,
        canUseAiSolutions: u.canUseAiSolutions,
        canAccessAiChatRoom: u.canAccessAiChatRoom,
        canUseGuestSync: u.canUseGuestSync,
        totalExp: u.leagueProfile?.totalExp ?? 0,
        league: leagueName,
        leagueStage: u.leagueProfile?.stage ?? null,
        autoAiAccess,
        isTopExp: topExpUserIds.has(u.id),
        z7iLinked: !!u.z7iAccount,
        z7iEnrollment: u.z7iAccount?.enrollmentNo || null,
        lastSyncAt: u.z7iAccount?.lastSyncAt?.toISOString() || null,
        z7iFirstName: u.z7iAccount?.firstName || null
      };
    });

    return res.status(200).json({ success: true, users: formattedUsers });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function handleAdminToggleAi(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, canUseAiSolutions } = req.body as { userId?: string; canUseAiSolutions?: boolean };
  if (!userId || typeof canUseAiSolutions !== 'boolean') {
    return res.status(400).json({ error: 'User ID and canUseAiSolutions are required' });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { canUseAiSolutions }
    });

    return res.status(200).json({ success: true, userId, canUseAiSolutions });
  } catch (error) {
    console.error('Admin toggle AI error:', error);
    return res.status(500).json({ error: 'Failed to update permission' });
  }
}

async function handleAdminToggleAiChatRoom(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, canAccessAiChatRoom } = req.body as { userId?: string; canAccessAiChatRoom?: boolean };
  if (!userId || typeof canAccessAiChatRoom !== 'boolean') {
    return res.status(400).json({ error: 'User ID and canAccessAiChatRoom are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { canUseAiSolutions: true },
    });

    const profile = await prisma.userLeagueProfile.findUnique({
      where: { userId },
      select: { totalExp: true, league: true },
    });
    const autoAiAccess = hasLeagueAiAccess(profile);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.canUseAiSolutions && !autoAiAccess && canAccessAiChatRoom) {
      return res.status(400).json({ error: 'Enable AI solutions before granting chatroom access' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { canAccessAiChatRoom },
    });

    return res.status(200).json({ success: true, userId, canAccessAiChatRoom });
  } catch (error) {
    console.error('Admin toggle AI chatroom error:', error);
    return res.status(500).json({ error: 'Failed to update chatroom permission' });
  }
}

async function handleAdminToggleGuestSync(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, canUseGuestSync } = req.body as { userId?: string; canUseGuestSync?: boolean };
  if (!userId || typeof canUseGuestSync !== 'boolean') {
    return res.status(400).json({ error: 'User ID and canUseGuestSync are required' });
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { canUseGuestSync }
    });

    return res.status(200).json({ success: true, userId, canUseGuestSync });
  } catch (error) {
    console.error('Admin toggle guest sync error:', error);
    return res.status(500).json({ error: 'Failed to update guest sync permission' });
  }
}

async function handleAdminGrantExp(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { userId, exp, note } = req.body as { userId?: string; exp?: number | string; note?: string };
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'User ID is required' });
  }
  const expValue = typeof exp === 'string' ? Number(exp) : exp;
  if (!Number.isFinite(expValue) || expValue === 0) {
    return res.status(400).json({ error: 'EXP must be a non-zero number' });
  }
  if (Math.abs(expValue) > 100000) {
    return res.status(400).json({ error: 'EXP grant magnitude is too large' });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const sourceId = `admin-${payload.userId}-${crypto.randomUUID()}`;
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    await prisma.userExpEvent.create({
      data: {
        userId,
        type: 'admin_grant',
        sourceId,
        exp: Math.round(expValue),
        metadata: {
          note: trimmedNote || null,
          grantedBy: payload.userId,
        }
      }
    });

    return res.status(200).json({ success: true, userId, exp: Math.round(expValue) });
  } catch (error) {
    console.error('Admin grant exp error:', error);
    return res.status(500).json({ error: 'Failed to grant EXP' });
  }
}

async function handleAdminUserIps(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const logs = await prisma.userIpLog.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { ip: true, firstSeenAt: true, lastSeenAt: true }
    });
    return res.status(200).json({ success: true, logs });
  } catch (error) {
    console.error('Admin user IPs error:', error);
    return res.status(500).json({ error: 'Failed to load user IPs' });
  }
}


async function handleAdminUserHistory(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const history = await prisma.userActionHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        actionType: true,
        title: true,
        description: true,
        metadata: true,
        createdAt: true,
      },
    });
    return res.status(200).json({ success: true, history });
  } catch (error) {
    console.error('Admin user history error:', error);
    return res.status(500).json({ error: 'Failed to load user history' });
  }
}

async function handleAdminDeletedAccounts(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const accounts = await prisma.deletedAccount.findMany({
      orderBy: { deletedAt: 'desc' },
      take: 200
    });
    return res.status(200).json({ success: true, accounts });
  } catch (error) {
    console.error('Admin deleted accounts error:', error);
    return res.status(500).json({ error: 'Failed to load deleted accounts' });
  }
}


async function handleAdminIpGeo(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const ip = req.query.ip as string;
  if (!ip || typeof ip !== 'string') {
    return res.status(400).json({ error: 'IP address is required' });
  }

  try {
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,lat,lon,isp,timezone`);
    const data = await response.json();
    if (data.status === 'fail') {
      return res.status(400).json({ error: data.message || 'Failed to resolve IP location.' });
    }
    return res.status(200).json({
      ip,
      city: data.city || null,
      region: data.regionName || null,
      country: data.country || null,
      latitude: typeof data.lat === 'number' ? data.lat : null,
      longitude: typeof data.lon === 'number' ? data.lon : null,
      org: data.isp || null,
      timezone: data.timezone || null,
    });
  } catch (error) {
    console.error('Admin IP geo error:', error);
    return res.status(500).json({ error: 'Failed to resolve IP location.' });
  }
}

async function handleGetZoneWorkspace(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { zoneWorkspace: true }
    });
    return res.status(200).json({ workspace: user?.zoneWorkspace ?? null });
  } catch (error) {
    console.error('Get zone workspace error:', error);
    return res.status(500).json({ error: 'Failed to load workspace' });
  }
}

async function handleSaveZoneWorkspace(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { zones, activeZoneId, zoneData } = req.body as { zones?: unknown; activeZoneId?: unknown; zoneData?: unknown };
  if (!Array.isArray(zones) || typeof activeZoneId !== 'string' || !zoneData || typeof zoneData !== 'object') {
    return res.status(400).json({ error: 'Invalid workspace payload' });
  }

  try {
    await prisma.user.update({
      where: { id: payload.userId },
      data: {
        zoneWorkspace: {
          zones,
          activeZoneId,
          zoneData
        }
      }
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Save zone workspace error:', error);
    return res.status(500).json({ error: 'Failed to save workspace' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action as string;

  switch (action) {
    case 'admin-list-tests':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminListTests(req, res);
    case 'link':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLink(req, res);
    case 'sync':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleSync(req, res);
    case 'resync-test':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleResyncTest(req, res);
    case 'tests':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleTests(req, res);
    case 'questions':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleQuestions(req, res);
    case 'bookmark':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleBookmark(req, res);
    case 'bookmarks':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleGetBookmarks(req, res);
    case 'note':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleNote(req, res);
    case 'comment':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleComment(req, res);
    case 'delete-comment':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteComment(req, res);
    case 'toggle-bonus':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleToggleBonus(req, res);
    case 'leaderboard':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleLeaderboard(req, res);
    case 'change-answer-key':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleChangeAnswerKey(req, res);
    case 'adjust-score':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdjustScore(req, res);
    case 'save-revision':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleSaveRevision(req, res);
    case 'revisions':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleGetRevisions(req, res);
    case 'forum-posts':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumPosts(req, res);
    case 'forum-post':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumPost(req, res);
    case 'forum-create-post':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      console.log('Forum create post request received', {
        contentLength: req.headers['content-length'] || null
      });
      return handleCreatePost(req, res);
    case 'forum-create-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleCreateReply(req, res);
    case 'forum-like-post':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLikePost(req, res);
    case 'forum-like-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleLikeReply(req, res);
    case 'forum-delete-post':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeletePost(req, res);
    case 'forum-edit-post':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleEditPost(req, res);
    case 'forum-delete-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteReply(req, res);
    case 'forum-toggle-resolved':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleToggleResolved(req, res);
    case 'forum-accept-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAcceptReply(req, res);
    case 'forum-search-users':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumSearchUsers(req, res);
    case 'forum-mentions-count':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumMentionsCount(req, res);
    case 'forum-mark-mention-read':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumMarkMentionRead(req, res);
    case 'forum-tests':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumTests(req, res);
    case 'forum-questions':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleForumQuestions(req, res);
    case 'time-intelligence':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleTimeIntelligence(req, res);
    case 'ai-questions':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleGetQuestionsForAI(req, res);
    case 'generate-ai-solution':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleGenerateAISolution(req, res);
    case 'ai-doubt':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAiDoubt(req, res);
    case 'delete-ai-solution':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteAISolution(req, res);
    case 'admin-users':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminUsers(req, res);
    case 'admin-toggle-ai':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminToggleAi(req, res);
    case 'admin-toggle-ai-chatroom':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminToggleAiChatRoom(req, res);
    case 'admin-toggle-guest-sync':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminToggleGuestSync(req, res);
    case 'admin-user-ips':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminUserIps(req, res);
    case 'admin-user-history':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminUserHistory(req, res);
    case 'admin-deleted-accounts':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminDeletedAccounts(req, res);
    case 'admin-ip-geo':
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminIpGeo(req, res);
    case 'admin-grant-exp':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminGrantExp(req, res);
    case 'zone-workspace':
      if (req.method === 'GET') return handleGetZoneWorkspace(req, res);
      if (req.method === 'POST') return handleSaveZoneWorkspace(req, res);
      return res.status(405).json({ error: 'Method not allowed' });
    case 'admin-fetch-all':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminFetchAll(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action' });
  }
}

async function handleAdminFetchAll(req: VercelRequest, res: VercelResponse) {
    const payload = getAuth(req);
    if (!payload) return res.status(401).json({ error: 'No token provided' });

    const userIsAdmin = await isAdmin(payload.userId);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const { testId } = req.body || {};

      // Only fetch users who have a linked Z7I account (enrollment + password)
      const users = await prisma.user.findMany({
        where: { z7iAccount: { isNot: null } },
        include: { z7iAccount: true }
      });

      // Filter to only users with actual enrollment credentials (not guests without permission)
      const eligibleUsers = users.filter(u => {
        const acc = u.z7iAccount;
        if (!acc) return false;
        if (!acc.enrollmentNo || !acc.encryptedPassword) return false;
        if (acc.isGuest && !u.canUseGuestSync) return false;
        return true;
      });

      if (testId) {
        // --- Specific test sync (existing behaviour) ---
        const testRecord = await prisma.test.findUnique({
          where: { id: testId },
          include: { package: true }
        });
        if (!testRecord) {
          return res.status(404).json({ error: 'Test not found' });
        }
        let total = eligibleUsers.length;
        let success = 0;
        let failed = 0;
        let results: any[] = [];
        for (const user of eligibleUsers) {
          const z7iAccount = user.z7iAccount;
          if (!z7iAccount) continue;
          let userStats: { tests: number; questions: number; skipped: number; errorDetails?: string[] } = {
            tests: 0,
            questions: 0,
            skipped: 0
          };
          try {
            const z7iPassword = decryptZ7iPassword(z7iAccount.encryptedPassword);
            const loginResult = await z7iLogin(z7iAccount.enrollmentNo, z7iPassword);
            if (!loginResult) throw new Error('Login failed');
            const cookies = loginResult.cookies;
            const dbPackage = await prisma.package.findFirst({
              where: { z7iId: testRecord.package.z7iId, z7iAccountId: z7iAccount.id }
            });
            if (!dbPackage) {
              userStats.skipped++;
              results.push({ userId: user.id, enrollmentNo: z7iAccount.enrollmentNo, error: 'Package not found for user' });
              continue;
            }
            let dbTest = await prisma.test.findFirst({
              where: { z7iId: testRecord.z7iId, packageId: dbPackage.id }
            });
            if (!dbTest) {
              dbTest = await prisma.test.create({
                data: {
                  z7iId: testRecord.z7iId,
                  packageId: dbPackage.id,
                  name: testRecord.name,
                  description: testRecord.description || null,
                  testType: testRecord.testType || null,
                  timeLimit: testRecord.timeLimit || null,
                  maxScore: testRecord.maxScore || null,
                  totalQuestions: testRecord.totalQuestions || null,
                  subjects: testRecord.subjects || undefined
                }
              });
            }
            try {
              const scoreOverview = await z7iGetScoreOverview(cookies, testRecord.z7iId);
              if (scoreOverview) {
                const attemptId = scoreOverview._id.$oid;
                const unattemptedCount = getUnattemptedCount(scoreOverview);
                let dbAttempt = await prisma.testAttempt.findFirst({
                  where: { z7iId: attemptId, z7iAccountId: z7iAccount.id }
                });
                if (!dbAttempt) {
                  dbAttempt = await prisma.testAttempt.create({
                    data: {
                      z7iId: attemptId,
                      z7iAccountId: z7iAccount.id,
                      testId: dbTest.id,
                      timeTaken: scoreOverview.time_taken,
                      submitDate: new Date(scoreOverview.submit_date * 1000),
                      correct: scoreOverview.correct,
                      incorrect: scoreOverview.incorrect,
                      unattempted: unattemptedCount,
                      totalScore: scoreOverview.total_score,
                      maxScore: scoreOverview.test?.[0]?.max_score || null,
                      rank: scoreOverview.rank || null,
                      percentile: scoreOverview.percentile || null,
                      bonusMarks: scoreOverview.bonus_marks || null,
                    }
                  });
                } else {
                  await prisma.testAttempt.update({
                    where: { id: dbAttempt.id },
                    data: {
                      timeTaken: scoreOverview.time_taken,
                      submitDate: new Date(scoreOverview.submit_date * 1000),
                      correct: scoreOverview.correct,
                      incorrect: scoreOverview.incorrect,
                      unattempted: unattemptedCount,
                      totalScore: scoreOverview.total_score,
                      maxScore: scoreOverview.test?.[0]?.max_score || null,
                      rank: scoreOverview.rank || null,
                      percentile: scoreOverview.percentile || null,
                      bonusMarks: scoreOverview.bonus_marks || null,
                    }
                  });
                }
                const questions = await z7iGetQuestionwise(cookies, testRecord.z7iId);
                if (questions.length > 0) {
                  for (const q of questions) {
                    const qId = q._id.$oid;
                    const subjectId = q.subject.$oid;
                    const hasAnswer = q.std_ans !== null && q.std_ans !== undefined && String(q.std_ans).trim() !== '';
                    await prisma.questionResponse.upsert({
                      where: { z7iQuestionId_attemptId: { z7iQuestionId: qId, attemptId: dbAttempt.id } },
                      create: {
                        z7iQuestionId: qId,
                        attemptId: dbAttempt.id,
                        questionOrder: q.__order,
                        subjectId,
                        subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                        questionType: q.question_type,
                        questionHtml: q.question,
                        option1: q.opt1 || null,
                        option2: q.opt2 || null,
                        option3: q.opt3 || null,
                        option4: q.opt4 || null,
                        correctAnswer: q.ans,
                        studentAnswer: hasAnswer ? String(q.std_ans) : null,
                        answerStatus: deriveAnswerStatus(q.ans_status, hasAnswer),
                        marksPositive: parseFloat(q.marks_positive),
                        marksNegative: parseFloat(q.marks_negative),
                        scoreObtained: hasAnswer ? (q.p_score + q.n_score) : 0,
                        timeTaken: q.time_taken || null,
                        solutionHtml: q.find_hint || null,
                      },
                      update: {
                        questionOrder: q.__order,
                        subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                        questionType: q.question_type,
                        questionHtml: q.question,
                        option1: q.opt1 || null,
                        option2: q.opt2 || null,
                        option3: q.opt3 || null,
                        option4: q.opt4 || null,
                        correctAnswer: q.ans,
                        studentAnswer: hasAnswer ? String(q.std_ans) : null,
                        answerStatus: deriveAnswerStatus(q.ans_status, hasAnswer),
                        scoreObtained: hasAnswer ? (q.p_score + q.n_score) : 0,
                        timeTaken: q.time_taken || null,
                        solutionHtml: q.find_hint || null,
                      }
                    });
                  }
                  userStats.questions += questions.length;
                }
                userStats.tests++;
              } else {
                userStats.skipped++;
              }
            } catch (err) {
              userStats.skipped++;
              if (!userStats.errorDetails) userStats.errorDetails = [];
              userStats.errorDetails.push('Test error: ' + (err instanceof Error ? err.message : String(err)));
            }
            success++;
            results.push({ userId: user.id, enrollmentNo: z7iAccount.enrollmentNo, ...userStats });
          } catch (err) {
            failed++;
            results.push({ userId: user.id, enrollmentNo: z7iAccount?.enrollmentNo, error: (err instanceof Error ? err.message : String(err)) });
          }
        }

        // Refresh EXP for all synced users
        for (const user of eligibleUsers) {
          try {
            await adminRefreshLeagueExp(user.id);
          } catch {}
        }

        return res.status(200).json({
          success: true,
          total,
          successCount: success,
          failedCount: failed,
          results
        });
      }

      // --- Full sync for all enrolled users ---
      let total = eligibleUsers.length;
      let success = 0;
      let failed = 0;
      let results: any[] = [];

      for (const user of eligibleUsers) {
        const z7iAccount = user.z7iAccount;
        if (!z7iAccount) continue;
        let userStats: { tests: number; questions: number; skipped: number; errorDetails?: string[] } = {
          tests: 0,
          questions: 0,
          skipped: 0
        };
        try {
          const isGuestSync = z7iAccount.isGuest;
          const z7iPassword = decryptZ7iPassword(z7iAccount.encryptedPassword);
          const loginResult = await z7iLogin(z7iAccount.enrollmentNo, z7iPassword);
          if (!loginResult) throw new Error('Login failed');
          const cookies = loginResult.cookies;

          const existingAttempts = await prisma.testAttempt.findMany({
            where: { z7iAccountId: z7iAccount.id },
            select: { z7iId: true },
          });
          const existingAttemptIds = new Set(existingAttempts.map((a: { z7iId: string }) => a.z7iId));

          const packages = await z7iGetPackages(cookies);
          const { details: packageDetails } = await fetchPackageDetailsWithConcurrency(cookies, packages);

          const packageNameMap = new Map();
          for (let i = 0; i < packages.length; i++) {
            const pkg = packages[i];
            if (!packageNameMap.has(pkg.name)) packageNameMap.set(pkg.name, []);
            packageNameMap.get(pkg.name).push({ pkg, details: packageDetails[i], index: i });
          }

          const mergedPackages: Array<{ pkg: any; details: any; index: number }> = [];
          for (const [, arr] of packageNameMap.entries()) {
            if (arr.length === 1) {
              mergedPackages.push(arr[0]);
            } else {
              const withQuestions = arr.find((x: any) => x.details && x.details.tests && x.details.tests.length > 0);
              if (withQuestions) {
                mergedPackages.push(withQuestions);
              } else {
                mergedPackages.push(arr[0]);
              }
            }
          }

          for (const { pkg, details } of mergedPackages) {
            const pkgId = pkg._id.$oid;
            if (!details) continue;

            const dbPackage = await prisma.package.upsert({
              where: { z7iId_z7iAccountId: { z7iId: pkgId, z7iAccountId: z7iAccount.id } },
              create: {
                z7iId: pkgId,
                z7iAccountId: z7iAccount.id,
                name: pkg.name,
                description: pkg.description?.replace(/<[^>]*>/g, '') || null,
                expiryDate: pkg.expiry_date ? new Date(pkg.expiry_date * 1000) : null,
              },
              update: {
                name: pkg.name,
                description: pkg.description?.replace(/<[^>]*>/g, '') || null,
                expiryDate: pkg.expiry_date ? new Date(pkg.expiry_date * 1000) : null,
              }
            });

            for (const test of details.tests as any[]) {
              const testZ7iId = test._id.$oid;
              const subjectsData = test.subjects
                ? (test.subjects as any[]).map((s: any) => ({
                  id: s.subject.$oid,
                  name: s.subject_name,
                  questionCount: parseInt(s.no_of_question)
                }))
                : undefined;

              const dbTest = await prisma.test.upsert({
                where: { z7iId_packageId: { z7iId: testZ7iId, packageId: dbPackage.id } },
                create: {
                  z7iId: testZ7iId,
                  packageId: dbPackage.id,
                  name: test.test_name,
                  description: test.description || null,
                  testType: test.test_type || null,
                  timeLimit: test.time_limit ? parseInt(test.time_limit) : null,
                  maxScore: test.max_score || null,
                  totalQuestions: test.questions?.length || null,
                  subjects: subjectsData,
                },
                update: {
                  name: test.test_name,
                  description: test.description || null,
                  testType: test.test_type || null,
                  timeLimit: test.time_limit ? parseInt(test.time_limit) : null,
                  maxScore: test.max_score || null,
                  totalQuestions: test.questions?.length || null,
                  subjects: subjectsData,
                }
              });

              const scoreOverview = await z7iGetScoreOverview(cookies, testZ7iId);
              if (scoreOverview) {
                const attemptId = scoreOverview._id.$oid;
                const unattemptedCount = isGuestSync
                  ? (test.questions?.length || test.total_questions || 0)
                  : getUnattemptedCount(scoreOverview);
                if (existingAttemptIds.has(attemptId)) {
                  userStats.skipped++;
                  continue;
                }
                const dbAttempt = await prisma.testAttempt.upsert({
                  where: { z7iId_z7iAccountId: { z7iId: attemptId, z7iAccountId: z7iAccount.id } },
                  create: {
                    z7iId: attemptId,
                    z7iAccountId: z7iAccount.id,
                    testId: dbTest.id,
                    timeTaken: scoreOverview.time_taken,
                    submitDate: new Date(scoreOverview.submit_date * 1000),
                    correct: isGuestSync ? 0 : scoreOverview.correct,
                    incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
                    unattempted: unattemptedCount,
                    totalScore: isGuestSync ? 0 : scoreOverview.total_score,
                    maxScore: scoreOverview.test?.[0]?.max_score || null,
                    rank: scoreOverview.rank || null,
                    percentile: scoreOverview.percentile || null,
                    bonusMarks: scoreOverview.bonus_marks || null,
                  },
                  update: {
                    timeTaken: isGuestSync ? null : scoreOverview.time_taken,
                    correct: isGuestSync ? 0 : scoreOverview.correct,
                    incorrect: isGuestSync ? 0 : scoreOverview.incorrect,
                    unattempted: unattemptedCount,
                    totalScore: isGuestSync ? 0 : scoreOverview.total_score,
                    rank: isGuestSync ? null : (scoreOverview.rank || null),
                    percentile: isGuestSync ? null : (scoreOverview.percentile || null),
                    bonusMarks: isGuestSync ? null : (scoreOverview.bonus_marks || null),
                  }
                });
                userStats.tests++;

                const questions = await z7iGetQuestionwise(cookies, testZ7iId);
                if (questions.length > 0) {
                  const questionRows = (questions as any[]).map((q: any) => {
                    const qId = q._id.$oid;
                    const subjectId = q.subject.$oid;
                    const hasAnswer = q.std_ans !== null && q.std_ans !== undefined && String(q.std_ans).trim() !== '';
                    return {
                      z7iQuestionId: qId,
                      attemptId: dbAttempt.id,
                      questionOrder: q.__order,
                      subjectId,
                      subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                      questionType: q.question_type,
                      questionHtml: q.question,
                      option1: q.opt1 || null,
                      option2: q.opt2 || null,
                      option3: q.opt3 || null,
                      option4: q.opt4 || null,
                      correctAnswer: q.ans,
                      studentAnswer: isGuestSync ? null : (hasAnswer ? String(q.std_ans) : null),
                      answerStatus: isGuestSync ? 'unattempted' : deriveAnswerStatus(q.ans_status, hasAnswer),
                      marksPositive: parseFloat(q.marks_positive),
                      marksNegative: parseFloat(q.marks_negative),
                      scoreObtained: isGuestSync ? 0 : (hasAnswer ? (q.p_score + q.n_score) : 0),
                      timeTaken: isGuestSync ? null : (q.time_taken || null),
                      solutionHtml: q.find_hint || null,
                    };
                  });
                  await upsertQuestionResponses(questionRows);
                  userStats.questions += questionRows.length;
                }
              } else {
                if (existingAttemptIds.has(testZ7iId)) {
                  userStats.skipped++;
                  continue;
                }
                const unattendedAttempt = await prisma.testAttempt.upsert({
                  where: { z7iId_z7iAccountId: { z7iId: testZ7iId, z7iAccountId: z7iAccount.id } },
                  create: {
                    z7iId: testZ7iId,
                    z7iAccountId: z7iAccount.id,
                    testId: dbTest.id,
                    timeTaken: null,
                    submitDate: null,
                    correct: 0,
                    incorrect: 0,
                    unattempted: 0,
                    totalScore: 0,
                    maxScore: test.max_score || null,
                    rank: null,
                    percentile: null,
                    bonusMarks: null
                  },
                  update: {}
                });
                const questions = await z7iGetQuestionwise(cookies, testZ7iId);
                if (questions.length > 0) {
                  const questionRows = (questions as any[]).map((q: any) => {
                    const qId = q._id.$oid;
                    const subjectId = q.subject.$oid;
                    return {
                      z7iQuestionId: qId,
                      attemptId: unattendedAttempt.id,
                      questionOrder: q.__order,
                      subjectId,
                      subjectName: SUBJECT_MAP[subjectId] || 'Unknown',
                      questionType: q.question_type,
                      questionHtml: q.question,
                      option1: q.opt1 || null,
                      option2: q.opt2 || null,
                      option3: q.opt3 || null,
                      option4: q.opt4 || null,
                      correctAnswer: q.ans,
                      studentAnswer: null,
                      answerStatus: 'unattempted',
                      marksPositive: parseFloat(q.marks_positive),
                      marksNegative: parseFloat(q.marks_negative),
                      scoreObtained: 0,
                      timeTaken: null,
                      solutionHtml: q.find_hint || null,
                    };
                  });
                  await upsertQuestionResponses(questionRows);
                  userStats.questions += questionRows.length;
                  await prisma.testAttempt.update({
                    where: { id: unattendedAttempt.id },
                    data: { unattempted: questions.length }
                  });
                }
                userStats.tests++;
              }
            }
          }

          await prisma.z7iAccount.update({
            where: { id: z7iAccount.id },
            data: { syncStatus: 'success', lastSyncAt: new Date() }
          });

          success++;
          results.push({ userId: user.id, enrollmentNo: z7iAccount.enrollmentNo, ...userStats });
        } catch (err) {
          failed++;
          results.push({ userId: user.id, enrollmentNo: user.z7iAccount?.enrollmentNo, error: (err instanceof Error ? err.message : String(err)) });
        }
      }

      // Refresh league EXP for all synced users
      for (const user of eligibleUsers) {
        try {
          await adminRefreshLeagueExp(user.id);
        } catch {}
      }

      return res.status(200).json({
        success: true,
        total,
        successCount: success,
        failedCount: failed,
        results
      });
    } catch (error) {
      console.error('Admin fetch all error:', error);
      return res.status(500).json({ error: 'Failed to fetch all user results' });
    }
  }

// ─── Mention helpers ────────────────────────────────────────────────────────

/** Extract @[Name](userId) patterns from content and return unique user IDs */
function extractMentionedUserIds(content: string): string[] {
  const regex = /@\[([^\]]+)\]\(([^)]+)\)/g;
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    ids.add(m[2]);
  }
  return Array.from(ids);
}

/** Create ForumMention records for mentioned users (skip self-mentions) */
async function createMentions(
  mentionedUserIds: string[],
  postId: string,
  replyId: string | null,
  mentionerUserId: string
) {
  // Filter out self-mentions and verify users exist
  const validUserIds = mentionedUserIds.filter(id => id !== mentionerUserId);
  if (validUserIds.length === 0) return;

  const existingUsers = await prisma.user.findMany({
    where: { id: { in: validUserIds } },
    select: { id: true }
  });
  const existingIds = new Set(existingUsers.map(u => u.id));

  const data = validUserIds
    .filter(id => existingIds.has(id))
    .map(id => ({
      postId,
      replyId,
      mentionedUserId: id,
      mentionerUserId
    }));

  if (data.length > 0) {
    await prisma.forumMention.createMany({ data });
  }
}

// ─── Forum mention endpoints ────────────────────────────────────────────────

async function handleForumSearchUsers(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const q = (req.query.q as string || '').trim();
  if (q.length < 1) {
    return res.status(200).json({ users: [] });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        name: { contains: q, mode: 'insensitive' },
        id: { not: payload.userId }
      },
      select: { id: true, name: true },
      take: 8,
      orderBy: { name: 'asc' }
    });
    return res.status(200).json({ users });
  } catch (error) {
    console.error('Forum search users error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumMentionsCount(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  try {
    const count = await prisma.forumMention.count({
      where: { mentionedUserId: payload.userId, isRead: false }
    });
    return res.status(200).json({ count });
  } catch (error) {
    console.error('Forum mentions count error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleForumMarkMentionRead(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'No token provided' });

  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'postId required' });

  try {
    await prisma.forumMention.updateMany({
      where: {
        mentionedUserId: payload.userId,
        postId,
        isRead: false
      },
      data: { isRead: true }
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Forum mark mention read error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
