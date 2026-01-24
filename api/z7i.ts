import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';
import { verifyToken, encryptZ7iPassword, decryptZ7iPassword } from './lib/auth.js';
import { z7iLogin, z7iGetPackages, z7iGetPackageDetails, z7iGetScoreOverview, z7iGetQuestionwise, SUBJECT_MAP } from './lib/z7i-service.js';
import { z7iGetFirstName } from './lib/z7i-service.js';
import type { QuestionData } from './lib/ai-service.js';
import { Prisma } from '@prisma/client';

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

function isMcqType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return MCQ_TYPES.some(type => normalized.includes(type));
}

function isNumericalType(questionType?: string | null) {
  const normalized = (questionType || '').toUpperCase();
  return NUMERICAL_TYPES.some(type => normalized.includes(type));
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

  const { enrollmentNo, z7iPassword } = req.body;
  if (!enrollmentNo || !z7iPassword) {
    return res.status(400).json({ error: 'Enrollment number and Z7I password are required' });
  }

  try {
    const loginResult = await z7iLogin(enrollmentNo, z7iPassword);
    if (!loginResult) {
      return res.status(400).json({ error: 'Invalid Z7I credentials' });
    }
    let firstName: string | null = null;
    try {
      firstName = await z7iGetFirstName(loginResult.cookies);
    } catch {}

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const encryptedPassword = encryptZ7iPassword(z7iPassword);

    if (user.z7iAccount) {
      await prisma.z7iAccount.update({
        where: { id: user.z7iAccount.id },
        data: { enrollmentNo, encryptedPassword, syncStatus: 'pending', firstName }
      });
    } else {
      await prisma.z7iAccount.create({
        data: { userId: user.id, enrollmentNo, encryptedPassword, syncStatus: 'pending', firstName }
      });
    }

    return res.status(200).json({ success: true, message: 'Z7I account linked', enrollmentNo });
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
          const unattemptedCount = getUnattemptedCount(scoreOverview);
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
            dbAttempt = await prisma.testAttempt.upsert({
              where: { z7iId_z7iAccountId: { z7iId: attemptId, z7iAccountId: z7iAccount.id } },
              create: {
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
              },
              update: {
                timeTaken: scoreOverview.time_taken,
                correct: scoreOverview.correct,
                incorrect: scoreOverview.incorrect,
                unattempted: unattemptedCount,
                totalScore: scoreOverview.total_score,
                rank: scoreOverview.rank || null,
                percentile: scoreOverview.percentile || null,
                bonusMarks: scoreOverview.bonus_marks || null,
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
                studentAnswer: hasAnswer ? String(q.std_ans) : null,
                answerStatus: deriveAnswerStatus(q.ans_status, hasAnswer),
                marksPositive: parseFloat(q.marks_positive),
                marksNegative: parseFloat(q.marks_negative),
                scoreObtained: hasAnswer ? (q.p_score + q.n_score) : 0,
                timeTaken: q.time_taken || null,
                solutionHtml: q.find_hint || null,
              };
            });
            await prisma.questionResponse.createMany({
              data: questionRows,
              skipDuplicates: true
            });
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
            await prisma.questionResponse.createMany({
              data: questionRows,
              skipDuplicates: true
            });
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
    let updatedAttempt;
    if (scoreOverview) {
      const unattemptedCount = getUnattemptedCount(scoreOverview);
      updatedAttempt = await prisma.testAttempt.update({
        where: { id: attemptId },
        data: {
          timeTaken: scoreOverview.time_taken,
          correct: scoreOverview.correct,
          incorrect: scoreOverview.incorrect,
          unattempted: unattemptedCount,
          totalScore: scoreOverview.total_score,
          maxScore: scoreOverview.test?.[0]?.max_score || null,
          rank: scoreOverview.rank || null,
          percentile: scoreOverview.percentile || null,
          bonusMarks: scoreOverview.bonus_marks || null,
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

    const tests = attempts.map(attempt => {
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
      const derivedUnattempted = Math.max(0, totalResponses - derivedCorrect - derivedIncorrect);
      const adjustedScore = attempt.totalScore + scoreAdjustment + bonusMarks;

      return {
        id: attempt.id,
        testId: attempt.testId,
        testName: attempt.test.name,
        packageName: attempt.test.package.name,
        testType: attempt.test.testType,
        submitDate: attempt.submitDate,
        timeTaken: attempt.timeTaken,
        correct: derivedCorrect,
        incorrect: derivedIncorrect,
        unattempted: derivedUnattempted,
        totalScore: attempt.totalScore,
        maxScore: attempt.maxScore || attempt.test.maxScore,
        rank: attempt.rank,
        percentile: attempt.percentile,
        totalQuestions: totalResponses,
        subjects: attempt.test.subjects,
        hasKeyChanges: attemptKeyChanges.length > 0,
        keyChangeCount: attemptKeyChanges.length,
        bonusMarks,
        adjustedScore,
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

  const { attemptId, subject } = req.query;
  if (!attemptId || typeof attemptId !== 'string') {
    return res.status(400).json({ error: 'Attempt ID is required' });
  }

  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { z7iAccount: true }
    });

    if (!user || !user.z7iAccount) {
      return res.status(400).json({ error: 'No Z7I account linked' });
    }

    const attempt = await prisma.testAttempt.findFirst({
      where: { id: attemptId, z7iAccountId: user.z7iAccount.id },
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
    const derivedCounts = questions.reduce(
      (acc, q) => {
        const normalized = deriveAnswerStatus(q.answerStatus, !!(q.studentAnswer && q.studentAnswer.trim()));
        if (normalized === 'correct') acc.correct += 1;
        if (normalized === 'incorrect') acc.incorrect += 1;
        return acc;
      },
      { correct: 0, incorrect: 0 }
    );
    const derivedUnattempted = Math.max(0, questions.length - derivedCounts.correct - derivedCounts.incorrect);

    const subjectStats = await prisma.questionResponse.groupBy({
      by: ['subjectName'],
      where: { attemptId },
      _count: { id: true },
      _sum: { scoreObtained: true }
    });

    const subjects = subjectStats.map(s => ({
      name: s.subjectName,
      total: s._count.id,
      score: s._sum.scoreObtained || 0,
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

    const userIsAdmin = await isAdmin(payload.userId);

    const canUseAi = userIsAdmin || user.canUseAiSolutions;

    const testRecord = await prisma.test.findUnique({
      where: { id: attempt.testId },
      select: { z7iId: true }
    });

    return res.status(200).json({
      success: true,
      isAdmin: canUseAi,
      testZ7iId: testRecord?.z7iId || null,
      attempt: {
        id: attempt.id,
        testName: attempt.test.name,
        packageName: attempt.test.package.name,
        testType: attempt.test.testType,
        timeLimit: attempt.test.timeLimit || 180, // Default 180 minutes for JEE
        submitDate: attempt.submitDate,
        timeTaken: attempt.timeTaken,
        correct: derivedCounts.correct,
        incorrect: derivedCounts.incorrect,
        unattempted: derivedUnattempted,
        totalScore: attempt.totalScore,
        maxScore: attempt.maxScore || attempt.test.maxScore,
        rank: attempt.rank,
        percentile: attempt.percentile,
      },
      subjects,
      questions: await Promise.all(questions.map(async q => {
        const isBonus = bonusSet.has(q.z7iQuestionId);
        const keyChange = keyChangeMap.get(q.z7iQuestionId);
        const effectiveCorrectAnswer = keyChange ? keyChange.newAnswer : q.correctAnswer;
        const originalCorrectAnswer = q.correctAnswer;
        const hasKeyChange = !!keyChange;
        const hasStudentAnswer = !!(q.studentAnswer && q.studentAnswer.trim());
        let effectiveStatus = deriveAnswerStatus(q.answerStatus, hasStudentAnswer);
        let effectiveScore = q.scoreObtained;
        let keyChangeAdjustment = 0;
        if (hasKeyChange && hasStudentAnswer) {
          const matchesNew = isAnswerMatch(q.studentAnswer, effectiveCorrectAnswer, q.questionType);
          const matchesOriginal = isAnswerMatch(q.studentAnswer, originalCorrectAnswer, q.questionType);
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
          studentAnswer: q.studentAnswer,
          status: effectiveStatus,
          originalStatus: hasKeyChange ? q.answerStatus : null,
          marksPositive: q.marksPositive,
          marksNegative: q.marksNegative,
          scoreObtained: effectiveScore,
          originalScoreObtained: hasKeyChange ? q.scoreObtained : null,
          timeTaken: q.timeTaken,
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

    const formattedBookmarks = bookmarks.map(b => ({
      id: b.id,
      questionId: b.questionId,
      createdAt: b.createdAt,
      question: {
        id: b.question.id,
        z7iQuestionId: b.question.z7iQuestionId,
        order: b.question.questionOrder,
        subject: b.question.subjectName,
        type: b.question.questionType,
        questionHtml: b.question.questionHtml,
        option1: b.question.option1,
        option2: b.question.option2,
        option3: b.question.option3,
        option4: b.question.option4,
        correctAnswer: b.question.correctAnswer,
        studentAnswer: b.question.studentAnswer,
        answerStatus: b.question.answerStatus,
        marksPositive: b.question.marksPositive,
        marksNegative: b.question.marksNegative,
        scoreObtained: b.question.scoreObtained,
      },
      test: {
        id: b.question.attempt.test.id,
        testName: b.question.attempt.test.name,
        packageId: b.question.attempt.test.packageId,
        submitDate: b.question.attempt.submitDate,
      }
    }));

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
          z7iAccount: {
            select: {
              user: { select: { id: true, name: true, email: true } }
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
            select: { z7iQuestionId: true, studentAnswer: true, answerStatus: true, marksPositive: true, marksNegative: true, questionType: true }
          }
        },
        orderBy: { totalScore: 'desc' }
      }),
      prisma.testAttempt.count({ where: { testId: { in: testIds } } })
    ]);

    const bonusQuestions = await prisma.bonusQuestion.findMany({
      where: { testZ7iId }
    });
    const bonusSet = new Set(bonusQuestions.map((b: any) => b.z7iQuestionId));

    const answerKeyChanges = await prisma.answerKeyChange.findMany({
      where: { testZ7iId }
    });
    const keyChangesMap = new Map(answerKeyChanges.map((k: any) => [k.z7iQuestionId, { newAnswer: k.newAnswer, originalAnswer: k.originalAnswer }]));

    const leaderboardMap = new Map<string, { entry: any; attempts: number }>();
    attempts.forEach((attempt: any) => {
      let scoreAdjustment = 0;
      let bonusMarks = 0;

      for (const response of attempt.responses) {
        const keyChange = keyChangesMap.get(response.z7iQuestionId);
        const isBonus = bonusSet.has(response.z7iQuestionId);

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
      }

      const adjustedScore = attempt.totalScore + scoreAdjustment + bonusMarks;
      const userId = attempt.z7iAccount.user.id;
      const existing = leaderboardMap.get(userId);
      const entry = {
        userId,
        userName: attempt.z7iAccount.user.name,
        userEmail: attempt.z7iAccount.user.email,
        adjustedScore,
        totalScore: attempt.totalScore,
        rank: 0, // will be set below
        percentile: attempt.percentile,
        correct: attempt.correct,
        incorrect: attempt.incorrect,
        unattempted: attempt.unattempted,
        timeTaken: attempt.timeTaken
      };

      if (!existing) {
        leaderboardMap.set(userId, { entry, attempts: 1 });
        return;
      }

      existing.attempts += 1;
      if (entry.adjustedScore > existing.entry.adjustedScore) {
        existing.entry = entry;
      }
    });

    const leaderboardData = Array.from(leaderboardMap.values())
      .filter(({ attempts }) => (!reattemptOnlyMode ? true : attempts > 1))
      .map(({ entry }) => entry)
      .sort((a: any, b: any) => b.adjustedScore - a.adjustedScore || a.userName.localeCompare(b.userName));

    const pagedLeaderboard = leaderboardData.slice(skip, skip + pageSize);

    pagedLeaderboard.forEach((entry: any, index: number) => {
      entry.rank = skip + index + 1;
    });

    const currentUserIndex = leaderboardData.findIndex((e: any) => e.userId === payload.userId);
    const filteredParticipantCount = leaderboardData.length;
    const uniqueParticipantCount = leaderboardMap.size;

    return res.status(200).json({
      success: true,
      leaderboard: pagedLeaderboard,
      currentUserRank: currentUserIndex !== -1 ? skip + currentUserIndex + 1 : null,
      currentUserId: payload.userId,
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

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
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

    const [posts, total] = await Promise.all([
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
      prisma.forumPost.count({ where })
    ]);

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

  const { title, content, questionId } = req.body;
  
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
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
        questionId: questionId || null
      }
    });

    return res.status(200).json({ success: true, postId: post.id });
  } catch (error) {
    console.error('Create forum post error:', error);
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

  const userIsAdmin = await isAdmin(payload.userId);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { canUseAiSolutions: true }
  });
  
  if (!userIsAdmin && !user?.canUseAiSolutions) {
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

  const userIsAdmin = await isAdmin(payload.userId);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { canUseAiSolutions: true }
  });
  
  if (!userIsAdmin && !user?.canUseAiSolutions) {
    return res.status(403).json({ error: 'AI solutions access required' });
  }

  const { questionId, model } = req.body as { questionId?: string; model?: 'flash' | 'lite' | '3-12b' };
  if (!questionId) {
    return res.status(400).json({ error: 'Question ID is required' });
  }

  try {
    const { generateSolution, isGeminiConfigured } = await import('./lib/ai-service.js');

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

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { canUseAiSolutions: true }
  });

  if (!user?.canUseAiSolutions) {
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
    const { generateDoubtResponse, isGeminiConfigured } = await import('./lib/ai-service.js');

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

  const userIsAdmin = await isAdmin(payload.userId);
  if (!userIsAdmin) {
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
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        lastIpAddress: true,
        canUseAiSolutions: true,
        canAccessAiChatRoom: true,
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

    const formattedUsers = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt.toISOString(),
      lastIpAddress: u.lastIpAddress,
      canUseAiSolutions: u.canUseAiSolutions,
      canAccessAiChatRoom: u.canAccessAiChatRoom,
      z7iLinked: !!u.z7iAccount,
      z7iEnrollment: u.z7iAccount?.enrollmentNo || null,
      lastSyncAt: u.z7iAccount?.lastSyncAt?.toISOString() || null,
      z7iFirstName: u.z7iAccount?.firstName || null
    }));

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

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.canUseAiSolutions && canAccessAiChatRoom) {
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
    case 'forum-delete-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleDeleteReply(req, res);
    case 'forum-toggle-resolved':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleToggleResolved(req, res);
    case 'forum-accept-reply':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAcceptReply(req, res);
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
    case 'admin-fetch-all':
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      return handleAdminFetchAll(req, res);
    default:
      return res.status(400).json({ error: 'Invalid action' });
  async function handleAdminFetchAll(req: VercelRequest, res: VercelResponse) {
    const payload = getAuth(req);
    if (!payload) return res.status(401).json({ error: 'No token provided' });

    const userIsAdmin = await isAdmin(payload.userId);
    if (!userIsAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const { testId } = req.body;
      if (!testId) {
        return res.status(400).json({ error: 'testId is required' });
      }
      const testRecord = await prisma.test.findUnique({
        where: { id: testId },
        include: { package: true }
      });
      if (!testRecord) {
        return res.status(404).json({ error: 'Test not found' });
      }
      const users = await prisma.user.findMany({
        where: { z7iAccount: { is: {} } },
        include: { z7iAccount: true }
      });
      let total = users.length;
      let success = 0;
      let failed = 0;
      let results: any[] = [];
      for (const user of users) {
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
  }
}
