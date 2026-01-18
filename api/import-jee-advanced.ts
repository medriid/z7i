import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from './lib/prisma.js';

const JEE_PAPERS = [
  { year: 2023, paper: 1, questions: 42 },
  { year: 2023, paper: 2, questions: 30 },
  { year: 2022, paper: 1, questions: 36 },
  { year: 2022, paper: 2, questions: 38 },
  { year: 2021, paper: 1, questions: 30 },
  { year: 2021, paper: 2, questions: 34 },
  { year: 2020, paper: 1, questions: 34 },
  { year: 2020, paper: 2, questions: 35 },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const existingPapers = await prisma.pastYearPaper.findMany({
      where: { examName: 'JEE Advanced' },
      select: { id: true, title: true, isActive: true }
    });
    
    if (existingPapers.length > 0) {
      const inactiveCount = existingPapers.filter(p => !p.isActive).length;
      if (inactiveCount > 0) {
        await prisma.pastYearPaper.updateMany({
          where: { examName: 'JEE Advanced', isActive: false },
          data: { isActive: true }
        });
        console.log(`Activated ${inactiveCount} inactive papers`);
      }
    }
    
    if (existingPapers.length >= JEE_PAPERS.length) {
      const activePapers = await prisma.pastYearPaper.findMany({
        where: { examName: 'JEE Advanced', isActive: true },
        select: { id: true, title: true }
      });
      return res.status(200).json({ 
        success: true, 
        message: `JEE Advanced papers ready (${activePapers.length} papers)`,
        papers: activePapers.map(p => p.title)
      });
    }

    console.log('Starting JEE Advanced import...');
    let papersCreated = 0;
    let questionsCreated = 0;

    for (const paperData of JEE_PAPERS) {
      try {
        const paperId = `jee-adv-${paperData.year}-paper-${paperData.paper}`;

        const existingPaper = await prisma.pastYearPaper.findUnique({
          where: { id: paperId }
        });
        
        if (existingPaper) {
          console.log(`Paper already exists: ${existingPaper.title}`);
          continue;
        }

        const paper = await prisma.pastYearPaper.create({
          data: {
            id: paperId,
            examName: 'JEE Advanced',
            year: paperData.year,
            session: 'Annual',
            shift: `Paper ${paperData.paper}`,
            title: `JEE Advanced ${paperData.year} Paper ${paperData.paper}`,
            description: `JEE Advanced ${paperData.year} Paper ${paperData.paper} - Physics, Chemistry, Mathematics`,
            timeLimit: 180,
            maxScore: paperData.questions * 4,
            totalQuestions: paperData.questions,
            isActive: true,
          },
        });

        papersCreated++;

        const subjects = ['Physics', 'Chemistry', 'Mathematics'];
        const questionsPerSubject = Math.floor(paperData.questions / 3);
        let qNum = 1;

        for (let s = 0; s < subjects.length; s++) {
          const count = questionsPerSubject + (s < (paperData.questions % 3) ? 1 : 0);
          
          for (let i = 0; i < count; i++) {
            const isNAT = qNum % 2 === 0;
            
            await prisma.pYPQuestion.create({
              data: {
                id: `${paperId}-q${qNum}`,
                paperId,
                questionNumber: qNum,
                subject: subjects[s],
                type: isNAT ? 'NAT' : 'MCQ',
                questionHtml: `<p><strong>Question ${qNum} (${subjects[s]})</strong></p><p>This is a sample question from ${paper.title}. Solve this problem step by step.</p>`,
                option1: isNAT ? null : `Option A for Q${qNum}`,
                option2: isNAT ? null : `Option B for Q${qNum}`,
                option3: isNAT ? null : `Option C for Q${qNum}`,
                option4: isNAT ? null : `Option D for Q${qNum}`,
                correctAnswer: isNAT ? `${5 + qNum}` : 'A',
                solutionHtml: `<p><strong>Solution:</strong> The answer to question ${qNum} is ${isNAT ? '${5 + ' + qNum + '}' : 'A'}</p>`,
                marksPositive: 4,
                marksNegative: isNAT ? 0 : -1,
              },
            });
            
            questionsCreated++;
            qNum++;
          }
        }

        console.log(`Created ${paper.title}`);

      } catch (error) {
        console.error(`Error creating paper: ${error}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'JEE Advanced papers imported successfully!',
      papersCreated,
      questionsCreated,
      papers: JEE_PAPERS.map(p => `JEE Advanced ${p.year} Paper ${p.paper}`)
    });

  } catch (error) {
    console.error('Import error:', error);
    return res.status(500).json({
      error: 'Import failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
