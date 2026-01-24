import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
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

const LOCAL_DATA_DIR = process.env.GETMARKS_DATA_DIR ?? 'getmarks_data';
const gunzipAsync = promisify(gunzip);

let localIndexCache: { data: LocalIndex; loadedAt: number; sourcePath: string } | null = null;

type LocalIndex = {
  chapters: Array<{
    exam: string;
    exam_id: string;
    subject: string;
    subject_id: string;
    chapter: string;
    chapter_id: string;
    total_questions: number;
    file: string;
  }>;
};

async function loadLocalIndex(): Promise<LocalIndex | null> {
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
  const parsed = JSON.parse(raw.toString('utf-8')) as LocalIndex;
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
  const localIndex = await loadLocalIndex();
  if (localIndex) {
    const entry = localIndex.chapters.find(
      (chapter) => chapter.exam_id === examId && chapter.subject_id === subjectId && chapter.chapter_id === chapterId
    );
    if (!entry) {
      return res.status(404).json({ error: 'Chapter data not found in local index' });
    }
    const rows = await loadLocalQuestions(entry.file);
    const questions = rows.map((row: any, index: number) => ({
      id: row?.id ?? `${index + 1}`,
      questionNumber: row?.index ?? index + 1,
      subject: row?.subject ?? entry.subject,
      type: row?.question_type ?? row?.type ?? '',
      questionHtml: buildQuestionHtml(row?.question?.text, row?.question?.image),
      options: Array.isArray(row?.options)
        ? row.options.map((opt: any) => buildOptionHtml(opt?.text, opt?.image))
        : [],
      correctAnswer: Array.isArray(row?.correct_answer)
        ? row.correct_answer.join(', ')
        : row?.correct_answer ?? '',
      solutionHtml: buildQuestionHtml(row?.solution?.text, row?.solution?.image),
    }));

    return res.status(200).json({ success: true, data: { items: questions } });
  }

  const data = await fetchGetMarks(GETMARKS_API.questions(examId, subjectId, chapterId), {
    limit: 10000,
    hideOutOfSyllabus: 'false'
  });
  return res.status(200).json({ success: true, data });
}

async function spawnExportProcess(command: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['scripts/getmarks_pyqs.py'], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    const handleError = (error: Error) => {
      reject({ error, command });
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
  const commandCandidates = [
    process.env.PYTHON,
    process.env.PYTHON_EXECUTABLE,
    'python3',
    'python',
  ].filter((command): command is string => Boolean(command));

  let lastError: Error | null = null;
  for (const command of commandCandidates) {
    try {
      await spawnExportProcess(command);
      return res.status(202).json({ success: true, message: 'GetMarks export started' });
    } catch (error) {
      const details = error as { error?: Error };
      lastError = details.error ?? (error instanceof Error ? error : null);
      if (lastError?.message && !lastError.message.includes('ENOENT')) {
        break;
      }
    }
  }

  const message = lastError?.message ?? 'No available Python executable found';
  return res.status(500).json({ error: 'Failed to start export', details: message });
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
