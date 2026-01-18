import { useEffect, useState } from 'react';
import { ChevronLeft, CheckCircle, XCircle, MinusCircle } from 'lucide-react';

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
  questionHtml: string;
  questionType: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  option4: string | null;
  correctAnswer: string;
}

interface CustomResponse {
  questionId: string;
  answer: string | null;
  answerStatus: string | null;
}

export function CustomTestResults({ attemptId, onBack }: CustomTestResultsProps) {
  const [loading, setLoading] = useState(true);
  const [testName, setTestName] = useState('');
  const [stats, setStats] = useState<{ correct: number; incorrect: number; unattempted: number; score: number; maxScore: number; timeTaken: number } | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [responses, setResponses] = useState<Map<string, CustomResponse>>(new Map());

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
        }
      } catch (error) {
        console.error('Failed to load custom test results', error);
      } finally {
        setLoading(false);
      }
    };

    loadAttempt();
  }, [attemptId]);

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
        </div>

        <div className="custom-results-questions">
          {questions.map(question => {
            const response = responses.get(question.id);
            return (
              <div key={question.id} className="custom-results-question">
                <div className="custom-results-question-header">
                  <span>Q{question.questionOrder}</span>
                  <span className={`status ${response?.answerStatus || 'unattempted'}`}>{response?.answerStatus || 'unattempted'}</span>
                </div>
                <div className="custom-results-question-body" dangerouslySetInnerHTML={{ __html: question.questionHtml }} />
                <div className="custom-results-answer-row">
                  <div>
                    <span className="custom-results-label">Your answer:</span>
                    <span className="custom-results-value">{response?.answer || '—'}</span>
                  </div>
                  <div>
                    <span className="custom-results-label">Correct answer:</span>
                    <span className="custom-results-value">{question.correctAnswer}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
