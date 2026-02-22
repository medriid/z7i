import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/api/prisma.js';
import { verifyToken } from '../../lib/api/auth.js';

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
const PYQ_STREAK_MIN_QUESTIONS = 100;
const PYQ_STREAK_MIN_TIME_SECONDS = 7200;

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

function getTestExp(score: number, maxScore: number | null | undefined, correct: number, incorrect: number): number {
  if (!maxScore || maxScore <= 0) return 0;
  const marksFraction = Math.max(0, Math.min(1, score / maxScore));
  const attempted = correct + incorrect;
  const accuracyFraction = attempted > 0 ? Math.max(0, Math.min(1, correct / attempted)) : 0;
  return Math.round(500 * marksFraction * accuracyFraction);
}

type LeagueProgress = {
  league: string;
  stage: number | null;
  stageStart: number;
  stageEnd: number | null;
  stageExp: number | null;
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
          stageStart: cumulative,
          stageEnd,
          stageExp,
        };
      }
      cumulative = stageEnd;
    }
  }

  return {
    league: MYTHIC_LEAGUE,
    stage: null,
    stageStart: cumulative,
    stageEnd: null,
    stageExp: null,
  };
}

async function ensureProfile(userId: string) {
  const profile = await prisma.userLeagueProfile.findUnique({
    where: { userId },
  });
  if (profile) return profile;
  return prisma.userLeagueProfile.create({
    data: { userId },
  });
}

async function processTestExp(userId: string, force = false) {
  const account = await prisma.z7iAccount.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!account) return;

  if (force) {
    await prisma.userExpEvent.deleteMany({ where: { userId, type: 'test_attempt' } });
  }

  const attempts = await prisma.testAttempt.findMany({
    where: { z7iAccountId: account.id },
    select: {
      id: true,
      totalScore: true,
      maxScore: true,
      correct: true,
      incorrect: true,
      test: { select: { maxScore: true } },
    },
  });

  if (attempts.length === 0) return;

  const attemptIds = attempts.map((attempt) => attempt.id);
  const existing = await prisma.userExpEvent.findMany({
    where: {
      userId,
      type: 'test_attempt',
      sourceId: { in: attemptIds },
    },
    select: { sourceId: true },
  });
  const existingIds = new Set(existing.map((event) => event.sourceId));

  const newEvents = attempts
    .filter((attempt) => !existingIds.has(attempt.id))
    .map((attempt) => {
      const maxScore = attempt.maxScore ?? attempt.test?.maxScore ?? null;
      const exp = getTestExp(attempt.totalScore, maxScore, attempt.correct, attempt.incorrect);
      if (exp <= 0) return null;
      return {
        userId,
        type: 'test_attempt',
        sourceId: attempt.id,
        exp,
        metadata: {
          totalScore: attempt.totalScore,
          maxScore,
          correct: attempt.correct,
          incorrect: attempt.incorrect,
        },
      };
    })
    .filter(Boolean) as Array<{ userId: string; type: string; sourceId: string; exp: number; metadata: object }>;

  if (newEvents.length > 0) {
    await prisma.userExpEvent.createMany({ data: newEvents, skipDuplicates: true });
  }
}

async function processPyqExp(profile: { lastPyqQualifiedAt: Date | null; streakCount: number; streakBonus: number }, userId: string, force = false) {
  if (force) {
    await prisma.userExpEvent.deleteMany({ where: { userId, type: 'pyq_daily' } });
  }

  const existingEvents = await prisma.userExpEvent.findMany({
    where: { userId, type: 'pyq_daily' },
    select: { sourceId: true },
    orderBy: { sourceId: 'desc' },
    take: 1,
  });

  const lastEventDateKey = existingEvents[0]?.sourceId || null;
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

  if (!startDate) return profile;

  const attempts = await prisma.pyqQuestionAttempt.findMany({
    where: {
      userId,
      createdAt: { gte: startDate },
    },
    select: { createdAt: true, timeTaken: true },
  });

  if (attempts.length === 0) return profile;

  const existingDayEvents = await prisma.userExpEvent.findMany({
    where: { userId, type: 'pyq_daily', createdAt: { gte: startDate } },
    select: { sourceId: true },
  });
  const existingDaySet = new Set(existingDayEvents.map((event) => event.sourceId));

  const dailyStats = new Map<string, { count: number; timeSum: number }>();
  attempts.forEach((attempt) => {
    const key = toDateKey(attempt.createdAt);
    const entry = dailyStats.get(key) || { count: 0, timeSum: 0 };
    entry.count += 1;
    entry.timeSum += typeof attempt.timeTaken === 'number' ? attempt.timeTaken : 0;
    dailyStats.set(key, entry);
  });

  const activeDays = Array.from(dailyStats.entries())
    .filter(([, stats]) => stats.count >= PYQ_STREAK_MIN_QUESTIONS && stats.timeSum >= PYQ_STREAK_MIN_TIME_SECONDS)
    .map(([key]) => key)
    .sort();

  if (activeDays.length === 0) return profile;

  let lastQualifiedAt = profile.lastPyqQualifiedAt ? new Date(profile.lastPyqQualifiedAt) : null;
  let streakCount = profile.streakCount || 0;
  let streakBonus = profile.streakBonus || 0;
  const newEvents: Array<{ userId: string; type: string; sourceId: string; exp: number; metadata: object }> = [];

  activeDays.forEach((dayKey) => {
    if (existingDaySet.has(dayKey)) return;

    const dayDate = fromDateKey(dayKey);
    const stats = dailyStats.get(dayKey) || { count: 0, timeSum: 0 };

    // Base EXP scales with both question count and time spent
    const questionFactor = Math.min(stats.count, 200) / 200;
    const timeFactor = Math.min(stats.timeSum, 10800) / 10800;
    const baseExp = Math.round(500 * (questionFactor * 0.6 + timeFactor * 0.4));

    if (baseExp <= 0) return;

    // Streak: 5% gain per consecutive day, 5% loss per missed day, capped at 100% bonus
    if (!lastQualifiedAt) {
      streakCount = 1;
      streakBonus = 0;
    } else {
      const gap = diffDays(lastQualifiedAt, dayDate);
      if (gap === 1) {
        streakCount += 1;
        streakBonus = Math.min(100, streakBonus + 5);
      } else if (gap > 1) {
        streakBonus = Math.max(0, streakBonus - 5 * (gap - 1));
        streakCount = 1;
      }
    }

    const streakMultiplier = 1 + streakBonus / 100;
    const exp = Math.round(baseExp * streakMultiplier);

    lastQualifiedAt = dayDate;

    newEvents.push({
      userId,
      type: 'pyq_daily',
      sourceId: dayKey,
      exp,
      metadata: {
        questionCount: stats.count,
        timeSeconds: stats.timeSum,
        baseExp,
        streakCount,
        streakBonus,
        streakMultiplier,
      },
    });
  });

  if (newEvents.length > 0) {
    await prisma.userExpEvent.createMany({ data: newEvents, skipDuplicates: true });
  }

  return {
    lastPyqQualifiedAt: lastQualifiedAt,
    streakCount,
    streakBonus,
  };
}

async function refreshProfile(userId: string, force = false) {
  const profile = await ensureProfile(userId);

  const pyqProfile = force
    ? { lastPyqQualifiedAt: null, streakCount: 0, streakBonus: 0 }
    : { lastPyqQualifiedAt: profile.lastPyqQualifiedAt, streakCount: profile.streakCount, streakBonus: profile.streakBonus };

  await processTestExp(userId, force);
  const updatedStreak = await processPyqExp(pyqProfile, userId, force);

  const totalExpAgg = await prisma.userExpEvent.aggregate({
    where: { userId },
    _sum: { exp: true },
  });
  const totalExp = Math.max(0, totalExpAgg._sum.exp ?? 0);
  const leagueProgress = computeLeagueProgress(totalExp);

  const updatedProfile = await prisma.userLeagueProfile.update({
    where: { userId },
    data: {
      totalExp,
      league: leagueProgress.league,
      stage: leagueProgress.stage,
      lastPyqQualifiedAt: updatedStreak.lastPyqQualifiedAt,
      streakCount: updatedStreak.streakCount,
      streakBonus: updatedStreak.streakBonus,
    },
  });

  return { updatedProfile, leagueProgress };
}

async function handleProfile(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { leagueUnranked: true, leagueUnrankedUpdatedAt: true, isOwner: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { updatedProfile, leagueProgress } = await refreshProfile(payload.userId);

  let mythicRank: number | null = null;
  if (leagueProgress.league === MYTHIC_LEAGUE && !user.leagueUnranked) {
    if (user.isOwner) {
      mythicRank = 0;
    } else {
      const higherCount = await prisma.userLeagueProfile.count({
        where: {
          league: MYTHIC_LEAGUE,
          user: { leagueUnranked: false, isOwner: false },
          OR: [
            { totalExp: { gt: updatedProfile.totalExp } },
            { totalExp: updatedProfile.totalExp, updatedAt: { lt: updatedProfile.updatedAt } },
          ],
        },
      });
      mythicRank = higherCount + 1;
    }
  }

  return res.status(200).json({
    success: true,
    profile: {
      totalExp: updatedProfile.totalExp,
      league: updatedProfile.league,
      stage: updatedProfile.stage,
      streakCount: updatedProfile.streakCount,
      streakBonus: updatedProfile.streakBonus,
      lastPyqQualifiedAt: updatedProfile.lastPyqQualifiedAt,
      stageStart: leagueProgress.stageStart,
      stageEnd: leagueProgress.stageEnd,
      stageExp: leagueProgress.stageExp,
      isUnranked: user.leagueUnranked,
      unrankedUpdatedAt: user.leagueUnrankedUpdatedAt,
      mythicRank,
    },
  });
}

type MergedLeagueEntry = {
  enrollmentNo: string;
  userId: string;
  userName: string;
  profileImageUrl: string | null;
  totalExp: number;
  testExp: number;
  pyqExp: number;
  league: string;
  stage: number | null;
  isYou: boolean;
  aliasNames: string[];
};

/**
 * Fetch league profiles, merge users that share the same Z7I enrollment number.
 *
 * Merging rules:
 * - Test EXP comes from the primary account only
 * - PYQ EXP from all accounts sharing the enrollment are summed
 * - Primary account is chosen by: highest test EXP → highest PYQ EXP → alphabetical name
 * - Merged totalExp = primary's test EXP + sum of all accounts' PYQ EXP
 * - League/stage is recomputed from the merged totalExp
 */
async function getMergedLeagueEntries(
  filter: { league?: string; stage?: number },
  requestingUserId: string,
  requestingUserEnrollment: string | null,
): Promise<MergedLeagueEntry[]> {
  // 1. Fetch all non-owner, non-unranked profiles
  const allProfiles = await prisma.userLeagueProfile.findMany({
    where: {
      user: { leagueUnranked: false, isOwner: false },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          profileImageUrl: true,
          z7iAccount: { select: { enrollmentNo: true, isGuest: true } },
        },
      },
    },
  });

  // 2. Fetch EXP breakdown (test vs pyq) for all users in one query
  const allUserIds = allProfiles.map((p) => p.userId);
  const expBreakdown = await prisma.userExpEvent.groupBy({
    by: ['userId', 'type'],
    where: { userId: { in: allUserIds } },
    _sum: { exp: true },
  });

  const expMap = new Map<string, { testExp: number; pyqExp: number; otherExp: number }>();
  for (const row of expBreakdown) {
    const entry = expMap.get(row.userId) || { testExp: 0, pyqExp: 0, otherExp: 0 };
    if (row.type === 'test_attempt') {
      entry.testExp = row._sum.exp ?? 0;
    } else if (row.type === 'pyq_daily') {
      entry.pyqExp = row._sum.exp ?? 0;
    } else {
      entry.otherExp += row._sum.exp ?? 0;
    }
    expMap.set(row.userId, entry);
  }

  // 3. Group profiles by enrollment number
  type ProfileGroup = {
    enrollmentNo: string;
    members: Array<{
      userId: string;
      name: string;
      profileImageUrl: string | null;
      testExp: number;
      pyqExp: number;
      otherExp: number;
    }>;
  };

  const enrollmentGroups = new Map<string, ProfileGroup>();

  for (const profile of allProfiles) {
    const enrollmentNo = profile.user.z7iAccount?.isGuest
      ? profile.userId
      : (profile.user.z7iAccount?.enrollmentNo || profile.userId);
    const exp = expMap.get(profile.userId) || { testExp: 0, pyqExp: 0, otherExp: 0 };

    const group = enrollmentGroups.get(enrollmentNo) || { enrollmentNo, members: [] };
    group.members.push({
      userId: profile.userId,
      name: profile.user.name || 'User',
      profileImageUrl: profile.user.profileImageUrl,
      testExp: exp.testExp,
      pyqExp: exp.pyqExp,
      otherExp: exp.otherExp,
    });
    enrollmentGroups.set(enrollmentNo, group);
  }

  // 4. Merge each group
  const merged: MergedLeagueEntry[] = [];

  for (const [enrollmentNo, group] of enrollmentGroups) {
    // Sort to find primary: highest testExp → highest pyqExp → alphabetical name
    const sorted = [...group.members].sort((a, b) => {
      if (b.testExp !== a.testExp) return b.testExp - a.testExp;
      if (b.pyqExp !== a.pyqExp) return b.pyqExp - a.pyqExp;
      return a.name.localeCompare(b.name);
    });

    const primary = sorted[0];
    const aliases = sorted.slice(1);

    // Test EXP + other EXP from primary only; PYQ EXP summed across all
    const totalPyqExp = group.members.reduce((sum, m) => sum + m.pyqExp, 0);
    const totalOtherExp = group.members.reduce((sum, m) => sum + m.otherExp, 0);
    const mergedTotalExp = primary.testExp + totalPyqExp + totalOtherExp;
    const leagueProgress = computeLeagueProgress(mergedTotalExp);

    const isYou = requestingUserEnrollment
      ? enrollmentNo === requestingUserEnrollment
      : group.members.some((m) => m.userId === requestingUserId);

    merged.push({
      enrollmentNo,
      userId: primary.userId,
      userName: primary.name,
      profileImageUrl: primary.profileImageUrl,
      totalExp: mergedTotalExp,
      testExp: primary.testExp,
      pyqExp: totalPyqExp,
      league: leagueProgress.league,
      stage: leagueProgress.stage,
      isYou,
      aliasNames: aliases.map((a) => a.name),
    });
  }

  // 5. Sort by totalExp descending, then name ascending
  merged.sort((a, b) => b.totalExp - a.totalExp || a.userName.localeCompare(b.userName));

  // 6. Filter by league/stage if requested
  if (filter.league) {
    const filtered = merged.filter((e) => {
      if (e.league !== filter.league) return false;
      if (filter.stage !== undefined && e.stage !== filter.stage) return false;
      return true;
    });
    return filtered;
  }

  return merged;
}

async function handleLeaderboard(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { leagueUnranked: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.leagueUnranked) {
    return res.status(200).json({ success: true, entries: [], totalPages: 0, page: 1, ownerEntry: null });
  }

  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'division';
  const page = Math.max(1, parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1);
  const pageSize = 10;
  const { updatedProfile } = await refreshProfile(payload.userId);

  if (!updatedProfile.league) {
    return res.status(200).json({ success: true, entries: [], totalPages: 0, page: 1, ownerEntry: null });
  }

  // Owners are always excluded from the main list and shown separately as rank #0
  const ownerProfiles = await prisma.userLeagueProfile.findMany({
    where: {
      user: { isOwner: true, leagueUnranked: false },
    },
    include: {
      user: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  const ownerEntry = ownerProfiles.length > 0
    ? {
        rank: 0,
        userId: ownerProfiles[0].userId,
        userName: ownerProfiles[0].user?.name || 'Owner',
        profileImageUrl: ownerProfiles[0].user?.profileImageUrl || null,
        totalExp: 0,
        league: ownerProfiles[0].league || '',
        stage: ownerProfiles[0].stage ?? null,
        isYou: ownerProfiles[0].userId === payload.userId,
        isOwner: true,
        isRanked: true,
        aliasNames: [] as string[],
      }
    : null;

  // Get the current user's enrollment number
  const currentUserAccount = await prisma.z7iAccount.findUnique({
    where: { userId: payload.userId },
    select: { enrollmentNo: true, isGuest: true },
  });
  const currentUserEnrollment = currentUserAccount?.isGuest
    ? null
    : (currentUserAccount?.enrollmentNo || null);

  if (scope === 'top') {
    const merged = await getMergedLeagueEntries({}, payload.userId, currentUserEnrollment);

    const totalPages = Math.max(1, Math.ceil(merged.length / pageSize));
    const paged = merged.slice((page - 1) * pageSize, page * pageSize);

    // For ??? members, assign rank within mythic; others get null rank
    let mythicRank = 0;
    const mythicRankMap = new Map<string, number>();
    for (const entry of merged) {
      if (entry.league === MYTHIC_LEAGUE) {
        mythicRank++;
        mythicRankMap.set(entry.enrollmentNo, mythicRank);
      }
    }

    const mapped = paged.map((entry) => ({
      rank: entry.league === MYTHIC_LEAGUE ? (mythicRankMap.get(entry.enrollmentNo) ?? null) : null,
      userId: entry.userId,
      userName: entry.userName,
      profileImageUrl: entry.profileImageUrl,
      totalExp: entry.totalExp,
      league: entry.league,
      stage: entry.stage,
      isYou: entry.isYou,
      isOwner: false,
      isRanked: entry.league === MYTHIC_LEAGUE,
      aliasNames: entry.aliasNames,
    }));

    return res.status(200).json({ success: true, entries: mapped, totalPages, page, ownerEntry });
  }

  // Division leaderboard
  const merged = await getMergedLeagueEntries(
    { league: updatedProfile.league, stage: updatedProfile.stage ?? undefined },
    payload.userId,
    currentUserEnrollment,
  );

  const totalPages = Math.max(1, Math.ceil(merged.length / pageSize));
  const paged = merged.slice((page - 1) * pageSize, page * pageSize);

  const mapped = paged.map((entry, idx) => ({
    rank: (page - 1) * pageSize + idx + 1,
    userId: entry.userId,
    userName: entry.userName,
    profileImageUrl: entry.profileImageUrl,
    totalExp: entry.totalExp,
    league: entry.league,
    stage: entry.stage,
    isYou: entry.isYou,
    isOwner: false,
    isRanked: true,
    aliasNames: entry.aliasNames,
  }));

  return res.status(200).json({ success: true, entries: mapped, totalPages, page, ownerEntry });
}

async function handleStats(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const currentUserAccount = await prisma.z7iAccount.findUnique({
    where: { userId: payload.userId },
    select: { enrollmentNo: true, isGuest: true },
  });
  const merged = await getMergedLeagueEntries(
    {},
    payload.userId,
    currentUserAccount?.isGuest ? null : (currentUserAccount?.enrollmentNo || null),
  );

  const allTierNames = [...LEAGUE_TIERS.map((t) => t.name), MYTHIC_LEAGUE];
  const countMap = new Map<string, number>();
  for (const entry of merged) {
    countMap.set(entry.league, (countMap.get(entry.league) || 0) + 1);
  }

  const leagues = allTierNames.map((name) => ({
    league: name,
    count: countMap.get(name) ?? 0,
  }));

  // Reverse so highest tier (???) comes first
  leagues.reverse();

  return res.status(200).json({ success: true, leagues });
}

async function handleMembers(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const league = typeof req.query.league === 'string' ? req.query.league : '';
  if (!league) return res.status(400).json({ error: 'League parameter required' });

  const allTierNames = [...LEAGUE_TIERS.map((t) => t.name), MYTHIC_LEAGUE];
  if (!allTierNames.includes(league)) {
    return res.status(400).json({ error: 'Invalid league' });
  }

  const page = Math.max(1, parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1);
  const pageSize = 10;

  const currentUserAccount = await prisma.z7iAccount.findUnique({
    where: { userId: payload.userId },
    select: { enrollmentNo: true, isGuest: true },
  });
  const currentUserEnrollment = currentUserAccount?.isGuest
    ? null
    : (currentUserAccount?.enrollmentNo || null);

  const merged = await getMergedLeagueEntries({ league }, payload.userId, currentUserEnrollment);

  const totalPages = Math.max(1, Math.ceil(merged.length / pageSize));
  const paged = merged.slice((page - 1) * pageSize, page * pageSize);
  const globalOffset = (page - 1) * pageSize;

  const mapped = paged.map((entry, idx) => ({
    rank: globalOffset + idx + 1,
    userId: entry.userId,
    userName: entry.userName,
    profileImageUrl: entry.profileImageUrl,
    totalExp: entry.totalExp,
    league: entry.league,
    stage: entry.stage,
    isYou: entry.isYou,
    isOwner: false,
    aliasNames: entry.aliasNames,
  }));

  return res.status(200).json({ success: true, entries: mapped, totalPages, page });
}

async function handleRecalculate(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isOwner: true },
  });
  if (!user?.isOwner) return res.status(403).json({ error: 'Owner access required' });

  const allProfiles = await prisma.userLeagueProfile.findMany({ select: { userId: true } });
  let processed = 0;

  for (const profile of allProfiles) {
    try {
      await refreshProfile(profile.userId, true);
      processed += 1;
    } catch (error) {
      console.error(`Recalculate failed for ${profile.userId}:`, error);
    }
  }

  return res.status(200).json({ success: true, processed, total: allProfiles.length });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = typeof req.query.action === 'string' ? req.query.action : 'profile';

  try {
    if (action === 'profile') {
      return await handleProfile(req, res);
    }
    if (action === 'leaderboard') {
      return await handleLeaderboard(req, res);
    }
    if (action === 'stats') {
      return await handleStats(req, res);
    }
    if (action === 'members') {
      return await handleMembers(req, res);
    }
    if (action === 'recalculate') {
      return await handleRecalculate(req, res);
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('League API error:', error);
    return res.status(500).json({ error: 'Internal server error', details: message });
  }
}
