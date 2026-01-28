import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  PenSquare,
  Search,
} from 'lucide-react';
import { renderLatexInHtml } from './utils/latex';

const PYQ_API = {
  exams: '/api/pyq?action=exams',
  subjects: (examId: string) => `/api/pyq?action=subjects&examId=${encodeURIComponent(examId)}`,
  chapters: (examId: string, subjectId: string) =>
    `/api/pyq?action=chapters&examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}`,
  questions: (examId: string, subjectId: string, chapterId: string) =>
    `/api/pyq?action=questions&examId=${encodeURIComponent(examId)}&subjectId=${encodeURIComponent(subjectId)}&chapterId=${encodeURIComponent(chapterId)}`,
  saveAttempt: '/api/pyq?action=save-attempt',
  attempts: '/api/pyq?action=attempts',
};

type Step = 'category' | 'exam' | 'subject' | 'chapter' | 'questions';
type CategoryKey = 'advanced' | 'mains' | 'shift';

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
  pyqInfo?: string;
}

interface QuestionAttempt {
  questionId: string;
  selectedOptionIndex: number | null;
  isCorrect: boolean | null;
  answerLabel?: string | null;
  correctAnswer?: string | null;
  createdAt?: string;
}

const CATEGORY_CONFIG: Array<{
  key: CategoryKey;
  title: string;
  description: string;
  icon: typeof BookOpen;
  matches: (name: string) => boolean;
}> = [
  {
    key: 'advanced',
    title: 'JEE Advanced PYQs',
    description: 'Past year questions from JEE Advanced papers.',
    icon: BookOpen,
    matches: (name) => name.includes('advanced'),
  },
  {
    key: 'mains',
    title: 'JEE Main PYQs',
    description: 'Past year questions from JEE Main papers.',
    icon: Layers,
    matches: (name) => name.includes('main'),
  },
  {
    key: 'shift',
    title: 'Other Exam PYQs',
    description: 'Practice with additional exams available in the GitHub PYQ library.',
    icon: ListChecks,
    matches: (name) => !name.includes('advanced') && !name.includes('main'),
  },
];

const EXAM_ICON_CONFIG: Array<{
  matches: (name: string) => boolean;
  icon: typeof BookOpen;
}> = [
  { matches: (name) => name.includes('advanced'), icon: GraduationCap },
  { matches: (name) => name.includes('main'), icon: ClipboardCheck },
  { matches: (name) => name.includes('neet'), icon: BookOpen },
  { matches: (name) => name.includes('bitsat'), icon: PenSquare },
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

function formatCorrectAnswer(answer: string | undefined, optionCount: number): string {
  const indexes = getCorrectOptionIndexes(answer, optionCount);
  if (indexes.length === 0) return answer ?? '';
  return indexes.map((index) => String.fromCharCode(65 + index)).join(', ');
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

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

interface PastYearPapersProps {
  onBack?: () => void;
}

export default function PastYearPapers({ onBack }: PastYearPapersProps) {
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<CategoryKey | null>(null);
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
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number | null>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, boolean>>({});
  const [answerResults, setAnswerResults] = useState<Record<string, boolean | null>>({});
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [questionTimes, setQuestionTimes] = useState<Record<string, number>>({});
  const [attemptsLoading, setAttemptsLoading] = useState(false);

  const activeCategory = CATEGORY_CONFIG.find((item) => item.key === category) ?? null;

  const filteredExams = useMemo(() => {
    const query = search.trim().toLowerCase();
    return exams.filter((exam) => exam.name.toLowerCase().includes(query));
  }, [exams, search]);

  const filteredSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return subjects.filter((subject) => subject.name.toLowerCase().includes(query));
  }, [subjects, search]);

  const filteredChapters = useMemo(() => {
    const query = search.trim().toLowerCase();
    return chapters.filter((chapter) => chapter.name.toLowerCase().includes(query));
  }, [chapters, search]);

  const resetSearch = () => setSearch('');
  const resetPracticeState = () => {
    setSelectedAnswers({});
    setSubmittedAnswers({});
    setAnswerResults({});
    setActiveQuestionId(null);
    setQuestionTimes({});
    setAttemptsLoading(false);
  };

  const loadExams = async (categoryKey: CategoryKey) => {
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
      const matcher = CATEGORY_CONFIG.find((item) => item.key === categoryKey)?.matches ?? (() => true);
      const filtered = normalized.filter((exam) => matcher(exam.name.toLowerCase()));
      setExams(filtered);
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
      setQuestions(normalized);
      setActiveQuestionId(normalized[0]?.id ?? null);
      setQuestionTimes(
        normalized.reduce<Record<string, number>>((acc, question) => {
          acc[question.id] = 0;
          return acc;
        }, {})
      );
      const token = localStorage.getItem('token');
      if (token && normalized.length > 0) {
        setAttemptsLoading(true);
        try {
          const attemptData = await fetchPyqAttempts(token, { questionIds: normalized.map((q) => q.id) });
          const attempts = extractArray(attemptData, ['attempts', 'data', 'items']) as QuestionAttempt[];
          const selected: Record<string, number | null> = {};
          const submitted: Record<string, boolean> = {};
          const results: Record<string, boolean | null> = {};
          attempts.forEach((attempt) => {
            if (typeof attempt.selectedOptionIndex !== 'number') return;
            selected[attempt.questionId] = attempt.selectedOptionIndex;
            submitted[attempt.questionId] = true;
            results[attempt.questionId] = typeof attempt.isCorrect === 'boolean' ? attempt.isCorrect : null;
          });
          setSelectedAnswers((prev) => ({ ...prev, ...selected }));
          setSubmittedAnswers((prev) => ({ ...prev, ...submitted }));
          setAnswerResults((prev) => ({ ...prev, ...results }));
        } catch (attemptError) {
          console.error('Failed to fetch PYQ attempts:', attemptError);
        } finally {
          setAttemptsLoading(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  };

  const handleCategorySelect = async (key: CategoryKey) => {
    setCategory(key);
    setStep('exam');
    resetSearch();
    setSelectedExam(null);
    setSelectedSubject(null);
    setSelectedChapter(null);
    setSubjects([]);
    setChapters([]);
    setQuestions([]);
    resetPracticeState();
    await loadExams(key);
  };

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
    setStep('questions');
    resetSearch();
    setQuestions([]);
    resetPracticeState();
    await loadQuestions(selectedExam, selectedSubject, chapter);
  };

  const handleOptionSelect = (questionId: string, index: number) => {
    if (submittedAnswers[questionId]) return;
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: index }));
  };

  const handleSubmitAnswer = (question: QuestionItem) => {
    const selectedIndex = selectedAnswers[question.id];
    if (selectedIndex === null || selectedIndex === undefined) return;
    const correctIndexes = getCorrectOptionIndexes(question.answer, question.options.length);
    const isCorrect =
      correctIndexes.length > 0 ? correctIndexes.includes(selectedIndex) : null;
    setSubmittedAnswers((prev) => ({ ...prev, [question.id]: true }));
    setAnswerResults((prev) => ({ ...prev, [question.id]: isCorrect }));
    const token = localStorage.getItem('token');
    if (token) {
      const answerLabel = String.fromCharCode(65 + selectedIndex);
      savePyqAttempt(token, {
        questionId: question.id,
        examId: selectedExam?.id ?? null,
        subjectId: selectedSubject?.id ?? null,
        chapterId: selectedChapter?.id ?? null,
        questionNumber: question.number,
        selectedOptionIndex: selectedIndex,
        answerLabel,
        correctAnswer: question.answer ?? null,
        isCorrect,
      }).catch((error) => {
        console.error('Failed to save PYQ attempt:', error);
      });
    }
  };

  const getExamIcon = (examName: string) => {
    const normalized = examName.toLowerCase();
    return EXAM_ICON_CONFIG.find((config) => config.matches(normalized))?.icon ?? null;
  };

  const handleBack = () => {
    setError(null);
    if (step === 'questions') {
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
    if (step === 'exam') {
      setStep('category');
      return;
    }
    if (onBack) onBack();
  };

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

  const activeQuestionIndex = questions.findIndex((question) => question.id === activeQuestionId);
  const activeQuestion =
    questions.find((question) => question.id === activeQuestionId) ?? questions[0] ?? null;

  return (
    <div className="pyp-page pyp-pyq">
      <div className="pyp-header">
        <button className="pyp-back-btn" onClick={handleBack}>
          <ChevronLeft size={20} />
        </button>
        <div className="pyp-header-title">
          <h1>Past Year Questions</h1>
          <span className="pyp-paper-count">Browse PYQs from the GitHub library by exam, subject, and chapter</span>
        </div>
      </div>

      <div className="pyp-breadcrumbs">
        <span className={step === 'category' ? 'active' : ''}>Category</span>
        <span>›</span>
        <span className={step === 'exam' ? 'active' : ''}>Exam</span>
        <span>›</span>
        <span className={step === 'subject' ? 'active' : ''}>Subject</span>
        <span>›</span>
        <span className={step === 'chapter' ? 'active' : ''}>Chapter</span>
        <span>›</span>
        <span className={step === 'questions' ? 'active' : ''}>Questions</span>
      </div>

      {step !== 'category' && (
        <div className="pyp-selection-pill">
          {activeCategory?.title && <span>{activeCategory.title}</span>}
          {selectedExam && <span>• {selectedExam.name}</span>}
          {selectedSubject && <span>• {selectedSubject.name}</span>}
          {selectedChapter && <span>• {selectedChapter.name}</span>}
        </div>
      )}

      {step === 'category' && (
        <div className="pyp-category-grid">
          {CATEGORY_CONFIG.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className="pyp-category-card" onClick={() => handleCategorySelect(item.key)}>
                <div className="pyp-category-icon">
                  <Icon size={28} />
                </div>
                <div className="pyp-category-content">
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {step !== 'category' && (
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
        <div className="pyp-list-grid">
          {filteredExams.length === 0 ? (
            <div className="pyp-empty">
              <p>No exams found.</p>
              <p className="pyp-empty-hint">Try another category or refine your search.</p>
            </div>
          ) : (
            filteredExams.map((exam) => (
              <button
                key={exam.id}
                className="pyp-item-card pyp-exam-card"
                onClick={() => handleExamSelect(exam)}
              >
                <span className={`pyp-item-icon ${getExamIcon(exam.name) ? '' : 'is-empty'}`}>
                  {(() => {
                    const Icon = getExamIcon(exam.name);
                    return Icon ? <Icon size={22} /> : null;
                  })()}
                </span>
                <div className="pyp-item-content">
                  <h3>{exam.name}</h3>
                  <span className="pyp-item-meta">Tap to view subjects</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {!loading && !error && step === 'subject' && (
        <div className="pyp-list-grid">
          {filteredSubjects.length === 0 ? (
            <div className="pyp-empty">
              <p>No subjects found.</p>
              <p className="pyp-empty-hint">Try another exam or refine your search.</p>
            </div>
          ) : (
            filteredSubjects.map((subject) => (
              <button key={subject.id} className="pyp-item-card" onClick={() => handleSubjectSelect(subject)}>
                <h3>{subject.name}</h3>
                <span className="pyp-item-meta">Tap to view chapters</span>
              </button>
            ))
          )}
        </div>
      )}

      {!loading && !error && step === 'chapter' && (
        <div className="pyp-list-grid">
          {filteredChapters.length === 0 ? (
            <div className="pyp-empty">
              <p>No chapters found.</p>
              <p className="pyp-empty-hint">Try another subject or refine your search.</p>
            </div>
          ) : (
            filteredChapters.map((chapter) => (
              <button key={chapter.id} className="pyp-item-card" onClick={() => handleChapterSelect(chapter)}>
                <h3>{chapter.name}</h3>
                <span className="pyp-item-meta">
                  {chapter.questionCount ? `${chapter.questionCount} questions` : 'Tap to view questions'}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {!loading && !error && step === 'questions' && (
        <div className="pyp-practice-panel">
          <div className="pyp-practice-header">
            <div>
              <span className="pyp-practice-badge">Practice mode</span>
              <h2>{selectedChapter?.name ?? 'Questions'}</h2>
              <p>{questions.length} questions • Submit answers to see instant feedback</p>
            </div>
            <div className="pyp-practice-meta">
              <span>
                {activeQuestionIndex >= 0 ? activeQuestionIndex + 1 : 0}/{questions.length}
              </span>
              {attemptsLoading && <span className="pyp-practice-sync">Syncing attempts…</span>}
            </div>
          </div>
          {questions.length === 0 ? (
            <div className="pyp-empty">
              <p>No questions found.</p>
              <p className="pyp-empty-hint">Try another chapter or refresh.</p>
            </div>
          ) : (
            <div className="pyp-practice-layout">
              <aside className="pyp-question-list">
                <div className="pyp-question-list-header">
                  <span>Questions</span>
                  <span className="pyp-question-list-count">{questions.length}</span>
                </div>
                <div className="pyp-question-list-items">
                  {questions.map((question) => {
                    const selectedIndex = selectedAnswers[question.id];
                    const isSubmitted = submittedAnswers[question.id];
                    const result = answerResults[question.id];
                    const status =
                      isSubmitted && result === true
                        ? 'correct'
                        : isSubmitted && result === false
                          ? 'incorrect'
                          : isSubmitted
                            ? 'submitted'
                            : selectedIndex !== null && selectedIndex !== undefined
                              ? 'in-progress'
                              : 'unattempted';
                    return (
                      <button
                        key={question.id}
                        className={[
                          'pyp-question-list-item',
                          status,
                          question.id === activeQuestion?.id ? 'active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setActiveQuestionId(question.id)}
                        type="button"
                      >
                        <span className="pyp-question-list-num">Q{question.number}</span>
                        <span className="pyp-question-list-status">{status.replace('-', ' ')}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>
              <section className="pyp-question-main">
                {activeQuestion && (() => {
                  const selectedIndex = selectedAnswers[activeQuestion.id];
                  const isSubmitted = submittedAnswers[activeQuestion.id];
                  const result = answerResults[activeQuestion.id];
                  const correctIndexes = getCorrectOptionIndexes(activeQuestion.answer, activeQuestion.options.length);
                  const hasCorrectAnswer = correctIndexes.length > 0;
                  const correctAnswerLabel = formatCorrectAnswer(activeQuestion.answer, activeQuestion.options.length);
                  const hasPrev = activeQuestionIndex > 0;
                  const hasNext = activeQuestionIndex < questions.length - 1;
                  return (
                    <div className="pyp-question-card">
                      <div className="pyp-question-header">
                        <span className="pyp-question-num">Q{activeQuestion.number}</span>
                        {activeQuestion.subject && <span className="pyp-question-subject">{activeQuestion.subject}</span>}
                        {activeQuestion.type && <span className="pyp-question-type">{activeQuestion.type}</span>}
                      </div>
                      <div
                        className="pyp-question-html invert-images"
                        dangerouslySetInnerHTML={{ __html: renderLatexInHtml(activeQuestion.questionHtml) }}
                      />
                      {activeQuestion.options.length > 0 && (
                        <div className="pyp-question-options">
                          {activeQuestion.options.map((option, index) => (
                            <button
                              key={`${activeQuestion.id}-opt-${index}`}
                              className={[
                                'pyp-question-option',
                                selectedIndex === index ? 'selected' : '',
                                isSubmitted && correctIndexes.includes(index) ? 'correct' : '',
                                isSubmitted && selectedIndex === index && !correctIndexes.includes(index)
                                  ? 'incorrect'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              type="button"
                              onClick={() => handleOptionSelect(activeQuestion.id, index)}
                              disabled={isSubmitted}
                            >
                              <span className="pyp-option-label">{String.fromCharCode(65 + index)}</span>
                              <span
                                className="pyp-option-content invert-images"
                                dangerouslySetInnerHTML={{ __html: renderLatexInHtml(option) }}
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="pyp-question-actions">
                        <button
                          className="pyp-submit-answer"
                          type="button"
                          onClick={() => handleSubmitAnswer(activeQuestion)}
                          disabled={isSubmitted || selectedIndex === null || selectedIndex === undefined}
                        >
                          Submit answer
                        </button>
                        <div className="pyp-question-nav">
                          <button
                            className="pyp-nav-btn"
                            type="button"
                            onClick={() => setActiveQuestionId(questions[activeQuestionIndex - 1].id)}
                            disabled={!hasPrev}
                          >
                            <ChevronLeft size={16} />
                            Previous
                          </button>
                          <button
                            className="pyp-nav-btn"
                            type="button"
                            onClick={() => setActiveQuestionId(questions[activeQuestionIndex + 1].id)}
                            disabled={!hasNext}
                          >
                            Next
                            <ChevronRight size={16} />
                          </button>
                        </div>
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
                            className="pyp-question-solution-body invert-images"
                            dangerouslySetInnerHTML={{ __html: renderLatexInHtml(activeQuestion.solutionHtml) }}
                          />
                        </div>
                      )}
                      {!activeQuestion.solutionHtml && isSubmitted && activeQuestion.answer && (
                        <div className="pyp-question-answer">Answer: {activeQuestion.answer}</div>
                      )}
                    </div>
                  );
                })()}
              </section>
              <aside className="pyp-question-meta-panel">
                {activeQuestion && (() => {
                  const meta = parsePyqInfo(activeQuestion.pyqInfo ?? '');
                  const selectedIndex = selectedAnswers[activeQuestion.id];
                  const isSubmitted = submittedAnswers[activeQuestion.id];
                  const result = answerResults[activeQuestion.id];
                  const correctAnswerLabel = formatCorrectAnswer(activeQuestion.answer, activeQuestion.options.length);
                  const selectedLabel =
                    selectedIndex !== null && selectedIndex !== undefined
                      ? String.fromCharCode(65 + selectedIndex)
                      : '—';
                  const timeTaken = formatDuration(questionTimes[activeQuestion.id] ?? 0);
                  return (
                    <div className="pyp-meta-card">
                      <h3>Question details</h3>
                      <div className="pyp-meta-list">
                        <div>
                          <span>Year</span>
                          <strong>{meta.year ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Date</span>
                          <strong>{meta.date ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Shift</span>
                          <strong>{meta.shift ?? '—'}</strong>
                        </div>
                        <div>
                          <span>Your time</span>
                          <strong>{timeTaken}</strong>
                        </div>
                        <div>
                          <span>Avg time</span>
                          <strong>—</strong>
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
                  );
                })()}
              </aside>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
