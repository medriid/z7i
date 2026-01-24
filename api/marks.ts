import { spawn } from 'node:child_process';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const GETMARKS_AUTH_TOKEN =
  process.env.GETMARKS_AUTH_TOKEN ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2OTkxNzVmNjcwMTY3ODUwOTBiZGI0ZiIsImlhdCI6MTc2MDE4ODAyOCwiZXhwIjoxNzYyNzgwMDI4fQ.v7tZWhoru3bC6c4H8RjtaGdkHm4luZQWvQ1kivF1Jl0';

const GETMARKS_API = {
  dashboard: 'https://web.getmarks.app/api/v3/dashboard/platform/web',
  examSubjects: (examId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}`,
  subjectChapters: (examId: string, subjectId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}`,
  questions: (examId: string, subjectId: string, chapterId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}/chapter/${encodeURIComponent(chapterId)}/questions`,
};

function buildUrlWithParams(url: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined) return;
    target.searchParams.set(key, String(value));
  });
  return target.toString();
}

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getRequiredQuery(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  if (typeof value === 'string') return value;
  return null;
}

async function fetchGetMarks(url: string, params?: Record<string, string | number | boolean | undefined>) {
  const target = buildUrlWithParams(url, params || {});
  const res = await fetch(target, {
    headers: {
      Authorization: `Bearer ${GETMARKS_AUTH_TOKEN}`,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GetMarks request failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function handleExams(req: VercelRequest, res: VercelResponse) {
  const data = await fetchGetMarks(GETMARKS_API.dashboard, { limit: 10000 });
  return res.status(200).json({ success: true, data });
}

async function handleSubjects(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  if (!examId) {
    return res.status(400).json({ error: 'examId is required' });
  }
  const data = await fetchGetMarks(GETMARKS_API.examSubjects(examId), { limit: 10000 });
  return res.status(200).json({ success: true, data });
}

async function handleChapters(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  const subjectId = getRequiredQuery(req, 'subjectId');
  if (!examId || !subjectId) {
    return res.status(400).json({ error: 'examId and subjectId are required' });
  }
  const data = await fetchGetMarks(GETMARKS_API.subjectChapters(examId, subjectId), { limit: 10000 });
  return res.status(200).json({ success: true, data });
}

async function handleQuestions(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  const subjectId = getRequiredQuery(req, 'subjectId');
  const chapterId = getRequiredQuery(req, 'chapterId');
  if (!examId || !subjectId || !chapterId) {
    return res.status(400).json({ error: 'examId, subjectId, and chapterId are required' });
  }
  const data = await fetchGetMarks(GETMARKS_API.questions(examId, subjectId, chapterId), {
    limit: 10000,
    hideOutOfSyllabus: 'false'
  });
  return res.status(200).json({ success: true, data });
}

async function handleExport(res: VercelResponse) {
  if (!process.env.GETMARKS_AUTH_TOKEN) {
    return res.status(400).json({ error: 'GETMARKS_AUTH_TOKEN is required' });
  }

  try {
    const child = spawn('python', ['scripts/getmarks_pyqs.py'], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return res.status(202).json({ success: true, message: 'GetMarks export started' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to start export', details: message });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = typeof req.query.action === 'string' ? req.query.action : '';

  try {
    switch (action) {
      case 'exams':
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleExams(req, res);
      case 'subjects':
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleSubjects(req, res);
      case 'chapters':
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleChapters(req, res);
      case 'questions':
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleQuestions(req, res);
      case 'export':
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return await handleExport(res);
      default:
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GetMarks proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: message });
  }
}
