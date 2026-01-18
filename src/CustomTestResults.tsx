import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, MinusCircle, Clock } from 'lucide-react';
import { renderLatexInHtml } from './utils/latex';

const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:3000/api';

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

interface CustomTestResultsProps {
  attemptId: string;
  onBack: () => void;
}

interface CustomQuestion {
  id: string;
  questionOrder: number;
  subject?: string | null;
  chapter?: string | null;
  difficulty?: string | null;
  questionHtml: string;
  questionType: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  correctAnswer: string;
  marksPositive: number;
  marksNegative: number;
}

interface CustomResponse {
  questionId: string;
  answer: string | null;
  answerStatus: string | null;
  timeSpent?: number | null;
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

function parseMcqAnswers(value: string) {
  if (!value) return [];
  const options = value
    .split(/[,\s/|]+/)
    .map(opt => opt.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(options)).sort();
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function QuestionNavBadge({
  number,
  status,
  isActive,
  onClick,
}: {
  number: number;
  status: 'correct' | 'incorrect' | 'unattempted';
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`exam-nav-badge ${status} ${isActive ? 'active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {number}
    </button>
  );
}

export function CustomTestResults({ attemptId, onBack }: CustomTestResultsProps) {
  const [loading, setLoading] = useState(true);
  const [testName, setTestName] = useState('');
  const [stats, setStats] = useState<{ correct: number; incorrect: number; unattempted: number; score: number; maxScore: number; timeTaken: number } | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [responses, setResponses] = useState<Map<string, CustomResponse>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const loadAttempt = async () => {
      setLoading(true);
      try {
        const data = await apiRequest(`/auth?action=custom-tests-attempt&attemptId=${attemptId}`);
        if (data.success) {
          setTestName(data.test.name);
          setQuestions(data.questions);
          setStats({
            correct: data.attempt.correct,
            incorrect: data.attempt.incorrect,
            unattempted: data.attempt.unattempted,
            score: data.attempt.totalScore,
            maxScore: data.attempt.maxScore || 0,
            timeTaken: data.attempt.timeTaken || 0,
          });
          const responseMap = new Map<string, CustomResponse>();
          data.responses.forEach((response: CustomResponse) => {
            responseMap.set(response.questionId, response);
          });
          setResponses(responseMap);
          setCurrentIndex(0);
        }
      } catch (error) {
        console.error('Failed to load custom test results', error);
      } finally {
        setLoading(false);
      }
    };

    loadAttempt();
  }, [attemptId]);

  const totalQuestions = questions.length;
  const accuracy = useMemo(() => {
    if (!stats || totalQuestions === 0) return 0;
    return Math.round((stats.correct / totalQuestions) * 100);
  }, [stats, totalQuestions]);

  const currentQuestion = questions[currentIndex];
  const currentResponse = currentQuestion ? responses.get(currentQuestion.id) : undefined;
  const isNat = currentQuestion ? currentQuestion.questionType.toUpperCase().includes('NAT') : false;
  const studentAnswer = currentResponse?.answer?.trim() ?? '';
  const answerStatus = (currentResponse?.answerStatus || 'unattempted') as 'correct' | 'incorrect' | 'unattempted';

  const getOptionClass = (label: string) => {
    if (!currentQuestion) return '';
    const correctAnswers = parseMcqAnswers(currentQuestion.correctAnswer);
    const isCorrect = correctAnswers.includes(label);
    const isSelected = studentAnswer.toUpperCase() === label;
    if (isCorrect && isSelected) return 'correct-selected';
    if (isCorrect) return 'correct-answer';
    if (isSelected) return 'wrong-answer';
    return '';
  };

  const handlePrev = () => {
    setCurrentIndex(prev => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    setCurrentIndex(prev => Math.min(prev + 1, totalQuestions - 1));
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container" style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <span className="spinner" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ChevronLeft size={18} /> Back to Home
          </button>
          <div className="alert alert-error">Unable to load results.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} /> Back to Home
        </button>

        <div className="custom-results-header">
          <div>
            <h1 className="page-title">{testName}</h1>
            <p className="page-subtitle">Custom test results</p>
          </div>
          <div className="custom-results-score">
            <span className="score-pill">{stats.score} / {stats.maxScore}</span>
          </div>
        </div>

        <div className="custom-results-summary">
          <div className="custom-results-card">
            <CheckCircle size={16} />
            <div>
              <div className="custom-results-label">Correct</div>
              <div className="custom-results-value">{stats.correct}</div>
            </div>
          </div>
          <div className="custom-results-card incorrect">
            <XCircle size={16} />
            <div>
              <div className="custom-results-label">Incorrect</div>
              <div className="custom-results-value">{stats.incorrect}</div>
            </div>
          </div>
          <div className="custom-results-card unattempted">
            <MinusCircle size={16} />
            <div>
              <div className="custom-results-label">Unattempted</div>
              <div className="custom-results-value">{stats.unattempted}</div>
            </div>
          </div>
          <div className="custom-results-card">
            <Clock size={16} />
            <div>
              <div className="custom-results-label">Time</div>
              <div className="custom-results-value">{formatTime(stats.timeTaken)}</div>
            </div>
          </div>
          <div className="custom-results-card">
            <CheckCircle size={16} />
            <div>
              <div className="custom-results-label">Accuracy</div>
              <div className="custom-results-value">{accuracy}%</div>
            </div>
          </div>
        </div>

        <div className="exam-panel-body custom-results-panel">
          <div className="exam-nav-panel">
            <div className="nav-header">
              <h3>Questions</h3>
              <div className="nav-stats">
                <span className="stat-answered">{stats.correct} correct</span>
                <span className="stat-incorrect">{stats.incorrect} incorrect</span>
                <span className="stat-unattempted">{stats.unattempted} skipped</span>
              </div>
            </div>

            <div className="nav-questions-scroll">
              <div className="nav-grid compact">
                {questions.map((question, idx) => (
                  <QuestionNavBadge
                    key={question.id}
                    number={idx + 1}
                    status={(responses.get(question.id)?.answerStatus || 'unattempted') as 'correct' | 'incorrect' | 'unattempted'}
                    isActive={idx === currentIndex}
                    onClick={() => setCurrentIndex(idx)}
                  />
                ))}
              </div>
            </div>

            <div className="nav-legend">
              <div className="legend-item">
                <span className="legend-dot correct"></span>
                <span>Correct</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot incorrect"></span>
                <span>Incorrect</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot unattempted"></span>
                <span>Skipped</span>
              </div>
            </div>
          </div>

          <div className="exam-main-content">
            {currentQuestion && (
              <>
                {typeof currentResponse?.timeSpent === 'number' && (
                  <div className="exam-question-stats-bar compact">
                    <div className="stat-item">
                      <Clock size={12} />
                      <span className="stat-label">Time</span>
                      <span className="stat-value">
                        {currentResponse.timeSpent >= 60
                          ? `${(currentResponse.timeSpent / 60).toFixed(1)}m`
                          : `${currentResponse.timeSpent}s`}
                      </span>
                    </div>
                  </div>
                )}

                <div className="exam-question-card custom-results-question-card">
                  <div className="exam-question-header">
                    <div className="question-meta">
                      <span className="question-number">Q{currentQuestion.questionOrder}</span>
                      <div className="question-tags">
                        {currentQuestion.subject && <span className="question-tag">{currentQuestion.subject}</span>}
                        {currentQuestion.chapter && <span className="question-tag">{currentQuestion.chapter}</span>}
                        {currentQuestion.difficulty && <span className="question-tag">{currentQuestion.difficulty}</span>}
                        <span className="question-tag">{currentQuestion.questionType.toUpperCase()}</span>
                      </div>
                      <span className={`question-status ${answerStatus}`}>
                        {answerStatus === 'correct' && <><CheckCircle size={14} /> Correct</>}
                        {answerStatus === 'incorrect' && <><XCircle size={14} /> Incorrect</>}
                        {answerStatus === 'unattempted' && <><MinusCircle size={14} /> Skipped</>}
                      </span>
                    </div>
                    <div className="question-marks">
                      <span className={answerStatus === 'correct' ? 'positive' : answerStatus === 'incorrect' ? 'negative' : ''}>
                        {answerStatus === 'correct' ? `+${currentQuestion.marksPositive}` : answerStatus === 'incorrect' ? `-${currentQuestion.marksNegative}` : '0'}
                      </span>
                      <span className="marks-possible">/ +{currentQuestion.marksPositive}</span>
                    </div>
                  </div>

                  <div
                    className="exam-question-body"
                    dangerouslySetInnerHTML={{ __html: renderLatexInHtml(currentQuestion.questionHtml) }}
                  />

                  {!isNat && (
                    <div className="exam-options">
                      {[
                        { label: 'A', content: currentQuestion.option1 },
                        { label: 'B', content: currentQuestion.option2 },
                        { label: 'C', content: currentQuestion.option3 },
                        { label: 'D', content: currentQuestion.option4 },
                      ]
                        .filter(option => option.content)
                        .map(option => (
                          <div key={option.label} className={`exam-option ${getOptionClass(option.label)}`}>
                            <span className="option-marker">{option.label}</span>
                            <div
                              className="option-text"
                              dangerouslySetInnerHTML={{ __html: renderLatexInHtml(option.content || '') }}
                            />
                          </div>
                        ))}
                    </div>
                  )}

                  <div className="exam-answer-info">
                    <div className="answer-item">
                      <span className="answer-label">Your Answer</span>
                      <span
                        className={`answer-value ${
                          !studentAnswer
                            ? 'skipped'
                            : isNat
                            ? matchesNumericalAnswer(studentAnswer, currentQuestion.correctAnswer)
                              ? 'correct'
                              : 'wrong'
                            : parseMcqAnswers(currentQuestion.correctAnswer).includes(studentAnswer.toUpperCase())
                            ? 'correct'
                            : 'wrong'
                        }`}
                      >
                        {studentAnswer || 'Not Attempted'}
                      </span>
                    </div>
                    <div className="answer-item">
                      <span className="answer-label">Correct Answer</span>
                      <span className="answer-value correct">
                        {isNat ? formatNumericalAnswer(currentQuestion.correctAnswer) : currentQuestion.correctAnswer.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="exam-nav-footer">
                  <button className="exam-nav-btn-large prev" onClick={handlePrev} disabled={currentIndex === 0}>
                    <ChevronLeft size={20} />
                    <span>Previous</span>
                  </button>
                  <div className="exam-nav-position">
                    <span className="current">{currentIndex + 1}</span>
                    <span className="separator">/</span>
                    <span className="total">{totalQuestions}</span>
                  </div>
                  <button
                    className="exam-nav-btn-large next"
                    onClick={handleNext}
                    disabled={currentIndex === totalQuestions - 1}
                  >
                    <span>Next</span>
                    <ChevronRight size={20} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
