import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  MinusCircle,
  Clock,
  Target,
  Eye,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { renderLatexInHtml } from './utils/latex';

import { API_BASE } from './lib/apiBase';

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

type ViewMode = 'analysis' | 'review';

export function CustomTestResults({ attemptId, onBack }: CustomTestResultsProps) {
  const [loading, setLoading] = useState(true);
  const [testName, setTestName] = useState('');
  const [stats, setStats] = useState<{
    correct: number;
    incorrect: number;
    unattempted: number;
    score: number;
    maxScore: number | null;
    timeTaken: number;
  } | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [responses, setResponses] = useState<Map<string, CustomResponse>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('analysis');
  const [passageExpanded, setPassageExpanded] = useState(true);

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
            maxScore: data.attempt.maxScore,
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
    const attempted = stats.correct + stats.incorrect;
    return attempted > 0 ? Math.round((stats.correct / attempted) * 100) : 0;
  }, [stats, totalQuestions]);

  /* -- Subject breakdown data (mirrors z7i TestAnalysis) -- */
  const subjectData = useMemo(() => {
    const subjectMap = new Map<string, CustomQuestion[]>();
    for (const q of questions) {
      const subj = q.subject || 'General';
      if (!subjectMap.has(subj)) subjectMap.set(subj, []);
      subjectMap.get(subj)!.push(q);
    }

    return Array.from(subjectMap.entries()).map(([name, qs]) => {
      const mcqQuestions = qs.filter(q => !q.questionType.toUpperCase().includes('NAT'));
      const natQuestions = qs.filter(q => q.questionType.toUpperCase().includes('NAT'));

      let correct = 0, incorrect = 0, unattempted = 0;
      let mcqScore = 0, mcqMax = 0, mcqCorrect = 0;
      let natScore = 0, natMax = 0, natCorrect = 0;
      let totalScore = 0, maxScore = 0;

      for (const q of qs) {
        const resp = responses.get(q.id);
        const status = (resp?.answerStatus || 'unattempted') as string;
        if (status === 'correct') { correct++; totalScore += q.marksPositive; }
        else if (status === 'incorrect') { incorrect++; totalScore -= q.marksNegative; }
        else unattempted++;
        maxScore += q.marksPositive;
      }

      for (const q of mcqQuestions) {
        const resp = responses.get(q.id);
        const status = (resp?.answerStatus || 'unattempted') as string;
        mcqMax += q.marksPositive;
        if (status === 'correct') { mcqCorrect++; mcqScore += q.marksPositive; }
        else if (status === 'incorrect') { mcqScore -= q.marksNegative; }
      }

      for (const q of natQuestions) {
        const resp = responses.get(q.id);
        const status = (resp?.answerStatus || 'unattempted') as string;
        natMax += q.marksPositive;
        if (status === 'correct') { natCorrect++; natScore += q.marksPositive; }
        else if (status === 'incorrect') { natScore -= q.marksNegative; }
      }

      const subjectAccuracy = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;

      return {
        name,
        shortName: name.substring(0, 3).toUpperCase(),
        correct,
        incorrect,
        unattempted,
        score: totalScore,
        maxScore,
        accuracy: subjectAccuracy,
        total: qs.length,
        mcq: { correct: mcqCorrect, total: mcqQuestions.length, score: mcqScore, max: mcqMax },
        nat: { correct: natCorrect, total: natQuestions.length, score: natScore, max: natMax },
      };
    });
  }, [questions, responses]);

  const performanceData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: 'Correct', value: stats.correct, color: 'var(--success)' },
      { name: 'Incorrect', value: stats.incorrect, color: 'var(--error)' },
      { name: 'Unattempted', value: stats.unattempted, color: 'var(--unattempted)' },
    ].filter(d => d.value > 0);
  }, [stats]);

  const barChartData = useMemo(() => {
    return subjectData.map(s => ({
      name: s.shortName,
      Score: s.score,
      Max: s.maxScore,
    }));
  }, [subjectData]);

  /* -- Question review state -- */
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

  const handlePrev = () => setCurrentIndex(prev => Math.max(prev - 1, 0));
  const handleNext = () => setCurrentIndex(prev => Math.min(prev + 1, totalQuestions - 1));

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

  /* ========= ANALYSIS VIEW ========= */
  if (viewMode === 'analysis') {
    return (
      <div className="page custom-results-page">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ChevronLeft size={18} /> Back to Home
          </button>

          <div className="analysis-container two-col">
            <div className="analysis-title-bar">
              <h2>{testName}</h2>
              <span>AI Generated Test</span>
            </div>

            <div className="analysis-grid">
              {/* -- Left Column -- */}
              <div className="analysis-left">
                <div className="score-overview">
                  <div className="hero-score-circle mini">
                    <ResponsiveContainer width={90} height={90}>
                      <PieChart>
                        <Pie
                          data={performanceData}
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={42}
                          dataKey="value"
                          strokeWidth={0}
                          isAnimationActive={false}
                        >
                          {performanceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="hero-score-center mini">
                      <div className="hero-score-value mini">{stats.maxScore != null ? stats.score : '—'}</div>
                      <div className="hero-score-max mini">{stats.maxScore != null ? `/${stats.maxScore}` : 'N/A'}</div>
                    </div>
                  </div>
                  <div className="quick-stats">
                    <div className="qs-item">
                      <Target size={12} />
                      <span className="qs-val">{stats.maxScore != null ? `${accuracy}%` : '—'}</span>
                      <span className="qs-lbl">Acc</span>
                    </div>
                    <div className="qs-item">
                      <Clock size={12} />
                      <span className="qs-val">{formatTime(stats.timeTaken)}</span>
                      <span className="qs-lbl">Time</span>
                    </div>
                    <div className="qs-item">
                      <CheckCircle size={12} />
                      <span className="qs-val">{totalQuestions}</span>
                      <span className="qs-lbl">Qs</span>
                    </div>
                  </div>
                  <div className="ciu-row">
                    <span className="ciu correct"><CheckCircle size={10} />{stats.correct}</span>
                    <span className="ciu incorrect"><XCircle size={10} />{stats.incorrect}</span>
                    <span className="ciu unattempted"><MinusCircle size={10} />{stats.unattempted}</span>
                  </div>
                </div>

                {/* Subject breakdown table */}
                {subjectData.length > 1 && (
                  <div className="subject-mini-table">
                    <div className="smt-header">
                      <span className="smt-subj">Subject</span>
                      <span className="smt-mcq">MCQ</span>
                      <span className="smt-nat">NAT</span>
                      <span className="smt-total">Total</span>
                      <span className="smt-pct">%</span>
                    </div>
                    {subjectData.map(s => (
                      <div key={s.name} className="smt-row">
                        <span className="smt-subj">{s.shortName}</span>
                        <span className="smt-mcq">
                          {s.mcq.total > 0 ? (
                            <><b>{s.mcq.score.toFixed(0)}</b><small>/{s.mcq.max}</small></>
                          ) : '-'}
                        </span>
                        <span className="smt-nat">
                          {s.nat.total > 0 ? (
                            <><b>{s.nat.score.toFixed(0)}</b><small>/{s.nat.max}</small></>
                          ) : '-'}
                        </span>
                        <span className="smt-total">
                          <b>{s.score.toFixed(0)}</b><small>/{s.maxScore}</small>
                        </span>
                        <span className={`smt-pct ${s.accuracy >= 70 ? 'good' : s.accuracy >= 40 ? 'med' : 'low'}`}>
                          {s.accuracy}%
                        </span>
                      </div>
                    ))}
                    {subjectData.length > 1 && (
                      <div className="smt-row total">
                        <span className="smt-subj">Total</span>
                        <span className="smt-mcq">
                          <b>{subjectData.reduce((sum, s) => sum + s.mcq.score, 0).toFixed(0)}</b>
                          <small>/{subjectData.reduce((sum, s) => sum + s.mcq.max, 0)}</small>
                        </span>
                        <span className="smt-nat">
                          <b>{subjectData.reduce((sum, s) => sum + s.nat.score, 0).toFixed(0)}</b>
                          <small>/{subjectData.reduce((sum, s) => sum + s.nat.max, 0)}</small>
                        </span>
                        <span className="smt-total">
                          <b>{stats.score}</b><small>/{stats.maxScore}</small>
                        </span>
                        <span className={`smt-pct ${accuracy >= 70 ? 'good' : accuracy >= 40 ? 'med' : 'low'}`}>
                          {accuracy}%
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* -- Right Column -- */}
              <div className="analysis-right">
                {/* Subject performance bar chart */}
                {subjectData.length > 1 && (
                  <div className="comparison-card">
                    <h3 className="card-title">
                      <BarChart3 size={14} />
                      Subject Performance
                    </h3>
                    <div className="comparison-chart">
                      <ResponsiveContainer width="100%" height={100}>
                        <BarChart data={barChartData} barGap={2} barCategoryGap="20%">
                          <XAxis
                            dataKey="name"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{
                              background: 'var(--card)',
                              border: '1px solid var(--border)',
                              borderRadius: '8px',
                              fontSize: '11px',
                            }}
                          />
                          <Bar dataKey="Score" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                          <Bar dataKey="Max" fill="var(--border-light)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="comparison-legend">
                      <span className="legend-item"><span className="legend-dot you"></span>Score</span>
                      <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--border-light)' }}></span>Max</span>
                    </div>
                  </div>
                )}

                {/* Question distribution mini-grid */}
                <div className="ctr-question-overview">
                  <h3 className="card-title">Question Map</h3>
                  <div className="ctr-question-grid">
                    {questions.map((q, idx) => {
                      const resp = responses.get(q.id);
                      const st = (resp?.answerStatus || 'unattempted') as string;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          className={`ctr-q-dot ${st}`}
                          title={`Q${idx + 1}: ${st}`}
                          onClick={() => { setCurrentIndex(idx); setViewMode('review'); }}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>
                  <div className="nav-legend" style={{ marginTop: '0.5rem' }}>
                    <div className="legend-item"><span className="legend-dot correct"></span><span>Correct</span></div>
                    <div className="legend-item"><span className="legend-dot incorrect"></span><span>Incorrect</span></div>
                    <div className="legend-item"><span className="legend-dot unattempted"></span><span>Skipped</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="analysis-actions">
              <button className="btn btn-primary review-btn" onClick={() => setViewMode('review')}>
                <Eye size={16} />
                Review Questions
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ========= QUESTION REVIEW VIEW ========= */
  return (
    <div className="page custom-results-page">
      <div className="container">
        <button className="back-btn" onClick={() => setViewMode('analysis')}>
          <ChevronLeft size={18} /> Back to Analysis
        </button>

        <div className="custom-results-header">
          <div>
            <h1 className="page-title">{testName}</h1>
            <p className="page-subtitle">Question Review</p>
          </div>
          <div className="custom-results-score">
            <span className="score-pill">{stats.score} / {stats.maxScore}</span>
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

                  {(() => {
                    const passageMatch = currentQuestion.questionHtml.match(/^<!-- PASSAGE -->([\s\S]*?)<!-- \/PASSAGE -->([\s\S]*)$/);
                    if (passageMatch) {
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
                              <div dangerouslySetInnerHTML={{ __html: renderLatexInHtml(passageMatch[1]) }} />
                            )}
                          </div>
                          <div className="exam-question-body" dangerouslySetInnerHTML={{ __html: renderLatexInHtml(passageMatch[2]) }} />
                        </>
                      );
                    }
                    return (
                      <div className="exam-question-body" dangerouslySetInnerHTML={{ __html: renderLatexInHtml(currentQuestion.questionHtml) }} />
                    );
                  })()}

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
