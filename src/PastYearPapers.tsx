import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Layers,
  Loader2,
  Search,
  Users,
  CheckCircle,
  XCircle,
  Bookmark,
  BookmarkCheck,
  Sparkles,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { renderLatexInHtml } from './utils/latex';
import { ImageLightbox, useImageLightbox } from './components/ImageLightbox';
import { AiDoubtPrompt } from './AiDoubtPrompt';

const PYQ_API = {
  exams: '/api/pyq?action=exams',
  subjects: (examId: string) => `/api/pyq?action=subjects&examId=${encodeURIComponent(examId)}`,
  chapters: (examId: string, subjectId: string) =>
    `/api/pyq?action=chapters&examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}`,
  questions: (examId: string, subjectId: string, chapterId: string) =>
    `/api/pyq?action=questions&examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}&chapterId=${encodeURIComponent(chapterId)}`,
  saveAttempt: '/api/pyq?action=save-attempt',
  attempts: '/api/pyq?action=attempts',
  saveState: '/api/pyq?action=save-state',
  states: '/api/pyq?action=states',
};

type Step = 'exam' | 'subject' | 'chapter' | 'overview' | 'questions';
type EntryExamKey = 'advanced' | 'mains' | 'bitsat';

interface BaseItem {
  id: string;
  name: string;
}

interface ChapterItem extends BaseItem {
  questionCount?: number;
}

interface QuestionItem {
  id: string;
  number: number;
  subject?: string;
  type?: string;
  questionHtml: string;
  options: string[];
  answer?: string;
  solutionHtml?: string;
  aiSolutionHtml?: string;
  aiGeneratedAt?: string;
  pyqInfo?: string;
  attemptStats?: {
    totalAttempts: number;
    correct: number;
    incorrect: number;
    averageTime: number | null;
    timeCount: number;
  } | null;
}

interface QuestionAttempt {
  questionId: string;
  selectedOptionIndex: number | null;
  isCorrect: boolean | null;
  answerLabel?: string | null;
  correctAnswer?: string | null;
  timeTaken?: number | null;
  createdAt?: string;
}

interface QuestionState {
  questionId: string;
  isBookmarked: boolean;
  note?: string | null;
  updatedAt?: string;
}

type ChapterProgress = {
  correct: number;
  incorrect: number;
  unattempted: number;
  total: number;
};

const PYQ_CHAPTER_PROGRESS_KEY = 'pyq-chapter-progress';
const PYQ_LAST_ACTIVE_KEY = 'pyq-last-active-question';
const PYQ_NOTE_STORAGE_KEY = 'pyq-question-notes';
const PYQ_BOOKMARK_STORAGE_KEY = 'pyq-question-bookmarks';

const ENTRY_EXAM_CONFIG: Array<{
  key: EntryExamKey;
  title: string;
  description: string;
  icon: typeof BookOpen;
  matches: (name: string) => boolean;
}> = [
  {
    key: 'mains',
    title: 'JEE Main',
    description: 'Practice memory-based PYQs from JEE Main shifts (including 2026).',
    icon: ClipboardCheck,
    matches: (name) => name.includes('jee_main') || name.includes('jee main'),
  },
  {
    key: 'bitsat',
    title: 'BITSAT',
    description: 'Practice chapter-wise BITSAT PYQs with performance tracking.',
    icon: Layers,
    matches: (name) => name.includes('bitsat'),
  },
  {
    key: 'advanced',
    title: 'JEE Advanced',
    description: 'Solve tougher PYQs curated from JEE Advanced papers.',
    icon: GraduationCap,
    matches: (name) => name.includes('advanced'),
  },
];


function extractArray(payload: unknown, keys: string[]): any[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  if ('data' in record) {
    return extractArray(record.data, keys);
  }

  return [];
}

function extractId(raw: any): string {
  const direct = raw?.id ?? raw?._id ?? raw?.examId ?? raw?.subjectId ?? raw?.chapterId ?? raw?.uuid;
  if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  if (direct?.$oid) return String(direct.$oid);
  return '';
}

function extractName(raw: any): string {
  return (
    raw?.name ??
    raw?.title ??
    raw?.examName ??
    raw?.subjectName ??
    raw?.chapterName ??
    raw?.displayName ??
    'Untitled'
  );
}

function normalizeItem(raw: any): BaseItem | null {
  const id = extractId(raw);
  if (!id) return null;
  return { id, name: extractName(raw) };
}

function normalizeChapter(raw: any): ChapterItem | null {
  const base = normalizeItem(raw);
  if (!base) return null;
  const count = raw?.questionCount ?? raw?.questionsCount ?? raw?.question_count;
  return { ...base, questionCount: typeof count === 'number' ? count : undefined };
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

const PYQ_IMAGE_REPLACE_COLORS = [
  { r: 231, g: 243, b: 253 }, // #E7F3FD
  { r: 231, g: 231, b: 233 }, // #E7E7E9
  { r: 237, g: 246, b: 254 }, // #EDF6FE
  { r: 237, g: 237, b: 238 }, // #EDEDEE
  { r: 249, g: 249, b: 249 }, // #F9F9F9
];
const PYQ_IMAGE_COLOR_TOLERANCE = 2;

function isNearColor(r: number, g: number, b: number, target: { r: number; g: number; b: number }) {
  return (
    Math.abs(r - target.r) <= PYQ_IMAGE_COLOR_TOLERANCE &&
    Math.abs(g - target.g) <= PYQ_IMAGE_COLOR_TOLERANCE &&
    Math.abs(b - target.b) <= PYQ_IMAGE_COLOR_TOLERANCE
  );
}

function replacePyqImageColors(imageData: ImageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;
    const shouldReplace = PYQ_IMAGE_REPLACE_COLORS.some((target) => isNearColor(r, g, b, target));
    if (shouldReplace) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }
  return imageData;
}

function loadImageForProcessing(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });
}

async function processPyqImageSource(src: string): Promise<string> {
  const cachedDataUrl = PYQ_IMAGE_CACHE.get(src);
  if (cachedDataUrl) return cachedDataUrl;

  const pending = PYQ_IMAGE_PROCESSING.get(src);
  if (pending) return pending;

  const task = (async () => {
    try {
      const image = await loadImageForProcessing(src);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return src;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const updated = replacePyqImageColors(imageData);
      ctx.putImageData(updated, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      PYQ_IMAGE_CACHE.set(src, dataUrl);
      return dataUrl;
    } catch {
      return src;
    } finally {
      PYQ_IMAGE_PROCESSING.delete(src);
    }
  })();

  PYQ_IMAGE_PROCESSING.set(src, task);
  return task;
}

async function processPyqHtmlImages(html: string): Promise<string> {
  if (!html) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));
  if (images.length === 0) return html;

  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src) return;
      const processedSrc = await processPyqImageSource(src);
      img.setAttribute('src', processedSrc);
    })
  );

  return doc.body.innerHTML;
}

function extractImageSourcesFromHtml(html: string): string[] {
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('img'))
    .map((img) => img.getAttribute('src'))
    .filter((src): src is string => Boolean(src));
}

function preloadImageSource(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

const PYQ_IMAGE_CACHE = new Map<string, string>();
const PYQ_IMAGE_PROCESSING = new Map<string, Promise<string>>();

function getOptions(raw: any): string[] {
  const direct = [raw?.option1, raw?.option2, raw?.option3, raw?.option4, raw?.option_1, raw?.option_2, raw?.option_3, raw?.option_4]
    .map(coerceString)
    .filter(Boolean);

  if (direct.length > 0) return direct;

  if (Array.isArray(raw?.options)) {
    return raw.options
      .map((opt: any) => coerceString(opt?.optionHtml ?? opt?.option ?? opt?.text ?? opt))
      .filter(Boolean);
  }

  return [];
}

function getCorrectOptionIndexes(answer: string | undefined, optionCount: number): number[] {
  if (!answer) return [];
  const normalized = answer.toUpperCase();
  const letterMatches = normalized.match(/[A-D]/g) ?? [];
  const numberMatches = normalized.match(/\b[1-4]\b/g) ?? [];
  const indexes = new Set<number>();

  letterMatches.forEach((letter) => {
    const index = letter.charCodeAt(0) - 65;
    if (index >= 0 && index < optionCount) indexes.add(index);
  });

  numberMatches.forEach((value) => {
    const index = Number(value) - 1;
    if (index >= 0 && index < optionCount) indexes.add(index);
  });

  return Array.from(indexes);
}

const NUMERICAL_TYPES = ['NAT', 'NUMERICAL', 'INTEGER'];
const MULTI_ANSWER_TYPES = ['MSQ', 'MULTIPLE', 'MULTI', 'MAQ'];

function isNumericalType(type: string | undefined) {
  const normalized = type?.toUpperCase() ?? '';
  return NUMERICAL_TYPES.some((entry) => normalized.includes(entry));
}

function isMultiAnswerType(type: string | undefined) {
  const normalized = type?.toUpperCase() ?? '';
  return MULTI_ANSWER_TYPES.some((entry) => normalized.includes(entry));
}

function formatQuestionType(type: string | undefined) {
  const raw = type?.trim();
  if (!raw) return 'Mixed';
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (['singlecorrect', 'singlechoice', 'singleselect', 'mcq'].includes(normalized)) {
    return 'Single Correct';
  }
  if (['multiplecorrect', 'multicorrect', 'multipleselect', 'multi', 'msq', 'maq'].includes(normalized)) {
    return 'Multiple Correct';
  }
  if (['numerical', 'integer', 'nat'].includes(normalized)) {
    return 'Numerical';
  }
  const withSpaces = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return withSpaces
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const CHAPTER_CATEGORY_CONFIG: Record<
  'physics' | 'chemistry' | 'math',
  Array<{ label: string; keywords: string[] }>
> = {
  physics: [
    {
      label: 'Mechanics',
      keywords: ['mechanics', 'kinematics', 'laws of motion', 'work', 'energy', 'power', 'rotation', 'gravitation', 'fluid', 'center of mass'],
    },
    {
      label: 'Electrodynamics',
      keywords: ['electrostatics', 'current', 'electric', 'capacitor', 'magnet', 'emi', 'induction', 'ac'],
    },
    {
      label: 'Optics',
      keywords: ['optics', 'reflection', 'refraction', 'lens', 'mirror', 'optical'],
    },
    {
      label: 'Thermodynamics & KTG',
      keywords: ['thermodynamics', 'thermal', 'heat', 'kinetic theory'],
    },
    {
      label: 'Waves & Oscillations',
      keywords: ['wave', 'oscillation', 'shm', 'sound'],
    },
    {
      label: 'Modern Physics',
      keywords: ['modern', 'photoelectric', 'nuclear', 'atom', 'semiconductor', 'dual nature'],
    },
  ],
  chemistry: [
    {
      label: 'Physical Chemistry',
      keywords: ['mole', 'stoichiometry', 'atomic', 'thermodynamics', 'equilibrium', 'electrochem', 'chemical kinetics', 'states of matter', 'solution', 'solid state', 'surface', 'redox'],
    },
    {
      label: 'Organic Chemistry',
      keywords: ['hydrocarbon', 'organic', 'goc', 'isomer', 'stereo', 'alkyl', 'halo', 'alcohol', 'phenol', 'ether', 'aldehyde', 'ketone', 'carboxylic', 'amine', 'biomolecule', 'polymer'],
    },
    {
      label: 'Inorganic Chemistry',
      keywords: ['periodic', 'chemical bonding', 'coordination', 's block', 'p block', 'd block', 'f block', 'metallurgy', 'hydrogen'],
    },
  ],
  math: [
    {
      label: 'Calculus',
      keywords: ['limit', 'continuity', 'differentiation', 'integration', 'differential equation', 'area under'],
    },
    {
      label: 'Algebra',
      keywords: ['quadratic', 'complex', 'sequence', 'series', 'permutation', 'combination', 'binomial', 'matrix', 'determinant', 'probability', 'set', 'relation', 'function'],
    },
    {
      label: 'Coordinate Geometry',
      keywords: ['coordinate', 'straight line', 'circle', 'parabola', 'ellipse', 'hyperbola', 'conic'],
    },
    {
      label: 'Vectors & 3D',
      keywords: ['vector', '3d', 'three dimensional', 'direction cosines', 'direction ratios'],
    },
    {
      label: 'Trigonometry',
      keywords: ['trigonometry', 'trigonometric'],
    },
    {
      label: 'Probability & Statistics',
      keywords: ['probability', 'statistics'],
    },
  ],
};

function getSubjectCategoryKey(subjectName: string | undefined) {
  const normalized = subjectName?.toLowerCase() ?? '';
  if (normalized.includes('phys')) return 'physics';
  if (normalized.includes('chem')) return 'chemistry';
  if (normalized.includes('math')) return 'math';
  return null;
}

function getChapterCategory(subjectName: string | undefined, chapterName: string) {
  const subjectKey = getSubjectCategoryKey(subjectName);
  if (!subjectKey) return 'Chapters';
  const normalized = chapterName.toLowerCase();
  const configs = CHAPTER_CATEGORY_CONFIG[subjectKey];
  for (const config of configs) {
    if (config.keywords.some((keyword) => normalized.includes(keyword))) {
      return config.label;
    }
  }
  return 'Other topics';
}

function parseNumericRanges(answer: string | undefined) {
  if (!answer) return [];
  return answer
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const rangeMatch = part.match(/^([+-]?\d*\.?\d+)\s*(?:-|–|—|\.\.)\s*([+-]?\d*\.?\d+)$/);
      if (rangeMatch) {
        const min = Number(rangeMatch[1]);
        const max = Number(rangeMatch[2]);
        if (!Number.isNaN(min) && !Number.isNaN(max)) {
          return [{ min: Math.min(min, max), max: Math.max(min, max) }];
        }
      }
      const numericValue = Number(part);
      if (!Number.isNaN(numericValue)) {
        return [{ min: numericValue, max: numericValue }];
      }
      return [];
    });
}

function matchesNumericAnswer(studentAnswer: string, correctAnswer: string | undefined) {
  if (!correctAnswer) return null;
  const trimmed = studentAnswer.trim();
  if (!trimmed) return null;
  const studentValue = Number(trimmed);
  if (Number.isNaN(studentValue)) return false;
  const ranges = parseNumericRanges(correctAnswer);
  if (ranges.length === 0) {
    return trimmed === correctAnswer.trim();
  }
  return ranges.some((range) => studentValue >= range.min && studentValue <= range.max);
}

function formatCorrectAnswer(answer: string | undefined, optionCount: number): string {
  const indexes = getCorrectOptionIndexes(answer, optionCount);
  if (indexes.length === 0) return answer ?? '';
  return indexes.map((index) => String.fromCharCode(65 + index)).join(', ');
}

function shouldAllowAiSolution(solutionHtml: string | undefined) {
  if (!solutionHtml || !solutionHtml.trim()) return true;
  const plain = solutionHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return /solution\s+coming\s+soon/i.test(plain);
}

function normalizeQuestion(raw: any, index: number): QuestionItem {
  const id = extractId(raw) || `${index + 1}`;
  const number = raw?.questionNumber ?? raw?.question_number ?? raw?.sequence ?? index + 1;
  const questionHtml = coerceString(
    raw?.questionHtml ?? raw?.question_html ?? raw?.question ?? raw?.questionText ?? raw?.text ?? ''
  );
  return {
    id,
    number: typeof number === 'number' ? number : index + 1,
    subject: coerceString(raw?.subject ?? raw?.subjectName ?? raw?.subject_name ?? ''),
    type: coerceString(raw?.type ?? raw?.questionType ?? ''),
    questionHtml,
    options: getOptions(raw),
    answer: coerceString(raw?.correctAnswer ?? raw?.answer ?? raw?.solution ?? ''),
    solutionHtml: coerceString(raw?.solutionHtml ?? raw?.solution_html ?? ''),
    pyqInfo: coerceString(raw?.pyqInfo ?? raw?.pyq_info ?? ''),
    attemptStats: raw?.attemptStats ?? null,
  };
}

async function fetchPyq(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PYQ request failed (${res.status})`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  const text = await res.text();
  const preview = text.trim().slice(0, 160);
  throw new Error(
    `PYQ returned non-JSON response. ${preview ? `Preview: ${preview}` : 'No response body.'}`
  );
}

async function savePyqAttempt(token: string, payload: Record<string, unknown>) {
  const res = await fetch(PYQ_API.saveAttempt, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save attempt (${res.status})`);
  }
  return res.json();
}

async function fetchPyqAttempts(token: string, payload: Record<string, unknown>) {
  const res = await fetch(PYQ_API.attempts, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch attempts (${res.status})`);
  }
  return res.json();
}


async function savePyqState(token: string, payload: Record<string, unknown>) {
  const res = await fetch(PYQ_API.saveState, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to save question state (${res.status})`);
  }
  return res.json();
}

async function fetchPyqStates(token: string, payload: Record<string, unknown>) {
  const res = await fetch(PYQ_API.states, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch question states (${res.status})`);
  }
  return res.json();
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateAttemptStats(
  existing: QuestionItem['attemptStats'],
  payload: { isCorrect: boolean | null; timeTaken: number }
) {
  const base = existing ?? { totalAttempts: 0, correct: 0, incorrect: 0, averageTime: null, timeCount: 0 };
  const totalAttempts = base.totalAttempts + 1;
  const correct = base.correct + (payload.isCorrect === true ? 1 : 0);
  const incorrect = base.incorrect + (payload.isCorrect === false ? 1 : 0);
  const hasTime = payload.timeTaken > 0;
  const timeCount = base.timeCount + (hasTime ? 1 : 0);
  const timeSum = (base.averageTime ?? 0) * base.timeCount + (hasTime ? payload.timeTaken : 0);
  const averageTime = timeCount > 0 ? Math.round(timeSum / timeCount) : null;
  return { totalAttempts, correct, incorrect, averageTime, timeCount };
}

function parsePyqInfo(info: string) {
  if (!info) return { year: undefined, date: undefined, shift: undefined };
  const yearMatch = info.match(/20\d{2}/);
  const shiftMatch = info.match(/shift\s*([1-3])/i);
  const dateMatch =
    info.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/) ||
    info.match(/\b\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*\d{2,4}\b/i);

  return {
    year: yearMatch?.[0],
    date: dateMatch?.[0],
    shift: shiftMatch ? `Shift ${shiftMatch[1]}` : undefined,
  };
}

function loadPyqBookmarks() {
  const raw = localStorage.getItem(PYQ_BOOKMARK_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.reduce<Record<string, boolean>>((acc, id) => {
        if (typeof id === 'string') acc[id] = true;
        return acc;
      }, {});
    }
    if (parsed && typeof parsed === 'object') return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
  return {};
}

function savePyqBookmarks(bookmarks: Record<string, boolean>) {
  localStorage.setItem(PYQ_BOOKMARK_STORAGE_KEY, JSON.stringify(bookmarks));
}

function loadPyqNotes() {
  const raw = localStorage.getItem(PYQ_NOTE_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    return {};
  }
  return {};
}

function savePyqNotes(notes: Record<string, string>) {
  localStorage.setItem(PYQ_NOTE_STORAGE_KEY, JSON.stringify(notes));
}

function loadPyqChapterProgress() {
  const raw = localStorage.getItem(PYQ_CHAPTER_PROGRESS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, ChapterProgress>;
  } catch {
    return {};
  }
  return {};
}

function savePyqChapterProgress(progress: Record<string, ChapterProgress>) {
  localStorage.setItem(PYQ_CHAPTER_PROGRESS_KEY, JSON.stringify(progress));
}

function loadPyqLastActiveQuestion() {
  const raw = localStorage.getItem(PYQ_LAST_ACTIVE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    return {};
  }
  return {};
}

function savePyqLastActiveQuestion(lastActive: Record<string, string>) {
  localStorage.setItem(PYQ_LAST_ACTIVE_KEY, JSON.stringify(lastActive));
}

interface PastYearPapersProps {
  onBack?: () => void;
  canUseAiSolutions?: boolean;
}

export default function PastYearPapers({ onBack, canUseAiSolutions = false }: PastYearPapersProps) {
  const [step, setStep] = useState<Step>('exam');
  const isQuestionsStep = step === 'questions';
  const [exams, setExams] = useState<BaseItem[]>([]);
  const [subjects, setSubjects] = useState<BaseItem[]>([]);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [selectedExam, setSelectedExam] = useState<BaseItem | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<BaseItem | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number | number[] | null>>({});
  const [numericAnswers, setNumericAnswers] = useState<Record<string, string>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, boolean>>({});
  const [answerResults, setAnswerResults] = useState<Record<string, boolean | null>>({});
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [questionTimes, setQuestionTimes] = useState<Record<string, number>>({});
  const processingQuestionIdsRef = useRef<Set<string>>(new Set());
  const processedQuestionIdsRef = useRef<Set<string>>(new Set());
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptHistory, setAttemptHistory] = useState<QuestionAttempt[]>([]);
  const [chapterProgress, setChapterProgress] = useState<Record<string, ChapterProgress>>(() =>
    loadPyqChapterProgress()
  );
  const [lastActiveByChapter, setLastActiveByChapter] = useState<Record<string, string>>(() =>
    loadPyqLastActiveQuestion()
  );
  const [questionNotes, setQuestionNotes] = useState<Record<string, string>>(() => loadPyqNotes());
  const [noteStatus, setNoteStatus] = useState<Record<string, string>>({});
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Record<string, boolean>>(() =>
    loadPyqBookmarks()
  );
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'incorrect' | 'unattempted' | 'bookmarked'>('all');
  const [aiModel, setAiModel] = useState<'flash' | 'lite' | '3-12b' | '3-flash'>('flash');
  const [aiLoadingByQuestion, setAiLoadingByQuestion] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isQuestionsStep) {
      document.body.classList.remove('immersive-view');
      return;
    }

    document.body.classList.add('immersive-view');
    return () => {
      document.body.classList.remove('immersive-view');
    };
  }, [isQuestionsStep]);

  const filteredSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subjects.filter((subject) => subject.name.toLowerCase().includes(query));
  }, [subjects, search]);

  const filteredChapters = useMemo(() => {
    const query = search.trim().toLowerCase();
    return chapters.filter((chapter) => chapter.name.toLowerCase().includes(query));
  }, [chapters, search]);

  const chapterSections = useMemo(() => {
    if (filteredChapters.length === 0) return [];
    const subjectKey = getSubjectCategoryKey(selectedSubject?.name);
    const categoryOrder = subjectKey ? CHAPTER_CATEGORY_CONFIG[subjectKey].map((config) => config.label) : [];
    const grouped = new Map<string, ChapterItem[]>();
    filteredChapters.forEach((chapter) => {
      const category = getChapterCategory(selectedSubject?.name, chapter.name);
      const existing = grouped.get(category);
      if (existing) {
        existing.push(chapter);
      } else {
        grouped.set(category, [chapter]);
      }
    });
    const sections = categoryOrder
      .map((label) => ({ label, chapters: grouped.get(label) ?? [] }))
      .filter((section) => section.chapters.length > 0);
    const fallbackLabel = subjectKey ? 'Other topics' : 'Chapters';
    const remaining = grouped.get(fallbackLabel);
    if (remaining && remaining.length > 0) {
      sections.push({ label: fallbackLabel, chapters: remaining });
    }
    grouped.forEach((chaptersList, label) => {
      if (categoryOrder.includes(label) || label === fallbackLabel) return;
      if (chaptersList.length > 0) sections.push({ label, chapters: chaptersList });
    });
    return sections;
  }, [filteredChapters, selectedSubject?.name]);

  const resetSearch = () => setSearch('');
  const resetPracticeState = () => {
    setSelectedAnswers({});
    setNumericAnswers({});
    setSubmittedAnswers({});
    setAnswerResults({});
    setActiveQuestionId(null);
    setQuestionTimes({});
    setAttemptsLoading(false);
    setAttemptHistory([]);
  };

  const loadExams = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPyq(PYQ_API.exams);
      const list = extractArray(data, ['exams', 'data', 'items']);
      const normalized = list
        .map(normalizeItem)
        .filter((item): item is BaseItem => Boolean(item))
        .map((item) => ({
          ...item,
          name: item.name.trim(),
        }));
      setExams(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exams');
    } finally {
      setLoading(false);
    }
  };

  const loadSubjects = async (exam: BaseItem) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPyq(PYQ_API.subjects(exam.id));
      const list = extractArray(data, ['subjects', 'data', 'items']);
      const normalized = list
        .map(normalizeItem)
        .filter((item): item is BaseItem => Boolean(item));
      setSubjects(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subjects');
    } finally {
      setLoading(false);
    }
  };

  const loadChapters = async (exam: BaseItem, subject: BaseItem) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPyq(PYQ_API.chapters(exam.id, subject.id));
      const list = extractArray(data, ['chapters', 'data', 'items']);
      const normalized = list
        .map(normalizeChapter)
        .filter((item): item is ChapterItem => Boolean(item));
      setChapters(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chapters');
    } finally {
      setLoading(false);
    }
  };

  const loadQuestions = async (exam: BaseItem, subject: BaseItem, chapter: ChapterItem) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPyq(PYQ_API.questions(exam.id, subject.id, chapter.id));
      const list = extractArray(data, ['questions', 'data', 'items']);
      const normalized = list.map((item, index) => normalizeQuestion(item, index));
      const lastActiveId = lastActiveByChapter[chapter.id];
      const fallbackId = normalized[0]?.id ?? null;
      const nextActiveId = normalized.some((question) => question.id === lastActiveId) ? lastActiveId : fallbackId;
      setQuestions(normalized);
      processingQuestionIdsRef.current.clear();
      processedQuestionIdsRef.current.clear();
      setActiveQuestionId(nextActiveId);
      setQuestionTimes(
        normalized.reduce<Record<string, number>>((acc, question) => {
          acc[question.id] = 0;
          return acc;
        }, {})
      );
      const questionIds = normalized.map((q) => q.id);
      const token = localStorage.getItem('token');
      if (token && normalized.length > 0) {
        setAttemptsLoading(true);
        try {
          const [attemptData, stateData] = await Promise.all([
            fetchPyqAttempts(token, { questionIds }),
            fetchPyqStates(token, { questionIds }),
          ]);
          const attempts = extractArray(attemptData, ['attempts', 'data', 'items']) as QuestionAttempt[];
          const states = extractArray(stateData, ['states', 'data', 'items']) as QuestionState[];
          const selected: Record<string, number | null> = {};
          const submitted: Record<string, boolean> = {};
          const results: Record<string, boolean | null> = {};
          const bookmarks: Record<string, boolean> = {};
          const notes: Record<string, string> = {};
          setAttemptHistory(attempts);
          attempts.forEach((attempt) => {
            if (typeof attempt.selectedOptionIndex !== 'number') return;
            selected[attempt.questionId] = attempt.selectedOptionIndex;
            submitted[attempt.questionId] = true;
            results[attempt.questionId] = typeof attempt.isCorrect === 'boolean' ? attempt.isCorrect : null;
          });
          states.forEach((state) => {
            if (state.isBookmarked) bookmarks[state.questionId] = true;
            const note = state.note?.trim();
            if (note) notes[state.questionId] = note;
          });
          setSelectedAnswers((prev) => ({ ...prev, ...selected }));
          setSubmittedAnswers((prev) => ({ ...prev, ...submitted }));
          setAnswerResults((prev) => ({ ...prev, ...results }));
          setBookmarkedQuestions((prev) => {
            const next = { ...prev };
            questionIds.forEach((id) => delete next[id]);
            return { ...next, ...bookmarks };
          });
          setQuestionNotes((prev) => {
            const next = { ...prev };
            questionIds.forEach((id) => delete next[id]);
            return { ...next, ...notes };
          });
        } catch (attemptError) {
          console.error('Failed to fetch PYQ attempts/state:', attemptError);
        } finally {
          setAttemptsLoading(false);
        }
      } else {
        setAttemptHistory([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!questions.length) return;
    const activeIndex = questions.findIndex((question) => question.id === activeQuestionId);
    const seedIndex = activeIndex >= 0 ? activeIndex : 0;
    const indexTargets = [seedIndex, seedIndex + 1, seedIndex - 1]
      .filter((index) => index >= 0 && index < questions.length);

    indexTargets.forEach((index) => {
      const question = questions[index];
      if (!question || processingQuestionIdsRef.current.has(question.id) || processedQuestionIdsRef.current.has(question.id)) return;

      processingQuestionIdsRef.current.add(question.id);
      const htmlBlocks = [question.questionHtml, ...question.options, question.solutionHtml || ''];
      const imageSources = Array.from(new Set(htmlBlocks.flatMap(extractImageSourcesFromHtml)));

      void (async () => {
        try {
          await Promise.all(imageSources.map((src) => preloadImageSource(src)));
          const processedQuestionHtml = await processPyqHtmlImages(question.questionHtml);
          const processedOptions = await Promise.all(question.options.map((option) => processPyqHtmlImages(option)));
          const processedSolutionHtml = question.solutionHtml
            ? await processPyqHtmlImages(question.solutionHtml)
            : question.solutionHtml;

          setQuestions((prev) =>
            prev.map((item) =>
              item.id === question.id
                ? {
                    ...item,
                    questionHtml: processedQuestionHtml,
                    options: processedOptions,
                    solutionHtml: processedSolutionHtml,
                  }
                : item
            )
          );
          processedQuestionIdsRef.current.add(question.id);
        } finally {
          processingQuestionIdsRef.current.delete(question.id);
        }
      })();
    });
  }, [questions, activeQuestionId]);

  const handleExamSelect = async (exam: BaseItem) => {
    setSelectedExam(exam);
    setStep('subject');
    resetSearch();
    setSelectedSubject(null);
    setSelectedChapter(null);
    setSubjects([]);
    setChapters([]);
    setQuestions([]);
    resetPracticeState();
    await loadSubjects(exam);
  };

  const handleSubjectSelect = async (subject: BaseItem) => {
    if (!selectedExam) return;
    setSelectedSubject(subject);
    setStep('chapter');
    resetSearch();
    setSelectedChapter(null);
    setChapters([]);
    setQuestions([]);
    resetPracticeState();
    await loadChapters(selectedExam, subject);
  };

  const handleChapterSelect = async (chapter: ChapterItem) => {
    if (!selectedExam || !selectedSubject) return;
    setSelectedChapter(chapter);
    setStep('overview');
    resetSearch();
    setQuestions([]);
    resetPracticeState();
    await loadQuestions(selectedExam, selectedSubject, chapter);
  };

  const handleOptionSelect = (question: QuestionItem, index: number) => {
    if (submittedAnswers[question.id]) return;
    if (isMultiAnswerType(question.type)) {
      setSelectedAnswers((prev) => {
        const existing = prev[question.id];
        const selected = Array.isArray(existing) ? existing : existing === null || existing === undefined ? [] : [existing];
        if (selected.includes(index)) {
          return { ...prev, [question.id]: selected.filter((value) => value !== index) };
        }
        return { ...prev, [question.id]: [...selected, index].sort((a, b) => a - b) };
      });
      return;
    }
    setSelectedAnswers((prev) => ({ ...prev, [question.id]: index }));
  };

  const handleSubmitAnswer = (question: QuestionItem) => {
    const selectedValue = selectedAnswers[question.id];
    const isNumerical = isNumericalType(question.type);
    const isMulti = isMultiAnswerType(question.type);
    const timeTaken = questionTimes[question.id] ?? 0;
    if (isNumerical) {
      const numericValue = numericAnswers[question.id] ?? '';
      if (!numericValue.trim()) return;
      const isCorrect = matchesNumericAnswer(numericValue, question.answer);
      setSubmittedAnswers((prev) => ({ ...prev, [question.id]: true }));
      setAnswerResults((prev) => ({ ...prev, [question.id]: isCorrect }));
      setQuestions((prev) =>
        prev.map((item) =>
          item.id === question.id
            ? { ...item, attemptStats: updateAttemptStats(item.attemptStats, { isCorrect, timeTaken }) }
            : item
        )
      );
      const token = localStorage.getItem('token');
      setAttemptHistory((prev) => [
        ...prev,
        {
          questionId: question.id,
          selectedOptionIndex: null,
          isCorrect,
          timeTaken,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (token) {
        savePyqAttempt(token, {
          questionId: question.id,
          examId: selectedExam?.id ?? null,
          subjectId: selectedSubject?.id ?? null,
          chapterId: selectedChapter?.id ?? null,
          questionNumber: question.number,
          selectedOptionIndex: null,
          answerLabel: numericValue.trim(),
          correctAnswer: question.answer ?? null,
          isCorrect,
          timeTaken,
        }).catch((error) => {
          console.error('Failed to save PYQ attempt:', error);
        });
      }
      return;
    }
    const selectedIndexes = Array.isArray(selectedValue)
      ? selectedValue
      : selectedValue === null || selectedValue === undefined
        ? []
        : [selectedValue];
    if (selectedIndexes.length === 0) return;
    const correctIndexes = getCorrectOptionIndexes(question.answer, question.options.length);
    const selectedSet = new Set(selectedIndexes);
    const isCorrect =
      correctIndexes.length > 0
        ? correctIndexes.every((index) => selectedSet.has(index)) && selectedSet.size === correctIndexes.length
        : null;
    setSubmittedAnswers((prev) => ({ ...prev, [question.id]: true }));
    setAnswerResults((prev) => ({ ...prev, [question.id]: isCorrect }));
    setQuestions((prev) =>
      prev.map((item) =>
        item.id === question.id
          ? { ...item, attemptStats: updateAttemptStats(item.attemptStats, { isCorrect, timeTaken }) }
          : item
      )
    );
    const token = localStorage.getItem('token');
    setAttemptHistory((prev) => [
      ...prev,
      {
        questionId: question.id,
        selectedOptionIndex: isMulti ? null : selectedIndexes[0] ?? null,
        isCorrect,
        timeTaken,
        createdAt: new Date().toISOString(),
      },
    ]);
    if (token) {
      const answerLabel = selectedIndexes.map((index) => String.fromCharCode(65 + index)).join(', ');
      savePyqAttempt(token, {
        questionId: question.id,
        examId: selectedExam?.id ?? null,
        subjectId: selectedSubject?.id ?? null,
        chapterId: selectedChapter?.id ?? null,
        questionNumber: question.number,
        selectedOptionIndex: isMulti ? null : selectedIndexes[0],
        selectedOptionIndexes: isMulti ? selectedIndexes : undefined,
        answerLabel,
        correctAnswer: question.answer ?? null,
        isCorrect,
        timeTaken,
      }).catch((error) => {
        console.error('Failed to save PYQ attempt:', error);
      });
    }
  };

  const persistQuestionState = async (questionId: string, changes: { isBookmarked?: boolean; note?: string | null }) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const latestBookmark = changes.isBookmarked ?? Boolean(bookmarkedQuestions[questionId]);
    const latestNote =
      changes.note !== undefined
        ? changes.note
        : questionNotes[questionId] ?? null;

    try {
      await savePyqState(token, {
        questionId,
        examId: selectedExam?.id ?? null,
        subjectId: selectedSubject?.id ?? null,
        chapterId: selectedChapter?.id ?? null,
        isBookmarked: latestBookmark,
        note: latestNote,
      });
    } catch (error) {
      console.error('Failed to save PYQ question state:', error);
    }
  };

  const handleToggleBookmark = (questionId: string) => {
    let nextBookmarkValue = false;
    setBookmarkedQuestions((prev) => {
      const next = { ...prev };
      if (next[questionId]) {
        delete next[questionId];
        nextBookmarkValue = false;
      } else {
        next[questionId] = true;
        nextBookmarkValue = true;
      }
      savePyqBookmarks(next);
      return next;
    });
    void persistQuestionState(questionId, { isBookmarked: nextBookmarkValue });
  };

  const handleSaveNote = (questionId: string) => {
    const note = questionNotes[questionId]?.trim() ?? '';
    setNoteStatus((prev) => ({ ...prev, [questionId]: note ? 'Note saved.' : 'Note cleared.' }));
    setQuestionNotes((prev) => {
      const next = { ...prev };
      if (note) {
        next[questionId] = note;
      } else {
        delete next[questionId];
      }
      savePyqNotes(next);
      return next;
    });
    void persistQuestionState(questionId, { note: note || null });
  };

  const handleGenerateAiSolution = async (question: QuestionItem) => {
    if (!canUseAiSolutions || !shouldAllowAiSolution(question.solutionHtml)) return;

    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in to use AI solutions.');
      return;
    }

    setAiLoadingByQuestion((prev) => ({ ...prev, [question.id]: true }));
    try {
      const res = await fetch('/api/pyq?action=generate-ai-solution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          questionId: question.id,
          questionHtml: question.questionHtml,
          options: question.options,
          answer: question.answer,
          type: question.type,
          subject: question.subject,
          solutionHtml: question.solutionHtml,
          model: aiModel,
        }),
      });
      const data = await res.json();
      if (data.success && data.aiSolutionHtml) {
        setQuestions((prev) =>
          prev.map((item) =>
            item.id === question.id
              ? { ...item, aiSolutionHtml: data.aiSolutionHtml, aiGeneratedAt: new Date().toISOString() }
              : item
          )
        );
      } else {
        setError(data.error || data.details || 'Failed to generate AI solution.');
      }
    } catch {
      setError('Failed to generate AI solution.');
    } finally {
      setAiLoadingByQuestion((prev) => ({ ...prev, [question.id]: false }));
    }
  };

  const handleBreadcrumbNavigate = (targetStep: Step) => {
    if (targetStep === step) return;

    switch (targetStep) {
      case 'exam':
        setStep('exam');
        return;
      case 'subject':
        if (!selectedExam) return;
        setStep('subject');
        return;
      case 'chapter':
        if (!selectedExam || !selectedSubject) return;
        setStep('chapter');
        return;
      case 'overview':
        if (!selectedChapter) return;
        setStep('overview');
        return;
      case 'questions':
        if (!selectedChapter || questions.length === 0) return;
        setStep('questions');
        return;
      default:
        return;
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 'questions') {
      setStep('overview');
      return;
    }
    if (step === 'overview') {
      setStep('chapter');
      return;
    }
    if (step === 'chapter') {
      setStep('subject');
      return;
    }
    if (step === 'subject') {
      setStep('exam');
      return;
    }
    if (onBack) onBack();
  };

  useEffect(() => {
    loadExams();
  }, []);

  useEffect(() => {
    if (!activeQuestionId) return;
    if (submittedAnswers[activeQuestionId]) return;
    const interval = window.setInterval(() => {
      setQuestionTimes((prev) => ({
        ...prev,
        [activeQuestionId]: (prev[activeQuestionId] ?? 0) + 1,
      }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeQuestionId, submittedAnswers]);

  useEffect(() => {
    if (!selectedChapter?.id || !activeQuestionId || step !== 'questions') return;
    setLastActiveByChapter((prev) => {
      if (prev[selectedChapter.id] === activeQuestionId) return prev;
      const next = { ...prev, [selectedChapter.id]: activeQuestionId };
      savePyqLastActiveQuestion(next);
      return next;
    });
  }, [activeQuestionId, selectedChapter?.id, step]);

  const activeQuestionIndex = questions.findIndex((question) => question.id === activeQuestionId);
  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) ?? questions[0] ?? null;

  const entryExamOptions = ENTRY_EXAM_CONFIG.map((item) => {
    const exam = exams.find((candidate) => item.matches(candidate.name.toLowerCase())) ?? null;
    return { ...item, exam };
  });

  const showSearch = step === 'subject' || step === 'chapter';

  const summaryCounts = questions.reduce(
    (acc, question) => {
      const result = answerResults[question.id];
      if (submittedAnswers[question.id] && result === true) acc.correct += 1;
      else if (submittedAnswers[question.id] && result === false) acc.incorrect += 1;
      else acc.unattempted += 1;
      return acc;
    },
    { correct: 0, incorrect: 0, unattempted: 0 }
  );

  const lightboxContext = useMemo(
    () => ({
      questionId: activeQuestion?.id,
      label: activeQuestion ? `PYQ Q${activeQuestion.number}` : undefined,
      subject: activeQuestion?.subject,
      testName: selectedChapter?.name ?? 'PYQ',
    }),
    [activeQuestion?.id, activeQuestion?.number, activeQuestion?.subject, selectedChapter?.name]
  );

  const { lightboxState, handleImageClick, closeLightbox } = useImageLightbox(lightboxContext);

  const questionTypeCounts = useMemo(() => {
    return questions.reduce<Record<string, number>>((acc, question) => {
      const label = formatQuestionType(question.type);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});
  }, [questions]);

  const overviewStats = useMemo(() => {
    const total = questions.length;
    const attempted = summaryCounts.correct + summaryCounts.incorrect;
    const accuracy = attempted ? Math.round((summaryCounts.correct / attempted) * 100) : 0;
    const bookmarked = questions.filter((question) => bookmarkedQuestions[question.id]).length;
    return { total, attempted, accuracy, bookmarked };
  }, [bookmarkedQuestions, questions, summaryCounts]);

  const overviewPieData = useMemo(
    () => [
      { name: 'Correct', value: summaryCounts.correct, color: '#22c55e' },
      { name: 'Incorrect', value: summaryCounts.incorrect, color: '#ef4444' },
      { name: 'Unattempted', value: summaryCounts.unattempted, color: '#6b7280' },
    ],
    [summaryCounts.correct, summaryCounts.incorrect, summaryCounts.unattempted]
  );

  const accuracyTrend = useMemo(() => {
    const attempts = attemptHistory.filter((attempt) => typeof attempt.isCorrect === 'boolean');
    if (attempts.length === 0) return [];
    const sorted = [...attempts].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA === timeB) return 0;
      return timeA - timeB;
    });
    let correct = 0;
    const trend = sorted.map((attempt, index) => {
      if (attempt.isCorrect) correct += 1;
      const accuracy = Math.round((correct / (index + 1)) * 100);
      return { index: index + 1, accuracy };
    });
    return trend.slice(-12);
  }, [attemptHistory]);

  const filteredOverviewQuestions = useMemo(() => {
    switch (overviewFilter) {
      case 'incorrect':
        return questions.filter((question) => submittedAnswers[question.id] && answerResults[question.id] === false);
      case 'unattempted':
        return questions.filter((question) => !submittedAnswers[question.id]);
      case 'bookmarked':
        return questions.filter((question) => bookmarkedQuestions[question.id]);
      default:
        return questions;
    }
  }, [answerResults, bookmarkedQuestions, overviewFilter, questions, submittedAnswers]);

  useEffect(() => {
    if (!selectedChapter || step !== 'questions' || questions.length === 0) return;
    const progress = questions.reduce<ChapterProgress>(
      (acc, question) => {
        const result = answerResults[question.id];
        if (submittedAnswers[question.id] && result === true) acc.correct += 1;
        else if (submittedAnswers[question.id] && result === false) acc.incorrect += 1;
        else acc.unattempted += 1;
        return acc;
      },
      { correct: 0, incorrect: 0, unattempted: 0, total: questions.length }
    );
    setChapterProgress((prev) => {
      const existing = prev[selectedChapter.id];
      if (
        existing &&
        existing.correct === progress.correct &&
        existing.incorrect === progress.incorrect &&
        existing.unattempted === progress.unattempted &&
        existing.total === progress.total
      ) {
        return prev;
      }
      const next = { ...prev, [selectedChapter.id]: progress };
      savePyqChapterProgress(next);
      return next;
    });
  }, [answerResults, questions, selectedChapter, step, submittedAnswers]);

  const renderQuestionPanel = () => {
    if (questions.length === 0) {
      return (
        <div className="pyp-empty">
          <p>No questions found.</p>
          <p className="pyp-empty-hint">Try another chapter or refresh.</p>
        </div>
      );
    }

    return (
      <div className="exam-panel pyp-practice-shell">
        <div className="exam-panel-topbar">
          <button className="exam-back-btn" onClick={handleBack}>
            <ChevronLeft size={20} />
            <span>Back</span>
          </button>
          <div className="exam-title">
            <h2>{selectedChapter?.name ?? 'Practice session'}</h2>
            <span className="exam-subtitle">
              {selectedExam?.name ?? 'JEE'} • {selectedSubject?.name ?? 'PYQ Practice'}
            </span>
          </div>
          <div className="exam-summary">
            <span className="summary-item correct">
              <span>Correct</span>
              {summaryCounts.correct}
            </span>
            <span className="summary-item incorrect">
              <span>Incorrect</span>
              {summaryCounts.incorrect}
            </span>
            <span className="summary-item skipped">
              <span>Unattempted</span>
              {summaryCounts.unattempted}
            </span>
          </div>
        </div>
        <div className="exam-panel-body">
          <aside className="exam-nav-sidebar pyp-question-sidebar">
            <div className="exam-nav-header">
              <h3>Questions</h3>
              <span className="pyp-question-count">{questions.length}</span>
            </div>
            <div className="pyp-question-grid-wrap">
              <div className="exam-nav-question-grid pyp-question-grid">
                {questions.map((question) => {
                  const isSubmitted = submittedAnswers[question.id];
                  const result = answerResults[question.id];
                  const isNumerical = isNumericalType(question.type);
                  const numericValue = numericAnswers[question.id] ?? '';
                  const selectedValue = selectedAnswers[question.id];
                  const selectedIndexes = Array.isArray(selectedValue)
                    ? selectedValue
                    : selectedValue === null || selectedValue === undefined
                      ? []
                      : [selectedValue];
                  const hasSelection = isNumerical ? Boolean(numericValue.trim()) : selectedIndexes.length > 0;
                  const status =
                    isSubmitted && result === true
                      ? 'correct'
                      : isSubmitted && result === false
                        ? 'incorrect'
                        : hasSelection
                          ? 'in-progress'
                          : 'unattempted';
                  return (
                    <button
                      key={question.id}
                      className={[
                        'exam-nav-btn',
                        status,
                        question.id === activeQuestion?.id ? 'current' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setActiveQuestionId(question.id)}
                      type="button"
                    >
                      {question.number}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="exam-nav-legend pyp-nav-legend">
              <div className="legend-row">
                <span className="legend-dot correct" />
                Correct
              </div>
              <div className="legend-row">
                <span className="legend-dot incorrect" />
                Incorrect
              </div>
              <div className="legend-row">
                <span className="legend-dot in-progress" />
                In progress
              </div>
              <div className="legend-row">
                <span className="legend-dot unattempted" />
                Unattempted
              </div>
            </div>
          </aside>
          <section className="exam-main-content pyp-question-main">
            {activeQuestion && (() => {
              const selectedValue = selectedAnswers[activeQuestion.id];
              const selectedIndexes = Array.isArray(selectedValue)
                ? selectedValue
                : selectedValue === null || selectedValue === undefined
                  ? []
                  : [selectedValue];
              const numericValue = numericAnswers[activeQuestion.id] ?? '';
              const isSubmitted = submittedAnswers[activeQuestion.id];
              const result = answerResults[activeQuestion.id];
              const isNumerical = isNumericalType(activeQuestion.type);
              const isMulti = isMultiAnswerType(activeQuestion.type);
              const correctIndexes = getCorrectOptionIndexes(activeQuestion.answer, activeQuestion.options.length);
              const hasCorrectAnswer = correctIndexes.length > 0;
              const correctAnswerLabel = isNumerical
                ? activeQuestion.answer ?? ''
                : formatCorrectAnswer(activeQuestion.answer, activeQuestion.options.length);
              const hasPrev = activeQuestionIndex > 0;
              const hasNext = activeQuestionIndex < questions.length - 1;
              const hasSelection = isNumerical ? Boolean(numericValue.trim()) : selectedIndexes.length > 0;
              const attemptStats = activeQuestion.attemptStats ?? null;
              const timeTaken = formatDuration(questionTimes[activeQuestion.id] ?? 0);
              const averageTime =
                attemptStats && typeof attemptStats.averageTime === 'number'
                  ? formatDuration(attemptStats.averageTime)
                  : '—';
              return (
                <div className="pyp-question-card exam-question-card">
                  <div className="pyp-question-header">
                    <span className="pyp-question-num">Q{activeQuestion.number}</span>
                    {activeQuestion.type && (
                      <span className="pyp-question-type">{formatQuestionType(activeQuestion.type)}</span>
                    )}
                    <div className="pyp-question-time-pills">
                      <span className="pyp-time-pill">
                        <span className="pyp-time-pill-label">Avg {averageTime}</span>
                        <span className="pyp-time-pill-value">Time {timeTaken}</span>
                      </span>
                    </div>
                    <button
                      className={`pyp-bookmark-btn ${bookmarkedQuestions[activeQuestion.id] ? 'active' : ''}`}
                      type="button"
                      onClick={() => handleToggleBookmark(activeQuestion.id)}
                      title={bookmarkedQuestions[activeQuestion.id] ? 'Remove bookmark' : 'Bookmark question'}
                    >
                      {bookmarkedQuestions[activeQuestion.id] ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                      <span>{bookmarkedQuestions[activeQuestion.id] ? 'Bookmarked' : 'Bookmark'}</span>
                    </button>
                  </div>
                  <div
                    className="pyp-question-html invert-images clickable-images"
                    dangerouslySetInnerHTML={{ __html: renderLatexInHtml(activeQuestion.questionHtml) }}
                    onClick={handleImageClick}
                  />
                  {isNumerical && (
                    <div className="pyp-question-numerical">
                      <label htmlFor={`pyp-numerical-${activeQuestion.id}`}>Your answer</label>
                      <input
                        id={`pyp-numerical-${activeQuestion.id}`}
                        className={[
                          'pyp-numerical-input',
                          isSubmitted && result === true ? 'correct' : '',
                          isSubmitted && result === false ? 'incorrect' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        type="text"
                        inputMode="decimal"
                        value={numericValue}
                        onChange={(event) =>
                          setNumericAnswers((prev) => ({ ...prev, [activeQuestion.id]: event.target.value }))
                        }
                        placeholder="Enter numeric value"
                        disabled={isSubmitted}
                      />
                    </div>
                  )}
                  {activeQuestion.options.length > 0 && (
                    <div className="pyp-question-options">
                      {activeQuestion.options.map((option, index) => {
                        const isSelected = selectedIndexes.includes(index);
                        const isCorrect = correctIndexes.includes(index);
                        return (
                          <button
                            key={`${activeQuestion.id}-opt-${index}`}
                            className={[
                              'pyp-question-option',
                              isSelected ? 'selected' : '',
                              isSubmitted && isCorrect ? 'correct' : '',
                              isSubmitted && isSelected && !isCorrect ? 'incorrect' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            type="button"
                            onClick={(event) => {
                              if ((event.target as HTMLElement).tagName === 'IMG') {
                                handleImageClick(event);
                                return;
                              }
                              handleOptionSelect(activeQuestion, index);
                            }}
                            disabled={isSubmitted}
                          >
                            <span className="pyp-option-label">{String.fromCharCode(65 + index)}</span>
                            <span
                              className="pyp-option-content invert-images clickable-images"
                              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(option) }}
                              onClick={handleImageClick}
                            />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="pyp-question-actions">
                    <button
                      className="pyp-submit-answer"
                      type="button"
                      onClick={() => handleSubmitAnswer(activeQuestion)}
                      disabled={isSubmitted || !hasSelection}
                    >
                      Submit answer
                    </button>
                    {isMulti && !isSubmitted && (
                      <span className="pyp-multi-hint">Select all that apply.</span>
                    )}
                  </div>
                  {isSubmitted && (
                    <div
                      className={[
                        'pyp-question-feedback',
                        result === true ? 'correct' : '',
                        result === false ? 'incorrect' : '',
                        result === null ? 'neutral' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {result === true && 'Correct!'}
                      {result === false && 'Incorrect.'}
                      {result === null && 'Answer submitted.'}
                      {hasCorrectAnswer && correctAnswerLabel && (
                        <span>Correct answer: {correctAnswerLabel}</span>
                      )}
                    </div>
                  )}
                  {isSubmitted && activeQuestion.solutionHtml && (
                    <div className="pyp-question-solution">
                      <div className="pyp-question-solution-title">Solution</div>
                      <div
                        className="pyp-question-solution-body invert-images clickable-images"
                        dangerouslySetInnerHTML={{ __html: renderLatexInHtml(activeQuestion.solutionHtml) }}
                        onClick={handleImageClick}
                      />
                    </div>
                  )}
                  {!activeQuestion.solutionHtml && isSubmitted && activeQuestion.answer && (
                    <div className="pyp-question-answer">Answer: {activeQuestion.answer}</div>
                  )}
                  {isSubmitted && canUseAiSolutions && shouldAllowAiSolution(activeQuestion.solutionHtml) && (
                    <div className="exam-action-ai-row pyp-ai-actions">
                      <select
                        className="ai-model-select"
                        value={aiModel}
                        onChange={(event) => setAiModel(event.target.value as 'flash' | 'lite' | '3-12b' | '3-flash')}
                        disabled={Boolean(aiLoadingByQuestion[activeQuestion.id])}
                      >
                        <option value="flash">Flash 2.5</option>
                        <option value="3-flash">Gemini 3 Flash</option>
                        <option value="3-12b">Gemini 3 12B</option>
                        <option value="lite">Flash Lite</option>
                      </select>
                      <button
                        className="exam-action-btn admin-action ai-regen"
                        type="button"
                        onClick={() => handleGenerateAiSolution(activeQuestion)}
                        disabled={Boolean(aiLoadingByQuestion[activeQuestion.id])}
                      >
                        <Sparkles size={14} />
                        <span>{aiLoadingByQuestion[activeQuestion.id] ? 'Generating...' : activeQuestion.aiSolutionHtml ? 'Regenerate AI Solution' : 'Generate AI Solution'}</span>
                      </button>
                    </div>
                  )}
                  {isSubmitted && activeQuestion.aiSolutionHtml && (
                    <div className="pyp-question-solution ai-solution" onClick={handleImageClick}>
                      <div className="pyp-question-solution-title">AI Solution</div>
                      <div
                        className="pyp-question-solution-body ai-solution-body invert-images clickable-images"
                        dangerouslySetInnerHTML={{ __html: renderLatexInHtml(activeQuestion.aiSolutionHtml) }}
                      />
                      <div className="ai-doubt-box" onClick={(event) => event.stopPropagation()}>
                        <h5>Ask a doubt about this AI solution:</h5>
                        <AiDoubtPrompt
                          questionId={activeQuestion.id}
                          aiSolution={activeQuestion.aiSolutionHtml}
                          apiPath="/pyq?action=ai-doubt"
                          questionPayload={{
                            questionHtml: activeQuestion.questionHtml,
                            option1: activeQuestion.options[0],
                            option2: activeQuestion.options[1],
                            option3: activeQuestion.options[2],
                            option4: activeQuestion.options[3],
                            correctAnswer: activeQuestion.answer || '',
                            questionType: activeQuestion.type,
                            subjectName: activeQuestion.subject,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="pyp-question-notes">
                    <div className="pyp-question-notes-header">
                      <span>Notes</span>
                      {noteStatus[activeQuestion.id] && (
                        <span className="pyp-question-notes-status">{noteStatus[activeQuestion.id]}</span>
                      )}
                    </div>
                    <textarea
                      className="pyp-question-notes-input"
                      rows={3}
                      placeholder="Type your note for this question..."
                      value={questionNotes[activeQuestion.id] ?? ''}
                      onChange={(event) =>
                        setQuestionNotes((prev) => ({
                          ...prev,
                          [activeQuestion.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="pyp-question-notes-actions">
                      <button
                        type="button"
                        className="pyp-notes-save"
                        onClick={() => handleSaveNote(activeQuestion.id)}
                      >
                        Save note
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="exam-nav-footer pyp-question-footer">
              <button
                className="exam-nav-btn-large prev"
                type="button"
                onClick={() => setActiveQuestionId(questions[activeQuestionIndex - 1].id)}
                disabled={activeQuestionIndex <= 0}
              >
                <ChevronLeft size={20} />
                <span>Previous</span>
              </button>
              <div className="exam-nav-position">
                <span className="current">{activeQuestionIndex >= 0 ? activeQuestionIndex + 1 : 0}</span>
                <span className="separator">/</span>
                <span className="total">{questions.length}</span>
              </div>
              <button
                className="exam-nav-btn-large next"
                type="button"
                onClick={() => setActiveQuestionId(questions[activeQuestionIndex + 1].id)}
                disabled={activeQuestionIndex >= questions.length - 1}
              >
                <span>Next</span>
                <ChevronRight size={20} />
              </button>
            </div>
          </section>
          <aside className="exam-actions-sidebar pyp-question-meta-panel">
            <div className="exam-actions-header">
              <h3>Question info</h3>
              {attemptsLoading && <span className="pyp-practice-sync">Syncing…</span>}
            </div>
            {activeQuestion && (() => {
              const meta = parsePyqInfo(activeQuestion.pyqInfo ?? '');
              const selectedValue = selectedAnswers[activeQuestion.id];
              const selectedIndexes = Array.isArray(selectedValue)
                ? selectedValue
                : selectedValue === null || selectedValue === undefined
                  ? []
                  : [selectedValue];
              const isNumerical = isNumericalType(activeQuestion.type);
              const isMulti = isMultiAnswerType(activeQuestion.type);
              const numericValue = numericAnswers[activeQuestion.id] ?? '';
              const isSubmitted = submittedAnswers[activeQuestion.id];
              const result = answerResults[activeQuestion.id];
              const attemptStats = activeQuestion.attemptStats ?? null;
              const correctAnswerLabel = isNumerical
                ? activeQuestion.answer ?? ''
                : formatCorrectAnswer(activeQuestion.answer, activeQuestion.options.length);
              const selectedLabel = isNumerical
                ? numericValue.trim() || '—'
                : selectedIndexes.length > 0
                  ? selectedIndexes.map((index) => String.fromCharCode(65 + index)).join(', ')
                  : '—';
              const questionTypeLabel = isNumerical ? 'Numerical' : isMulti ? 'Multiple Correct' : 'Single Correct';
              return (
                <>
                  <div className="pyp-meta-card">
                    <div className="pyp-meta-card-top">
                      <h3>Question details</h3>
                      <div className="pyp-question-type-group">
                        <span className="pyp-question-type-pill">{questionTypeLabel}</span>
                      </div>
                    </div>
                    <div className="pyp-meta-list">
                      <div>
                        <span>Year</span>
                        <strong>{meta.year ?? '—'}</strong>
                      </div>
                      <div>
                        <span>Shift</span>
                        <strong>{meta.shift ?? '—'}</strong>
                      </div>
                    </div>
                    {activeQuestion.pyqInfo && (
                      <div className="pyp-meta-info">
                        <span>Paper</span>
                        <p>{activeQuestion.pyqInfo}</p>
                      </div>
                    )}
                    <div className="pyp-meta-analysis">
                      <h4>Answer analysis</h4>
                      {!isSubmitted && <p>Submit your answer to unlock analysis.</p>}
                      {isSubmitted && (
                        <div className="pyp-analysis-content">
                          <span>{result === true ? 'Correct answer chosen.' : 'Answer needs review.'}</span>
                          <span>Selected: {selectedLabel}</span>
                          {correctAnswerLabel && <span>Correct: {correctAnswerLabel}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {attemptStats && attemptStats.totalAttempts > 0 && (
                    <div className="exam-action-section answer-analysis-section">
                      <div className="exam-comments-header">
                        <Users size={14} />
                        <span>Answer Analysis ({attemptStats.totalAttempts} attempts)</span>
                      </div>
                      <div className="analysis-bars compact">
                        <div className="analysis-row">
                          <span className="analysis-label correct">
                            <CheckCircle size={10} /> Correct
                          </span>
                          <div className="analysis-bar-container">
                            <div
                              className="analysis-bar correct"
                              style={{ width: `${(attemptStats.correct / attemptStats.totalAttempts) * 100}%` }}
                            />
                          </div>
                          <span className="analysis-count">{attemptStats.correct}</span>
                        </div>
                        <div className="analysis-row">
                          <span className="analysis-label incorrect">
                            <XCircle size={10} /> Wrong
                          </span>
                          <div className="analysis-bar-container">
                            <div
                              className="analysis-bar incorrect"
                              style={{ width: `${(attemptStats.incorrect / attemptStats.totalAttempts) * 100}%` }}
                            />
                          </div>
                          <span className="analysis-count">{attemptStats.incorrect}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </aside>
        </div>
      </div>
    );
  };

  const renderOverviewPanel = () => {
    if (questions.length === 0) {
      return (
        <div className="pyp-empty">
          <p>No questions found.</p>
          <p className="pyp-empty-hint">Try another chapter or refresh.</p>
        </div>
      );
    }

    const subjectLabel = selectedSubject?.name ?? 'Subject';
    const examLabel = selectedExam?.name ?? 'Exam';
    const chapterLabel = selectedChapter?.name ?? 'Selected chapter';
    const lastActiveId = selectedChapter ? lastActiveByChapter[selectedChapter.id] : null;
    const lastActiveNumber = questions.find((question) => question.id === lastActiveId)?.number;
    const resumeLabel = lastActiveNumber ? `Resume from Q${lastActiveNumber}` : 'Resume where you left off';

    return (
      <div className="pyp-overview">
        <div className="pyp-overview-card">
          <div className="pyp-overview-header">
            <div>
              <p className="pyp-overview-eyebrow">{examLabel} • {subjectLabel}</p>
              <h2>{chapterLabel}</h2>
              <p className="pyp-overview-subtitle">
                Review every PYQ in this chapter before diving into practice. Tap a question to jump straight in.
              </p>
            </div>
            <div className="pyp-overview-actions">
              <button
                className="pyp-overview-btn primary"
                type="button"
                onClick={() => {
                  if (selectedChapter?.id && lastActiveByChapter[selectedChapter.id]) {
                    setActiveQuestionId(lastActiveByChapter[selectedChapter.id]);
                  } else if (questions[0]) {
                    setActiveQuestionId(questions[0].id);
                  }
                  setStep('questions');
                }}
              >
                {resumeLabel}
              </button>
              <button
                className="pyp-overview-btn"
                type="button"
                onClick={() => {
                  if (questions[0]) {
                    setActiveQuestionId(questions[0].id);
                    setStep('questions');
                  }
                }}
              >
                Start from Q1
              </button>
            </div>
          </div>
          <div className="pyp-overview-metrics">
            <div className="pyp-overview-metric">
              <span>Total questions</span>
              <strong>{overviewStats.total}</strong>
            </div>
            <div className="pyp-overview-metric">
              <span>Attempted</span>
              <strong>{overviewStats.attempted}</strong>
            </div>
            <div className="pyp-overview-metric">
              <span>Accuracy</span>
              <strong>{overviewStats.accuracy}%</strong>
            </div>
            <div className="pyp-overview-metric">
              <span>Bookmarked</span>
              <strong>{overviewStats.bookmarked}</strong>
            </div>
          </div>
          <div className="pyp-overview-visuals">
            <div className="pyp-overview-visual-card">
              <div className="pyp-overview-visual-header">
                <h3>Attempt mix</h3>
                <span>Correct vs wrong vs unattempted</span>
              </div>
              <div className="pyp-overview-pie">
                <PieChart width={120} height={92}>
                  <Pie
                    data={overviewPieData}
                    dataKey="value"
                    innerRadius={19}
                    outerRadius={33}
                    strokeWidth={0}
                    isAnimationActive={false}
                  >
                      {overviewPieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                  </Pie>
                </PieChart>
                <div className="pyp-overview-pie-legend">
                  {overviewPieData.map((entry) => (
                    <div key={entry.name} className="pyp-overview-legend-row">
                      <span className="pyp-overview-legend-dot" style={{ background: entry.color }} />
                      <span>{entry.name}</span>
                      <strong>{entry.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="pyp-overview-visual-card">
              <div className="pyp-overview-visual-header">
                <h3>Accuracy trend</h3>
                <span>Recent attempts</span>
              </div>
              {accuracyTrend.length === 0 ? (
                <p className="pyp-overview-visual-empty">No attempts yet. Submit answers to see progress.</p>
              ) : (
                <div className="pyp-overview-line">
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={accuracyTrend}>
                      <XAxis dataKey="index" hide />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip
                        formatter={(value) => [`${value}%`, 'Accuracy']}
                        labelFormatter={(label) => `Attempt ${label}`}
                      />
                      <Line type="monotone" dataKey="accuracy" stroke="#cbd5e1" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="pyp-overview-line-meta">
                    <span>Latest accuracy</span>
                    <strong>{accuracyTrend[accuracyTrend.length - 1]?.accuracy ?? 0}%</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="pyp-overview-chips">
            {Object.entries(questionTypeCounts).map(([label, count]) => (
              <span key={label} className="pyp-overview-chip">
                {label} • {count}
              </span>
            ))}
          </div>
        </div>
        <div className="pyp-overview-questions">
          <div className="pyp-overview-questions-header">
            <h3>Questions</h3>
            <span>{questions.length}</span>
          </div>
          <div className="pyp-overview-toggles">
            {[
              { key: 'all', label: 'All' },
              { key: 'incorrect', label: 'Incorrect' },
              { key: 'unattempted', label: 'Unattempted' },
              { key: 'bookmarked', label: 'Bookmarked' },
            ].map((toggle) => (
              <button
                key={toggle.key}
                type="button"
                className={`pyp-overview-toggle ${overviewFilter === toggle.key ? 'active' : ''}`}
                onClick={() => setOverviewFilter(toggle.key as typeof overviewFilter)}
              >
                {toggle.label}
              </button>
            ))}
          </div>
          <div className="pyp-overview-question-track">
            {filteredOverviewQuestions.map((question) => {
              const isSubmitted = submittedAnswers[question.id];
              const result = answerResults[question.id];
              const isNumerical = isNumericalType(question.type);
              const numericValue = numericAnswers[question.id] ?? '';
              const selectedValue = selectedAnswers[question.id];
              const selectedIndexes = Array.isArray(selectedValue)
                ? selectedValue
                : selectedValue === null || selectedValue === undefined
                  ? []
                  : [selectedValue];
              const hasSelection = isNumerical ? Boolean(numericValue.trim()) : selectedIndexes.length > 0;
              const status =
                isSubmitted && result === true
                  ? 'correct'
                  : isSubmitted && result === false
                    ? 'incorrect'
                    : hasSelection
                      ? 'in-progress'
                      : 'unattempted';
              return (
                <button
                  key={question.id}
                  className={[
                    'pyp-overview-question',
                    status,
                    question.id === activeQuestion?.id ? 'current' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  type="button"
                  onClick={() => {
                    setActiveQuestionId(question.id);
                    setStep('questions');
                  }}
                >
                  <span className="pyp-overview-question-index">Q{question.number}</span>
                  <span
                    className="pyp-overview-question-text invert-images"
                    dangerouslySetInnerHTML={{ __html: renderLatexInHtml(question.questionHtml) }}
                  />
                </button>
              );
            })}
          </div>
          {filteredOverviewQuestions.length === 0 && (
            <p className="pyp-overview-hint">No questions match this filter yet.</p>
          )}
          <p className="pyp-overview-hint">Tap any question to open the full practice view.</p>
        </div>
      </div>
    );
  };

  return (
    <div className={`pyp-page pyp-pyq ${isQuestionsStep ? 'pyp-practice-mode' : ''}`}>
      <>
        <div className="pyp-breadcrumbs">
          {[
            { key: 'exam', label: 'Exam', enabled: true },
            { key: 'subject', label: 'Subject', enabled: Boolean(selectedExam) },
            { key: 'chapter', label: 'Chapter', enabled: Boolean(selectedExam && selectedSubject) },
            { key: 'overview', label: 'Overview', enabled: Boolean(selectedChapter) },
            { key: 'questions', label: 'Questions', enabled: Boolean(selectedChapter && questions.length > 0) },
          ].map((crumb, index) => (
            <span key={crumb.key} className="pyp-breadcrumb-item">
              <button
                type="button"
                className={`pyp-breadcrumb-btn ${step === crumb.key ? 'active' : ''}`}
                disabled={!crumb.enabled}
                onClick={() => handleBreadcrumbNavigate(crumb.key as Step)}
              >
                {crumb.label}
              </button>
              {index < 4 && <span className="pyp-breadcrumb-separator">›</span>}
            </span>
          ))}
        </div>

          {step !== 'exam' && (
            <div className="pyp-selection-pill">
              {selectedExam && <span>{selectedExam.name}</span>}
              {selectedSubject && <span>• {selectedSubject.name}</span>}
              {selectedChapter && <span>• {selectedChapter.name}</span>}
            </div>
          )}

          {showSearch && (
            <div className="pyp-search-row">
              <div className="pyp-search">
                <Search size={16} />
                <input
                  type="text"
                  placeholder={`Search ${step}...`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          )}

          {loading && (
            <div className="pyp-loading">
              <Loader2 className="spinning" size={32} />
              <span>Loading...</span>
            </div>
          )}

          {error && !loading && (
            <div className="pyp-error">
              <p>Unable to load data.</p>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && step === 'exam' && (
            <div className="pyp-exam-grid">
              {entryExamOptions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    className={`pyp-exam-select-card ${item.key}`}
                    onClick={() => item.exam && handleExamSelect(item.exam)}
                    type="button"
                    disabled={!item.exam}
                  >
                    <div className="pyp-exam-select-top">
                      <span className="pyp-exam-chip">{item.title}</span>
                      <span className="pyp-exam-icon">
                        <Icon size={24} />
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <span className="pyp-exam-meta">
                      {item.exam ? 'Tap to view subjects' : 'Exam data unavailable'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && !error && step === 'subject' && (
            <div className="pyp-list-grid pyp-topic-grid">
              {filteredSubjects.length === 0 ? (
                <div className="pyp-empty">
                  <p>No subjects found.</p>
                  <p className="pyp-empty-hint">Try another exam or refine your search.</p>
                </div>
              ) : (
                filteredSubjects.map((subject) => (
                  <button key={subject.id} className="pyp-item-card pyp-topic-card" onClick={() => handleSubjectSelect(subject)}>
                    <div className="pyp-topic-icon">
                      <BookOpen size={20} />
                    </div>
                    <div className="pyp-topic-content">
                      <h3>{subject.name}</h3>
                      <span className="pyp-item-meta">Tap to view chapters</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {!loading && !error && step === 'chapter' && (
            <div className="pyp-chapter-sections">
              {filteredChapters.length === 0 ? (
                <div className="pyp-empty">
                  <p>No chapters found.</p>
                  <p className="pyp-empty-hint">Try another subject or refine your search.</p>
                </div>
              ) : (
                chapterSections.map((section) => (
                  <div key={section.label} className="pyp-chapter-section">
                    <div className="pyp-chapter-section-header">
                      <h3>{section.label}</h3>
                      <span>{section.chapters.length} chapters</span>
                    </div>
                    <div className="pyp-list-grid pyp-topic-grid pyp-chapter-grid">
                      {section.chapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          className="pyp-item-card pyp-topic-card pyp-chapter-card"
                          onClick={() => handleChapterSelect(chapter)}
                        >
                          <div className="pyp-chapter-card-top">
                            <div className="pyp-topic-icon">
                              <Layers size={20} />
                            </div>
                            <div className="pyp-topic-content">
                              <h3>{chapter.name}</h3>
                              <span className="pyp-item-meta">
                                {chapter.questionCount ? `${chapter.questionCount} questions` : 'Tap to view questions'}
                              </span>
                            </div>
                          </div>
                          {(() => {
                            const progress = chapterProgress[chapter.id];
                            const total = progress?.total ?? chapter.questionCount ?? 0;
                            const correct = progress?.correct ?? 0;
                            const incorrect = progress?.incorrect ?? 0;
                            const unattempted = progress?.unattempted ?? Math.max(total - correct - incorrect, 0);
                            const safeTotal = total > 0 ? total : 1;
                            return (
                              <div className="pyp-chapter-progress">
                                <div className="pyp-chapter-bars">
                                  <span
                                    className="pyp-chapter-bar correct"
                                    style={{ width: `${(correct / safeTotal) * 100}%` }}
                                  />
                                  <span
                                    className="pyp-chapter-bar incorrect"
                                    style={{ width: `${(incorrect / safeTotal) * 100}%` }}
                                  />
                                  <span
                                    className="pyp-chapter-bar unattempted"
                                    style={{ width: `${(unattempted / safeTotal) * 100}%` }}
                                  />
                                </div>
                                <div className="pyp-chapter-progress-meta">
                                  <span className="correct">{correct}</span>
                                  <span className="incorrect">{incorrect}</span>
                                  <span className="unattempted">{unattempted}</span>
                                </div>
                              </div>
                            );
                          })()}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        {!loading && !error && step === 'overview' && renderOverviewPanel()}
      </>

      {!loading && !error && step === 'questions' && renderQuestionPanel()}
      {lightboxState && (
        <ImageLightbox
          src={lightboxState.src}
          context={lightboxState.context}
          shouldInvert={lightboxState.shouldInvert}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
