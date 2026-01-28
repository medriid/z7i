import type { VercelRequest, VercelResponse } from '@vercel/node';

const CATALOG_URL = 'https://raw.githubusercontent.com/medriid/pyq/main/catalog.json';
const RAW_BASE = 'https://raw.githubusercontent.com/medriid/pyq/main/';
const CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogChapter = {
  name: string;
  display?: string | null;
  path: string;
  chapter_index: string;
};

type CatalogSubject = {
  name: string;
  display?: string | null;
  chapters: CatalogChapter[];
};

type CatalogExam = {
  name: string;
  display?: string | null;
  subjects: CatalogSubject[];
};

type Catalog = {
  root: string;
  exams: CatalogExam[];
};

type ChapterIndex = {
  questions_exported?: number;
  questions_reported_by_api?: number;
  question_paths: string[];
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const catalogCache: { entry?: CacheEntry<Catalog> } = {};
const chapterIndexCache = new Map<string, CacheEntry<ChapterIndex>>();
const chapterQuestionsCache = new Map<string, CacheEntry<any[]>>();

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getRequiredQuery(req: VercelRequest, key: string): string | null {
  const value = req.query[key];
  return typeof value === 'string' ? value : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

function slugToTitle(value: string) {
  return value
    .split('__')[0]
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayName(name: string, display?: string | null) {
  if (display && display.trim()) return display.trim();
  return slugToTitle(name);
}

function normalizeAssetHtml(html: string | undefined, assetBase: string) {
  if (!html) return '';
  return html.replace(/src=(["'])assets[\\/]/g, `src=$1${assetBase}assets/`);
}

function buildAssetUrl(assetBase: string, assetPath: string | undefined) {
  if (!assetPath) return '';
  const normalized = assetPath.replace(/\\/g, '/');
  if (normalized.startsWith('http')) return normalized;
  return `${assetBase}${normalized}`;
}

function buildQuestionHtml(text: string | undefined, image: string | undefined, assetBase: string) {
  const safeText = normalizeAssetHtml(text, assetBase);
  const imageUrl = buildAssetUrl(assetBase, image);
  const imageHtml = imageUrl ? `<div class="pyp-question-media"><img src="${imageUrl}" alt="Question visual" /></div>` : '';
  return `${safeText}${imageHtml}`;
}

function buildOptionHtml(text: string | undefined, image: string | undefined, assetBase: string) {
  const safeText = normalizeAssetHtml(text, assetBase);
  const imageUrl = buildAssetUrl(assetBase, image);
  const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="Option visual" />` : '';
  return `${safeText}${imageHtml}`;
}

async function getCatalog(): Promise<Catalog> {
  if (catalogCache.entry && catalogCache.entry.expiresAt > Date.now()) {
    return catalogCache.entry.value;
  }
  const catalog = await fetchJson<Catalog>(CATALOG_URL);
  catalogCache.entry = { value: catalog, expiresAt: Date.now() + CACHE_TTL_MS };
  return catalog;
}

async function getChapterIndex(catalog: Catalog, chapter: CatalogChapter): Promise<ChapterIndex> {
  const cacheKey = chapter.chapter_index;
  const cached = chapterIndexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = `${RAW_BASE}${catalog.root}/${chapter.chapter_index}`;
  const data = await fetchJson<ChapterIndex>(url);
  chapterIndexCache.set(cacheKey, { value: data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

function normalizeExam(exam: CatalogExam) {
  return { id: exam.name, name: displayName(exam.name, exam.display) };
}

function normalizeSubject(subject: CatalogSubject) {
  return { id: subject.name, name: displayName(subject.name, subject.display) };
}

function normalizeChapter(chapter: CatalogChapter, questionCount?: number) {
  return {
    id: chapter.name,
    name: displayName(chapter.name, chapter.display),
    questionCount,
  };
}

async function handleExams(res: VercelResponse) {
  const catalog = await getCatalog();
  const exams = catalog.exams.map(normalizeExam);
  return res.status(200).json({ success: true, data: { items: exams } });
}

async function handleSubjects(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  if (!examId) return res.status(400).json({ error: 'examId is required' });
  const catalog = await getCatalog();
  const exam = catalog.exams.find((entry) => entry.name === examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subjects = exam.subjects.map(normalizeSubject);
  return res.status(200).json({ success: true, data: { items: subjects } });
}

async function handleChapters(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  const subjectId = getRequiredQuery(req, 'subjectId');
  if (!examId || !subjectId) {
    return res.status(400).json({ error: 'examId and subjectId are required' });
  }
  const catalog = await getCatalog();
  const exam = catalog.exams.find((entry) => entry.name === examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subject = exam.subjects.find((entry) => entry.name === subjectId);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const chaptersWithCounts = await Promise.all(
    subject.chapters.map(async (chapter) => {
      try {
        const index = await getChapterIndex(catalog, chapter);
        const count = index.questions_exported ?? index.questions_reported_by_api;
        return normalizeChapter(chapter, typeof count === 'number' ? count : undefined);
      } catch {
        return normalizeChapter(chapter);
      }
    })
  );

  return res.status(200).json({ success: true, data: { items: chaptersWithCounts } });
}

async function handleQuestions(req: VercelRequest, res: VercelResponse) {
  const examId = getRequiredQuery(req, 'examId');
  const subjectId = getRequiredQuery(req, 'subjectId');
  const chapterId = getRequiredQuery(req, 'chapterId');
  if (!examId || !subjectId || !chapterId) {
    return res.status(400).json({ error: 'examId, subjectId, and chapterId are required' });
  }
  const catalog = await getCatalog();
  const exam = catalog.exams.find((entry) => entry.name === examId);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const subject = exam.subjects.find((entry) => entry.name === subjectId);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });
  const chapter = subject.chapters.find((entry) => entry.name === chapterId);
  if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

  const cacheKey = `${examId}:${subjectId}:${chapterId}`;
  const cached = chapterQuestionsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.status(200).json({ success: true, data: { items: cached.value } });
  }

  const index = await getChapterIndex(catalog, chapter);
  const basePath = `${RAW_BASE}${catalog.root}/${chapter.path}/`;
  const questionPayloads = await Promise.all(
    index.question_paths.map(async (questionPath) => {
      const payloadUrl = `${basePath}${questionPath}/payload.json`;
      const payload = await fetchJson<any>(payloadUrl);
      const assetBase = `${basePath}${questionPath}/`;
      return {
        id: payload?.id ?? `${chapterId}-${payload?.index ?? questionPath}`,
        questionNumber: typeof payload?.index === 'number' ? payload.index + 1 : 0,
        subject: payload?.tags?.subject_name ?? payload?.subject ?? displayName(subject.name, subject.display),
        type: payload?.type ?? payload?.question_type ?? '',
        questionHtml: buildQuestionHtml(payload?.question?.text, payload?.question?.image, assetBase),
        options: Array.isArray(payload?.options)
          ? payload.options.map((opt: any) => buildOptionHtml(opt?.text, opt?.image, assetBase))
          : [],
        answer: Array.isArray(payload?.correct_answer)
          ? payload.correct_answer.join(', ')
          : payload?.correct_answer ?? '',
        solutionHtml: buildQuestionHtml(payload?.solution?.text, payload?.solution?.image, assetBase),
        pyqInfo: payload?.pyq_info ?? '',
      };
    })
  );

  const sorted = questionPayloads.sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));
  chapterQuestionsCache.set(cacheKey, { value: sorted, expiresAt: Date.now() + CACHE_TTL_MS });
  return res.status(200).json({ success: true, data: { items: sorted } });
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
        return await handleExams(res);
      case 'subjects':
        return await handleSubjects(req, res);
      case 'chapters':
        return await handleChapters(req, res);
      case 'questions':
        return await handleQuestions(req, res);
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PYQ proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: message });
  }
}
