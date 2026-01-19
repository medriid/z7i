import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

const resolveDatabaseUrl = () =>
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.NEON_DATABASE_URL;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return res.status(500).json({
      error: 'Database connection string is missing. Set DATABASE_URL or a Postgres/Neon URL env var.',
    });
  }

  const sql = neon(databaseUrl);

  try {
    
    await sql`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT UNIQUE NOT NULL,
        "password" TEXT NOT NULL,
        "name" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "themeMode" TEXT NOT NULL DEFAULT 'dark',
        "themeCustomEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
        "themeAccent" TEXT,
        "themeAccentSecondary" TEXT,
        "themeSuccess" TEXT,
        "themeError" TEXT,
        "themeWarning" TEXT,
        "themeUnattempted" TEXT,
        "lastIpAddress" TEXT,
        "canUseAiSolutions" BOOLEAN NOT NULL DEFAULT FALSE,
        "canAccessAiChatRoom" BOOLEAN NOT NULL DEFAULT TRUE,
        "isOwner" BOOLEAN NOT NULL DEFAULT FALSE,
        "streakCount" INTEGER NOT NULL DEFAULT 0,
        "lastStreakAt" TIMESTAMP(3)
      )
    `;

    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastIpAddress" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canUseAiSolutions" BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canAccessAiChatRoom" BOOLEAN NOT NULL DEFAULT TRUE`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeMode" TEXT NOT NULL DEFAULT 'dark'`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeCustomEnabled" BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeAccent" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeAccentSecondary" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeSuccess" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeError" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeWarning" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "themeUnattempted" TEXT`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streakCount" INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastStreakAt" TIMESTAMP(3)`;

    await sql`
      CREATE TABLE IF NOT EXISTS "Session" (
        "id" TEXT PRIMARY KEY,
        "token" TEXT UNIQUE NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "AiChatPersonalityConfig" (
        "id" TEXT PRIMARY KEY,
        "key" TEXT UNIQUE NOT NULL,
        "label" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "promptHint" TEXT NOT NULL,
        "systemPrompt" TEXT,
        "isGated" BOOLEAN NOT NULL DEFAULT FALSE,
        "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "AiChatSession" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "title" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "personalityId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "AiChatMessage" (
        "id" TEXT PRIMARY KEY,
        "sessionId" TEXT NOT NULL REFERENCES "AiChatSession"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "Z7iAccount" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT UNIQUE NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "enrollmentNo" TEXT NOT NULL,
        "encryptedPassword" TEXT NOT NULL,
        "firstName" TEXT,
        "lastSyncAt" TIMESTAMP(3),
        "syncStatus" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`ALTER TABLE "Z7iAccount" ADD COLUMN IF NOT EXISTS "firstName" TEXT`;

    await sql`
      CREATE TABLE IF NOT EXISTS "Package" (
        "id" TEXT PRIMARY KEY,
        "z7iId" TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL REFERENCES "Z7iAccount"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "expiryDate" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("z7iId", "z7iAccountId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "Test" (
        "id" TEXT PRIMARY KEY,
        "z7iId" TEXT NOT NULL,
        "packageId" TEXT NOT NULL REFERENCES "Package"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "testType" TEXT,
        "timeLimit" INTEGER,
        "maxScore" INTEGER,
        "totalQuestions" INTEGER,
        "startDate" TIMESTAMP(3),
        "endDate" TIMESTAMP(3),
        "subjects" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("z7iId", "packageId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "TestAttempt" (
        "id" TEXT PRIMARY KEY,
        "z7iId" TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL REFERENCES "Z7iAccount"("id") ON DELETE CASCADE,
        "testId" TEXT NOT NULL REFERENCES "Test"("id") ON DELETE CASCADE,
        "timeTaken" DOUBLE PRECISION,
        "submitDate" TIMESTAMP(3),
        "correct" INTEGER NOT NULL DEFAULT 0,
        "incorrect" INTEGER NOT NULL DEFAULT 0,
        "unattempted" INTEGER NOT NULL DEFAULT 0,
        "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "maxScore" INTEGER,
        "rank" INTEGER,
        "percentile" DOUBLE PRECISION,
        "bonusMarks" DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("z7iId", "z7iAccountId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "QuestionResponse" (
        "id" TEXT PRIMARY KEY,
        "z7iQuestionId" TEXT NOT NULL,
        "attemptId" TEXT NOT NULL REFERENCES "TestAttempt"("id") ON DELETE CASCADE,
        "questionOrder" INTEGER NOT NULL,
        "subjectId" TEXT,
        "subjectName" TEXT,
        "questionType" TEXT NOT NULL,
        "questionHtml" TEXT NOT NULL,
        "option1" TEXT,
        "option2" TEXT,
        "option3" TEXT,
        "option4" TEXT,
        "correctAnswer" TEXT NOT NULL,
        "studentAnswer" TEXT,
        "answerStatus" TEXT NOT NULL,
        "marksPositive" DOUBLE PRECISION NOT NULL DEFAULT 4,
        "marksNegative" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "scoreObtained" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "timeTaken" INTEGER,
        "avgTimeTaken" INTEGER,
        "percentCorrect" DOUBLE PRECISION,
        "solutionHtml" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("z7iQuestionId", "attemptId")
      )
    `;

    await sql`ALTER TABLE "QuestionResponse" ADD COLUMN IF NOT EXISTS "avgTimeTaken" INTEGER`;
    await sql`ALTER TABLE "QuestionResponse" ADD COLUMN IF NOT EXISTS "percentCorrect" DOUBLE PRECISION`;
    await sql`ALTER TABLE "QuestionResponse" ADD COLUMN IF NOT EXISTS "aiSolutionHtml" TEXT`;
    await sql`ALTER TABLE "QuestionResponse" ADD COLUMN IF NOT EXISTS "aiGeneratedAt" TIMESTAMP(3)`;

    await sql`CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "AiChatSession_userId_idx" ON "AiChatSession"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "AiChatMessage_sessionId_idx" ON "AiChatMessage"("sessionId")`;
    await sql`CREATE INDEX IF NOT EXISTS "Package_z7iAccountId_idx" ON "Package"("z7iAccountId")`;
    await sql`CREATE INDEX IF NOT EXISTS "Test_packageId_idx" ON "Test"("packageId")`;
    await sql`CREATE INDEX IF NOT EXISTS "TestAttempt_z7iAccountId_idx" ON "TestAttempt"("z7iAccountId")`;
    await sql`CREATE INDEX IF NOT EXISTS "TestAttempt_testId_idx" ON "TestAttempt"("testId")`;
    await sql`CREATE INDEX IF NOT EXISTS "QuestionResponse_attemptId_idx" ON "QuestionResponse"("attemptId")`;

    if (process.env.NODE_ENV !== 'production') {
      const defaultAdminEmail = 'logeshms.cbe@gmail.com';
      const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const existingAdmin = await sql`SELECT "id" FROM "User" WHERE "email" = ${defaultAdminEmail} LIMIT 1`;
      if (existingAdmin.length === 0) {
        const passwordHash = await bcrypt.hash(defaultAdminPassword, 12);
        const adminId = crypto.randomUUID();
        await sql`
          INSERT INTO "User" (
            "id",
            "email",
            "password",
            "name",
            "createdAt",
            "updatedAt",
            "canUseAiSolutions",
            "canAccessAiChatRoom"
          )
          VALUES (
            ${adminId},
            ${defaultAdminEmail},
            ${passwordHash},
            'Owner',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP,
            TRUE,
            TRUE
          )
        `;
      }
    }

    await sql`
      CREATE TABLE IF NOT EXISTS "BookmarkGroup" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "name")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "QuestionBookmark" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "groupId" TEXT REFERENCES "BookmarkGroup"("id") ON DELETE SET NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "questionId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "QuestionNote" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "content" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "questionId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "QuestionComment" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "userName" TEXT,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "content" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "BonusQuestion" (
        "id" TEXT PRIMARY KEY,
        "z7iQuestionId" TEXT UNIQUE NOT NULL,
        "testZ7iId" TEXT NOT NULL,
        "reason" TEXT,
        "markedBy" TEXT NOT NULL,
        "markedByName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "AnswerKeyChange" (
        "id" TEXT PRIMARY KEY,
        "z7iQuestionId" TEXT UNIQUE NOT NULL,
        "testZ7iId" TEXT NOT NULL,
        "originalAnswer" TEXT NOT NULL,
        "newAnswer" TEXT NOT NULL,
        "reason" TEXT,
        "changedBy" TEXT NOT NULL,
        "changedByName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "TestRevision" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "attemptId" TEXT NOT NULL,
        "correct" INTEGER NOT NULL DEFAULT 0,
        "incorrect" INTEGER NOT NULL DEFAULT 0,
        "unattempted" INTEGER NOT NULL DEFAULT 0,
        "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "maxScore" INTEGER NOT NULL DEFAULT 0,
        "timeTaken" INTEGER NOT NULL DEFAULT 0,
        "originalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "improvement" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "RevisionResponse" (
        "id" TEXT PRIMARY KEY,
        "revisionId" TEXT NOT NULL REFERENCES "TestRevision"("id") ON DELETE CASCADE,
        "z7iQuestionId" TEXT NOT NULL,
        "questionOrder" INTEGER NOT NULL,
        "userAnswer" TEXT,
        "correctAnswer" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "marksObtained" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "marksPositive" DOUBLE PRECISION NOT NULL DEFAULT 4,
        "marksNegative" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "timeSpent" INTEGER NOT NULL DEFAULT 0,
        "wasFlagged" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS "QuestionBookmark_userId_idx" ON "QuestionBookmark"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "QuestionBookmark_questionId_idx" ON "QuestionBookmark"("questionId")`;
    await sql`CREATE INDEX IF NOT EXISTS "QuestionNote_userId_idx" ON "QuestionNote"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "QuestionNote_questionId_idx" ON "QuestionNote"("questionId")`;
    await sql`CREATE INDEX IF NOT EXISTS "QuestionComment_questionId_idx" ON "QuestionComment"("questionId")`;
    await sql`CREATE INDEX IF NOT EXISTS "BonusQuestion_testZ7iId_idx" ON "BonusQuestion"("testZ7iId")`;
    await sql`CREATE INDEX IF NOT EXISTS "AnswerKeyChange_testZ7iId_idx" ON "AnswerKeyChange"("testZ7iId")`;
    await sql`CREATE INDEX IF NOT EXISTS "TestRevision_userId_idx" ON "TestRevision"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "TestRevision_attemptId_idx" ON "TestRevision"("attemptId")`;
    await sql`CREATE INDEX IF NOT EXISTS "RevisionResponse_revisionId_idx" ON "RevisionResponse"("revisionId")`;

    await sql`
      CREATE TABLE IF NOT EXISTS "ScoreAdjustment" (
        "id" TEXT PRIMARY KEY,
        "testZ7iId" TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL,
        "adjustment" DOUBLE PRECISION NOT NULL,
        "reason" TEXT,
        "changedBy" TEXT NOT NULL,
        "changedByName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("testZ7iId", "z7iAccountId")
      )
    `;

    await sql`ALTER TABLE "Test" ADD COLUMN IF NOT EXISTS "z7iTestId" TEXT`;

    await sql`CREATE INDEX IF NOT EXISTS "ScoreAdjustment_testZ7iId_idx" ON "ScoreAdjustment"("testZ7iId")`;
    await sql`CREATE INDEX IF NOT EXISTS "ScoreAdjustment_z7iAccountId_idx" ON "ScoreAdjustment"("z7iAccountId")`;

    await sql`
      CREATE TABLE IF NOT EXISTS "ForumPost" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "userName" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "questionId" TEXT REFERENCES "QuestionResponse"("id") ON DELETE SET NULL,
        "likes" INTEGER NOT NULL DEFAULT 0,
        "viewCount" INTEGER NOT NULL DEFAULT 0,
        "isPinned" BOOLEAN NOT NULL DEFAULT FALSE,
        "isResolved" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "ForumReply" (
        "id" TEXT PRIMARY KEY,
        "postId" TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL,
        "userName" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "isAccepted" BOOLEAN NOT NULL DEFAULT FALSE,
        "likes" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "ForumPostLike" (
        "id" TEXT PRIMARY KEY,
        "postId" TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("postId", "userId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "ForumReplyLike" (
        "id" TEXT PRIMARY KEY,
        "replyId" TEXT NOT NULL REFERENCES "ForumReply"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("replyId", "userId")
      )
    `;


    await sql`
      CREATE TABLE IF NOT EXISTS "PastYearPaper" (
        "id" TEXT PRIMARY KEY,
        "examName" TEXT NOT NULL,
        "year" INTEGER NOT NULL,
        "session" TEXT,
        "shift" TEXT,
        "date" TIMESTAMP(3),
        "title" TEXT NOT NULL,
        "description" TEXT,
        "timeLimit" INTEGER NOT NULL,
        "maxScore" INTEGER NOT NULL,
        "totalQuestions" INTEGER NOT NULL,
        "structure" JSONB,
        "source" TEXT,
        "sourceUrl" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("examName", "year", "session", "shift")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "PYPQuestion" (
        "id" TEXT PRIMARY KEY,
        "paperId" TEXT NOT NULL REFERENCES "PastYearPaper"("id") ON DELETE CASCADE,
        "questionNumber" INTEGER NOT NULL,
        "subject" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "questionHtml" TEXT NOT NULL,
        "option1" TEXT,
        "option2" TEXT,
        "option3" TEXT,
        "option4" TEXT,
        "correctAnswer" TEXT NOT NULL,
        "solutionHtml" TEXT,
        "marksPositive" DOUBLE PRECISION NOT NULL DEFAULT 4,
        "marksNegative" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "difficulty" TEXT,
        "avgTimeTaken" INTEGER,
        "percentCorrect" DOUBLE PRECISION,
        "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("paperId", "questionNumber")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "PYPAttempt" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "paperId" TEXT NOT NULL REFERENCES "PastYearPaper"("id") ON DELETE CASCADE,
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "submittedAt" TIMESTAMP(3),
        "timeTaken" DOUBLE PRECISION,
        "correct" INTEGER NOT NULL DEFAULT 0,
        "incorrect" INTEGER NOT NULL DEFAULT 0,
        "unattempted" INTEGER NOT NULL DEFAULT 0,
        "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "physicsScore" DOUBLE PRECISION,
        "chemistryScore" DOUBLE PRECISION,
        "mathsScore" DOUBLE PRECISION,
        "answers" JSONB NOT NULL DEFAULT '{}',
        "topicStats" JSONB,
        "revisionRecommendations" JSONB,
        "isCompleted" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "paperId", "startedAt")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "PYPBookmark" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "PYPQuestion"("id") ON DELETE CASCADE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "questionId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "PYPNote" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "PYPQuestion"("id") ON DELETE CASCADE,
        "content" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("userId", "questionId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "CustomTest" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "prompt" TEXT NOT NULL,
        "modelId" TEXT NOT NULL,
        "timeLimit" INTEGER NOT NULL,
        "totalQuestions" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ready',
        "isShared" BOOLEAN NOT NULL DEFAULT FALSE,
        "isManual" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "CustomTestQuestion" (
        "id" TEXT PRIMARY KEY,
        "testId" TEXT NOT NULL REFERENCES "CustomTest"("id") ON DELETE CASCADE,
        "questionOrder" INTEGER NOT NULL,
        "subject" TEXT,
        "chapter" TEXT,
        "difficulty" TEXT,
        "questionType" TEXT NOT NULL,
        "questionHtml" TEXT NOT NULL,
        "option1" TEXT,
        "option2" TEXT,
        "option3" TEXT,
        "option4" TEXT,
        "correctAnswer" TEXT NOT NULL,
        "marksPositive" DOUBLE PRECISION NOT NULL DEFAULT 4,
        "marksNegative" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("testId", "questionOrder")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "CustomTestAttempt" (
        "id" TEXT PRIMARY KEY,
        "testId" TEXT NOT NULL REFERENCES "CustomTest"("id") ON DELETE CASCADE,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "status" TEXT NOT NULL DEFAULT 'in_progress',
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "submittedAt" TIMESTAMP(3),
        "timeTaken" INTEGER,
        "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
        "correct" INTEGER NOT NULL DEFAULT 0,
        "incorrect" INTEGER NOT NULL DEFAULT 0,
        "unattempted" INTEGER NOT NULL DEFAULT 0,
        "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "maxScore" INTEGER,
        "accuracy" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("testId", "userId")
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "CustomTestResponse" (
        "id" TEXT PRIMARY KEY,
        "attemptId" TEXT NOT NULL REFERENCES "CustomTestAttempt"("id") ON DELETE CASCADE,
        "questionId" TEXT NOT NULL REFERENCES "CustomTestQuestion"("id") ON DELETE CASCADE,
        "answer" TEXT,
        "flagged" BOOLEAN NOT NULL DEFAULT FALSE,
        "timeSpent" INTEGER NOT NULL DEFAULT 0,
        "visited" BOOLEAN NOT NULL DEFAULT FALSE,
        "answerStatus" TEXT,
        "marksObtained" DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("attemptId", "questionId")
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS "ForumPost_userId_idx" ON "ForumPost"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "ForumPost_questionId_idx" ON "ForumPost"("questionId")`;
    await sql`CREATE INDEX IF NOT EXISTS "ForumPost_createdAt_idx" ON "ForumPost"("createdAt" DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS "ForumReply_postId_idx" ON "ForumReply"("postId")`;
    await sql`CREATE INDEX IF NOT EXISTS "ForumReply_userId_idx" ON "ForumReply"("userId")`;

    await sql`CREATE INDEX IF NOT EXISTS "PastYearPaper_examName_idx" ON "PastYearPaper"("examName")`;
    await sql`CREATE INDEX IF NOT EXISTS "PastYearPaper_year_idx" ON "PastYearPaper"("year" DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS "PYPQuestion_paperId_idx" ON "PYPQuestion"("paperId")`;
    await sql`CREATE INDEX IF NOT EXISTS "PYPQuestion_subject_idx" ON "PYPQuestion"("subject")`;
    await sql`CREATE INDEX IF NOT EXISTS "PYPAttempt_userId_idx" ON "PYPAttempt"("userId")`;
    await sql`CREATE INDEX IF NOT EXISTS "PYPAttempt_paperId_idx" ON "PYPAttempt"("paperId")`;

    await sql`ALTER TABLE "PYPAttempt" ADD COLUMN IF NOT EXISTS "topicStats" JSONB`;
    await sql`ALTER TABLE "PYPAttempt" ADD COLUMN IF NOT EXISTS "revisionRecommendations" JSONB`;
    await sql`ALTER TABLE "QuestionBookmark" ADD COLUMN IF NOT EXISTS "groupId" TEXT`;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'QuestionBookmark_groupId_fkey'
        ) THEN
          ALTER TABLE "QuestionBookmark"
            ADD CONSTRAINT "QuestionBookmark_groupId_fkey"
            FOREIGN KEY ("groupId") REFERENCES "BookmarkGroup"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `;
    await sql`ALTER TABLE "CustomTest" ADD COLUMN IF NOT EXISTS "isShared" BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE "CustomTest" ADD COLUMN IF NOT EXISTS "isManual" BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE "PastYearPaper" ALTER COLUMN "shift" TYPE TEXT USING "shift"::TEXT`;

    return res.status(200).json({ 
      success: true, 
      message: 'Database migrated successfully!',
      tables: ['User', 'Session', 'AiChatPersonalityConfig', 'AiChatSession', 'AiChatMessage', 'Z7iAccount', 'Package', 'Test', 'TestAttempt', 'QuestionResponse', 'BookmarkGroup', 'QuestionBookmark', 'QuestionNote', 'QuestionComment', 'BonusQuestion', 'AnswerKeyChange', 'TestRevision', 'RevisionResponse', 'ScoreAdjustment', 'ForumPost', 'ForumReply', 'ForumPostLike', 'ForumReplyLike', 'PastYearPaper', 'PYPQuestion', 'PYPAttempt', 'PYPBookmark', 'PYPNote', 'CustomTest', 'CustomTestQuestion', 'CustomTestAttempt', 'CustomTestResponse']
    });

  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({ 
      error: 'Migration failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}
