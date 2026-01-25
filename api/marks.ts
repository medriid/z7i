import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';

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

const LOCAL_DATA_DIR = process.env.GETMARKS_DATA_DIR ?? 'getmarks_data';
const gunzipAsync = promisify(gunzip);

const { Pool } = pg;

type IndexEntry = {
  exam: string;
  exam_id: string;
  subject: string;
  subject_id: string;
  chapter: string;
  chapter_id: string;
  total_questions: number;
  file?: string;
};

type Index = {
  chapters: Array<{
    exam: string;
    exam_id: string;
    subject: string;
    subject_id: string;
    chapter: string;
    chapter_id: string;
    total_questions: number;
    file?: string;
  }>;
};

let localIndexCache: { data: Index; loadedAt: number; sourcePath: string } | null = null;
let dbIndexCache: { data: Index; loadedAt: number } | null = null;
let dbPool: pg.Pool | null = null;

const resolveDatabaseUrl = () =>
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.NEON_DATABASE_URL ??
  '';

function getDbPool() {
  if (dbPool) return dbPool;
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) return null;
  dbPool = new Pool({ connectionString: databaseUrl });
  return dbPool;
}

async function loadDatabaseIndex(): Promise<Index | null> {
  if (dbIndexCache && Date.now() - dbIndexCache.loadedAt < 5 * 60_000) {
    return dbIndexCache.data;
  }

  const pool = getDbPool();
  if (!pool) return null;

  try {
    const result = await pool.query(
      `select exam_id, subject_id, chapter_id, exam_name, subject_name, chapter_name, question_count
       from pyq_chapters`
    );
    if (result.rows.length === 0) return null;
    const chapters: IndexEntry[] = result.rows.map((row) => ({
      exam: row.exam_name,
      exam_id: row.exam_id,
      subject: row.subject_name,
      subject_id: row.subject_id,
      chapter: row.chapter_name,
      chapter_id: row.chapter_id,
      total_questions: Number(row.question_count) || 0,
    }));
    const data = { chapters };
    dbIndexCache = { data, loadedAt: Date.now() };
    return data;
  } catch (error) {
    return null;
  }
}

async function loadDatabaseQuestions(examId: string, subjectId: string, chapterId: string) {
  const pool = getDbPool();
  if (!pool) return null;
  try {
    const result = await pool.query(
      `select question_index, payload
       from pyq_questions
       where exam_id = $1 and subject_id = $2 and chapter_id = $3
       order by question_index asc`,
      [examId, subjectId, chapterId]
    );
    if (result.rows.length === 0) return null;
    return result.rows;
  } catch (error) {
    return null;
  }
}

async function loadLocalIndex(): Promise<Index | null> {
  if (localIndexCache && Date.now() - localIndexCache.loadedAt < 5 * 60_000) {
    return localIndexCache.data;
  }

  const baseDir = path.resolve(process.cwd(), LOCAL_DATA_DIR);
  const jsonPath = path.join(baseDir, 'master_index.json');
  const gzPath = `${jsonPath}.gz`;

  let contents: Buffer | null = null;
  let sourcePath = '';

  try {
    contents = await fs.readFile(jsonPath);
    sourcePath = jsonPath;
  } catch {
    try {
      contents = await fs.readFile(gzPath);
      sourcePath = gzPath;
    } catch {
      return null;
    }
  }

  if (!contents) return null;

  const raw = sourcePath.endsWith('.gz') ? await gunzipAsync(contents) : contents;
  const parsed = JSON.parse(raw.toString('utf-8')) as Index;
  if (!parsed || !Array.isArray(parsed.chapters)) return null;

  localIndexCache = { data: parsed, loadedAt: Date.now(), sourcePath };
  return parsed;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function buildAssetUrl(assetPath?: string) {
  if (!assetPath) return '';
  if (assetPath.startsWith('http')) return assetPath;
  return `/${LOCAL_DATA_DIR.replace(/^\//, '')}/${assetPath}`;
}

function buildQuestionHtml(text?: string, image?: string) {
  const safeText = text?.trim() ?? '';
  const imageUrl = buildAssetUrl(image);
  const imageHtml = imageUrl ? `<div class="pyp-question-media"><img src="${imageUrl}" alt="Question visual" /></div>` : '';
  return `${safeText}${imageHtml}`;
}

function buildOptionHtml(text?: string, image?: string) {
  const safeText = text?.trim() ?? '';
  const imageUrl = buildAssetUrl(image);
  const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="Option visual" />` : '';
  return `${safeText}${imageHtml}`;
}

async function loadLocalQuestions(fileName: string) {
  const baseDir = path.resolve(process.cwd(), LOCAL_DATA_DIR);
  const jsonDir = path.join(baseDir, 'json');
  const filePath = path.join(jsonDir, fileName);
  let contents: Buffer;

  try {
    contents = await fs.readFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Local data file missing: ${fileName}. ${message}`);
  }

  const raw = fileName.endsWith('.gz') ? await gunzipAsync(contents) : contents;
  const lines = raw.toString('utf-8').split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function buildQuestionItem(row: any, index: number, fallbackSubject: string) {
  const payloadRaw = row?.payload ?? row;
  const payload = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw;
  const questionIndex = typeof payload?.index === 'number' ? payload.index : row?.question_index ?? index;
  return {
    id: payload?.id ?? `${index + 1}`,
    questionNumber: questionIndex,
    subject: payload?.subject ?? fallbackSubject,
    type: payload?.question_type ?? payload?.type ?? '',
    questionHtml: buildQuestionHtml(payload?.question?.text, payload?.question?.image),
    options: Array.isArray(payload?.options)
      ? payload.options.map((opt: any) => buildOptionHtml(opt?.text, opt?.image))
      : [],
    correctAnswer: Array.isArray(payload?.correct_answer)
      ? payload.correct_answer.join(', ')
      : payload?.correct_answer ?? '',
    solutionHtml: buildQuestionHtml(payload?.solution?.text, payload?.solution?.image),
  };
}

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
  const dbIndex = await loadDatabaseIndex();
  if (dbIndex) {
    const exams = uniqueBy(
      dbIndex.chapters.map((chapter) => ({
        id: chapter.exam_id,
        name: chapter.exam,
      })),
      (item) => item.id
    );
    return res.status(200).json({ success: true, data: { items: exams } });
  }

  const localIndex = await loadLocalIndex();
  if (localIndex) {
    const exams = uniqueBy(
      localIndex.chapters.map((chapter) => ({
        id: chapter.exam_id,
        name: chapter.exam,
      })),
      (item) => item.id
    );
    return res.status(200).json({ success: true, data: { items: exams } });
  }

  const data = await fetchGetMarks(GETMARKS_API.dashboard, { limit: 10000 });
  return res.status(200).json({ success: true, data });
}

async function handleSubjects(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  if (!examId) {
    return res.status(400).json({ error: 'examId is required' });
  }
  const dbIndex = await loadDatabaseIndex();
  if (dbIndex) {
    const subjects = uniqueBy(
      dbIndex.chapters
        .filter((chapter) => chapter.exam_id === examId)
        .map((chapter) => ({
          id: chapter.subject_id,
          name: chapter.subject,
        })),
      (item) => item.id
    );
    return res.status(200).json({ success: true, data: { items: subjects } });
  }

  const localIndex = await loadLocalIndex();
  if (localIndex) {
    const subjects = uniqueBy(
      localIndex.chapters
        .filter((chapter) => chapter.exam_id === examId)
        .map((chapter) => ({
          id: chapter.subject_id,
          name: chapter.subject,
        })),
      (item) => item.id
    );
    return res.status(200).json({ success: true, data: { items: subjects } });
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
  const dbIndex = await loadDatabaseIndex();
  if (dbIndex) {
    const chapters = dbIndex.chapters
      .filter((chapter) => chapter.exam_id === examId && chapter.subject_id === subjectId)
      .map((chapter) => ({
        id: chapter.chapter_id,
        name: chapter.chapter,
        questionCount: chapter.total_questions,
      }));
    return res.status(200).json({ success: true, data: { items: chapters } });
  }

  const localIndex = await loadLocalIndex();
  if (localIndex) {
    const chapters = localIndex.chapters
      .filter((chapter) => chapter.exam_id === examId && chapter.subject_id === subjectId)
      .map((chapter) => ({
        id: chapter.chapter_id,
        name: chapter.chapter,
        questionCount: chapter.total_questions,
      }));
    return res.status(200).json({ success: true, data: { items: chapters } });
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
  const dbIndex = await loadDatabaseIndex();
  if (dbIndex) {
    const entry = dbIndex.chapters.find(
      (chapter) => chapter.exam_id === examId && chapter.subject_id === subjectId && chapter.chapter_id === chapterId
    );
    if (entry) {
      const rows = await loadDatabaseQuestions(examId, subjectId, chapterId);
      if (rows) {
        const questions = rows.map((row: any, index: number) => buildQuestionItem(row, index, entry.subject));
        return res.status(200).json({ success: true, data: { items: questions } });
      }
    }
  }

  const localIndex = await loadLocalIndex();
  if (localIndex) {
    const entry = localIndex.chapters.find(
      (chapter) => chapter.exam_id === examId && chapter.subject_id === subjectId && chapter.chapter_id === chapterId
    );
    if (!entry || !entry.file) {
      return res.status(404).json({ error: 'Chapter data not found in local index' });
    }
    const rows = await loadLocalQuestions(entry.file);
    const questions = rows.map((row: any, index: number) => buildQuestionItem(row, index, entry.subject));

    return res.status(200).json({ success: true, data: { items: questions } });
  }

  const data = await fetchGetMarks(GETMARKS_API.questions(examId, subjectId, chapterId), {
    limit: 10000,
    hideOutOfSyllabus: 'false'
  });
  return res.status(200).json({ success: true, data });
}

async function spawnExportProcess() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--loader', 'ts-node/esm', 'scripts/getmarks_pyqs.ts'], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    const handleError = (error: Error) => {
      reject({ error });
    };
    child.once('error', handleError);
    child.once('spawn', () => {
      child.off('error', handleError);
      child.unref();
      resolve();
    });
  });
}

async function handleExport(res: VercelResponse) {
  try {
    const databaseUrl = resolveDatabaseUrl();
    if (!databaseUrl) {
      return res.status(500).json({ error: 'DATABASE_URL is required to export PYQs to Neon' });
    }
    await spawnExportProcess();
    return res.status(202).json({ success: true, message: 'GetMarks export started' });
  } catch (error) {
    const details = error as { error?: Error };
    const message = details.error?.message ?? (error instanceof Error ? error.message : 'Unknown error');
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
