import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Pause,
  Play,
  RotateCcw,
  Send,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { renderLatexInHtml } from './utils/latex';

import { API_BASE } from './lib/apiBase';
import { ImageLightbox, useImageLightbox } from './components/ImageLightbox';

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  return res.json();
}

interface CustomQuestion {
  id: string;
  questionOrder: number;
  subject?: string | null;
  chapter?: string | null;
  difficulty?: string | null;
  questionType: string;
  questionHtml: string;
  diagramImageDataUrl?: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  correctAnswer: string;
  marksPositive: number;
  marksNegative: number;
}

interface CustomAttemptResponse {
  questionId: string;
  answer: string | null;
  flagged: boolean;
  timeSpent: number;
  visited: boolean;
}

interface CustomAttempt {
  id: string;
  status: 'in_progress' | 'submitted';
  timeTaken: number | null;
  currentQuestionIndex: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  totalScore: number;
  maxScore: number | null;
  accuracy: number | null;
}

interface CustomTestSummary {
  id: string;
  name: string;
  timeLimit: number;
  totalQuestions: number;
}

interface UserAnswer {
  questionId: string;
  answer: string | null;
  flagged: boolean;
  timeSpent: number;
  visited: boolean;
}

interface CustomExamWriterProps {
  testId: string;
  onBack: () => void;
  onSubmitted: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

function matchesNumericalAnswer(studentAnswer: string, correctAnswer: string): boolean {
  const studentValue = Number(studentAnswer);
  if (Number.isNaN(studentValue)) return false;
  const ranges = parseNumericRanges(correctAnswer);
  if (ranges.length === 0) {
    return studentAnswer.trim() === correctAnswer.trim();
  }
  return ranges.some(range => studentValue >= range.min && studentValue <= range.max);
}

function formatNumericalAnswer(answer: string): string {
  const ranges = parseNumericRanges(answer);
  if (ranges.length === 0) return answer;
  return ranges
    .map(range => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(', ');
}


function composeQuestionHtml(question: CustomQuestion): string {
  const baseHtml = question.questionHtml || '';
  const diagram = (question.diagramImageDataUrl || '').trim();
  if (!diagram || /<img\b/i.test(baseHtml)) return baseHtml;
  const imageTag = `<img src="${diagram}" alt="Question diagram" style="display:block;max-width:100%;height:auto;margin:0.6rem auto;background:#ffffff;padding:0.35rem;border:1px solid #e5e7eb;border-radius:0.4rem;" />`;
  const passageEndIdx = baseHtml.indexOf('<!-- /PASSAGE -->');
  if (passageEndIdx !== -1) {
    const insertAt = passageEndIdx + '<!-- /PASSAGE -->'.length;
    return baseHtml.slice(0, insertAt) + imageTag + baseHtml.slice(insertAt);
  }
  return `${imageTag}${baseHtml}`;
}

function getSubjectShortName(subject?: string | null): 'Physics' | 'Chemistry' | 'Maths' | 'Other' {
  const subjectUpper = (subject || '').toUpperCase();
  if (subjectUpper.includes('PHY')) return 'Physics';
  if (subjectUpper.includes('CHE')) return 'Chemistry';
  if (subjectUpper.includes('MAT')) return 'Maths';
  return 'Other';
}

function TimerCircle({ elapsed, total }: { elapsed: number; total: number }) {
  const remaining = Math.max(total - elapsed, 0);
  const progress = total > 0 ? (remaining / total) * 100 : 0;
  return (
    <div className="timer-circle">
      <svg viewBox="0 0 36 36">
        <path
          className="timer-bg"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path
          className="timer-progress"
          strokeDasharray={`${progress}, 100`}
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
      </svg>
      <div className="timer-content">
        <Clock size={14} />
        <span className="timer-value">{formatTime(remaining)}</span>
      </div>
    </div>
  );
}

function OptionButton({
  label,
  html,
  isSelected,
  onClick,
  disabled,
  onImageClick,
}: {
  label: string;
  html: string | null;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  onImageClick?: (e: React.MouseEvent) => void;
}) {
  if (!html) return null;

  let className = 'exam-option';
  if (isSelected) className += ' selected immediate';
  if (disabled) className += ' disabled';

  return (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-pressed={isSelected}
    >
      <span className="option-label">{label}</span>
      <div className="option-content invert-images clickable-images" onClick={onImageClick} dangerouslySetInnerHTML={{ __html: renderLatexInHtml(html) }} />
      {isSelected && <span className="option-selected-indicator" aria-hidden="true" />}
    </button>
  );
}

function QuestionStatusBadge({
  number,
  status,
  isActive,
  onClick,
}: {
  number: number;
  status: 'answered' | 'flagged' | 'unattempted' | 'visited-unanswered';
  isActive: boolean;
  onClick: () => void;
}) {
  const statusLabel = status === 'answered'
    ? 'Answered'
    : status === 'flagged'
      ? 'Flagged'
      : status === 'visited-unanswered'
        ? 'Seen'
        : 'Not visited';

  return (
    <button
      className={`exam-nav-badge ${status} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="exam-nav-badge-number">{number}</span>
      <span className="exam-nav-badge-status">{statusLabel}</span>
      {status === 'flagged' && <Flag size={10} className="badge-flag" />}
    </button>
  );
}

function SubmissionOverlay({
  isVisible,
  stage,
  results,
  onBack,
}: {
  isVisible: boolean;
  stage: 'submitting' | 'calculating' | 'results';
  results: {
    correct: number;
    incorrect: number;
    unattempted: number;
    score: number;
    maxScore: number | null;
    accuracy: number | null;
    timeTaken: number;
    hasSubjective?: boolean;
  } | null;
  onBack: () => void;
}) {
  if (!isVisible) return null;

  const pieData = results
    ? [
        { name: 'Correct', value: results.correct, color: 'var(--success)' },
        { name: 'Incorrect', value: results.incorrect, color: 'var(--error)' },
        { name: 'Unattempted', value: results.unattempted, color: 'var(--unattempted)' },
      ].filter(d => d.value > 0)
    : [];

  return (
    <div className="submission-overlay">
      <div className="submission-modal">
        {stage === 'submitting' && (
          <div className="submission-stage submitting">
            <div className="submit-animation">
              <Send size={48} className="submit-icon" />
              <div className="submit-rings">
                <div className="ring ring-1"></div>
                <div className="ring ring-2"></div>
                <div className="ring ring-3"></div>
              </div>
            </div>
            <h2>Submitting Exam...</h2>
            <p>Please wait while we save your responses</p>
          </div>
        )}

        {stage === 'calculating' && (
          <div className="submission-stage calculating">
            <div className="calc-animation">
              <Send size={48} className="calc-icon" />
            </div>
            <h2>Calculating Results...</h2>
            <p>Scoring your attempt</p>
          </div>
        )}

        {stage === 'results' && results && (
          <div className="submission-stage results">
            <div className="results-header">
              <h2>Your Results</h2>
              <p>Completed in {formatTime(results.timeTaken)}</p>
            </div>

            <div className="results-score">
              <div className="score-circle">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={40} outerRadius={55} strokeWidth={0}>
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="score-center">
                  <span className="score-value">{results.accuracy != null ? `${results.accuracy}%` : '—'}</span>
                  <span className="score-label">{results.hasSubjective ? 'Not graded' : 'Accuracy'}</span>
                </div>
              </div>
              <div className="score-breakdown">
                {results.hasSubjective && (
                  <div className="score-item" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                    This paper contains subjective questions — marks are not counted.
                  </div>
                )}
                <div className="score-item">
                  <span className="score-label">Score</span>
                  <span className="score-value">
                    {results.maxScore != null ? `${results.score} / ${results.maxScore}` : 'N/A'}
                  </span>
                </div>
                <div className="score-item correct">
                  <span className="score-label">Correct</span>
                  <span className="score-value">{results.correct}</span>
                </div>
                <div className="score-item incorrect">
                  <span className="score-label">Incorrect</span>
                  <span className="score-value">{results.incorrect}</span>
                </div>
                <div className="score-item unattempted">
                  <span className="score-label">Unattempted</span>
                  <span className="score-value">{results.unattempted}</span>
                </div>
              </div>
            </div>

            <button className="btn btn-primary results-back-btn" onClick={onBack}>
              <ChevronLeft size={16} />
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CustomExamWriter({ testId, onBack, onSubmitted }: CustomExamWriterProps) {
  const [test, setTest] = useState<CustomTestSummary | null>(null);
  const [attempt, setAttempt] = useState<CustomAttempt | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Map<string, UserAnswer>>(new Map());
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<'submitting' | 'calculating' | 'results'>('submitting');
  const [examResults, setExamResults] = useState<{
    correct: number;
    incorrect: number;
    unattempted: number;
    score: number;
    maxScore: number | null;
    accuracy: number | null;
    timeTaken: number;
    hasSubjective?: boolean;
  } | null>(null);
  const [examFinished, setExamFinished] = useState(false);
  const [passageExpanded, setPassageExpanded] = useState(true);

  const { lightboxState, handleImageClick, closeLightbox } = useImageLightbox();

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const questionStartTime = useRef<number>(Date.now());
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    document.body.classList.add('immersive-view');
    return () => {
      document.body.classList.remove('immersive-view');
    };
  }, []);

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? userAnswers.get(currentQuestion.id) : null;


  const answered = useMemo(() => Array.from(userAnswers.values()).filter(a => a.answer !== null).length, [userAnswers]);
  const flagged = useMemo(() => Array.from(userAnswers.values()).filter(a => a.flagged).length, [userAnswers]);
  const unattempted = Math.max(questions.length - answered, 0);

  const groupedQuestions = useMemo(() => {
    const subjectOrder: Array<'Physics' | 'Chemistry' | 'Maths' | 'Other'> = ['Physics', 'Chemistry', 'Maths', 'Other'];
    const buckets = new Map(subjectOrder.map((subject) => [subject, [] as Array<{ question: CustomQuestion; index: number }> ]));

    questions.forEach((question, index) => {
      const subject = getSubjectShortName(question.subject);
      buckets.get(subject)?.push({ question, index });
    });

    return subjectOrder
      .map((subject) => {
        const list = buckets.get(subject) || [];
        if (list.length === 0) return null;
        const qTypeUpper = (q: CustomQuestion) => (q.questionType || '').toUpperCase();
        const mcq = list.filter(({ question }) => {
          const t = qTypeUpper(question);
          return !t.includes('NAT') && !t.includes('NUMERICAL') && !t.includes('SUBJECTIVE') && !t.includes('DESCRIPTIVE');
        });
        const nat = list.filter(({ question }) => {
          const t = qTypeUpper(question);
          return t.includes('NAT') || t.includes('NUMERICAL') || t.includes('INTEGER');
        });
        const subjective = list.filter(({ question }) => {
          const t = qTypeUpper(question);
          return t.includes('SUBJECTIVE') || t.includes('DESCRIPTIVE');
        });
        return { subject, mcq, nat, subjective };
      })
      .filter((group): group is { subject: 'Physics' | 'Chemistry' | 'Maths' | 'Other'; mcq: Array<{ question: CustomQuestion; index: number }>; nat: Array<{ question: CustomQuestion; index: number }>; subjective: Array<{ question: CustomQuestion; index: number }> } => Boolean(group));
  }, [questions]);

  const scheduleSave = useCallback((nextAnswers: Map<string, UserAnswer>, nextIndex = currentIndex, nextElapsed = elapsedTime) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      if (!attempt || examFinished) return;
      const payload = Array.from(nextAnswers.values()).map(answer => ({
        questionId: answer.questionId,
        answer: answer.answer,
        flagged: answer.flagged,
        timeSpent: answer.timeSpent,
        visited: answer.visited,
      }));
      await apiRequest('/auth?action=custom-tests-save-progress', {
        method: 'POST',
        body: JSON.stringify({
          attemptId: attempt.id,
          elapsedTime: nextElapsed,
          currentQuestionIndex: nextIndex,
          responses: payload,
        }),
      });
    }, 800);
  }, [attempt, currentIndex, elapsedTime, examFinished]);

  const commitTimeForCurrent = useCallback(() => {
    if (!currentQuestion) return;
    const timeSpent = Math.floor((Date.now() - questionStartTime.current) / 1000);
    setUserAnswers(prev => {
      const next = new Map(prev);
      const existing = next.get(currentQuestion.id);
      if (existing) {
        next.set(currentQuestion.id, {
          ...existing,
          timeSpent: existing.timeSpent + timeSpent,
        });
      }
      return next;
    });
    questionStartTime.current = Date.now();
  }, [currentQuestion]);

  useEffect(() => {
    const loadExam = async () => {
      setLoading(true);
      try {
        const data = await apiRequest('/auth?action=custom-tests-start', {
          method: 'POST',
          body: JSON.stringify({ testId }),
        });
        if (data.success) {
          const fetchedTest = data.test as CustomTestSummary;
          const fetchedAttempt = data.attempt as CustomAttempt & { responses?: CustomAttemptResponse[] };
          const fetchedQuestions = data.questions as CustomQuestion[];
          setTest(fetchedTest);
          setAttempt(fetchedAttempt);
          setQuestions(fetchedQuestions);
          setCurrentIndex(fetchedAttempt.currentQuestionIndex || 0);
          setElapsedTime(fetchedAttempt.timeTaken || 0);
          const initial = new Map<string, UserAnswer>();
          fetchedQuestions.forEach((question, idx) => {
            const existing = fetchedAttempt.responses?.find((response: CustomAttemptResponse) => response.questionId === question.id);
            initial.set(question.id, {
              questionId: question.id,
              answer: existing?.answer ?? null,
              flagged: existing?.flagged ?? false,
              timeSpent: existing?.timeSpent ?? 0,
              visited: existing?.visited ?? idx === 0,
            });
          });
          setUserAnswers(initial);
          if (fetchedAttempt.status === 'submitted') {
            setExamFinished(true);
            setExamResults({
              correct: fetchedAttempt.correct,
              incorrect: fetchedAttempt.incorrect,
              unattempted: fetchedAttempt.unattempted,
              score: fetchedAttempt.totalScore,
              maxScore: fetchedAttempt.maxScore || 0,
              accuracy: fetchedAttempt.accuracy || 0,
              timeTaken: fetchedAttempt.timeTaken || 0,
            });
            setSubmissionStage('results');
          }
        }
      } catch (error) {
        console.error('Failed to load custom test', error);
      } finally {
        setLoading(false);
      }
    };

    loadExam();
  }, [testId]);

  useEffect(() => {
    if (questions.length > 0 && !examFinished) {
      const questionId = questions[currentIndex]?.id;
      if (questionId) {
        setUserAnswers(prev => {
          const next = new Map(prev);
          const existing = next.get(questionId);
          if (existing && !existing.visited) {
            next.set(questionId, { ...existing, visited: true });
          }
          return next;
        });
      }
    }
  }, [currentIndex, questions, examFinished]);

  useEffect(() => {
    if (!isPaused && !examFinished) {
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, examFinished]);

  useEffect(() => {
    questionStartTime.current = Date.now();
    return () => {
      commitTimeForCurrent();
    };
  }, [currentIndex, commitTimeForCurrent]);

  useEffect(() => {
    if (!attempt || examFinished) return;
    scheduleSave(userAnswers, currentIndex, elapsedTime);
  }, [userAnswers, currentIndex, elapsedTime, attempt, examFinished, scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const handleSelectAnswer = (answer: string) => {
    if (!currentQuestion || examFinished) return;
    setUserAnswers(prev => {
      const next = new Map(prev);
      const existing = next.get(currentQuestion.id);
      next.set(currentQuestion.id, {
        ...existing!,
        answer: existing?.answer === answer ? null : answer,
      });
      return next;
    });
  };

  const handleToggleFlag = () => {
    if (!currentQuestion || examFinished) return;
    setUserAnswers(prev => {
      const next = new Map(prev);
      const existing = next.get(currentQuestion.id);
      next.set(currentQuestion.id, { ...existing!, flagged: !existing?.flagged });
      return next;
    });
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      commitTimeForCurrent();
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      commitTimeForCurrent();
      setCurrentIndex(prev => prev + 1);
    }
  };

  const getQuestionStatus = (questionId: string): 'answered' | 'flagged' | 'unattempted' | 'visited-unanswered' => {
    const answer = userAnswers.get(questionId);
    if (answer?.flagged) return 'flagged';
    if (answer?.answer) return 'answered';
    if (answer?.visited) return 'visited-unanswered';
    return 'unattempted';
  };

  const handleSubmit = useCallback(async () => {
    if (!attempt) return;
    setShowSubmitConfirm(false);
    setIsSubmitting(true);
    setSubmissionStage('submitting');

    commitTimeForCurrent();

    const payload = Array.from(userAnswers.values()).map(answer => ({
      questionId: answer.questionId,
      answer: answer.answer,
      flagged: answer.flagged,
      timeSpent: answer.timeSpent,
      visited: answer.visited,
    }));

    await apiRequest('/auth?action=custom-tests-save-progress', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: attempt.id,
        elapsedTime,
        currentQuestionIndex: currentIndex,
        responses: payload,
      }),
    });

    try {
      const response = await apiRequest('/auth?action=custom-tests-submit', {
        method: 'POST',
        body: JSON.stringify({ attemptId: attempt.id, elapsedTime }),
      });

      if (response.success) {
        setSubmissionStage('calculating');
        await new Promise(resolve => setTimeout(resolve, 900));
        setExamResults(response.results);
        setSubmissionStage('results');
        setExamFinished(true);
        onSubmitted();
      }
    } catch (error) {
      console.error('Failed to submit custom test', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [attempt, commitTimeForCurrent, currentIndex, elapsedTime, onSubmitted, userAnswers]);

  const handleExit = async () => {
    if (attempt && !examFinished) {
      const payload = Array.from(userAnswers.values()).map(answer => ({
        questionId: answer.questionId,
        answer: answer.answer,
        flagged: answer.flagged,
        timeSpent: answer.timeSpent,
        visited: answer.visited,
      }));
      await apiRequest('/auth?action=custom-tests-save-progress', {
        method: 'POST',
        body: JSON.stringify({
          attemptId: attempt.id,
          elapsedTime,
          currentQuestionIndex: currentIndex,
          responses: payload,
        }),
      });
    }
    onBack();
  };

  if (loading) {
    return (
      <div className="exam-writer">
        <div className="exam-loading">
          <span className="spinner" />
          <p>Loading custom exam...</p>
        </div>
      </div>
    );
  }

  if (!test || !attempt) {
    return (
      <div className="exam-writer">
        <div className="exam-loading">
          <p>Unable to load custom test.</p>
          <button className="btn btn-secondary" onClick={onBack}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="exam-writer">
      <div className="exam-writer-header">
        <button className="btn-back" onClick={handleExit}>
          <ChevronLeft size={18} />
          <span>Exit</span>
        </button>

        <div className="exam-title-section">
          <h1 className="exam-title">{test.name}</h1>
          <span className="exam-package">Custom Test</span>
          <span className="exam-progress">
            Question {currentIndex + 1} / {questions.length}
          </span>
        </div>

        <div className="exam-controls">
          <TimerCircle elapsed={elapsedTime} total={(test.timeLimit || 60) * 60} />
          <button
            className={`btn-pause ${isPaused ? 'paused' : ''}`}
            onClick={() => setIsPaused(!isPaused)}
            disabled={examFinished}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        </div>
      </div>

      <div className="exam-writer-content">
        <div className="exam-nav-panel">
          <div className="nav-header">
            <h3>Questions</h3>
            <div className="nav-stats">
              <span className="stat-answered">{answered} answered</span>
              <span className="stat-flagged">{flagged} flagged</span>
              <span className="stat-unattempted">{unattempted} left</span>
            </div>
          </div>

          <div className="nav-questions-scroll">
            {groupedQuestions.map((group) => (
              <div key={group.subject} className="nav-subject-section">
                <div className="nav-subject-title">{group.subject}</div>
                {group.mcq.length > 0 && (
                  <>
                    <div className="nav-type-label">MCQ</div>
                    <div className="nav-grid compact">
                      {group.mcq.map(({ question, index }) => (
                        <QuestionStatusBadge
                          key={question.id}
                          number={index + 1}
                          status={getQuestionStatus(question.id)}
                          isActive={index === currentIndex}
                          onClick={() => setCurrentIndex(index)}
                        />
                      ))}
                    </div>
                  </>
                )}
                {group.nat.length > 0 && (
                  <>
                    <div className="nav-type-label">NAT</div>
                    <div className="nav-grid compact">
                      {group.nat.map(({ question, index }) => (
                        <QuestionStatusBadge
                          key={question.id}
                          number={index + 1}
                          status={getQuestionStatus(question.id)}
                          isActive={index === currentIndex}
                          onClick={() => setCurrentIndex(index)}
                        />
                      ))}
                    </div>
                  </>
                )}
                {group.subjective.length > 0 && (
                  <>
                    <div className="nav-type-label">Subjective</div>
                    <div className="nav-grid compact">
                      {group.subjective.map(({ question, index }) => (
                        <QuestionStatusBadge
                          key={question.id}
                          number={index + 1}
                          status={getQuestionStatus(question.id)}
                          isActive={index === currentIndex}
                          onClick={() => setCurrentIndex(index)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="nav-legend">
            <div className="legend-item">
              <span className="legend-dot answered"></span>
              <span>Answered</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot visited-unanswered"></span>
              <span>Seen</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot flagged"></span>
              <span>Flagged</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot unattempted"></span>
              <span>Not Visited</span>
            </div>
          </div>
        </div>

        <div className="exam-question-panel">
          {currentQuestion && (
            <>
              <div className="question-header">
                <div className="question-meta">
                  <span className="question-number">Question {currentQuestion.questionOrder}</span>
                  <div className="question-tags">
                    {currentQuestion.subject && <span className="question-tag">{currentQuestion.subject}</span>}
                    {currentQuestion.chapter && <span className="question-tag">{currentQuestion.chapter}</span>}
                    {currentQuestion.difficulty && <span className="question-tag">{currentQuestion.difficulty}</span>}
                    <span className="question-tag">{currentQuestion.questionType.toUpperCase()}</span>
                  </div>
                  <span className="question-marks">+{currentQuestion.marksPositive} / -{currentQuestion.marksNegative}</span>
                </div>
                <button
                  className={`btn-flag ${currentAnswer?.flagged ? 'flagged' : ''}`}
                  onClick={handleToggleFlag}
                  disabled={examFinished}
                >
                  <Flag size={16} />
                </button>
              </div>

              <div className="question-content invert-images clickable-images" onClick={handleImageClick}>
                {(() => {
                  const fullQuestionHtml = composeQuestionHtml(currentQuestion);
                  const passageMatch = fullQuestionHtml.match(/^<!-- PASSAGE -->([\s\S]*?)<!-- \/PASSAGE -->([\s\S]*)$/);
                  if (passageMatch) {
                    const passageHtml = passageMatch[1];
                    const questionHtml = passageMatch[2];
                    return (
                      <>
                        <div className={`case-study-passage ${passageExpanded ? '' : 'collapsed'}`}>
                          <button
                            type="button"
                            className="passage-toggle-btn"
                            onClick={() => setPassageExpanded(prev => !prev)}
                          >
                            {passageExpanded ? 'Hide Passage ▲' : 'Show Passage ▼'}
                          </button>
                          {passageExpanded && (
                            <div className="invert-images clickable-images" onClick={handleImageClick} dangerouslySetInnerHTML={{ __html: renderLatexInHtml(passageHtml) }} />
                          )}
                        </div>
                        <div className="question-html invert-images clickable-images" onClick={handleImageClick} dangerouslySetInnerHTML={{ __html: renderLatexInHtml(questionHtml) }} />
                      </>
                    );
                  }
                  return (
                    <div className="question-html invert-images clickable-images" onClick={handleImageClick} dangerouslySetInnerHTML={{ __html: renderLatexInHtml(fullQuestionHtml) }} />
                  );
                })()}
              </div>

              <div className="options-container">
                {(() => {
                  const qType = currentQuestion.questionType.toUpperCase();
                  const isSubjective = qType.includes('SUBJECTIVE') || qType.includes('DESCRIPTIVE');
                  const isNat = qType.includes('NAT') || qType.includes('NUMERICAL') || qType.includes('INTEGER');

                  if (isSubjective) {
                    return (
                      <div className="subjective-notice">
                        <div className="subjective-notice-text">
                          This is a subjective question. Answer on paper — it will not be graded digitally.
                        </div>
                      </div>
                    );
                  }

                  if (isNat) {
                    return (
                      <div className="nat-input-container">
                        <label className="nat-label">Enter your answer:</label>
                        <input
                          type="number"
                          className="nat-input"
                          value={currentAnswer?.answer || ''}
                          onChange={(e) => handleSelectAnswer(e.target.value)}
                          disabled={examFinished}
                          placeholder="Enter numeric value"
                          step="any"
                        />
                        {examFinished && currentAnswer?.answer && (
                          <div className="nat-result">
                            {matchesNumericalAnswer(currentAnswer.answer, currentQuestion.correctAnswer) ? (
                              <div className="nat-feedback correct">
                                <CheckCircle size={18} />
                                <span>Correct!</span>
                              </div>
                            ) : (
                              <div className="nat-feedback incorrect">
                                <XCircle size={18} />
                                <span>Incorrect. Answer: {formatNumericalAnswer(currentQuestion.correctAnswer)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      <OptionButton
                        label="A"
                        html={currentQuestion.option1}
                        isSelected={currentAnswer?.answer === 'A'}
                        onClick={() => handleSelectAnswer('A')}
                        disabled={examFinished}
                        onImageClick={handleImageClick}
                      />
                      <OptionButton
                        label="B"
                        html={currentQuestion.option2}
                        isSelected={currentAnswer?.answer === 'B'}
                        onClick={() => handleSelectAnswer('B')}
                        disabled={examFinished}
                        onImageClick={handleImageClick}
                      />
                      <OptionButton
                        label="C"
                        html={currentQuestion.option3}
                        isSelected={currentAnswer?.answer === 'C'}
                        onClick={() => handleSelectAnswer('C')}
                        disabled={examFinished}
                        onImageClick={handleImageClick}
                      />
                      <OptionButton
                        label="D"
                        html={currentQuestion.option4}
                        isSelected={currentAnswer?.answer === 'D'}
                        onClick={() => handleSelectAnswer('D')}
                        disabled={examFinished}
                        onImageClick={handleImageClick}
                      />
                    </>
                  );
                })()}
              </div>

              <div className="question-navigation">
                <button className="btn-nav prev" onClick={handlePrev} disabled={currentIndex === 0}>
                  <ChevronLeft size={18} />
                  <span>Previous</span>
                </button>

                <button
                  className="btn-clear"
                  onClick={() => handleSelectAnswer(currentAnswer?.answer || '')}
                  disabled={!currentAnswer?.answer}
                >
                  <RotateCcw size={16} />
                  Clear Answer
                </button>

                <button
                  className="btn-submit-exam"
                  onClick={() => setShowSubmitConfirm(true)}
                  disabled={examFinished}
                >
                  <Send size={16} />
                  <span>Submit</span>
                </button>

                <button
                  className="btn-nav next"
                  onClick={handleNext}
                  disabled={currentIndex === questions.length - 1}
                >
                  <span>Next</span>
                  <ChevronRight size={18} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showSubmitConfirm && (
        <div className="submit-confirm-overlay">
          <div className="submit-confirm-modal">
            <h3>Submit Exam?</h3>
            <p>Please confirm before final submission.</p>
            <div className="confirm-stats">
              <div className="confirm-stat">
                <span className="value">{questions.length}</span>
                <span className="label">Total</span>
              </div>
              <div className="confirm-stat">
                <span className="value">{answered}</span>
                <span className="label">Answered</span>
              </div>
              <div className="confirm-stat">
                <span className="value">{flagged}</span>
                <span className="label">Flagged</span>
              </div>
            </div>
            <div className="submit-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowSubmitConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
                Submit Now
              </button>
            </div>
          </div>
        </div>
      )}


      {lightboxState && (
        <ImageLightbox
          src={lightboxState.src}
          shouldInvert={lightboxState.shouldInvert}
          onClose={closeLightbox}
        />
      )}

      <SubmissionOverlay
        isVisible={examFinished}
        stage={submissionStage}
        results={examResults}
        onBack={handleExit}
      />
    </div>
  );
}
