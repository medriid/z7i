import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';
import { verifyToken } from './lib/auth.js';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getAuth(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.substring(7));
}

async function handleListPapers(req: VercelRequest, res: VercelResponse) {
  try {
    const { examName, year, session } = req.query;
    
    const where: any = { isActive: true };
    if (examName) where.examName = String(examName);
    if (year) where.year = parseInt(String(year));
    if (session) where.session = String(session);
    
    console.log('Listing papers with where:', JSON.stringify(where));
    
    const papers = await prisma.pastYearPaper.findMany({
      where,
      orderBy: [
        { year: 'desc' },
        { session: 'asc' },
        { shift: 'asc' }
      ],
      select: {
        id: true,
        examName: true,
        year: true,
        session: true,
        shift: true,
        date: true,
        title: true,
        description: true,
        timeLimit: true,
        maxScore: true,
        totalQuestions: true,
        structure: true,
        _count: {
          select: { questions: true, attempts: true }
        }
      }
    });
    
    console.log('Found papers:', papers.length);
    return res.status(200).json({ success: true, papers });
  } catch (error) {
    console.error('List papers error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' });
  }
}

async function handleGetPaper(req: VercelRequest, res: VercelResponse) {
  try {
    const { paperId } = req.query;
    
    if (!paperId) {
      return res.status(400).json({ error: 'Paper ID is required' });
    }
    
    const paper = await prisma.pastYearPaper.findUnique({
      where: { id: paperId as string },
      include: {
        questions: {
          orderBy: { questionNumber: 'asc' }
        }
      }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    return res.status(200).json({ success: true, paper });
  } catch (error) {
    console.error('Get paper error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleCreatePaper(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const {
      examName,
      year,
      session,
      shift,
      date,
      title,
      description,
      timeLimit,
      maxScore,
      totalQuestions,
      structure,
      source,
      sourceUrl
    } = req.body;
    
    if (!examName || !year || !title || !timeLimit || !maxScore || !totalQuestions) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const paper = await prisma.pastYearPaper.create({
      data: {
        examName,
        year,
        session,
        shift,
        date: date ? new Date(date) : null,
        title,
        description,
        timeLimit,
        maxScore,
        totalQuestions,
        structure,
        source,
        sourceUrl
      }
    });
    
    return res.status(201).json({ success: true, paper });
  } catch (error) {
    console.error('Create paper error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleAddQuestions(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { paperId, questions } = req.body;
    
    if (!paperId || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Paper ID and questions array required' });
    }
    
    const paper = await prisma.pastYearPaper.findUnique({
      where: { id: paperId }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const created = await prisma.pYPQuestion.createMany({
      data: questions.map((q: any) => ({
        paperId,
        questionNumber: q.questionNumber,
        subject: q.subject,
        type: q.type,
        questionHtml: q.questionHtml,
        option1: q.option1,
        option2: q.option2,
        option3: q.option3,
        option4: q.option4,
        correctAnswer: q.correctAnswer,
        solutionHtml: q.solutionHtml,
        marksPositive: q.marksPositive || 4,
        marksNegative: q.marksNegative || 1,
        difficulty: q.difficulty,
        avgTimeTaken: q.avgTimeTaken,
        percentCorrect: q.percentCorrect,
        topics: q.topics || []
      })),
      skipDuplicates: true
    });
    
    return res.status(201).json({ success: true, count: created.count });
  } catch (error) {
    console.error('Add questions error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleStartAttempt(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { paperId } = req.body;
    
    if (!paperId) {
      return res.status(400).json({ error: 'Paper ID is required' });
    }
    
    const paper = await prisma.pastYearPaper.findUnique({
      where: { id: paperId },
      include: { questions: true }
    });
    
    if (!paper) {
      return res.status(404).json({ error: 'Paper not found' });
    }
    
    const attempt = await prisma.pYPAttempt.create({
      data: {
        userId: payload.userId,
        paperId,
        answers: {}
      }
    });
    
    return res.status(201).json({
      success: true,
      attempt: {
        id: attempt.id,
        startedAt: attempt.startedAt
      },
      paper: {
        id: paper.id,
        title: paper.title,
        timeLimit: paper.timeLimit,
        maxScore: paper.maxScore,
        totalQuestions: paper.totalQuestions,
        questions: paper.questions
      }
    });
  } catch (error) {
    console.error('Start attempt error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleSubmitAttempt(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { attemptId, answers, timeTaken } = req.body;
    
    if (!attemptId || !answers) {
      return res.status(400).json({ error: 'Attempt ID and answers required' });
    }
    
    const attempt = await prisma.pYPAttempt.findUnique({
      where: { id: attemptId },
      include: {
        paper: {
          include: { questions: true }
        }
      }
    });
    
    if (!attempt || attempt.userId !== payload.userId) {
      return res.status(404).json({ error: 'Attempt not found' });
    }
    
    if (attempt.isCompleted) {
      return res.status(400).json({ error: 'Attempt already submitted' });
    }
    
    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;
    let totalScore = 0;
    let physicsScore = 0;
    let chemistryScore = 0;
    let mathsScore = 0;
    const topicStatsMap = new Map<string, { topic: string; total: number; correct: number; incorrect: number; unattempted: number; score: number }>();

    const normalizeAnswer = (value: unknown) => {
      if (value === null || value === undefined) return '';
      return String(value).trim().toLowerCase();
    };

    const getAnswerValue = (questionId: string, questionNumber: number) => {
      const answerEntry = answers?.[questionId] ?? answers?.[questionNumber] ?? answers?.[String(questionNumber)];
      if (typeof answerEntry === 'object' && answerEntry !== null && 'answer' in answerEntry) {
        return (answerEntry as { answer?: unknown }).answer;
      }
      return answerEntry;
    };

    const updateTopicStats = (topics: string[], result: { isCorrect: boolean; isAttempted: boolean; scoreDelta: number }) => {
      const topicList = topics.length > 0 ? topics : ['Uncategorized'];
      topicList.forEach((topic) => {
        const existing = topicStatsMap.get(topic) ?? {
          topic,
          total: 0,
          correct: 0,
          incorrect: 0,
          unattempted: 0,
          score: 0
        };

        existing.total += 1;
        if (!result.isAttempted) {
          existing.unattempted += 1;
        } else if (result.isCorrect) {
          existing.correct += 1;
        } else {
          existing.incorrect += 1;
        }
        existing.score += result.scoreDelta;
        topicStatsMap.set(topic, existing);
      });
    };
    
    for (const question of attempt.paper.questions) {
      const answerValue = getAnswerValue(question.id, question.questionNumber);
      const normalizedAnswer = normalizeAnswer(answerValue);
      const isAttempted = normalizedAnswer.length > 0;
      const isCorrect = isAttempted && normalizedAnswer === normalizeAnswer(question.correctAnswer);
      const scoreDelta = isAttempted ? (isCorrect ? question.marksPositive : -question.marksNegative) : 0;

      if (!isAttempted) {
        unattempted++;
      } else if (isCorrect) {
        correct++;
        totalScore += question.marksPositive;
        
        if (question.subject.toLowerCase().includes('physics')) physicsScore += question.marksPositive;
        else if (question.subject.toLowerCase().includes('chemistry')) chemistryScore += question.marksPositive;
        else if (question.subject.toLowerCase().includes('math')) mathsScore += question.marksPositive;
      } else {
        incorrect++;
        totalScore -= question.marksNegative;
        
        if (question.subject.toLowerCase().includes('physics')) physicsScore -= question.marksNegative;
        else if (question.subject.toLowerCase().includes('chemistry')) chemistryScore -= question.marksNegative;
        else if (question.subject.toLowerCase().includes('math')) mathsScore -= question.marksNegative;
      }

      updateTopicStats(question.topics || [], { isCorrect, isAttempted, scoreDelta });
    }

    const topicStats = Array.from(topicStatsMap.values()).map((stat) => {
      const attempted = stat.correct + stat.incorrect;
      return {
        ...stat,
        accuracy: attempted > 0 ? Math.round((stat.correct / attempted) * 100) : 0
      };
    }).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);

    const weakTopics = topicStats.filter((stat) => stat.total > 0)
      .filter((stat) => stat.accuracy < 60 || stat.incorrect >= stat.correct || stat.unattempted > 0)
      .slice(0, 3);

    const revisionRecommendations = (weakTopics.length > 0 ? weakTopics : topicStats.slice(0, 3)).map((stat, index) => ({
      topic: stat.topic,
      accuracy: stat.accuracy,
      total: stat.total,
      priority: index === 0 ? 'High' : index === 1 ? 'Medium' : 'Low',
      recommendation: `Revise ${stat.topic} fundamentals and attempt ${stat.total} focused questions.`
    }));
    
    const updatedAttempt = await prisma.pYPAttempt.update({
      where: { id: attemptId },
      data: {
        answers,
        timeTaken,
        submittedAt: new Date(),
        isCompleted: true,
        correct,
        incorrect,
        unattempted,
        totalScore,
        physicsScore,
        chemistryScore,
        mathsScore,
        topicStats,
        revisionRecommendations
      }
    });
    
    return res.status(200).json({
      success: true,
      results: {
        correct,
        incorrect,
        unattempted,
        totalScore,
        physicsScore,
        chemistryScore,
        mathsScore,
        topicStats,
        revisionRecommendations,
        timeTaken,
        maxScore: attempt.paper.maxScore
      }
    });
  } catch (error) {
    console.error('Submit attempt error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetAttempts(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { paperId } = req.query;
    
    const where: any = { userId: payload.userId };
    if (paperId) where.paperId = paperId as string;
    
    const attempts = await prisma.pYPAttempt.findMany({
      where,
      include: {
        paper: {
          select: {
            id: true,
            title: true,
            examName: true,
            year: true,
            session: true,
            shift: true,
            maxScore: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return res.status(200).json({ success: true, attempts });
  } catch (error) {
    console.error('Get attempts error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleBookmark(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { questionId } = req.body;
    
    if (!questionId) {
      return res.status(400).json({ error: 'Question ID is required' });
    }
    
    const existing = await prisma.pYPBookmark.findUnique({
      where: {
        userId_questionId: {
          userId: payload.userId,
          questionId
        }
      }
    });
    
    if (existing) {
      await prisma.pYPBookmark.delete({
        where: { id: existing.id }
      });
      return res.status(200).json({ success: true, bookmarked: false });
    } else {
      await prisma.pYPBookmark.create({
        data: {
          userId: payload.userId,
          questionId
        }
      });
      return res.status(200).json({ success: true, bookmarked: true });
    }
  } catch (error) {
    console.error('Bookmark error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleNote(req: VercelRequest, res: VercelResponse) {
  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  
  try {
    const { questionId, content } = req.body;
    
    if (!questionId) {
      return res.status(400).json({ error: 'Question ID is required' });
    }
    
    if (!content || content.trim() === '') {
      await prisma.pYPNote.deleteMany({
        where: {
          userId: payload.userId,
          questionId
        }
      });
      return res.status(200).json({ success: true, note: null });
    }
    
    const note = await prisma.pYPNote.upsert({
      where: {
        userId_questionId: {
          userId: payload.userId,
          questionId
        }
      },
      create: {
        userId: payload.userId,
        questionId,
        content
      },
      update: {
        content
      }
    });
    
    return res.status(200).json({ success: true, note });
  } catch (error) {
    console.error('Note error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetMetadata(req: VercelRequest, res: VercelResponse) {
  try {
    const papers = await prisma.pastYearPaper.findMany({
      where: { isActive: true },
      select: {
        examName: true,
        year: true,
        session: true,
        shift: true
      },
      orderBy: [
        { examName: 'asc' },
        { year: 'desc' }
      ]
    });
    
    const metadata: Record<string, any> = {};
    
    for (const paper of papers) {
      if (!metadata[paper.examName]) {
        metadata[paper.examName] = {};
      }
      
      if (!metadata[paper.examName][paper.year]) {
        metadata[paper.examName][paper.year] = {};
      }
      
      const sessionKey = paper.session || 'main';
      if (!metadata[paper.examName][paper.year][sessionKey]) {
        metadata[paper.examName][paper.year][sessionKey] = [];
      }
      
      if (paper.shift !== null) {
        metadata[paper.examName][paper.year][sessionKey].push(paper.shift);
      }
    }
    
    return res.status(200).json({ success: true, metadata });
  } catch (error) {
    console.error('Get metadata error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const action = req.query.action as string;
  
  try {
    switch (action) {
      case 'list':
        return await handleListPapers(req, res);
      case 'get':
        return await handleGetPaper(req, res);
      case 'create':
        return await handleCreatePaper(req, res);
      case 'add-questions':
        return await handleAddQuestions(req, res);
      case 'start-attempt':
        return await handleStartAttempt(req, res);
      case 'submit-attempt':
        return await handleSubmitAttempt(req, res);
      case 'attempts':
        return await handleGetAttempts(req, res);
      case 'bookmark':
        return await handleBookmark(req, res);
      case 'note':
        return await handleNote(req, res);
      case 'metadata':
        return await handleGetMetadata(req, res);
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('PYP API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
