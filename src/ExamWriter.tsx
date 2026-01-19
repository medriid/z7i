import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ChevronLeft, ChevronRight, Clock, CheckCircle, XCircle, MinusCircle,
  Flag, Eye, Play, Pause, RotateCcw, Send, Trophy,
  Sparkles, TrendingUp, Zap, X, BookOpen
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface Test {
  id: string;
  testId: string;
  testName: string;
  packageName: string;
  testType: string | null;
  timeLimit?: number; // in minutes, optional
  submitDate: string;
  timeTaken: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  totalScore: number;
  maxScore: number;
  rank: number | null;
  percentile: number | null;
  totalQuestions: number;
  subjects: Array<{ id: string; name: string; questionCount: number }> | null;
}

interface Question {
  id: string;
  z7iQuestionId: string;
  order: number;
  subject: string;
  type: string;
  questionHtml: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  correctAnswer: string;
  hasKeyChange: boolean;
  isBonus: boolean;
  bonusMarks: number;
  studentAnswer: string | null;
  status: string;
  marksPositive: number;
  marksNegative: number;
  scoreObtained: number;
  timeTaken: number | null;
}

interface UserAnswer {
  questionId: string;
  answer: string | null;
  flagged: boolean;
  timeSpent: number;
  visited: boolean;
}

interface ExamWriterProps {
  test: Test;
  onBack: () => void;
  onViewAnalysis: () => void;
}

function getSubjectPriority(subject: string): number {
  const s = subject.toLowerCase();
  if (s.includes('phy')) return 0;
  if (s.includes('che')) return 1;
  if (s.includes('mat') || s.includes('math')) return 2;
  return 3;
}

function getSubjectShortName(subject: string): string {
  const s = subject.toLowerCase();
  if (s.includes('phy')) return 'Physics';
  if (s.includes('che')) return 'Chemistry';
  if (s.includes('mat') || s.includes('math')) return 'Maths';
  return subject;
}

function sortQuestionsByPCM(questions: Question[]): Question[] {
  return [...questions].sort((a, b) => {
    const priorityA = getSubjectPriority(a.subject);
    const priorityB = getSubjectPriority(b.subject);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.order - b.order;
  });
}

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return response.json();
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

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        <X size={24} />
      </button>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="Enlarged view" className="lightbox-image" />
      </div>
      <div className="lightbox-hint">
        Click anywhere or press ESC to close
      </div>
    </div>
  );
}

function useImageLightbox() {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      e.stopPropagation();
      const src = (target as HTMLImageElement).src;
      setLightboxImage(src);
    }
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxImage(null);
  }, []);

  return { lightboxImage, handleImageClick, closeLightbox };
}

function QuestionStatusBadge({ 
  number, 
  status, 
  isActive, 
  onClick 
}: { 
  number: number; 
  status: 'answered' | 'flagged' | 'unattempted' | 'visited-unanswered'; 
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button 
      className={`exam-nav-badge ${status} ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      {number}
      {status === 'flagged' && <Flag size={8} className="badge-flag" />}
    </button>
  );
}

function TimerCircle({ elapsed, total }: { elapsed: number; total: number }) {
  const progress = Math.min((elapsed / total) * 100, 100);
  const remaining = Math.max(0, total - elapsed);
  const isWarning = remaining < 300; // Less than 5 minutes
  const isCritical = remaining < 60; // Less than 1 minute
  
  return (
    <div className={`timer-circle ${isWarning ? 'warning' : ''} ${isCritical ? 'critical' : ''}`}>
      <svg viewBox="0 0 36 36" className="timer-svg">
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
  showResult,
  isCorrect,
  wasSelected
}: { 
  label: string;
  html: string | null;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  showResult?: boolean;
  isCorrect?: boolean;
  wasSelected?: boolean;
}) {
  if (!html) return null;
  
  let className = 'exam-option';
  if (isSelected) className += ' selected immediate'; // 'immediate' for instant feedback
  if (disabled) className += ' disabled';
  if (showResult) {
    if (isCorrect) className += ' correct';
    else if (wasSelected && !isCorrect) className += ' incorrect';
  }
  
  return (
    <button 
      className={className}
      onClick={onClick}
      disabled={disabled}
      type="button"
      aria-pressed={isSelected}
    >
      <span className="option-label">{label}</span>
      <div 
        className="option-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isSelected && !showResult && <span className="option-selected-indicator" aria-hidden="true" />}
      {showResult && isCorrect && <CheckCircle size={18} className="option-icon correct" />}
      {showResult && wasSelected && !isCorrect && <XCircle size={18} className="option-icon incorrect" />}
    </button>
  );
}

function SubmissionOverlay({ 
  isVisible, 
  stage,
  results,
  onBack
}: { 
  isVisible: boolean;
  stage: 'submitting' | 'calculating' | 'results';
  results: {
    correct: number;
    incorrect: number;
    unattempted: number;
    score: number;
    maxScore: number;
    accuracy: number;
    timeTaken: number;
    improvement: number;
  } | null;
  onBack: () => void;
}) {
  if (!isVisible) return null;

  const pieData = results ? [
    { name: 'Correct', value: results.correct, color: 'var(--success)' },
    { name: 'Incorrect', value: results.incorrect, color: 'var(--error)' },
    { name: 'Unattempted', value: results.unattempted, color: 'var(--unattempted)' },
  ].filter(d => d.value > 0) : [];
  const animationId = results
    ? `${results.correct}-${results.incorrect}-${results.unattempted}`
    : 'empty';

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
              <Zap size={48} className="calc-icon" />
              <div className="calc-particles">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="particle" style={{ '--i': i } as React.CSSProperties}></div>
                ))}
              </div>
            </div>
            <h2>Calculating Results...</h2>
            <p>Analyzing your performance</p>
          </div>
        )}
        
        {stage === 'results' && results && (
          <div className="submission-stage results">
            <div className="results-card">
              <div className="results-header">
                <div className="results-trophy">
                  <Trophy size={40} />
                  <Sparkles size={20} className="sparkle sparkle-1" />
                  <Sparkles size={16} className="sparkle sparkle-2" />
                  <Sparkles size={14} className="sparkle sparkle-3" />
                </div>
                <h2>Exam Complete!</h2>
              </div>
              
              <div className="results-chart">
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      dataKey="value"
                      strokeWidth={0}
                      isAnimationActive
                      animationDuration={650}
                      animationEasing="ease-out"
                      animationId={animationId}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="chart-center">
                  <span className="chart-accuracy">{results.accuracy}%</span>
                  <span className="chart-label">Accuracy</span>
                </div>
              </div>
              
              <div className="results-stats">
                <div className="result-stat correct">
                  <CheckCircle size={16} />
                  <span className="stat-value">{results.correct}</span>
                  <span className="stat-label">Correct</span>
                </div>
                <div className="result-stat incorrect">
                  <XCircle size={16} />
                  <span className="stat-value">{results.incorrect}</span>
                  <span className="stat-label">Wrong</span>
                </div>
                <div className="result-stat unattempted">
                  <MinusCircle size={16} />
                  <span className="stat-value">{results.unattempted}</span>
                  <span className="stat-label">Skipped</span>
                </div>
              </div>
              
              <div className="results-score">
                <div className="score-main">
                  <span className="score-value">{results.score}</span>
                  <span className="score-max">/ {results.maxScore}</span>
                </div>
                <div className="score-time">
                  <Clock size={14} />
                  <span>Time: {formatTime(results.timeTaken)}</span>
                </div>
              </div>
              
              {results.improvement !== 0 && (
                <div className={`improvement-badge ${results.improvement > 0 ? 'positive' : 'negative'}`}>
                  <TrendingUp size={14} />
                  <span>
                    {results.improvement > 0 ? '+' : ''}{results.improvement} vs original
                  </span>
                </div>
              )}
              
              <button className="btn btn-primary results-back-btn" onClick={onBack}>
                <ChevronLeft size={16} />
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ExamWriter({ test, onBack, onViewAnalysis }: ExamWriterProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Map<string, UserAnswer>>(new Map());
  const [isPaused, setIsPaused] = useState(false);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStage, setSubmissionStage] = useState<'submitting' | 'calculating' | 'results'>('submitting');
  const [examResults, setExamResults] = useState<{
    correct: number;
    incorrect: number;
    unattempted: number;
    score: number;
    maxScore: number;
    accuracy: number;
    timeTaken: number;
    improvement: number;
  } | null>(null);
  const [examFinished, setExamFinished] = useState(false);
  
  const { lightboxImage, handleImageClick, closeLightbox } = useImageLightbox();
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const questionStartTime = useRef<number>(Date.now());

  useEffect(() => {
    const loadQuestions = async () => {
      setLoading(true);
      try {
        const data = await apiRequest(`/z7i?action=questions&attemptId=${test.id}`);
        if (data.success) {
          const sortedQuestions = sortQuestionsByPCM(data.questions);
          setQuestions(sortedQuestions);
          const initial = new Map<string, UserAnswer>();
          sortedQuestions.forEach((q: Question, idx: number) => {
            initial.set(q.id, { questionId: q.id, answer: null, flagged: false, timeSpent: 0, visited: idx === 0 });
          });
          setUserAnswers(initial);
        }
      } catch (err) {
        console.error('Failed to load questions:', err);
      } finally {
        setLoading(false);
      }
    };
    loadQuestions();
  }, [test.id]);

  useEffect(() => {
    if (questions.length > 0 && !examFinished) {
      const questionId = questions[currentIndex]?.id;
      if (questionId) {
        setUserAnswers(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(questionId);
          if (existing && !existing.visited) {
            newMap.set(questionId, { ...existing, visited: true });
          }
          return newMap;
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
    if (isStudyMode) {
      setIsPaused(true);
    }
  }, [isStudyMode]);

  useEffect(() => {
    questionStartTime.current = Date.now();
    return () => {
      if (questions.length > 0) {
        const questionId = questions[currentIndex]?.id;
        if (questionId) {
          const timeSpent = Math.floor((Date.now() - questionStartTime.current) / 1000);
          setUserAnswers(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(questionId);
            if (existing) {
              newMap.set(questionId, { ...existing, timeSpent: existing.timeSpent + timeSpent });
            }
            return newMap;
          });
        }
      }
    };
  }, [currentIndex, questions]);

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? userAnswers.get(currentQuestion.id) : null;
  
  const answered = Array.from(userAnswers.values()).filter(a => a.answer !== null).length;
  const flagged = Array.from(userAnswers.values()).filter(a => a.flagged).length;
  const unattempted = questions.length - answered;

  const handleSelectAnswer = (answer: string) => {
    if (!currentQuestion || examFinished) return;
    setUserAnswers(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(currentQuestion.id);
      newMap.set(currentQuestion.id, { 
        ...existing!, 
        answer: existing?.answer === answer ? null : answer 
      });
      return newMap;
    });
  };

  const handleToggleFlag = () => {
    if (!currentQuestion || examFinished) return;
    setUserAnswers(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(currentQuestion.id);
      newMap.set(currentQuestion.id, { ...existing!, flagged: !existing?.flagged });
      return newMap;
    });
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex(prev => prev + 1);
  };

  const handleSubmit = useCallback(async () => {
    setShowSubmitConfirm(false);
    setIsSubmitting(true);
    setSubmissionStage('submitting');

    let correct = 0;
    let incorrect = 0;
    let score = 0;

    const responses: Array<{
      z7iQuestionId: string;
      questionOrder: number;
      userAnswer: string | null;
      correctAnswer: string;
      status: string;
      marksObtained: number;
      marksPositive: number;
      marksNegative: number;
      timeSpent: number;
      wasFlagged: boolean;
      isBonus: boolean;
    }> = [];

    questions.forEach(q => {
      const userAnswer = userAnswers.get(q.id);
      let status = 'unattempted';
      let marksObtained = 0;

      if (q.isBonus) {
        if (userAnswer?.answer) {
          correct++;
          score += q.marksPositive;
          status = 'correct';
          marksObtained = q.marksPositive;
        }
      } else if (userAnswer?.answer) {
        const userAns = userAnswer.answer.trim();
        const correctAns = (q.correctAnswer || '').trim();
        
        const isCorrect = q.type.toUpperCase().includes('NAT') 
          ? matchesNumericalAnswer(userAns, correctAns)
          : userAns.toUpperCase() === correctAns.toUpperCase();

        if (isCorrect) {
          correct++;
          score += q.marksPositive;
          status = 'correct';
          marksObtained = q.marksPositive;
        } else {
          incorrect++;
          score -= q.marksNegative;
          status = 'incorrect';
          marksObtained = -q.marksNegative;
        }
      }

      responses.push({
        z7iQuestionId: q.z7iQuestionId,
        questionOrder: q.order,
        userAnswer: userAnswer?.answer || null,
        correctAnswer: q.correctAnswer,
        status,
        marksObtained,
        marksPositive: q.marksPositive,
        marksNegative: q.marksNegative,
        timeSpent: userAnswer?.timeSpent || 0,
        wasFlagged: userAnswer?.flagged || false,
        isBonus: q.isBonus
      });
    });

    const unattemptedCount = questions.length - correct - incorrect;
    const maxScore = questions.reduce((acc, q) => acc + q.marksPositive, 0);
    const accuracy = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const improvement = score - test.totalScore;

    try {
      const results = {
        correct,
        incorrect,
        unattempted: unattemptedCount,
        score,
        maxScore,
        timeTaken: elapsedTime,
        originalScore: test.totalScore,
        improvement,
        accuracy
      };

      await apiRequest('/z7i?action=save-revision', {
        method: 'POST',
        body: JSON.stringify({
          attemptId: test.id,
          responses,
          results
        })
      });
    } catch (err) {
      console.error('Failed to save revision:', err);
    }

    setSubmissionStage('calculating');
    await new Promise(resolve => setTimeout(resolve, 1000));

    setExamResults({
      correct,
      incorrect,
      unattempted: unattemptedCount,
      score,
      maxScore,
      accuracy,
      timeTaken: elapsedTime,
      improvement
    });

    setSubmissionStage('results');
    setExamFinished(true);
  }, [questions, userAnswers, elapsedTime, test.totalScore, test.id]);

  const getQuestionStatus = (questionId: string): 'answered' | 'flagged' | 'unattempted' | 'visited-unanswered' => {
    const answer = userAnswers.get(questionId);
    if (answer?.flagged) return 'flagged';
    if (answer?.answer) return 'answered';
    if (answer?.visited) return 'visited-unanswered';
    return 'unattempted';
  };

  if (loading) {
    return (
      <div className="exam-writer">
        <div className="exam-loading">
          <span className="spinner" />
          <p>Loading exam questions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="exam-writer">
      <div className="exam-writer-header">
        <button className="btn-back" onClick={onBack}>
          <ChevronLeft size={18} />
          <span>Exit</span>
        </button>
        
        <div className="exam-title-section">
          <h1 className="exam-title">{test.testName}</h1>
          <span className="exam-package">{test.packageName}</span>
        </div>
        
        <div className="exam-controls">
          <TimerCircle elapsed={elapsedTime} total={(test.timeLimit || 180) * 60} />
          <button 
            className={`btn-pause ${isPaused ? 'paused' : ''}`}
            onClick={() => setIsPaused(!isPaused)}
            disabled={examFinished}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className={`btn-study ${isStudyMode ? 'active' : ''}`}
            onClick={() => setIsStudyMode(prev => !prev)}
            disabled={examFinished}
            title="Toggle study mode"
          >
            <BookOpen size={16} />
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
            </div>
          </div>
          
          <div className="nav-questions-scroll">
            {['Physics', 'Chemistry', 'Maths'].map((subject, subjectIdx) => {
              const subjectQuestions = questions.filter(q => getSubjectShortName(q.subject) === subject);
              if (subjectQuestions.length === 0) return null;
              const startNum = subjectIdx * 25 + 1;
              const mcqQuestions = subjectQuestions.slice(0, 20);
              const natQuestions = subjectQuestions.slice(20);
              return (
                <div key={subject} className="nav-subject-section">
                  <div className="nav-subject-title">{subject}</div>
                  {mcqQuestions.length > 0 && (
                    <>
                      <div className="nav-type-label">MCQ</div>
                      <div className="nav-grid compact">
                        {mcqQuestions.map((q, idx) => {
                          const globalIdx = questions.findIndex(qq => qq.id === q.id);
                          return (
                            <QuestionStatusBadge
                              key={q.id}
                              number={startNum + idx}
                              status={getQuestionStatus(q.id)}
                              isActive={globalIdx === currentIndex}
                              onClick={() => setCurrentIndex(globalIdx)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                  {natQuestions.length > 0 && (
                    <>
                      <div className="nav-type-label">NAT</div>
                      <div className="nav-grid compact">
                        {natQuestions.map((q, idx) => {
                          const globalIdx = questions.findIndex(qq => qq.id === q.id);
                          return (
                            <QuestionStatusBadge
                              key={q.id}
                              number={startNum + 20 + idx}
                              status={getQuestionStatus(q.id)}
                              isActive={globalIdx === currentIndex}
                              onClick={() => setCurrentIndex(globalIdx)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
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
          
          <button 
            className="btn-submit-exam"
            onClick={() => setShowSubmitConfirm(true)}
            disabled={examFinished}
          >
            <Send size={16} />
            <span>Submit Exam</span>
          </button>
        </div>

        <div className="exam-question-panel">
          {currentQuestion && (() => {
            const subjectName = getSubjectShortName(currentQuestion.subject);
            const subjectOffset = subjectName === 'Physics' ? 0 : subjectName === 'Chemistry' ? 25 : 50;
            const subjectQuestions = questions.filter(q => getSubjectShortName(q.subject) === subjectName);
            const indexInSubject = subjectQuestions.findIndex(q => q.id === currentQuestion.id);
            const displayNumber = subjectOffset + indexInSubject + 1;
            
            return (
            <>
              <div className="question-header">
                <div className="question-meta">
                  <span className="question-number">Question {displayNumber}</span>
                  <span className="question-subject">{subjectName}</span>
                  {currentQuestion.isBonus ? (
                    <span className="question-bonus-badge" title="This is a bonus question - any answer gets full marks">
                      <Sparkles size={14} /> Bonus
                    </span>
                  ) : (
                    <span className="question-marks">+{currentQuestion.marksPositive} / -{currentQuestion.marksNegative}</span>
                  )}
                  {currentQuestion.hasKeyChange && (
                    <span className="question-keychange-badge" title="Answer key was changed for this question">
                      Key Changed
                    </span>
                  )}
                </div>
                <button 
                  className={`btn-flag ${currentAnswer?.flagged ? 'flagged' : ''}`}
                  onClick={handleToggleFlag}
                  disabled={examFinished}
                >
                  <Flag size={16} />
                </button>
              </div>
              
              <div className="question-content" onClick={handleImageClick}>
                <div 
                  className="question-html"
                  dangerouslySetInnerHTML={{ __html: currentQuestion.questionHtml }}
                />
              </div>
              
              <div className="options-container">
                {currentQuestion.type.toUpperCase().includes('NAT') ? (
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
                ) : (
                  <>
                    <OptionButton
                      label="A"
                      html={currentQuestion.option1}
                      isSelected={currentAnswer?.answer === 'A'}
                      onClick={() => handleSelectAnswer('A')}
                      disabled={examFinished}
                      showResult={examFinished}
                      isCorrect={currentQuestion.correctAnswer === 'A'}
                      wasSelected={currentAnswer?.answer === 'A'}
                    />
                    <OptionButton
                      label="B"
                      html={currentQuestion.option2}
                      isSelected={currentAnswer?.answer === 'B'}
                      onClick={() => handleSelectAnswer('B')}
                      disabled={examFinished}
                      showResult={examFinished}
                      isCorrect={currentQuestion.correctAnswer === 'B'}
                      wasSelected={currentAnswer?.answer === 'B'}
                    />
                    <OptionButton
                      label="C"
                      html={currentQuestion.option3}
                      isSelected={currentAnswer?.answer === 'C'}
                      onClick={() => handleSelectAnswer('C')}
                      disabled={examFinished}
                      showResult={examFinished}
                      isCorrect={currentQuestion.correctAnswer === 'C'}
                      wasSelected={currentAnswer?.answer === 'C'}
                    />
                    <OptionButton
                      label="D"
                      html={currentQuestion.option4}
                      isSelected={currentAnswer?.answer === 'D'}
                      onClick={() => handleSelectAnswer('D')}
                      disabled={examFinished}
                      showResult={examFinished}
                      isCorrect={currentQuestion.correctAnswer === 'D'}
                      wasSelected={currentAnswer?.answer === 'D'}
                    />
                  </>
                )}
              </div>

              {isStudyMode && (
                <div className="study-answer">
                  <span className="study-label">Correct Answer</span>
                  <span className="study-value">
                    {currentQuestion.type.toUpperCase().includes('NAT')
                      ? formatNumericalAnswer(currentQuestion.correctAnswer)
                      : currentQuestion.correctAnswer}
                  </span>
                </div>
              )}
              
              <div className="question-navigation">
                <button 
                  className="btn-nav prev"
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                >
                  <ChevronLeft size={18} />
                  <span>Previous</span>
                </button>
                
                {examFinished ? (
                  <button className="btn-nav results" onClick={onViewAnalysis}>
                    <Eye size={18} />
                    <span>View Full Analysis</span>
                  </button>
                ) : (
                  <button 
                    className="btn-clear"
                    onClick={() => handleSelectAnswer(currentAnswer?.answer || '')}
                    disabled={!currentAnswer?.answer}
                  >
                    <RotateCcw size={16} />
                    <span>Clear</span>
                  </button>
                )}
                
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
          );
          })()}
        </div>
      </div>

      {isPaused && (
        <div className="pause-overlay">
          <div className="pause-modal">
            <Pause size={48} />
            <h2>Exam Paused</h2>
            <p>Click resume to continue</p>
            <button className="btn-resume" onClick={() => setIsPaused(false)}>
              <Play size={18} />
              <span>Resume</span>
            </button>
          </div>
        </div>
      )}

      {showSubmitConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <Send size={48} className="confirm-icon" />
            <h2>Submit Exam?</h2>
            <div className="confirm-stats">
              <div className="confirm-stat">
                <span className="value">{answered}</span>
                <span className="label">Answered</span>
              </div>
              <div className="confirm-stat">
                <span className="value">{unattempted}</span>
                <span className="label">Unattempted</span>
              </div>
              <div className="confirm-stat">
                <span className="value">{flagged}</span>
                <span className="label">Flagged</span>
              </div>
            </div>
            {unattempted > 0 && (
              <p className="confirm-warning">You have {unattempted} unattempted questions!</p>
            )}
            <div className="confirm-actions">
              <button className="btn-cancel" onClick={() => setShowSubmitConfirm(false)}>
                Go Back
              </button>
              <button className="btn-confirm" onClick={handleSubmit}>
                <Send size={16} />
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      <SubmissionOverlay 
        isVisible={isSubmitting}
        stage={submissionStage}
        results={examResults}
        onBack={onBack}
      />

      {lightboxImage && (
        <ImageLightbox src={lightboxImage} onClose={closeLightbox} />
      )}
    </div>
  );
}

export default ExamWriter;
