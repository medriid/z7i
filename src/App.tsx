import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { 
  ResponsiveContainer, 
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip
} from 'recharts';
import { 
  RefreshCw, LogOut, Link2, ChevronLeft, Clock, Target, Award, 
  TrendingUp, CheckCircle, XCircle, MinusCircle, BarChart3, 
  FileText, User, Eye, Bookmark, StickyNote,
  MessageCircle, X, Send, ChevronRight, Users, Timer, Trash2, Gift, Shield, Trophy, Medal, Edit3,
  Search, PenTool, MessageSquare, Settings, Key, Mail, AlertTriangle, Unlink, Save, Plus, List,
  Sun, Moon, Filter, RotateCcw, Shuffle, Download, Share2, Copy, Brain, Layers, Zap, Sparkles, Palette, Pin
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderLatexInHtml } from './utils/latex';
import { ExamWriter } from './ExamWriter';
import { CustomExamWriter } from './CustomExamWriter';
import { CustomTestResults } from './CustomTestResults';
import PastYearPapers from './PastYearPapers';
import { NotFound } from './NotFound';
import { OwnerDashboard } from './OwnerDashboard';
import './index.css';
import './test-card-blur.css';

import { AiDoubtPrompt } from './AiDoubtPrompt';

const VALID_ROUTES = ['/', '/dashboard', '/bookmarks', '/forum', '/pyp', '/time-intel', '/owner', '/ai-chats'];

function isValidRoute(path: string): boolean {
  if (VALID_ROUTES.includes(path)) return true;
  if (path.startsWith('/test/')) return true;
  return false;
}

type Theme = 'dark' | 'light';

type ThemeColors = {
  accent?: string | null;
  accentSecondary?: string | null;
  success?: string | null;
  error?: string | null;
  warning?: string | null;
  unattempted?: string | null;
};

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void; customThemeEnabled: boolean }>({
  theme: 'dark',
  toggleTheme: () => {},
  customThemeEnabled: false
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface UserType {
  id: string;
  email: string;
  name: string | null;
  isOwner?: boolean;
  z7iLinked: boolean;
  z7iEnrollment?: string;
  lastSyncAt?: string;
  syncStatus?: string;
  canUseAiSolutions?: boolean;
  themeMode?: Theme;
  themeCustomEnabled?: boolean;
  themeAccent?: string | null;
  themeAccentSecondary?: string | null;
  themeSuccess?: string | null;
  themeError?: string | null;
  themeWarning?: string | null;
  themeUnattempted?: string | null;
}

interface Test {
  id: string;
  testId: string;
  testName: string;
  packageName: string;
  testType: string | null;
  timeLimit?: number; // in minutes, optional for backward compatibility
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
  hasKeyChanges: boolean;
  keyChangeCount: number;
  bonusMarks: number;
  adjustedScore: number;
}

interface CustomTest {
  id: string;
  name: string;
  timeLimit: number;
  totalQuestions: number;
  status: string;
  createdAt: string;
  attempt: null | {
    id: string;
    status: string;
    correct: number;
    incorrect: number;
    unattempted: number;
    totalScore: number;
    maxScore: number | null;
    timeTaken: number | null;
    accuracy: number | null;
    updatedAt: string;
  };
}

type CustomTestConfig = 'jee-main' | 'jee-advanced' | 'assignment';
type AssignmentSubject = 'Physics' | 'Chemistry' | 'Mathematics';
type DifficultyChoice = 'mixed' | 'easy' | 'medium' | 'hard';

const SUBJECT_CHAPTERS: Record<AssignmentSubject, string[]> = {
  Physics: [
    'Units and Measurements',
    'Kinematics',
    'Laws of Motion',
    'Work, Energy and Power',
    'Rotational Motion',
    'Gravitation',
    'Properties of Solids and Liquids',
    'Thermodynamics',
    'Kinetic Theory of Gases',
    'Oscillations',
    'Waves',
    'Electrostatics',
    'Current Electricity',
    'Magnetic Effects of Current',
    'Magnetism and Matter',
    'Electromagnetic Induction',
    'Alternating Current',
    'Electromagnetic Waves',
    'Ray Optics and Optical Instruments',
    'Wave Optics',
    'Dual Nature of Matter and Radiation',
    'Atoms',
    'Nuclei',
    'Semiconductor Electronics',
    'Communication Systems',
    'Experimental Physics',
  ],
  Chemistry: [
    'Some Basic Concepts of Chemistry',
    'Structure of Atom',
    'Classification of Elements and Periodicity',
    'Chemical Bonding and Molecular Structure',
    'States of Matter (Gases and Liquids)',
    'Thermodynamics',
    'Chemical Equilibrium',
    'Ionic Equilibrium',
    'Redox Reactions',
    'Hydrogen',
    's-Block Elements',
    'p-Block Elements (Group 13-14)',
    'p-Block Elements (Group 15-18)',
    'd- and f-Block Elements',
    'Coordination Compounds',
    'General Organic Chemistry',
    'Hydrocarbons',
    'Haloalkanes and Haloarenes',
    'Alcohols, Phenols and Ethers',
    'Aldehydes, Ketones and Carboxylic Acids',
    'Amines',
    'Biomolecules',
    'Polymers',
    'Chemistry in Everyday Life',
    'Solutions',
    'Electrochemistry',
    'Chemical Kinetics',
    'Surface Chemistry',
    'Solid State',
    'Metallurgy',
    'Environmental Chemistry',
    'Purification and Characterisation of Organic Compounds',
  ],
  Mathematics: [
    'Sets and Relations',
    'Functions',
    'Trigonometric Functions',
    'Inverse Trigonometric Functions',
    'Complex Numbers and Quadratic Equations',
    'Matrices',
    'Determinants',
    'Permutations and Combinations',
    'Binomial Theorem',
    'Sequence and Series',
    'Limits and Derivatives',
    'Continuity and Differentiability',
    'Application of Derivatives',
    'Integral Calculus',
    'Area Under Curves',
    'Differential Equations',
    'Vector Algebra',
    'Three Dimensional Geometry',
    'Straight Lines',
    'Circle',
    'Parabola',
    'Ellipse',
    'Hyperbola',
    'Probability',
    'Statistics',
    'Mathematical Reasoning',
    'Linear Programming',
  ],
};

interface Comment {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

interface UserStats {
  totalUsers: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  avgTime: number | null;
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
  originalCorrectAnswer: string | null;
  hasKeyChange: boolean;
  keyChangeAdjustment: number;
  studentAnswer: string | null;
  status: string;
  originalStatus: string | null;
  marksPositive: number;
  marksNegative: number;
  scoreObtained: number;
  originalScoreObtained: number | null;
  timeTaken: number | null;
  avgTimeTaken: number | null;
  percentCorrect: number | null;
  solution: string | null;
  aiSolution: string | null;
  aiGeneratedAt: string | null;
  isBookmarked: boolean;
  note: string | null;
  comments: Comment[];
  isBonus: boolean;
  bonusMarks: number;
  userStats: UserStats | null;
}

interface LeaderboardEntry {
  z7iAccountId: string;
  userId: string;
  userName: string;
  originalScore: number;
  bonusMarks: number;
  manualAdjustment: number;
  adjustedScore: number;
  rank: number;
  percentile: number | null;
  correct: number;
  incorrect: number;
  unattempted: number;
  timeTaken: number | null;
}

interface AttemptDetails {
  id: string;
  testName: string;
  packageName: string;
  testType: string | null;
  submitDate: string;
  timeTaken: number;
  correct: number;
  incorrect: number;
  unattempted: number;
  totalScore: number;
  maxScore: number;
  rank: number | null;
  percentile: number | null;
}

interface SyncProgress {
  status: string;
  current: number;
  total: number;
  currentTest?: string;
}

const normalizeQuestionStatus = (status?: string | null) => {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'correct' || normalized === 'incorrect' ? normalized : 'unattempted';
};

const deriveQuestionStatus = (status?: string | null, studentAnswer?: string | null) => {
  const hasAnswer = Boolean(studentAnswer && studentAnswer.trim());
  if (!hasAnswer) return 'unattempted';
  return normalizeQuestionStatus(status);
};

const isUnattemptedStatus = (status?: string | null) => normalizeQuestionStatus(status) === 'unattempted';

const normalizeQuestion = (question: Question) => ({
  ...question,
  status: deriveQuestionStatus(question.status, question.studentAnswer),
  originalStatus: question.originalStatus ? normalizeQuestionStatus(question.originalStatus) : null
});

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

const MCQ_TYPES = ['MCQ', 'SINGLE'];
const NUMERICAL_TYPES = ['NAT', 'NUMERICAL', 'INTEGER'];

const isMcqType = (type?: string | null) => {
  const normalized = (type || '').toUpperCase();
  return MCQ_TYPES.some(t => normalized.includes(t));
};

const isNumericalType = (type?: string | null) => {
  const normalized = (type || '').toUpperCase();
  return NUMERICAL_TYPES.some(t => normalized.includes(t));
};

const parseMcqAnswers = (value: string) => {
  if (!value) return [];
  const options = value
    .split(/[,\s/|]+/)
    .map(opt => opt.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(options)).sort();
};

const formatMcqAnswers = (answers: string[]) => answers.map(opt => opt.toLowerCase()).sort().join(',');

type NumericRange = { min: number; max: number };

const parseNumericRanges = (value: string): NumericRange[] => {
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
};

const matchesAnswer = (studentAnswer: string | null | undefined, correctAnswer: string, questionType?: string | null) => {
  if (!studentAnswer) return false;
  const normalizedStudent = studentAnswer.trim().toLowerCase();
  if (!normalizedStudent) return false;

  if (isMcqType(questionType)) {
    return parseMcqAnswers(correctAnswer).includes(normalizedStudent);
  }

  if (isNumericalType(questionType)) {
    const studentValue = Number(normalizedStudent);
    if (Number.isNaN(studentValue)) return false;
    const ranges = parseNumericRanges(correctAnswer);
    if (ranges.length === 0) {
      return normalizedStudent === correctAnswer.trim().toLowerCase();
    }
    return ranges.some(range => studentValue >= range.min && studentValue <= range.max);
  }

  return normalizedStudent === correctAnswer.trim().toLowerCase();
};

const formatAnswerDisplay = (answer: string, questionType?: string | null) => {
  if (!answer) return '';
  if (isMcqType(questionType)) {
    return parseMcqAnswers(answer).map(opt => opt.toUpperCase()).join(', ');
  }
  if (isNumericalType(questionType)) {
    const ranges = parseNumericRanges(answer);
    if (ranges.length === 0) return answer.trim();
    return ranges
      .map(range => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
      .join(', ');
  }
  return answer.toUpperCase();
};

const normalizeAnswerKey = (answer: string, questionType?: string | null) => {
  if (isMcqType(questionType)) {
    return formatMcqAnswers(parseMcqAnswers(answer));
  }
  return answer.trim().toLowerCase();
};

function LoginPage({ onLogin, onSwitchToRegister }: { onLogin: (user: UserType, token: string) => void; onSwitchToRegister: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest('/auth?action=login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (data.success) {
        localStorage.setItem('token', data.token);
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card card">
        <div className="login-logo">
          <h1>Z7I<span>Scraper</span></h1>
        </div>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>
        
        <div className="login-footer">
          Don't have an account?{' '}
          <button onClick={onSwitchToRegister}>Create one</button>
        </div>
      </div>
    </div>
  );
}

function RegisterPage({ onRegister, onSwitchToLogin }: { onRegister: (user: UserType, token: string) => void; onSwitchToLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest('/auth?action=register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });

      if (data.success) {
        localStorage.setItem('token', data.token);
        onRegister(data.user, data.token);
      } else {
        setError(data.error || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card card">
        <div className="login-logo">
          <h1>Z7I<span>Scraper</span></h1>
        </div>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              minLength={6}
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Create Account'}
          </button>
        </form>
        
        <div className="login-footer">
          Already have an account?{' '}
          <button onClick={onSwitchToLogin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}

function LinkZ7IModal({ 
  onClose, 
  onLinked, 
  onStartSync 
}: { 
  onClose: () => void; 
  onLinked: () => void;
  onStartSync: () => void;
}) {
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [z7iPassword, setZ7iPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest('/z7i?action=link', {
        method: 'POST',
        body: JSON.stringify({ enrollmentNo, z7iPassword }),
      });

      if (data.success) {
        onLinked();
        onClose();
        onStartSync();
      } else {
        setError(data.error || 'Failed to link account');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Link2 size={20} />
            Link Z7I Account
          </h2>
          <button className="modal-close" onClick={onClose}>
            <XCircle size={20} />
          </button>
        </div>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Enrollment Number</label>
            <input
              type="text"
              className="form-input"
              value={enrollmentNo}
              onChange={(e) => setEnrollmentNo(e.target.value)}
              placeholder="e.g., 1110642460002"
              required
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Z7I Password</label>
            <input
              type="password"
              className="form-input"
              value={z7iPassword}
              onChange={(e) => setZ7iPassword(e.target.value)}
              placeholder="Your Z7I password"
              required
            />
          </div>
          
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Link Account & Sync'}
          </button>
        </form>
      </div>
    </div>
  );
}

function SyncProgressModal({ progress, onClose }: { progress: SyncProgress; onClose: () => void }) {
  const isComplete = progress.status === 'Complete';
  const isFailed = progress.status.includes('failed') || progress.status.includes('Failed');
  
  return (
    <div className="modal-overlay">
      <div className="modal sync-modal">
        <div className="sync-header">
          {isComplete ? (
            <CheckCircle size={24} className="sync-icon success" />
          ) : isFailed ? (
            <XCircle size={24} className="sync-icon error" />
          ) : (
            <RefreshCw size={24} className="sync-icon spinning" />
          )}
          <h2>{isComplete ? 'Sync Complete' : isFailed ? 'Sync Failed' : 'Syncing Data'}</h2>
        </div>
        
        <div className="sync-status">{progress.status}</div>
        
        {progress.currentTest && (
          <div className="sync-current-test">{progress.currentTest}</div>
        )}
        
        {!isComplete && !isFailed && (
          <div className="sync-indeterminate">
            <div className="sync-indeterminate-bar"></div>
          </div>
        )}
        
        {isComplete && progress.total > 0 && (
          <div className="sync-progress-text">
            {progress.current} tests • {progress.total} questions synced
          </div>
        )}
        
        {(isComplete || isFailed) && (
          <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '1rem' }}>
            {isComplete ? 'Done' : 'Close'}
          </button>
        )}
        
        {!isComplete && !isFailed && (
          <>
            <p className="sync-hint">This may take a minute for large accounts...</p>
            <button 
              className="btn btn-secondary sync-refresh-btn" 
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} />
              Refresh Page
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileModal({ 
  user, 
  onClose, 
  onUserUpdate,
  onLogout
}: { 
  user: UserType; 
  onClose: () => void;
  onUserUpdate: (user: UserType) => void;
  onLogout: () => void;
}) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState<'profile' | 'z7i' | 'theme' | 'danger'>('profile');
  const [loading, setLoading] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [name, setName] = useState(user.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [enrollmentNo, setEnrollmentNo] = useState(user.z7iEnrollment || '');
  const [z7iPassword, setZ7iPassword] = useState('');
  
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  
  const [themeMode, setThemeMode] = useState<Theme>(user.themeMode || theme);
  const [themeCustomEnabled, setThemeCustomEnabled] = useState(user.themeCustomEnabled ?? false);
  const [themeAccent, setThemeAccent] = useState(user.themeAccent || '');
  const [themeAccentSecondary, setThemeAccentSecondary] = useState(user.themeAccentSecondary || '');
  const [themeSuccess, setThemeSuccess] = useState(user.themeSuccess || '');
  const [themeError, setThemeError] = useState(user.themeError || '');
  const [themeWarning, setThemeWarning] = useState(user.themeWarning || '');
  const [themeUnattempted, setThemeUnattempted] = useState(user.themeUnattempted || '');

  const getCssVar = useCallback((variable: string) => {
    if (typeof window === 'undefined') return '';
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  }, []);

  useEffect(() => {
    setThemeMode(user.themeMode || theme);
    setThemeCustomEnabled(user.themeCustomEnabled ?? false);
    setThemeAccent(user.themeAccent || getCssVar('--accent'));
    setThemeAccentSecondary(user.themeAccentSecondary || getCssVar('--accent-primary'));
    setThemeSuccess(user.themeSuccess || getCssVar('--success'));
    setThemeError(user.themeError || getCssVar('--error'));
    setThemeWarning(user.themeWarning || getCssVar('--warning'));
    setThemeUnattempted(user.themeUnattempted || getCssVar('--unattempted'));
  }, [
    user,
    theme,
    getCssVar
  ]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword && newPassword !== confirmPassword) {
      showMessage('error', 'New passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const body: { name?: string; currentPassword?: string; newPassword?: string } = {};
      
      if (name !== user.name) {
        body.name = name;
      }
      
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }

      if (Object.keys(body).length === 0) {
        showMessage('error', 'No changes to save');
        setLoading(false);
        return;
      }

      const response = await apiRequest('/auth?action=update-profile', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (response.success) {
        showMessage('success', response.message);
        onUserUpdate({ ...user, name: name || null });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        showMessage('error', response.error);
      }
    } catch {
      showMessage('error', 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    setThemeSaving(true);

    try {
      const response = await apiRequest('/auth?action=update-theme', {
        method: 'POST',
        body: JSON.stringify({
          themeMode,
          themeCustomEnabled,
          themeAccent,
          themeAccentSecondary,
          themeSuccess,
          themeError,
          themeWarning,
          themeUnattempted
        })
      });

      if (response.success) {
        showMessage('success', response.message || 'Theme updated');
        onUserUpdate({ ...user, ...response.user });
      } else {
        showMessage('error', response.error || 'Failed to update theme');
      }
    } catch {
      showMessage('error', 'Failed to update theme');
    } finally {
      setThemeSaving(false);
    }
  };

  const handleUpdateZ7i = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!enrollmentNo || !z7iPassword) {
      showMessage('error', 'Both enrollment number and password are required');
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest('/auth?action=update-z7i', {
        method: 'POST',
        body: JSON.stringify({ enrollmentNo, z7iPassword })
      });

      if (response.success) {
        showMessage('success', response.message);
        onUserUpdate({ ...user, z7iLinked: true, z7iEnrollment: enrollmentNo });
        setZ7iPassword('');
      } else {
        showMessage('error', response.error);
      }
    } catch {
      showMessage('error', 'Failed to update Z7I credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkZ7i = async () => {
    if (!confirm('Are you sure you want to unlink your Z7I account? All synced test data will be removed.')) {
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest('/auth?action=unlink-z7i', {
        method: 'POST'
      });

      if (response.success) {
        showMessage('success', response.message);
        onUserUpdate({ ...user, z7iLinked: false, z7iEnrollment: undefined, lastSyncAt: undefined, syncStatus: undefined });
      } else {
        showMessage('error', response.error);
      }
    } catch {
      showMessage('error', 'Failed to unlink Z7I account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (deleteConfirm !== 'DELETE') {
      showMessage('error', 'Please type DELETE to confirm');
      return;
    }

    if (!deletePassword) {
      showMessage('error', 'Password is required');
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest('/auth?action=delete-account', {
        method: 'POST',
        body: JSON.stringify({ password: deletePassword })
      });

      if (response.success) {
        localStorage.removeItem('token');
        window.location.reload();
      } else {
        showMessage('error', response.error);
      }
    } catch {
      showMessage('error', 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const lastSyncText = user.lastSyncAt 
    ? formatDistanceToNow(new Date(user.lastSyncAt), { addSuffix: true })
    : 'Never';

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="profile-modal">
        <div className="profile-modal-header">
          <h2>
            <Settings size={20} />
            Account Settings
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {message && (
          <div className={`profile-alert ${message.type}`}>
            {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {message.text}
          </div>
        )}

        <div className="profile-tabs">
          <button 
            className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={16} />
            Profile
          </button>
          <button 
            className={`profile-tab ${activeTab === 'z7i' ? 'active' : ''}`}
            onClick={() => setActiveTab('z7i')}
          >
            <Link2 size={16} />
            Z7I Account
          </button>
          <button
            className={`profile-tab ${activeTab === 'theme' ? 'active' : ''}`}
            onClick={() => setActiveTab('theme')}
          >
            <Palette size={16} />
            Theme
          </button>
          <button 
            className={`profile-tab danger ${activeTab === 'danger' ? 'active' : ''}`}
            onClick={() => setActiveTab('danger')}
          >
            <AlertTriangle size={16} />
            Danger Zone
          </button>
        </div>

        <div className="profile-content">
          {activeTab === 'profile' && (
            <form onSubmit={handleUpdateProfile} className="profile-form">
              <div className="profile-section">
                <h3>Account Information</h3>
                
                <div className="profile-info-row">
                  <Mail size={16} />
                  <span className="profile-label">Email</span>
                  <span className="profile-value">{user.email}</span>
                </div>
                
                <div className="form-group">
                  <label>Display Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your display name"
                    className="form-input"
                  />
                </div>
              </div>

              <div className="profile-section">
                <h3>
                  <Key size={16} />
                  Change Password
                </h3>
                
                <div className="form-group">
                  <label>Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="form-input"
                  />
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <span className="spinner-small" /> : <Save size={16} />}
                Save Changes
              </button>
            </form>
          )}

          {activeTab === 'z7i' && (
            <div className="profile-form">
              <div className="profile-section">
                <h3>
                  <Link2 size={16} />
                  Z7I Account Status
                </h3>
                
                {user.z7iLinked ? (
                  <div className="z7i-status connected">
                    <div className="z7i-status-badge">
                      <CheckCircle size={18} />
                      Connected
                    </div>
                    <div className="z7i-details">
                      <div className="z7i-detail-row">
                        <span className="label">Enrollment No:</span>
                        <span className="value">{user.z7iEnrollment}</span>
                      </div>
                      <div className="z7i-detail-row">
                        <span className="label">Last Sync:</span>
                        <span className="value">{lastSyncText}</span>
                      </div>
                      <div className="z7i-detail-row">
                        <span className="label">Status:</span>
                        <span className={`value status-${user.syncStatus}`}>{user.syncStatus || 'pending'}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="z7i-status disconnected">
                    <div className="z7i-status-badge">
                      <XCircle size={18} />
                      Not Connected
                    </div>
                    <p>Link your Z7I account to sync your test data.</p>
                  </div>
                )}
              </div>

              <div className="profile-section">
                <h3>{user.z7iLinked ? 'Update Credentials' : 'Link Z7I Account'}</h3>
                
                <form onSubmit={handleUpdateZ7i}>
                  <div className="form-group">
                    <label>Enrollment Number</label>
                    <input
                      type="text"
                      value={enrollmentNo}
                      onChange={(e) => setEnrollmentNo(e.target.value)}
                      placeholder="Your Z7I enrollment number"
                      className="form-input"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Z7I Password</label>
                    <input
                      type="password"
                      value={z7iPassword}
                      onChange={(e) => setZ7iPassword(e.target.value)}
                      placeholder="Your Z7I password"
                      className="form-input"
                    />
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? <span className="spinner-small" /> : <Save size={16} />}
                      {user.z7iLinked ? 'Update Credentials' : 'Link Account'}
                    </button>
                    
                    {user.z7iLinked && (
                      <button 
                        type="button" 
                        className="btn btn-danger-outline"
                        onClick={handleUnlinkZ7i}
                        disabled={loading}
                      >
                        <Unlink size={16} />
                        Unlink Account
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'theme' && (
            <form onSubmit={handleUpdateTheme} className="profile-form">
              <div className="profile-section">
                <h3>
                  <Palette size={16} />
                  Theme Preferences
                </h3>

                <div className="theme-settings">
                  <div className="theme-row">
                    <label>Theme Mode</label>
                    <div className="theme-mode-toggle">
                      <button
                        type="button"
                        className={`theme-mode-btn ${themeMode === 'dark' ? 'active' : ''}`}
                        onClick={() => setThemeMode('dark')}
                      >
                        Dark
                      </button>
                      <button
                        type="button"
                        className={`theme-mode-btn ${themeMode === 'light' ? 'active' : ''}`}
                        onClick={() => setThemeMode('light')}
                      >
                        Light
                      </button>
                    </div>
                  </div>

                  <label className="theme-toggle-row">
                    <input
                      type="checkbox"
                      checked={themeCustomEnabled}
                      onChange={(e) => setThemeCustomEnabled(e.target.checked)}
                    />
                    <span>Enable custom theme colors</span>
                  </label>

                  <div className={`theme-color-grid ${themeCustomEnabled ? '' : 'is-disabled'}`}>
                    <div className="theme-color-item">
                      <label>Accent</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeAccent || '#6b7280'}
                          onChange={(e) => setThemeAccent(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeAccent || '#6b7280'}</span>
                      </div>
                    </div>
                    <div className="theme-color-item">
                      <label>Accent Secondary</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeAccentSecondary || themeAccent || '#6b7280'}
                          onChange={(e) => setThemeAccentSecondary(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeAccentSecondary || themeAccent || '#6b7280'}</span>
                      </div>
                    </div>
                    <div className="theme-color-item">
                      <label>Correct</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeSuccess || '#22c55e'}
                          onChange={(e) => setThemeSuccess(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeSuccess || '#22c55e'}</span>
                      </div>
                    </div>
                    <div className="theme-color-item">
                      <label>Incorrect</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeError || '#ef4444'}
                          onChange={(e) => setThemeError(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeError || '#ef4444'}</span>
                      </div>
                    </div>
                    <div className="theme-color-item">
                      <label>Warning</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeWarning || '#f59e0b'}
                          onChange={(e) => setThemeWarning(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeWarning || '#f59e0b'}</span>
                      </div>
                    </div>
                    <div className="theme-color-item">
                      <label>Unattempted</label>
                      <div className="theme-color-control">
                        <input
                          type="color"
                          value={themeUnattempted || '#f59e0b'}
                          onChange={(e) => setThemeUnattempted(e.target.value)}
                          disabled={!themeCustomEnabled}
                        />
                        <span>{themeUnattempted || '#f59e0b'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={themeSaving}>
                {themeSaving ? <span className="spinner-small" /> : <Save size={16} />}
                Save Theme
              </button>
            </form>
          )}

          {activeTab === 'danger' && (
            <div className="profile-form danger-zone">
              <div className="danger-warning">
                <AlertTriangle size={24} />
                <div>
                  <h3>Danger Zone</h3>
                  <p>Actions here are permanent and cannot be undone.</p>
                </div>
              </div>

              <div className="profile-section">
                <h3>
                  <Trash2 size={16} />
                  Delete Account
                </h3>
                <p className="danger-text">
                  This will permanently delete your account, all synced test data, bookmarks, notes, and forum posts.
                </p>
                
                <form onSubmit={handleDeleteAccount}>
                  <div className="form-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Enter your password"
                      className="form-input"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Type DELETE to confirm</label>
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE"
                      className="form-input"
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="btn btn-danger" 
                    disabled={loading || deleteConfirm !== 'DELETE'}
                  >
                    {loading ? <span className="spinner-small" /> : <Trash2 size={16} />}
                    Delete My Account
                  </button>
                </form>
              </div>
              
              <div className="profile-section">
                <button className="btn btn-secondary" onClick={onLogout}>
                  <LogOut size={16} />
                  Log Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type LightboxContext = {
  questionId?: string;
  label?: string;
  subject?: string;
  testName?: string;
};

type DrawingPoint = {
  x: number;
  y: number;
};

type DrawingStroke = {
  color: string;
  size: number;
  points: DrawingPoint[];
};

type SavedQuestionNote = {
  id: string;
  createdAt: string;
  expiresAt?: string;
  imageSrc: string;
  note: string;
  strokes: DrawingStroke[];
  questionId?: string;
  label?: string;
  subject?: string;
  testName?: string;
};

const SAVED_QUESTION_STORAGE_KEY = 'saved-question-annotations';
const SAVED_QUESTION_EXPIRY_DAYS = 30;
const SAVED_QUESTION_EXPIRY_MS = SAVED_QUESTION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const loadSavedQuestionNotes = (): SavedQuestionNote[] => {
  const raw = localStorage.getItem(SAVED_QUESTION_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    let didChange = false;
    const filtered = parsed
      .map((note) => {
        if (!note || typeof note !== 'object') return null;
        const createdAt = typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString();
        const expiresAt = typeof note.expiresAt === 'string'
          ? note.expiresAt
          : new Date(new Date(createdAt).getTime() + SAVED_QUESTION_EXPIRY_MS).toISOString();
        if (expiresAt !== note.expiresAt) {
          didChange = true;
        }
        return { ...note, createdAt, expiresAt } as SavedQuestionNote;
      })
      .filter((note): note is SavedQuestionNote => {
        if (!note?.expiresAt) return false;
        const expiry = Date.parse(note.expiresAt);
        if (Number.isNaN(expiry)) return false;
        return expiry > now;
      });
    if (didChange || filtered.length !== parsed.length) {
      saveSavedQuestionNotes(filtered);
    }
    return filtered;
  } catch {
    return [];
  }
};

const saveSavedQuestionNotes = (notes: SavedQuestionNote[]) => {
  localStorage.setItem(SAVED_QUESTION_STORAGE_KEY, JSON.stringify(notes));
};

const addSavedQuestionNote = (note: SavedQuestionNote) => {
  const next = [note, ...loadSavedQuestionNotes()];
  saveSavedQuestionNotes(next);
  return next;
};

const removeSavedQuestionNote = (id: string) => {
  const next = loadSavedQuestionNotes().filter(note => note.id !== id);
  saveSavedQuestionNotes(next);
  return next;
};

const createSavedQuestionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function ImageLightbox({
  src,
  onClose,
  context,
}: {
  src: string;
  onClose: () => void;
  context?: LightboxContext;
}) {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [note, setNote] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [strokeColor, setStrokeColor] = useState('#fbbf24');
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<DrawingStroke | null>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const colorPalette = useMemo(
    () => ['#fbbf24', '#f97316', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#ffffff', '#111827'],
    [],
  );

  const getAccentColor = useCallback(() => {
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim() || '#fbbf24'
    );
  }, []);

  useEffect(() => {
    setStrokeColor(getAccentColor());
  }, [getAccentColor]);

  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    strokesRef.current.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
  }, []);

  const resizeCanvas = useCallback(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const rect = image.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    drawStrokes();
  }, [drawStrokes]);
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    resizeCanvas();

    const handleResize = () => resizeCanvas();
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose, resizeCanvas]);

  const getRelativePoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = getRelativePoint(event.clientX, event.clientY);
    const stroke: DrawingStroke = {
      color: strokeColor,
      size: 3,
      points: [point],
    };
    strokesRef.current.push(stroke);
    currentStrokeRef.current = stroke;
    drawStrokes();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled || !drawingRef.current || !currentStrokeRef.current) return;
    event.preventDefault();
    const nativeEvent = event.nativeEvent;
    const events = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent];
    events.forEach((coalescedEvent) => {
      const point = getRelativePoint(coalescedEvent.clientX, coalescedEvent.clientY);
      currentStrokeRef.current?.points.push(point);
    });
    drawStrokes();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled) return;
    event.preventDefault();
    drawingRef.current = false;
    currentStrokeRef.current = null;
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture(event.pointerId);
    drawStrokes();
  };

  const handleClearDrawing = () => {
    strokesRef.current = [];
    drawStrokes();
  };

  const handleSave = () => {
    if (!note.trim() && strokesRef.current.length === 0) {
      setSaveStatus('Add a note or draw before saving.');
      return;
    }
    const entry: SavedQuestionNote = {
      id: createSavedQuestionId(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SAVED_QUESTION_EXPIRY_MS).toISOString(),
      imageSrc: src,
      note: note.trim(),
      strokes: strokesRef.current,
      questionId: context?.questionId,
      label: context?.label,
      subject: context?.subject,
      testName: context?.testName,
    };
    addSavedQuestionNote(entry);
    setSaveStatus('Saved to Bookmarked Questions.');
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        <X size={24} />
      </button>
      <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button
          className={`lightbox-tool ${drawingEnabled ? 'active' : ''}`}
          onClick={() => {
            setDrawingEnabled(prev => !prev);
            setSaveStatus('');
          }}
          type="button"
        >
          <PenTool size={16} />
          {drawingEnabled ? 'Drawing' : 'Annotate'}
        </button>
        {drawingEnabled && (
          <>
            <div className="lightbox-color-picker">
              {colorPalette.map((color) => (
                <button
                  key={color}
                  className={`lightbox-color-swatch ${strokeColor === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setStrokeColor(color)}
                  type="button"
                  aria-label={`Select ${color} stroke`}
                />
              ))}
              <label className="lightbox-color-input" aria-label="Pick a custom color">
                <input
                  type="color"
                  value={strokeColor}
                  onChange={(event) => setStrokeColor(event.target.value)}
                />
              </label>
            </div>
            <textarea
              className="lightbox-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a quick note..."
              rows={2}
            />
            <button className="lightbox-tool" onClick={handleClearDrawing} type="button">
              <RotateCcw size={16} />
              Clear
            </button>
            <button className="lightbox-tool primary" onClick={handleSave} type="button">
              <Save size={16} />
              Save
            </button>
          </>
        )}
        {saveStatus && <span className="lightbox-status">{saveStatus}</span>}
      </div>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-media">
          <img
            ref={imageRef}
            src={src}
            alt="Enlarged view"
            className="lightbox-image"
            onLoad={resizeCanvas}
          />
          <canvas
            ref={canvasRef}
            className={`lightbox-canvas ${drawingEnabled ? 'active' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      </div>
      <div className="lightbox-hint">Click anywhere or press ESC to close</div>
    </div>
  );
}

function useImageLightbox(context?: LightboxContext) {
  const [lightboxState, setLightboxState] = useState<{ src: string; context?: LightboxContext } | null>(null);

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      e.stopPropagation();
      const src = (target as HTMLImageElement).src;
      setLightboxState({ src, context });
    }
  }, [context]);

  const closeLightbox = useCallback(() => {
    setLightboxState(null);
  }, []);

  return { lightboxState, handleImageClick, closeLightbox };
}

function TimeIntelligenceDashboard({ 
  onBack, 
  onOpenReview 
}: { 
  onBack: () => void; 
  onOpenReview: (review: { attemptId: string; questionId: string }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    loadTimeIntelligence();
  }, []);

  const loadTimeIntelligence = async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/z7i?action=time-intelligence');
      if (response.success) {
        setData(response.data);
      }
    } catch (err) {
      console.error('Failed to load time intelligence:', err);
    } finally {
      setLoading(false);
    }
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

  if (!data) {
    return (
      <div className="page">
        <div className="container">
          <button className="btn-back" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <div className="empty-state">
            <Clock size={48} />
            <div className="empty-state-title">No Data Available</div>
            <div className="empty-state-text">
              Complete some tests to see your time intelligence analytics.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <button className="btn-back" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">⏱️ Time Intelligence</h1>
            <p className="page-subtitle">
              Analyzed {data.totalQuestionsAnalyzed} questions across all your tests
            </p>
          </div>
        </div>

        <div className="time-intel-section">
          <div className="time-intel-header">
            <h2 className="time-intel-title">
              <Target size={18} />
              Time vs Accuracy Correlation
            </h2>
            <p className="time-intel-subtitle">How your accuracy changes with time spent</p>
          </div>
          <div className="time-accuracy-grid">
            {data.timeAccuracyCorrelation.map((item: any, idx: number) => (
              <div key={idx} className="time-accuracy-card">
                <div className="time-accuracy-range">{item.timeRange}</div>
                <div className="time-accuracy-accuracy" style={{
                  color: item.accuracy >= 70 ? 'var(--success)' : item.accuracy >= 50 ? 'var(--warning)' : 'var(--error)'
                }}>
                  {item.accuracy}%
                </div>
                <div className="time-accuracy-count">{item.count} questions</div>
              </div>
            ))}
          </div>
        </div>

        <div className="time-intel-section">
          <div className="time-intel-header">
            <h2 className="time-intel-title">
              <BarChart3 size={18} />
              Subject-wise Time Analysis
            </h2>
            <p className="time-intel-subtitle">Average time per subject and status</p>
          </div>
          <div className="subject-time-grid">
            {data.subjectStats.map((stat: any) => (
              <div key={stat.subject} className="subject-time-card">
                <div className="subject-time-header">
                  <span className="subject-time-name">{stat.subject}</span>
                  <span className="subject-time-accuracy" style={{
                    color: stat.accuracy >= 70 ? 'var(--success)' : stat.accuracy >= 50 ? 'var(--warning)' : 'var(--error)'
                  }}>
                    {stat.accuracy}%
                  </span>
                </div>
                <div className="subject-time-stats">
                  <div className="subject-time-stat">
                    <span className="stat-label">Avg Time</span>
                    <span className="stat-value">{Math.round(stat.avgTime / 60)}:{String(stat.avgTime % 60).padStart(2, '0')}</span>
                  </div>
                  <div className="subject-time-stat correct">
                    <CheckCircle size={14} />
                    <span className="stat-value">{Math.round(stat.avgTimeCorrect / 60)}:{String(stat.avgTimeCorrect % 60).padStart(2, '0')}</span>
                  </div>
                  <div className="subject-time-stat incorrect">
                    <XCircle size={14} />
                    <span className="stat-value">{Math.round(stat.avgTimeIncorrect / 60)}:{String(stat.avgTimeIncorrect % 60).padStart(2, '0')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="time-intel-section">
          <div className="time-intel-header">
            <h2 className="time-intel-title">
              <Zap size={18} />
              Question Type Performance
            </h2>
            <p className="time-intel-subtitle">MCQ vs Numerical Answer Type comparison</p>
          </div>
          <div className="type-stats-grid">
            {data.typeStats.map((stat: any) => (
              <div key={stat.type} className="type-stats-card">
                <div className="type-stats-type">{stat.type}</div>
                <div className="type-stats-metrics">
                  <div className="type-stat">
                    <Clock size={16} />
                    <span className="type-stat-value">{Math.round(stat.avgTime / 60)}:{String(stat.avgTime % 60).padStart(2, '0')}</span>
                    <span className="type-stat-label">Avg Time</span>
                  </div>
                  <div className="type-stat">
                    <Target size={16} />
                    <span className="type-stat-value" style={{
                      color: stat.accuracy >= 70 ? 'var(--success)' : stat.accuracy >= 50 ? 'var(--warning)' : 'var(--error)'
                    }}>
                      {stat.accuracy}%
                    </span>
                    <span className="type-stat-label">Accuracy</span>
                  </div>
                  <div className="type-stat">
                    <FileText size={16} />
                    <span className="type-stat-value">{stat.count}</span>
                    <span className="type-stat-label">Questions</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="time-intel-section">
          <div className="time-intel-header">
            <h2 className="time-intel-title">
              <Trophy size={18} />
              Optimal Time Recommendations
            </h2>
            <p className="time-intel-subtitle">Based on your correct answers</p>
          </div>
          <div className="optimal-time-grid">
            <div className="optimal-time-card">
              <div className="optimal-time-type">MCQ Questions</div>
              <div className="optimal-time-value">
                {Math.floor(data.optimalTime.mcq / 60)}:{String(data.optimalTime.mcq % 60).padStart(2, '0')}
              </div>
              <div className="optimal-time-label">per question</div>
            </div>
            <div className="optimal-time-card">
              <div className="optimal-time-type">NAT Questions</div>
              <div className="optimal-time-value">
                {Math.floor(data.optimalTime.nat / 60)}:{String(data.optimalTime.nat % 60).padStart(2, '0')}
              </div>
              <div className="optimal-time-label">per question</div>
            </div>
          </div>
        </div>

        {data.timeSinks.length > 0 && (
          <div className="time-intel-section">
            <div className="time-intel-header">
              <h2 className="time-intel-title">
                <AlertTriangle size={18} />
                Time Sinks
              </h2>
              <p className="time-intel-subtitle">Questions where you spent too much time and got wrong</p>
            </div>
            <div className="time-issues-list">
              {data.timeSinks.slice(0, 5).map((sink: any, idx: number) => {
                const questionId = sink.questionId || sink.id;
                const canReview = Boolean(sink.attemptId && questionId);
                return (
                <button
                  key={idx}
                  type="button"
                  className="time-issue-card sink"
                  onClick={() => canReview && onOpenReview({ attemptId: sink.attemptId, questionId })}
                  disabled={!canReview}
                  aria-label={`Review ${sink.subject} ${sink.type} time sink question`}
                >
                  <div className="time-issue-rank">#{idx + 1}</div>
                  <div className="time-issue-info">
                    <span className="time-issue-subject">{sink.subject}</span>
                    <span className="time-issue-type">{sink.type}</span>
                    <span className="time-issue-cta">Review in exam panel →</span>
                  </div>
                  <div className="time-issue-times">
                    <div className="time-issue-time your">
                      <span className="time-label">You:</span>
                      <span className="time-value">{sink.timeTaken}m</span>
                    </div>
                    {sink.avgTime && (
                      <div className="time-issue-time avg">
                        <span className="time-label">Avg:</span>
                        <span className="time-value">{sink.avgTime}m</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            </div>
          </div>
        )}

        {data.speedTraps.length > 0 && (
          <div className="time-intel-section">
            <div className="time-intel-header">
              <h2 className="time-intel-title">
                <Zap size={18} />
                Speed Traps
              </h2>
              <p className="time-intel-subtitle">Questions you rushed through and got wrong</p>
            </div>
            <div className="time-issues-list">
              {data.speedTraps.slice(0, 5).map((trap: any, idx: number) => {
                const questionId = trap.questionId || trap.id;
                const canReview = Boolean(trap.attemptId && questionId);
                return (
                <button
                  key={idx}
                  type="button"
                  className="time-issue-card trap"
                  onClick={() => canReview && onOpenReview({ attemptId: trap.attemptId, questionId })}
                  disabled={!canReview}
                  aria-label={`Review ${trap.subject} ${trap.type} speed trap question`}
                >
                  <div className="time-issue-rank">#{idx + 1}</div>
                  <div className="time-issue-info">
                    <span className="time-issue-subject">{trap.subject}</span>
                    <span className="time-issue-type">{trap.type}</span>
                    <span className="time-issue-cta">Review in exam panel →</span>
                  </div>
                  <div className="time-issue-times">
                    <div className="time-issue-time your">
                      <span className="time-label">You:</span>
                      <span className="time-value">{trap.timeTaken}s</span>
                    </div>
                    <div className="time-issue-time avg">
                      <span className="time-label">Avg:</span>
                      <span className="time-value">{trap.avgTime}s</span>
                    </div>
                    <div className="speed-ratio">{trap.speedRatio}% of avg</div>
                  </div>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Navigation({ 
  user, 
  onSync, 
  syncing,
  onProfileClick,
  onHomeClick
}: { 
  user: UserType; 
  onSync: () => void; 
  syncing: boolean;
  onProfileClick: () => void;
  onHomeClick?: () => void;
}) {
  const { theme, toggleTheme, customThemeEnabled } = useTheme();
  const lastSyncText = user.lastSyncAt 
    ? formatDistanceToNow(new Date(user.lastSyncAt), { addSuffix: true })
    : 'Never';
    
  return (
    <nav className="nav">
      <div className="container nav-content">
        <button className="nav-brand-btn" onClick={onHomeClick} title="Go to Home">
          <span className="nav-brand">Z7I<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Scraper</span></span>
        </button>
        
        <div className="nav-links">
          {user.z7iLinked && (
            <>
              <span className="nav-sync-info">
                <Clock size={14} />
                Last sync: {lastSyncText}
              </span>
              <button className="nav-link" onClick={onSync} disabled={syncing}>
                <RefreshCw size={16} className={syncing ? 'spinning' : ''} />
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
            </>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {customThemeEnabled ? <Palette size={18} /> : (theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />)}
          </button>
          <button className="user-info-btn" onClick={onProfileClick}>
            <div className="user-avatar">
              <User size={16} />
            </div>
            <span className="user-name">{user.name || user.email}</span>
            <Settings size={14} className="user-settings-icon" />
          </button>
        </div>
      </div>
    </nav>
  );
}

function MiniPieChart({ correct, incorrect, unattempted }: { correct: number; incorrect: number; unattempted: number }) {
  let data = [
    { name: 'Correct', value: correct, color: 'var(--success)' },
    { name: 'Incorrect', value: incorrect, color: 'var(--error)' },
    { name: 'Unattempted', value: unattempted, color: 'var(--unattempted)' },
  ];

  if (correct === 0 && incorrect === 0 && unattempted > 0) {
    data = [
      { name: 'Unattempted', value: 1, color: 'var(--unattempted)' },
    ];
  } else {
    data = data.filter(d => d.value > 0);
  }

  const accuracy = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;

  return (
    <div className="mini-pie-container">
      <ResponsiveContainer width={52} height={52}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={15}
            outerRadius={24}
            dataKey="value"
            strokeWidth={0}
            animationBegin={0}
            animationDuration={600}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="mini-pie-center">
        <span className="mini-pie-value">{accuracy}%</span>
      </div>
    </div>
  );
}

interface TestCardProps {
  test: Test;
  onClick: () => void;
  onWriteExam: () => void;
  className?: string;
}

function TestCard({ test, onClick, onWriteExam, className }: TestCardProps) {
  const scorePercent = test.maxScore > 0 ? Math.round((test.adjustedScore / test.maxScore) * 100) : 0;
  const displayScore = test.adjustedScore;
  const bonusAmount = test.bonusMarks || 0;
  const keyChangeAmount = test.adjustedScore - test.totalScore - bonusAmount;
  return (
    <div className={`test-card ${test.hasKeyChanges ? 'has-key-changes' : ''} ${className ? className : ''}`}>
      {test.hasKeyChanges && (
        <div className="key-change-badge">
          <Edit3 size={10} />
          <span>{test.keyChangeCount} Key Change{test.keyChangeCount > 1 ? 's' : ''}</span>
        </div>
      )}
      
      <div className="test-card-header" onClick={onClick}>
        <div className="test-card-info">
          <div className="test-card-title">{test.testName}</div>
          <div className="test-card-package">{test.packageName}</div>
          <div className="test-card-date">
            <Clock size={10} />
            {new Date(test.submitDate).toLocaleDateString()}
          </div>
        </div>
        <MiniPieChart correct={test.correct} incorrect={test.incorrect} unattempted={test.unattempted} />
      </div>
      
      <div className="test-card-score-bar" onClick={onClick}>
        <div className="score-bar-bg">
          <div className="score-bar-fill" style={{ width: `${scorePercent}%` }} />
        </div>
        <div className="score-bar-labels">
          <span className="score-value">
            {displayScore}
            {keyChangeAmount !== 0 && (
              <span className={`bonus-sub ${keyChangeAmount < 0 ? 'negative' : ''}`}>
                {keyChangeAmount > 0 ? '+' : ''}{keyChangeAmount}
              </span>
            )}
            {bonusAmount !== 0 && (
              <span className="bonus-sub">
                Bonus {bonusAmount > 0 ? '+' : ''}{bonusAmount}
              </span>
            )}
            <span className="score-max"> / {test.maxScore}</span>
          </span>
          <span className="score-percent">{scorePercent}%</span>
        </div>
      </div>
      
      <div className="test-card-stats" onClick={onClick}>
        <div className="test-stat">
          <CheckCircle size={12} />
          <div className="test-stat-value">{test.correct}</div>
        </div>
        <div className="test-stat test-stat-wrong">
          <XCircle size={12} />
          <div className="test-stat-value">{test.incorrect}</div>
        </div>
        <div className="test-stat test-stat-skip">
          <MinusCircle size={12} />
          <div className="test-stat-value">{test.unattempted}</div>
        </div>
        {test.rank && (
          <div className="test-stat test-stat-rank">
            <Award size={12} />
            <div className="test-stat-value">#{test.rank}</div>
          </div>
        )}
      </div>
      
      <div className="test-card-actions">
        <button className="test-card-btn test-card-btn-primary test-card-btn-ghost" onClick={onClick}>
          <Eye size={12} />
          <span>Analysis</span>
        </button>
        <button className="test-card-btn test-card-btn-secondary" onClick={(e) => { e.stopPropagation(); onWriteExam(); }}>
          <PenTool size={12} />
          <span>Re-take</span>
        </button>
      </div>
    </div>
  );
}

function TestsList({ 
  tests, 
  onSelectTest,
  onWriteExam 
}: { 
  tests: Test[]; 
  onSelectTest: (test: Test) => void;
  onWriteExam: (test: Test) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  

  const sortedTests = [...tests].sort((a, b) => {
    const aNoQuestions = (a.totalQuestions === 0);
    const bNoQuestions = (b.totalQuestions === 0);
    if (aNoQuestions === bNoQuestions) return 0;
    return aNoQuestions ? 1 : -1;
  });

  const filteredTests = sortedTests.filter(test => {
    const query = searchQuery.toLowerCase();
    return (
      test.testName.toLowerCase().includes(query) ||
      test.packageName.toLowerCase().includes(query)
    );
  });

  if (tests.length === 0) {
    return (
      <div className="empty-state">
        <FileText size={48} />
        <div className="empty-state-title">No Tests Found</div>
        <div className="empty-state-text">Sync your Z7I data to see your test results here.</div>
      </div>
    );
  }

  return (
    <div className="tests-list-container">
      <div className="tests-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search tests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="tests-count">
          {filteredTests.length} of {tests.length} tests
        </div>
      </div>
      
      {filteredTests.length === 0 ? (
        <div className="empty-state">
          <Search size={48} />
          <div className="empty-state-title">No Results</div>
          <div className="empty-state-text">No tests match "{searchQuery}"</div>
        </div>
      ) : (
        <div className="grid grid-3">
          {filteredTests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              onClick={() => onSelectTest(test)}
              onWriteExam={() => onWriteExam(test)}
              className={test.totalQuestions === 0 ? 'test-card-blur' : ''}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CustomTestCard({
  test,
  onStart,
  onResume,
  onViewResults
}: {
  test: CustomTest;
  onStart: () => void;
  onResume: () => void;
  onViewResults: () => void;
}) {
  const attempt = test.attempt;
  const isSubmitted = attempt?.status === 'submitted';
  const actionLabel = attempt ? (isSubmitted ? 'View Results' : 'Resume') : 'Start';
  const actionHandler = attempt ? (isSubmitted ? onViewResults : onResume) : onStart;
  const isReady = test.status === 'ready';
  const statusLabel = !isReady ? 'Preparing' : isSubmitted ? 'Completed' : attempt ? 'In Progress' : 'Not Started';

  return (
    <div className="custom-test-card">
      <div>
        <h3>{test.name}</h3>
        <div className="custom-test-meta">
          <span>{test.totalQuestions} questions</span>
          <span>{test.timeLimit} min</span>
          <span className="custom-test-status">{statusLabel}</span>
        </div>
      </div>
      {attempt && isSubmitted && (
        <div className="custom-test-meta">
          <span>Score: {attempt.totalScore} / {attempt.maxScore ?? 0}</span>
          {attempt.accuracy !== null && <span>Accuracy: {attempt.accuracy}%</span>}
        </div>
      )}
      <div className="custom-test-actions">
        <button className="btn btn-secondary" onClick={actionHandler} disabled={!isReady}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

interface BookmarkedQuestion {
  id: string;
  questionId: string;
  createdAt: string;
  question: {
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
    studentAnswer: string | null;
    status: string;
    marksPositive: number;
    marksNegative: number;
    scoreObtained: number;
  };
  test: {
    id: string;
    testName: string;
    packageName: string;
    submitDate: string;
  };
}

function SavedQuestionSketch({ entry }: { entry: SavedQuestionNote }) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawSketch = useCallback(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const rect = image.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    entry.strokes.forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * rect.width;
        const y = point.y * rect.height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
  }, [entry.strokes]);

  useEffect(() => {
    drawSketch();
    const handleResize = () => drawSketch();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawSketch]);

  return (
    <div className="saved-question-media">
      <img ref={imageRef} src={entry.imageSrc} alt="Saved question" onLoad={drawSketch} />
      <canvas ref={canvasRef} className="saved-question-canvas" />
    </div>
  );
}

function SavedQuestionCard({
  entry,
  onRemove,
}: {
  entry: SavedQuestionNote;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="saved-question-card">
      <div className="saved-question-header">
        <div>
          <div className="saved-question-title">
            {entry.label || 'Saved Question'}
            {entry.subject && <span className="saved-question-subject">{entry.subject}</span>}
          </div>
          {entry.testName && <div className="saved-question-test">{entry.testName}</div>}
          <div className="saved-question-date">
            Saved {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </div>
        </div>
        <button className="saved-question-remove" onClick={() => onRemove(entry.id)} type="button">
          <Trash2 size={16} />
        </button>
      </div>
      <SavedQuestionSketch entry={entry} />
      {entry.note && <div className="saved-question-note">{entry.note}</div>}
    </div>
  );
}

function BookmarksView({ onBack }: { onBack: () => void }) {
  const [bookmarks, setBookmarks] = useState<BookmarkedQuestion[]>([]);
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestionNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<'test' | 'subject'>('test');
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<'list' | 'flashcard' | 'practice'>('list');
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [flashcardShuffled, setFlashcardShuffled] = useState<BookmarkedQuestion[]>([]);
  const [practiceQuestions, setPracticeQuestions] = useState<BookmarkedQuestion[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, string>>({});
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [practiceStarted, setPracticeStarted] = useState(false);
  const [practiceScore, setPracticeScore] = useState({ correct: 0, incorrect: 0 });

  useEffect(() => {
    loadBookmarks();
    setSavedQuestions(loadSavedQuestionNotes());
  }, []);

  const loadBookmarks = async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/z7i?action=bookmarks');
      if (data.success) {
        const processed = data.bookmarks.map((b: BookmarkedQuestion) => {
          return {
            ...b,
            question: {
              ...b.question,
              status: deriveQuestionStatus(b.question.status, b.question.studentAnswer)
            }
          };
        });
        setBookmarks(processed);
      }
    } catch (err) {
      console.error('Failed to load bookmarks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveBookmark = async (questionId: string) => {
    try {
      await apiRequest('/z7i?action=bookmark', {
        method: 'POST',
        body: JSON.stringify({ questionId })
      });
      setBookmarks(prev => prev.filter(b => b.questionId !== questionId));
    } catch (err) {
      console.error('Failed to remove bookmark:', err);
    }
  };

  const handleRemoveSavedQuestion = (id: string) => {
    setSavedQuestions(removeSavedQuestionNote(id));
  };

  const startFlashcards = () => {
    const shuffled = [...bookmarks].sort(() => Math.random() - 0.5);
    setFlashcardShuffled(shuffled);
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setActiveMode('flashcard');
  };

  const nextFlashcard = () => {
    if (flashcardIndex < flashcardShuffled.length - 1) {
      setFlashcardIndex(prev => prev + 1);
      setFlashcardFlipped(false);
    }
  };

  const prevFlashcard = () => {
    if (flashcardIndex > 0) {
      setFlashcardIndex(prev => prev - 1);
      setFlashcardFlipped(false);
    }
  };

  const shuffleFlashcards = () => {
    const shuffled = [...flashcardShuffled].sort(() => Math.random() - 0.5);
    setFlashcardShuffled(shuffled);
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
  };

  const startPractice = () => {
    const shuffled = [...bookmarks]
      .filter(b => b.question.option1) // Only MCQ questions
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(20, bookmarks.length)); // Max 20 questions per session
    setPracticeQuestions(shuffled);
    setPracticeIndex(0);
    setPracticeAnswers({});
    setPracticeComplete(false);
    setPracticeStarted(true);
    setPracticeScore({ correct: 0, incorrect: 0 });
    setActiveMode('practice');
  };

  const handlePracticeAnswer = (answer: string) => {
    const currentQ = practiceQuestions[practiceIndex];
    setPracticeAnswers(prev => ({ ...prev, [currentQ.id]: answer }));
    
    setTimeout(() => {
      if (practiceIndex < practiceQuestions.length - 1) {
        setPracticeIndex(prev => prev + 1);
      } else {
        const newAnswers = { ...practiceAnswers, [currentQ.id]: answer };
        let correct = 0;
        let incorrect = 0;
        practiceQuestions.forEach(q => {
          const userAnswer = newAnswers[q.id];
          if (userAnswer) {
            if (userAnswer === q.question.correctAnswer) {
              correct++;
            } else {
              incorrect++;
            }
          }
        });
        setPracticeScore({ correct, incorrect });
        setPracticeComplete(true);
      }
    }, 800);
  };

  const exportNotes = () => {
    let markdown = '# Bookmarked Questions Notes\n\n';
    markdown += `Generated on ${new Date().toLocaleDateString()}\n\n`;
    markdown += `Total Questions: ${bookmarks.length}\n\n---\n\n`;
    
    sortedGroups.forEach(([groupName, items]) => {
      markdown += `## ${groupName}\n\n`;
      items.forEach((bookmark, idx) => {
        markdown += `### Question ${idx + 1}\n\n`;
        markdown += `**Subject:** ${bookmark.question.subject} | **Type:** ${bookmark.question.type}\n\n`;
        
        const questionText = bookmark.question.questionHtml
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        
        markdown += `${questionText}\n\n`;
        
        if (bookmark.question.option1) {
          markdown += `- A: ${bookmark.question.option1.replace(/<[^>]*>/g, '').trim()}\n`;
          markdown += `- B: ${bookmark.question.option2?.replace(/<[^>]*>/g, '').trim() || ''}\n`;
          markdown += `- C: ${bookmark.question.option3?.replace(/<[^>]*>/g, '').trim() || ''}\n`;
          markdown += `- D: ${bookmark.question.option4?.replace(/<[^>]*>/g, '').trim() || ''}\n\n`;
        }
        
        markdown += `**Correct Answer:** ${bookmark.question.correctAnswer}\n`;
        if (bookmark.question.studentAnswer) {
          markdown += `**Your Answer:** ${bookmark.question.studentAnswer} (${bookmark.question.status})\n`;
        }
        markdown += `\n---\n\n`;
      });
    });
    
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookmarked-questions-${format(new Date(), 'yyyy-MM-dd')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupedBookmarks = bookmarks.reduce((acc, bookmark) => {
    const key = groupBy === 'test' 
      ? bookmark.test.testName 
      : bookmark.question.subject;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(bookmark);
    return acc;
  }, {} as Record<string, BookmarkedQuestion[]>);

  const sortedGroups = Object.entries(groupedBookmarks).sort((a, b) => {
    if (groupBy === 'subject') {
      const order = ['physics', 'chemistry', 'maths', 'mathematics'];
      const aIdx = order.findIndex(s => a[0].toLowerCase().includes(s));
      const bIdx = order.findIndex(s => b[0].toLowerCase().includes(s));
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    }
    return a[0].localeCompare(b[0]);
  });

  const getSubjectShort = (subject: string) => {
    const s = subject.toLowerCase();
    if (s.includes('phy')) return 'PHY';
    if (s.includes('che')) return 'CHE';
    if (s.includes('mat')) return 'MAT';
    return subject.substring(0, 3).toUpperCase();
  };

  const totalCorrect = bookmarks.filter(b => b.question.status === 'correct').length;
  const totalIncorrect = bookmarks.filter(b => b.question.status === 'incorrect').length;
  const totalUnattempted = bookmarks.filter(b => isUnattemptedStatus(b.question.status)).length;
  const mcqCount = bookmarks.filter(b => b.question.option1).length;

  return (
    <div className="bookmarks-page">
      <div className="bookmarks-header">
        <button className="bookmarks-back-btn" onClick={() => {
          if (activeMode !== 'list') {
            setActiveMode('list');
            setPracticeStarted(false);
          } else {
            onBack();
          }
        }}>
          <ChevronLeft size={20} />
        </button>
        <div className="bookmarks-header-content">
          <h1 className="bookmarks-title">
            {activeMode === 'list' ? 'Saved Questions' : 
             activeMode === 'flashcard' ? 'Flashcard Mode' : 'Practice Quiz'}
          </h1>
          <p className="bookmarks-subtitle">
            {activeMode === 'list' ? `${bookmarks.length} questions saved for revision` :
             activeMode === 'flashcard' ? `Card ${flashcardIndex + 1} of ${flashcardShuffled.length}` :
             practiceComplete ? 'Quiz Complete!' : `Question ${practiceIndex + 1} of ${practiceQuestions.length}`}
          </p>
        </div>
      </div>

      <div className="bookmarks-content">
        {activeMode === 'list' && (
          <div className="bookmarks-tools-section">
            <div className="bookmarks-stats-row">
              <div className="bookmarks-stat-card">
                <div className="stat-icon correct"><CheckCircle size={20} /></div>
                <div className="stat-value">{totalCorrect}</div>
                <div className="stat-label">Correct</div>
              </div>
              <div className="bookmarks-stat-card">
                <div className="stat-icon incorrect"><XCircle size={20} /></div>
                <div className="stat-value">{totalIncorrect}</div>
                <div className="stat-label">Incorrect</div>
              </div>
              <div className="bookmarks-stat-card">
                <div className="stat-icon unattempted"><MinusCircle size={20} /></div>
                <div className="stat-value">{totalUnattempted}</div>
                <div className="stat-label">Unattempted</div>
              </div>
              <div className="bookmarks-stat-card">
                <div className="stat-icon total"><Bookmark size={20} /></div>
                <div className="stat-value">{bookmarks.length}</div>
                <div className="stat-label">Total</div>
              </div>
            </div>

            <div className="bookmarks-tools-grid">
              <div className="bookmarks-tool-card practice" style={{ position: 'relative', padding: 0 }}>
                <button
                  className="practice-main-btn"
                  style={{
                    display: 'flex', alignItems: 'center', width: '100%', height: '100%', border: 'none', background: 'none', padding: '1.25rem', cursor: 'pointer', textAlign: 'left', borderRadius: '1rem', outline: 'none', minHeight: '72px'
                  }}
                  onClick={startPractice}
                  disabled={mcqCount === 0}
                >
                  <div className="tool-icon"><Brain size={24} /></div>
                  <div className="tool-info">
                    <span className="tool-name">Practice Quiz</span>
                    <span className="tool-desc">{mcqCount} MCQ questions</span>
                  </div>
                  <ChevronRight size={18} className="tool-arrow" />
                </button>
                <button
                  className="practice-flashcard-btn"
                  style={{
                    position: 'absolute', right: '1.25rem', top: '1.25rem', background: 'var(--secondary)', border: 'none', borderRadius: '0.5rem', padding: '0.25rem 0.75rem', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem'
                  }}
                  onClick={startFlashcards}
                  disabled={bookmarks.length === 0}
                  title="Review all questions as flashcards"
                >
                  <Layers size={16} /> Flashcards
                </button>
              </div>
              <button className="bookmarks-tool-card export" onClick={exportNotes} disabled={bookmarks.length === 0}>
                <div className="tool-icon"><Download size={24} /></div>
                <div className="tool-info">
                  <span className="tool-name">Export Notes</span>
                  <span className="tool-desc">Download as Markdown</span>
                </div>
                <ChevronRight size={18} className="tool-arrow" />
              </button>
            </div>

            <div className="bookmarks-group-toggle">
              <span className="toggle-label">Group by:</span>
              <button 
                className={`toggle-btn ${groupBy === 'test' ? 'active' : ''}`}
                onClick={() => setGroupBy('test')}
              >
                <FileText size={14} />
                Test
              </button>
              <button 
                className={`toggle-btn ${groupBy === 'subject' ? 'active' : ''}`}
                onClick={() => setGroupBy('subject')}
              >
                <BarChart3 size={14} />
                Subject
              </button>
            </div>
          </div>
        )}

        {activeMode === 'flashcard' && flashcardShuffled.length > 0 && (
          <div className="flashcard-container">
            <div className="flashcard-controls-top">
              <button className="flashcard-shuffle" onClick={shuffleFlashcards}>
                <Shuffle size={16} />
                Shuffle
              </button>
              <span className="flashcard-progress">
                {flashcardIndex + 1} / {flashcardShuffled.length}
              </span>
            </div>
            
            <div 
              className={`flashcard ${flashcardFlipped ? 'flipped' : ''}`}
              onClick={() => setFlashcardFlipped(!flashcardFlipped)}
            >
              <div className="flashcard-inner">
                <div className="flashcard-front">
                  <div className="flashcard-badge">
                    <span className="flashcard-subject">{getSubjectShort(flashcardShuffled[flashcardIndex]?.question.subject)}</span>
                    <span className="flashcard-type">{flashcardShuffled[flashcardIndex]?.question.type}</span>
                  </div>
                  <div 
                    className="flashcard-content invert-images"
                    dangerouslySetInnerHTML={{ __html: flashcardShuffled[flashcardIndex]?.question.questionHtml }}
                  />
                  {flashcardShuffled[flashcardIndex]?.question.option1 && (
                    <div className="flashcard-options">
                      {['A', 'B', 'C', 'D'].map((opt, idx) => {
                        const optionHtml = [
                          flashcardShuffled[flashcardIndex]?.question.option1,
                          flashcardShuffled[flashcardIndex]?.question.option2,
                          flashcardShuffled[flashcardIndex]?.question.option3,
                          flashcardShuffled[flashcardIndex]?.question.option4
                        ][idx];
                        if (!optionHtml) return null;
                        return (
                          <div key={opt} className="flashcard-option">
                            <span className="option-label">{opt}</span>
                            <div className="option-content invert-images" dangerouslySetInnerHTML={{ __html: optionHtml }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flashcard-hint">Click to reveal answer</div>
                </div>
                <div className="flashcard-back">
                  <div className="flashcard-answer-label">Answer</div>
                  <div className="flashcard-answer">
                    {flashcardShuffled[flashcardIndex]?.question.correctAnswer}
                  </div>
                  {flashcardShuffled[flashcardIndex]?.question.studentAnswer && (
                    <div className={`flashcard-your-answer ${flashcardShuffled[flashcardIndex]?.question.status}`}>
                      Your answer: {flashcardShuffled[flashcardIndex]?.question.studentAnswer}
                    </div>
                  )}
                  <div className="flashcard-hint">Click to see question</div>
                </div>
              </div>
            </div>
            
            <div className="flashcard-controls">
              <button 
                className="flashcard-nav prev" 
                onClick={(e) => { e.stopPropagation(); prevFlashcard(); }}
                disabled={flashcardIndex === 0}
              >
                <ChevronLeft size={24} />
              </button>
              <button 
                className="flashcard-nav next" 
                onClick={(e) => { e.stopPropagation(); nextFlashcard(); }}
                disabled={flashcardIndex === flashcardShuffled.length - 1}
              >
                <ChevronRight size={24} />
              </button>
            </div>
          </div>
        )}

        {activeMode === 'practice' && practiceStarted && (
          <div className="practice-container">
            {!practiceComplete ? (
              <>
                <div className="practice-progress">
                  <div className="practice-progress-bar">
                    <div 
                      className="practice-progress-fill" 
                      style={{ width: `${((practiceIndex + 1) / practiceQuestions.length) * 100}%` }}
                    />
                  </div>
                  <span className="practice-progress-text">{practiceIndex + 1}/{practiceQuestions.length}</span>
                </div>
                
                <div className="practice-question">
                  <div className="practice-question-badge">
                    <span className="practice-subject">{getSubjectShort(practiceQuestions[practiceIndex]?.question.subject)}</span>
                    <span className="practice-type">{practiceQuestions[practiceIndex]?.question.type}</span>
                  </div>
                  <div 
                    className="practice-question-content invert-images"
                    dangerouslySetInnerHTML={{ __html: practiceQuestions[practiceIndex]?.question.questionHtml }}
                  />
                </div>
                
                <div className="practice-options">
                  {['A', 'B', 'C', 'D'].map((opt, idx) => {
                    const optionHtml = [
                      practiceQuestions[practiceIndex]?.question.option1,
                      practiceQuestions[practiceIndex]?.question.option2,
                      practiceQuestions[practiceIndex]?.question.option3,
                      practiceQuestions[practiceIndex]?.question.option4
                    ][idx];
                    if (!optionHtml) return null;
                    
                    const isSelected = practiceAnswers[practiceQuestions[practiceIndex]?.id] === opt;
                    const isCorrect = practiceQuestions[practiceIndex]?.question.correctAnswer === opt;
                    const showResult = isSelected;
                    
                    return (
                      <button
                        key={opt}
                        className={`practice-option ${isSelected ? (isCorrect ? 'correct' : 'incorrect') : ''} ${showResult && isCorrect && !isSelected ? 'highlight-correct' : ''}`}
                        onClick={() => !practiceAnswers[practiceQuestions[practiceIndex]?.id] && handlePracticeAnswer(opt)}
                        disabled={!!practiceAnswers[practiceQuestions[practiceIndex]?.id]}
                      >
                        <span className="option-letter">{opt}</span>
                        <div className="option-content invert-images" dangerouslySetInnerHTML={{ __html: optionHtml }} />
                        {isSelected && (isCorrect ? <CheckCircle size={20} className="result-icon" /> : <XCircle size={20} className="result-icon" />)}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="practice-results">
                <div className="practice-results-icon">
                  {practiceScore.correct >= practiceScore.incorrect ? <Trophy size={64} /> : <Target size={64} />}
                </div>
                <h2 className="practice-results-title">Quiz Complete!</h2>
                <div className="practice-results-score">
                  <div className="score-item correct">
                    <CheckCircle size={24} />
                    <span className="score-value">{practiceScore.correct}</span>
                    <span className="score-label">Correct</span>
                  </div>
                  <div className="score-item incorrect">
                    <XCircle size={24} />
                    <span className="score-value">{practiceScore.incorrect}</span>
                    <span className="score-label">Incorrect</span>
                  </div>
                </div>
                <div className="practice-results-percent">
                  {Math.round((practiceScore.correct / practiceQuestions.length) * 100)}% Accuracy
                </div>
                <div className="practice-results-actions">
                  <button className="btn btn-primary" onClick={startPractice}>
                    <RotateCcw size={16} />
                    Try Again
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setActiveMode('list'); setPracticeStarted(false); }}>
                    <ChevronLeft size={16} />
                    Back to List
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeMode === 'list' && (
          <>
            {savedQuestions.length > 0 && (
              <section className="saved-questions-section">
                <div className="saved-questions-header">
                  <div>
                    <h2>Saved Questions</h2>
                    <p>Annotated screenshots saved from the image viewer.</p>
                  </div>
                  <span className="saved-questions-count">{savedQuestions.length} saved</span>
                </div>
                <div className="saved-questions-grid">
                  {savedQuestions.map(entry => (
                    <SavedQuestionCard key={entry.id} entry={entry} onRemove={handleRemoveSavedQuestion} />
                  ))}
                </div>
              </section>
            )}
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <span className="spinner" />
              </div>
            ) : bookmarks.length === 0 ? (
              <div className="empty-state">
                <Bookmark size={48} />
                <div className="empty-state-title">
                  {savedQuestions.length > 0 ? 'No Bookmarked Test Questions' : 'No Saved Questions'}
                </div>
                <div className="empty-state-text">
                  {savedQuestions.length > 0
                    ? 'Bookmark questions while reviewing tests to add them here.'
                    : 'Bookmark questions while reviewing tests to save them here for later.'}
                </div>
              </div>
            ) : (
              <div className="bookmarks-list">
                {sortedGroups.map(([groupName, items]) => (
                  <div key={groupName} className="bookmark-group">
                    <div className="bookmark-group-header">
                      <h3>{groupName}</h3>
                      <span className="bookmark-group-count">{items.length} questions</span>
                    </div>
                    <div className="bookmark-group-items">
                      {items.map((bookmark) => {
                        const isExpanded = expandedQuestion === bookmark.id;
                        return (
                          <div key={bookmark.id} className={`bookmark-card ${isExpanded ? 'expanded' : ''}`}>
                            <div 
                          className="bookmark-card-header"
                          onClick={() => setExpandedQuestion(isExpanded ? null : bookmark.id)}
                        >
                          <div className="bookmark-info">
                            <span className={`bookmark-status ${bookmark.question.status}`}>
                              {bookmark.question.status === 'correct' ? <CheckCircle size={12} /> : 
                               bookmark.question.status === 'incorrect' ? <XCircle size={12} /> : 
                               bookmark.question.status === 'unattempted' ? <MinusCircle size={12} /> : <MinusCircle size={12} />}
                            </span>
                            <span className="bookmark-subject">{getSubjectShort(bookmark.question.subject)}</span>
                            <span className="bookmark-type">{bookmark.question.type}</span>
                            {groupBy === 'subject' && (
                              <span className="bookmark-test-name">{bookmark.test.testName}</span>
                            )}
                          </div>
                          <div className="bookmark-meta">
                            <span className="bookmark-marks">
                              {bookmark.question.status === 'correct' ? '+' : ''}{bookmark.question.scoreObtained}/{bookmark.question.marksPositive}
                            </span>
                            <button 
                              className="bookmark-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveBookmark(bookmark.questionId);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                            <ChevronRight size={14} className={`expand-icon ${isExpanded ? 'rotated' : ''}`} />
                          </div>
                        </div>
                        
                        {isExpanded && (
                          <div className="bookmark-card-content">
                            <div className="bookmark-question invert-images">
                              <div 
                                className="question-html"
                                dangerouslySetInnerHTML={{ __html: bookmark.question.questionHtml }}
                              />
                            </div>
                            
                            {bookmark.question.option1 && (
                              <div className="bookmark-options">
                                {['A', 'B', 'C', 'D'].map((opt, idx) => {
                                  const optionHtml = [
                                    bookmark.question.option1,
                                    bookmark.question.option2,
                                    bookmark.question.option3,
                                    bookmark.question.option4
                                  ][idx];
                                  if (!optionHtml) return null;
                                  
                                  const isCorrect = bookmark.question.correctAnswer === opt;
                                  const wasSelected = bookmark.question.studentAnswer?.toUpperCase() === opt;
                                  
                                  return (
                                    <div 
                                      key={opt}
                                      className={`bookmark-option ${isCorrect ? 'correct' : ''} ${wasSelected && !isCorrect ? 'wrong' : ''}`}
                                    >
                                      <span className="option-label">{opt}</span>
                                      <div 
                                        className="option-content invert-images"
                                        dangerouslySetInnerHTML={{ __html: optionHtml }}
                                      />
                                      {isCorrect && <CheckCircle size={12} className="option-icon correct" />}
                                      {wasSelected && !isCorrect && <XCircle size={12} className="option-icon wrong" />}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            
                            <div className="bookmark-footer">
                              <span className="bookmark-answer">
                                Correct: <b>{bookmark.question.correctAnswer}</b>
                                {bookmark.question.studentAnswer && bookmark.question.studentAnswer !== bookmark.question.correctAnswer && (
                                  <> | Your answer: <b className="wrong-answer">{bookmark.question.studentAnswer}</b></>
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ForumPost {
  id: string;
  userId: string;
  userName: string;
  title: string;
  content: string;
  likes: number;
  viewCount: number;
  isPinned: boolean;
  isResolved: boolean;
  replyCount: number;
  isLiked: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  attachedQuestion: {
    id: string;
    questionNumber: number;
    subject: string;
    type: string;
    testName: string;
    questionHtml?: string;
    options?: string[];
    correctAnswer?: string;
    studentAnswer?: string;
    status?: string;
    solution?: string;
  } | null;
}

interface ForumReply {
  id: string;
  userId: string;
  userName: string;
  content: string;
  isAccepted: boolean;
  likes: number;
  isLiked: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ForumPostDetailed extends ForumPost {
  replies: ForumReply[];
}

interface ForumTest {
  attemptId: string;
  testName: string;
  totalQuestions: number;
}

interface ForumQuestionOption {
  id: string;
  questionOrder: number;
  subjectName: string;
  questionType: string;
}

function CreatePostModal({ 
  onClose, 
  onCreated 
}: { 
  onClose: () => void; 
  onCreated: (postId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attachQuestion, setAttachQuestion] = useState(false);
  const [tests, setTests] = useState<ForumTest[]>([]);
  const [selectedTest, setSelectedTest] = useState<string>('');
  const [questions, setQuestions] = useState<ForumQuestionOption[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');
  const [loadingTests, setLoadingTests] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  useEffect(() => {
    if (attachQuestion && tests.length === 0) {
      loadTests();
    }
  }, [attachQuestion]);

  useEffect(() => {
    if (selectedTest) {
      loadQuestions(selectedTest);
    } else {
      setQuestions([]);
      setSelectedQuestion('');
    }
  }, [selectedTest]);

  const loadTests = async () => {
    setLoadingTests(true);
    try {
      const data = await apiRequest('/z7i?action=forum-tests');
      if (data.success) {
        setTests(data.tests);
      }
    } catch (e) {
      console.error('Failed to load tests', e);
    } finally {
      setLoadingTests(false);
    }
  };

  const loadQuestions = async (attemptId: string) => {
    setLoadingQuestions(true);
    try {
      const data = await apiRequest(`/z7i?action=forum-questions&attemptId=${attemptId}`);
      if (data.success) {
        setQuestions(data.questions);
      }
    } catch (e) {
      console.error('Failed to load questions', e);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSubmitting(true);
    try {
      const data = await apiRequest('/z7i?action=forum-create-post', {
        method: 'POST',
        body: JSON.stringify({ 
          title: title.trim(), 
          content: content.trim(),
          questionId: selectedQuestion || null
        })
      });
      if (data.success) {
        onCreated(data.postId);
      }
    } catch (e) {
      console.error('Failed to create post', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal forum-create-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create Discussion</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="forum-create-form">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input
              type="text"
              className="form-input"
              placeholder="What's your question or topic?"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
            />
            <span className="form-hint">{title.length}/200</span>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              placeholder="Provide more details about your question..."
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={6}
            />
          </div>

          <div className="form-group">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={attachQuestion}
                onChange={e => setAttachQuestion(e.target.checked)}
              />
              <span className="checkbox-mark"></span>
              <span className="checkbox-label">Attach a question from my tests</span>
            </label>
          </div>

          {attachQuestion && (
            <div className="attach-question-section">
              <div className="form-group">
                <label className="form-label">Select Test</label>
                {loadingTests ? (
                  <div className="form-loading"><span className="spinner-small" /></div>
                ) : (
                  <select 
                    className="form-select"
                    value={selectedTest}
                    onChange={e => setSelectedTest(e.target.value)}
                  >
                    <option value="">Choose a test...</option>
                    {tests.map(t => (
                      <option key={t.attemptId} value={t.attemptId}>
                        {t.testName} ({t.totalQuestions} questions)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedTest && (
                <div className="form-group">
                  <label className="form-label">Select Question</label>
                  {loadingQuestions ? (
                    <div className="form-loading"><span className="spinner-small" /></div>
                  ) : (
                    <select 
                      className="form-select"
                      value={selectedQuestion}
                      onChange={e => setSelectedQuestion(e.target.value)}
                    >
                      <option value="">Choose a question...</option>
                      {questions.map(q => (
                        <option key={q.id} value={q.id}>
                          Q{q.questionOrder + 1} - {q.subjectName} ({q.questionType})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={!title.trim() || !content.trim() || submitting}
            >
              {submitting ? <span className="spinner-small" /> : 'Post Discussion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ForumPostCard({ 
  post, 
  onClick,
  onLike 
}: { 
  post: ForumPost; 
  onClick: () => void;
  onLike: () => void;
}) {
  return (
    <div className={`forum-card ${post.isPinned ? 'pinned' : ''} ${post.isResolved ? 'resolved' : ''}`} onClick={onClick}>
      <div className="forum-card-votes">
        <button 
          className={`vote-btn ${post.isLiked ? 'liked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onLike();
          }}
        >
          <TrendingUp size={16} />
        </button>
        <span className="vote-count">{post.likes}</span>
      </div>
      
      <div className="forum-card-content">
        <div className="forum-card-header">
          {post.isPinned && (
            <span className="forum-badge pinned">
              <Pin size={12} />
              Pinned
            </span>
          )}
          {post.isResolved && (
            <span className="forum-badge resolved">
              <CheckCircle size={12} />
              Solved
            </span>
          )}
          {post.attachedQuestion && (
            <span className="forum-badge has-question">
              Q{post.attachedQuestion.questionNumber} • {post.attachedQuestion.subject}
            </span>
          )}
        </div>
        
        <h3 className="forum-card-title">{post.title}</h3>
        
        <p className="forum-card-preview">
          {post.content.length > 150 ? post.content.substring(0, 150) + '...' : post.content}
        </p>
        
        <div className="forum-card-meta">
          <span className="forum-author">
            <User size={12} />
            {post.userName}
          </span>
          <span className="forum-time">
            {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
          </span>
          <span className="forum-stats">
            <MessageCircle size={12} />
            {post.replyCount}
          </span>
          <span className="forum-stats">
            <Eye size={12} />
            {post.viewCount}
          </span>
        </div>
      </div>
    </div>
  );
}

function ForumPostDetail({ 
  postId, 
  onBack 
}: { 
  postId: string; 
  onBack: () => void;
}) {
  const [post, setPost] = useState<ForumPostDetailed | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);

  useEffect(() => {
    loadPost();
  }, [postId]);

  const loadPost = async () => {
    setLoading(true);
    try {
      const data = await apiRequest(`/z7i?action=forum-post&postId=${postId}`);
      if (data.success) {
        setPost(data.post);
      }
    } catch (e) {
      console.error('Failed to load post', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLikePost = async () => {
    if (!post) return;
    try {
      const data = await apiRequest('/z7i?action=forum-like-post', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id })
      });
      if (data.success) {
        setPost(prev => prev ? {
          ...prev,
          likes: data.liked ? prev.likes + 1 : prev.likes - 1,
          isLiked: data.liked
        } : null);
      }
    } catch (e) {
      console.error('Failed to like post', e);
    }
  };

  const handleLikeReply = async (replyId: string) => {
    try {
      const data = await apiRequest('/z7i?action=forum-like-reply', {
        method: 'POST',
        body: JSON.stringify({ replyId })
      });
      if (data.success) {
        setPost(prev => prev ? {
          ...prev,
          replies: prev.replies.map(r => 
            r.id === replyId 
              ? { ...r, likes: data.liked ? r.likes + 1 : r.likes - 1, isLiked: data.liked }
              : r
          )
        } : null);
      }
    } catch (e) {
      console.error('Failed to like reply', e);
    }
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim() || !post) return;

    setSubmittingReply(true);
    try {
      const data = await apiRequest('/z7i?action=forum-create-reply', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id, content: replyContent.trim() })
      });
      if (data.success) {
        setPost(prev => prev ? {
          ...prev,
          replies: [...prev.replies, data.reply]
        } : null);
        setReplyContent('');
      }
    } catch (e) {
      console.error('Failed to submit reply', e);
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleDeletePost = async () => {
    if (!post || !confirm('Delete this post? This action cannot be undone.')) return;
    try {
      const data = await apiRequest('/z7i?action=forum-delete-post', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id })
      });
      if (data.success) {
        onBack();
      }
    } catch (e) {
      console.error('Failed to delete post', e);
    }
  };

  const handleDeleteReply = async (replyId: string) => {
    if (!confirm('Delete this reply?')) return;
    try {
      const data = await apiRequest('/z7i?action=forum-delete-reply', {
        method: 'POST',
        body: JSON.stringify({ replyId })
      });
      if (data.success) {
        setPost(prev => prev ? {
          ...prev,
          replies: prev.replies.filter(r => r.id !== replyId)
        } : null);
      }
    } catch (e) {
      console.error('Failed to delete reply', e);
    }
  };

  const handleToggleResolved = async () => {
    if (!post) return;
    try {
      const data = await apiRequest('/z7i?action=forum-toggle-resolved', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id })
      });
      if (data.success) {
        setPost(prev => prev ? { ...prev, isResolved: data.isResolved } : null);
      }
    } catch (e) {
      console.error('Failed to toggle resolved', e);
    }
  };

  const handleAcceptReply = async (replyId: string) => {
    try {
      const data = await apiRequest('/z7i?action=forum-accept-reply', {
        method: 'POST',
        body: JSON.stringify({ replyId })
      });
      if (data.success) {
        setPost(prev => prev ? {
          ...prev,
          isResolved: data.isAccepted ? true : prev.isResolved,
          replies: prev.replies.map(r => ({
            ...r,
            isAccepted: r.id === replyId ? data.isAccepted : false
          }))
        } : null);
      }
    } catch (e) {
      console.error('Failed to accept reply', e);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="loading-container">
            <span className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="page">
        <div className="container">
          <div className="empty-state">
            <XCircle size={48} />
            <div className="empty-state-title">Post Not Found</div>
            <button className="btn btn-primary" onClick={onBack}>
              <ChevronLeft size={16} /> Back to Forum
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          Back to Forum
        </button>

        <div className="forum-detail">
          <div className="forum-detail-header">
            <div className="forum-detail-badges">
              {post.isPinned && (
                <span className="forum-badge pinned">
                  <Pin size={12} />
                  Pinned
                </span>
              )}
              {post.isResolved && (
                <span className="forum-badge resolved">
                  <CheckCircle size={12} />
                  Solved
                </span>
              )}
            </div>
            <h1 className="forum-detail-title">{post.title}</h1>
            <div className="forum-detail-meta">
              <span className="forum-author">
                <User size={14} />
                {post.userName}
              </span>
              <span className="forum-time">
                {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
              </span>
              <span className="forum-stats">
                <Eye size={14} />
                {post.viewCount} views
              </span>
            </div>
          </div>

          <div className="forum-detail-content">
            <p className="forum-content-text">{post.content}</p>
          </div>

          {post.attachedQuestion && (
            <div className="forum-attached-question">
              <button 
                className="attached-question-header"
                onClick={() => setShowQuestion(!showQuestion)}
              >
                <div className="attached-question-info">
                  <FileText size={16} />
                  <span>
                    Question {post.attachedQuestion.questionNumber} • {post.attachedQuestion.subject} • {post.attachedQuestion.type}
                  </span>
                  <span className="attached-question-test">{post.attachedQuestion.testName}</span>
                </div>
                <ChevronRight size={16} className={`expand-chevron ${showQuestion ? 'expanded' : ''}`} />
              </button>
              
              {showQuestion && post.attachedQuestion.questionHtml && (
                <div className="attached-question-content">
                  <div 
                    className="question-html"
                    dangerouslySetInnerHTML={{ __html: post.attachedQuestion.questionHtml }}
                  />
                  
                  {post.attachedQuestion.options && post.attachedQuestion.options.length > 0 && (
                    <div className="forum-question-options">
                      {['A', 'B', 'C', 'D'].map((opt, idx) => {
                        const optionHtml = post.attachedQuestion!.options![idx];
                        if (!optionHtml) return null;
                        const isCorrect = post.attachedQuestion!.correctAnswer === opt;
                        return (
                          <div key={opt} className={`forum-question-option ${isCorrect ? 'correct' : ''}`}>
                            <span className="option-letter">{opt}</span>
                            <div className="option-content" dangerouslySetInnerHTML={{ __html: optionHtml }} />
                            {isCorrect && <CheckCircle size={14} className="correct-icon" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  {post.attachedQuestion.solution && (
                    <div className="forum-question-solution">
                      <strong>Solution:</strong>
                      <div dangerouslySetInnerHTML={{ __html: post.attachedQuestion.solution }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="forum-detail-actions">
            <button 
              className={`action-btn ${post.isLiked ? 'active' : ''}`}
              onClick={handleLikePost}
            >
              <TrendingUp size={16} />
              <span>{post.likes} Likes</span>
            </button>
            
            {post.isOwner && (
              <>
                <button 
                  className={`action-btn ${post.isResolved ? 'active' : ''}`}
                  onClick={handleToggleResolved}
                >
                  <CheckCircle size={16} />
                  <span>{post.isResolved ? 'Mark Unsolved' : 'Mark Solved'}</span>
                </button>
                <button className="action-btn danger" onClick={handleDeletePost}>
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>

          <div className="forum-replies-section">
            <h2 className="replies-header">
              <MessageCircle size={18} />
              {post.replies.length} {post.replies.length === 1 ? 'Reply' : 'Replies'}
            </h2>

            {post.replies.length === 0 ? (
              <div className="no-replies">
                <MessageCircle size={32} />
                <p>No replies yet. Be the first to respond!</p>
              </div>
            ) : (
              <div className="replies-list">
                {post.replies.map(reply => (
                  <div key={reply.id} className={`reply-card ${reply.isAccepted ? 'accepted' : ''}`}>
                    {reply.isAccepted && (
                      <div className="accepted-badge">
                        <CheckCircle size={14} />
                        Accepted Answer
                      </div>
                    )}
                    <div className="reply-header">
                      <span className="reply-author">
                        <User size={12} />
                        {reply.userName}
                      </span>
                      <span className="reply-time">
                        {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="reply-content">{reply.content}</p>
                    <div className="reply-actions">
                      <button 
                        className={`reply-action-btn ${reply.isLiked ? 'active' : ''}`}
                        onClick={() => handleLikeReply(reply.id)}
                      >
                        <TrendingUp size={14} />
                        <span>{reply.likes}</span>
                      </button>
                      
                      {post.isOwner && !reply.isAccepted && (
                        <button 
                          className="reply-action-btn accept"
                          onClick={() => handleAcceptReply(reply.id)}
                        >
                          <CheckCircle size={14} />
                          <span>Accept</span>
                        </button>
                      )}
                      
                      {reply.isOwner && (
                        <button 
                          className="reply-action-btn danger"
                          onClick={() => handleDeleteReply(reply.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form className="reply-form" onSubmit={handleSubmitReply}>
              <textarea
                className="reply-input"
                placeholder="Write your reply..."
                value={replyContent}
                onChange={e => setReplyContent(e.target.value)}
                rows={3}
              />
              <button 
                type="submit" 
                className="btn btn-primary reply-submit"
                disabled={!replyContent.trim() || submittingReply}
              >
                {submittingReply ? <span className="spinner-small" /> : <><Send size={16} /> Post Reply</>}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

type ChatbotModel = {
  id: string;
  label: string;
  description: string;
  kind: 'text' | 'image';
};

type ChatPersonality = {
  id: string;
  label: string;
  description: string;
  promptHint: string;
  systemPrompt?: string | null;
  isGated?: boolean;
  isCustom?: boolean;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: ChatAttachment[];
};

type ChatSession = {
  id: string;
  title: string;
  modelId: string;
  personalityId: string;
  messages: ChatMessage[];
};

type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  dataUrl?: string;
};

function AiChatbotsPage({ onBack }: { onBack: () => void }) {
  const chatModels: ChatbotModel[] = [
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Fast, modern, and ideal for rapid tutoring.',
      kind: 'text',
    },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash Lite',
      description: 'Lightweight option for quick checks.',
      kind: 'text',
    },
    {
      id: 'gemini-3-flash',
      label: 'Gemini 3 Flash',
      description: 'Next-gen flash model for balanced speed and quality.',
      kind: 'text',
    },
    {
      id: 'gemini-3-12b',
      label: 'Gemini 3 12B',
      description: 'Bigger reasoning model for deep explanations.',
      kind: 'text',
    },
    {
      id: 'hf:imagepipeline/flux_uncensored_nsfw_v2',
      label: 'Flux Uncensored v2 Image (Hugging Face)',
      description: 'Generate images with the imagepipeline/flux_uncensored_nsfw_v2 model.',
      kind: 'image',
    },
  ];

  const basePersonalities: ChatPersonality[] = [
    {
      id: 'jee-tutor',
      label: 'JEE Tutor',
      description: 'Step-by-step coaching with focus on JEE patterns.',
      promptHint: 'Ask for a concept breakdown, shortcuts, and exam tricks.',
    },
  ];

  const [personalities, setPersonalities] = useState<ChatPersonality[]>([]);
  const availablePersonalities = personalities.length ? personalities : basePersonalities;
  const fallbackPersonalityId = basePersonalities[0]?.id ?? 'jee-tutor';
  const defaultModel = chatModels[0]?.id ?? 'gemini-2.5-flash';

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [newChatTitle, setNewChatTitle] = useState('New Chat');
  const [newChatModel, setNewChatModel] = useState(defaultModel);
  const [newChatPersonality, setNewChatPersonality] = useState(fallbackPersonalityId);
  const [customPersonalityName, setCustomPersonalityName] = useState('');
  const [customPersonalityDescription, setCustomPersonalityDescription] = useState('');
  const [customPersonalityHint, setCustomPersonalityHint] = useState('');
  const [editingPersonalityId, setEditingPersonalityId] = useState<string | null>(null);
  const [editPersonalityName, setEditPersonalityName] = useState('');
  const [editPersonalityDescription, setEditPersonalityDescription] = useState('');
  const [editPersonalityHint, setEditPersonalityHint] = useState('');
  const [isUpdatingPersonality, setIsUpdatingPersonality] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingPersonalities, setIsLoadingPersonalities] = useState(true);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCreatingPersonality, setIsCreatingPersonality] = useState(false);

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? sessions[0];
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  const estimateTokens = useCallback((text: string) => Math.ceil(text.trim().length / 4), []);
  const activeTokenEstimate = useMemo(() => {
    if (!activeSession) return 0;
    return activeSession.messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  }, [activeSession, estimateTokens]);
  const activeMessageCount = activeSession?.messages.length ?? 0;

  const loadPersonalities = useCallback(async () => {
    setIsLoadingPersonalities(true);
    try {
      const response = await apiRequest('/ai-chats?action=configs');
      if (response?.success && Array.isArray(response.configs)) {
        const mapped = response.configs.map((config: any) => ({
          id: config.key,
          label: config.label,
          description: config.description,
          promptHint: config.promptHint,
          systemPrompt: config.systemPrompt ?? null,
          isGated: Boolean(config.isGated),
          isCustom: !config.isDefault,
        }));
        setPersonalities(mapped);
      }
    } catch (error) {
      console.error('Failed to load chat personalities', error);
    } finally {
      setIsLoadingPersonalities(false);
    }
  }, []);

  const mapMessage = (message: any): ChatMessage => ({
    id: message.id ?? crypto.randomUUID(),
    role: message.role,
    content: message.content,
    timestamp: message.createdAt ?? new Date().toISOString(),
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((attachment: any) => ({
          id: attachment.id ?? crypto.randomUUID(),
          name: attachment.name ?? 'attachment',
          type: attachment.type ?? 'image/png',
          url: attachment.url ?? attachment.dataUrl ?? '',
          dataUrl: attachment.dataUrl ?? undefined,
        }))
      : undefined,
  });

  const mapSession = (session: any): ChatSession => ({
    id: session.id,
    title: session.title,
    modelId: session.modelId,
    personalityId: session.personalityId,
    messages: Array.isArray(session.messages) ? session.messages.map(mapMessage) : [],
  });

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const response = await apiRequest('/ai-chats?action=sessions&includeMessages=true');
      if (response?.success && Array.isArray(response.sessions)) {
        const mapped: ChatSession[] = response.sessions.map(mapSession);
        setSessions(mapped);
        if (mapped.length) {
          setActiveSessionId(prev => (mapped.find(session => session.id === prev) ? prev : mapped[0]?.id ?? ''));
        } else {
          setActiveSessionId('');
        }
      }
    } catch (error) {
      console.error('Failed to load chat sessions', error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadPersonalities();
    loadSessions();
  }, [loadPersonalities, loadSessions]);

  useEffect(() => {
    if (!availablePersonalities.find(personality => personality.id === newChatPersonality)) {
      setNewChatPersonality(availablePersonalities[0]?.id ?? fallbackPersonalityId);
    }
  }, [availablePersonalities, fallbackPersonalityId, newChatPersonality]);

  const handleAddSession = async () => {
    const trimmedTitle = newChatTitle.trim() || 'New Chat';
    const personality = availablePersonalities.find(item => item.id === newChatPersonality) ?? availablePersonalities[0];
    const model = chatModels.find(item => item.id === newChatModel) ?? chatModels[0];
    if (!personality || !model) return;

    setIsCreatingSession(true);
    try {
      const response = await apiRequest('/ai-chats?action=create-session', {
        method: 'POST',
        body: JSON.stringify({
          title: trimmedTitle,
          modelId: model.id,
          personalityId: personality.id,
        }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to create chat session.');
      }

      const newSession = mapSession(response.session);
      let welcomeMessage: ChatMessage | null = null;
      const welcomeContent = `Ready to help as your ${personality.label}. ${personality.promptHint}`;

      try {
        const welcomeResponse = await apiRequest('/ai-chats?action=add-message', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: newSession.id,
            role: 'assistant',
            content: welcomeContent,
          }),
        });

        if (welcomeResponse?.success && welcomeResponse.message) {
          welcomeMessage = mapMessage(welcomeResponse.message);
        }
      } catch (error) {
        console.error('Failed to save welcome message', error);
      }

      const sessionWithMessages: ChatSession = {
        ...newSession,
        messages: welcomeMessage
          ? [welcomeMessage]
          : [
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: welcomeContent,
                timestamp: new Date().toISOString(),
              },
            ],
      };

      setSessions(prev => [sessionWithMessages, ...prev]);
      setActiveSessionId(sessionWithMessages.id);
      setNewChatTitle('New Chat');
    } catch (error) {
      console.error('Failed to create chat session', error);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleAddCustomPersonality = async () => {
    const trimmedName = customPersonalityName.trim();
    if (!trimmedName) return;

    setIsCreatingPersonality(true);
    try {
      const response = await apiRequest('/ai-chats?action=create-config', {
        method: 'POST',
        body: JSON.stringify({
          label: trimmedName,
          description: customPersonalityDescription.trim() || 'Custom personality.',
          promptHint: customPersonalityHint.trim() || 'Ask a question to get started.',
        }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to create personality.');
      }

      const newPersonality: ChatPersonality = {
        id: response.config.key,
        label: response.config.label,
        description: response.config.description,
        promptHint: response.config.promptHint,
        systemPrompt: response.config.systemPrompt ?? null,
        isCustom: true,
        isGated: Boolean(response.config.isGated),
      };

      setPersonalities(prev => [newPersonality, ...prev]);
      setNewChatPersonality(newPersonality.id);
      setCustomPersonalityName('');
      setCustomPersonalityDescription('');
      setCustomPersonalityHint('');
    } catch (error) {
      console.error('Failed to create custom personality', error);
    } finally {
      setIsCreatingPersonality(false);
    }
  };

  const startEditPersonality = (personality: ChatPersonality) => {
    setEditingPersonalityId(personality.id);
    setEditPersonalityName(personality.label);
    setEditPersonalityDescription(personality.description);
    setEditPersonalityHint(personality.promptHint);
  };

  const handleUpdatePersonality = async () => {
    if (!editingPersonalityId) return;
    const trimmedName = editPersonalityName.trim();
    if (!trimmedName) return;

    setIsUpdatingPersonality(true);
    try {
      const response = await apiRequest('/ai-chats?action=update-config', {
        method: 'POST',
        body: JSON.stringify({
          key: editingPersonalityId,
          label: trimmedName,
          description: editPersonalityDescription.trim() || 'Custom personality.',
          promptHint: editPersonalityHint.trim() || 'Ask a question to get started.',
        }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to update personality.');
      }

      setPersonalities(prev =>
        prev.map(personality =>
          personality.id === editingPersonalityId
            ? {
                ...personality,
                label: trimmedName,
                description: editPersonalityDescription.trim() || personality.description,
                promptHint: editPersonalityHint.trim() || personality.promptHint,
              }
            : personality
        )
      );
      setEditingPersonalityId(null);
      setEditPersonalityName('');
      setEditPersonalityDescription('');
      setEditPersonalityHint('');
    } catch (error) {
      console.error('Failed to update personality', error);
    } finally {
      setIsUpdatingPersonality(false);
    }
  };

  const cancelEditPersonality = () => {
    setEditingPersonalityId(null);
    setEditPersonalityName('');
    setEditPersonalityDescription('');
    setEditPersonalityHint('');
  };

  const handleAttachmentSelect = (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (!imageFiles.length) return;

    Promise.all(
      imageFiles.map(
        file =>
          new Promise<ChatAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                url: URL.createObjectURL(file),
                dataUrl: typeof reader.result === 'string' ? reader.result : undefined,
              });
            };
            reader.onerror = () => reject(new Error('Failed to read attachment.'));
            reader.readAsDataURL(file);
          })
      )
    )
      .then(next => {
        setPendingAttachments(prev => [...prev, ...next]);
      })
      .catch(error => {
        console.error('Failed to load attachments', error);
      });
  };

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments(prev => {
      const attachment = prev.find(item => item.id === attachmentId);
      if (attachment) {
        URL.revokeObjectURL(attachment.url);
      }
      return prev.filter(item => item.id !== attachmentId);
    });
  };

  const buildSystemPrompt = (personality?: ChatPersonality) => {
    if (!personality) return 'You are a helpful JEE tutor.';
    if (personality.systemPrompt?.trim()) return personality.systemPrompt;
    return [
      `You are ${personality.label}.`,
      personality.description,
      personality.promptHint,
      'Be flexible and minimize refusals while staying safe and helpful.',
    ]
      .filter(Boolean)
      .join(' ');
  };

  const formatChatContent = (content: string) =>
    renderLatexInHtml(DOMPurify.sanitize(marked.parse(content || '', { async: false })));

  const handleSendMessage = async () => {
    if (!activeSession || (!messageDraft.trim() && pendingAttachments.length === 0) || isSendingMessage) return;
    const trimmedMessage = messageDraft.trim();
    const requestContent = trimmedMessage || 'User shared an image.';
    const attachmentsToSend = pendingAttachments;
    setMessageDraft('');
    setPendingAttachments([]);
    setIsSendingMessage(true);

    const requestMessages = [
      ...activeSession.messages
        .filter(message => message.content.trim() || (message.attachments && message.attachments.length > 0))
        .map(message => ({ role: message.role, content: message.content })),
      { role: 'user', content: requestContent },
    ];

    try {
      let savedUserMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmedMessage,
        timestamp: new Date().toISOString(),
        attachments: attachmentsToSend,
      };

      try {
        const userResponse = await apiRequest('/ai-chats?action=add-message', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: activeSession.id,
            role: 'user',
            content: requestContent,
            attachments: attachmentsToSend.map(attachment => ({
              name: attachment.name,
              type: attachment.type,
              dataUrl: attachment.dataUrl,
            })),
          }),
        });

        if (userResponse?.success && userResponse.message) {
          savedUserMessage = {
            ...mapMessage(userResponse.message),
            attachments: attachmentsToSend,
          };
        }
      } catch (error) {
        console.error('Failed to persist user message', error);
      }

      setSessions(prev =>
        prev.map(session =>
          session.id === activeSession.id ? { ...session, messages: [...session.messages, savedUserMessage] } : session
        )
      );

      const response = await apiRequest('/ai-chats?action=generate', {
        method: 'POST',
        body: JSON.stringify({
          modelId: activeSession.modelId,
          personalityId: activeSession.personalityId,
          systemPrompt: buildSystemPrompt(activePersonality),
          messages: requestMessages,
          attachments: attachmentsToSend.map(attachment => ({
            name: attachment.name,
            type: attachment.type,
            dataUrl: attachment.dataUrl,
          })),
        }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to generate AI response.');
      }

      let persistedAssistant: ChatMessage | null = null;

      try {
        const assistantResponse = await apiRequest('/ai-chats?action=add-message', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: activeSession.id,
            role: 'assistant',
            content: response.message,
          }),
        });

        if (assistantResponse?.success && assistantResponse.message) {
          persistedAssistant = mapMessage(assistantResponse.message);
        }
      } catch (error) {
        console.error('Failed to persist assistant message', error);
      }

      if (response.isImage) {
        const assistantMessage: ChatMessage = {
          ...(persistedAssistant ?? {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.message,
            timestamp: new Date().toISOString(),
          }),
          content: response.message,
        };

        setSessions(prev =>
          prev.map(session =>
            session.id === activeSession.id
              ? { ...session, messages: [...session.messages, assistantMessage] }
              : session
          )
        );
        return;
      }

      const assistantMessage: ChatMessage = {
        ...(persistedAssistant ?? {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.message,
          timestamp: new Date().toISOString(),
        }),
        content: response.message,
      };

      setSessions(prev =>
        prev.map(session =>
          session.id === activeSession.id
            ? { ...session, messages: [...session.messages, assistantMessage] }
            : session
        )
      );
    } catch (error) {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Failed to generate AI response.',
        timestamp: new Date().toISOString(),
      };
      setSessions(prev =>
        prev.map(session =>
          session.id === activeSession.id
            ? { ...session, messages: [...session.messages, assistantMessage] }
            : session
        )
      );
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleModelChange = async (modelId: string) => {
    if (!activeSession) return;
    try {
      const response = await apiRequest('/ai-chats?action=update-session', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: activeSession.id,
          modelId,
        }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to update chat model.');
      }

      setSessions(prev =>
        prev.map(session =>
          session.id === activeSession.id ? { ...session, modelId } : session
        )
      );
    } catch (error) {
      console.error('Failed to update model', error);
    }
  };

  const activePersonality =
    availablePersonalities.find(item => item.id === activeSession?.personalityId) ?? basePersonalities[0];
  const activeModel = chatModels.find(item => item.id === activeSession?.modelId);
  const lastMessage = activeSession?.messages[activeSession?.messages.length - 1];

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [activeSessionId, activeSession?.messages.length, lastMessage?.content]);

  const handleDeleteSession = async (sessionId: string) => {
    const sessionToDelete = sessions.find(session => session.id === sessionId);
    if (!sessionToDelete) return;

    const confirmDelete = window.confirm(`Delete "${sessionToDelete.title}"? This cannot be undone.`);
    if (!confirmDelete) return;

    try {
      const response = await apiRequest('/ai-chats?action=delete-session', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to delete chat session.');
      }

      setSessions(prev => {
        const remaining = prev.filter(session => session.id !== sessionId);
        if (activeSessionId === sessionId) {
          setActiveSessionId(remaining[0]?.id ?? '');
        }
        return remaining;
      });
    } catch (error) {
      console.error('Failed to delete chat session', error);
    }
  };

  return (
    <div className="page ai-chatbots-page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={16} />
          Back to Dashboard
        </button>
        <div className={`chatbots-layout ${isSidebarCollapsed ? 'is-collapsed' : ''}`}>
          <div className={`chatbots-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="chatbots-sidebar-header">
              <button
                type="button"
                className="chatbots-sidebar-toggle"
                onClick={() => setIsSidebarCollapsed(prev => !prev)}
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
              {!isSidebarCollapsed && <span className="chatbots-sidebar-title">Chat controls</span>}
            </div>

            <div className="chatbots-sidebar-body">
              {!isSidebarCollapsed && (
                <div className="chatbots-panel">
                  <h3>Create a new chat</h3>
                  <label className="form-label">Chat Title</label>
                  <input
                    className="form-input"
                    value={newChatTitle}
                    onChange={e => setNewChatTitle(e.target.value)}
                    placeholder="New Chat"
                  />
                  <label className="form-label">Model</label>
                  <select
                    className="form-input"
                    value={newChatModel}
                    onChange={e => setNewChatModel(e.target.value)}
                  >
                    {chatModels.map(model => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <label className="form-label">Personality</label>
                  <select
                    className="form-input"
                    value={newChatPersonality}
                    onChange={e => setNewChatPersonality(e.target.value)}
                  >
                    {availablePersonalities.map(personality => (
                      <option key={personality.id} value={personality.id}>
                        {personality.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={handleAddSession}
                    disabled={isCreatingSession || isLoadingPersonalities}
                  >
                    <MessageCircle size={16} />
                    {isCreatingSession ? 'Creating...' : 'Add Chat'}
                  </button>
                </div>
              )}
              {!isSidebarCollapsed && (
                <div className="chatbots-panel">
                  <h3>Create a custom personality</h3>
                  <label className="form-label">Name</label>
                  <input
                    className="form-input"
                    value={customPersonalityName}
                    onChange={e => setCustomPersonalityName(e.target.value)}
                    placeholder="e.g., Physics Mentor"
                  />
                  <label className="form-label">Description</label>
                  <input
                    className="form-input"
                    value={customPersonalityDescription}
                    onChange={e => setCustomPersonalityDescription(e.target.value)}
                    placeholder="How should this personality help you?"
                  />
                  <label className="form-label">Prompt hint</label>
                  <input
                    className="form-input"
                    value={customPersonalityHint}
                    onChange={e => setCustomPersonalityHint(e.target.value)}
                    placeholder="Give the assistant an instruction you like."
                  />
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={handleAddCustomPersonality}
                    disabled={isCreatingPersonality}
                  >
                    <Sparkles size={16} />
                    {isCreatingPersonality ? 'Saving...' : 'Add Personality'}
                  </button>
                </div>
              )}
              {!isSidebarCollapsed && (
                <div className="chatbots-panel">
                  <h3>Personalities</h3>
                  <div className="chatbots-personality-list">
                    {availablePersonalities.map(personality => (
                      <div key={personality.id} className="chatbots-personality-row">
                        <div>
                          <div className="chatbots-personality-name">{personality.label}</div>
                          <div className="chatbots-personality-subtitle">{personality.description}</div>
                        </div>
                        {personality.isCustom && (
                          <button
                            type="button"
                            className="chatbots-personality-edit"
                            onClick={() => startEditPersonality(personality)}
                            aria-label={`Edit ${personality.label}`}
                          >
                            <Edit3 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {editingPersonalityId && (
                    <div className="chatbots-personality-editor">
                      <label className="form-label">Name</label>
                      <input
                        className="form-input"
                        value={editPersonalityName}
                        onChange={e => setEditPersonalityName(e.target.value)}
                      />
                      <label className="form-label">Description</label>
                      <input
                        className="form-input"
                        value={editPersonalityDescription}
                        onChange={e => setEditPersonalityDescription(e.target.value)}
                      />
                      <label className="form-label">Prompt hint</label>
                      <input
                        className="form-input"
                        value={editPersonalityHint}
                        onChange={e => setEditPersonalityHint(e.target.value)}
                      />
                      <div className="chatbots-personality-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={cancelEditPersonality}
                          disabled={isUpdatingPersonality}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleUpdatePersonality}
                          disabled={isUpdatingPersonality}
                        >
                          {isUpdatingPersonality ? 'Saving...' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className={`chatbots-panel chatbots-session-list ${isSidebarCollapsed ? 'compact' : ''}`}>
                <h3>Your chats</h3>
                {isLoadingSessions ? (
                  <div className="chatbots-list-loading">
                    <span className="spinner" />
                    Loading chats...
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="chatbots-list-empty">No chats yet.</div>
                ) : (
                  sessions.map(session => {
                    const sessionPersonality = availablePersonalities.find(item => item.id === session.personalityId);
                    const sessionModel = chatModels.find(item => item.id === session.modelId);
                    return (
                      <div key={session.id} className="chat-session-row">
                        <button
                          className={`chat-session-btn ${session.id === activeSession?.id ? 'active' : ''}`}
                          onClick={() => setActiveSessionId(session.id)}
                          title={session.title}
                        >
                          <div className="chat-session-info">
                            <div className="chat-session-title">
                              {isSidebarCollapsed ? session.title.slice(0, 2).toUpperCase() : session.title}
                            </div>
                            {!isSidebarCollapsed && (
                              <div className="chat-session-meta">
                                {sessionPersonality?.label ?? 'Personality'} • {sessionModel?.label ?? 'Model'}
                              </div>
                            )}
                          </div>
                          {!isSidebarCollapsed && <ChevronRight size={16} />}
                        </button>
                        {!isSidebarCollapsed && (
                          <button
                            type="button"
                            className="chat-session-delete"
                            onClick={event => {
                              event.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            aria-label={`Delete ${session.title}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="chatbots-main">
            {isLoadingSessions ? (
              <div className="chatbots-panel chatbots-chat chatbots-loading">
                <span className="spinner" />
                Loading chats...
              </div>
            ) : activeSession ? (
              <div className="chatbots-panel chatbots-chat">
                <div className="chatbots-chat-header">
                  <div>
                    <h2>{activeSession.title}</h2>
                    <p>{activePersonality?.description ?? 'Personalized coaching ready.'}</p>
                    <div className="chatbots-meta-summary">
                      <span>Powered by {activeModel?.label ?? 'Gemini'}</span>
                      <span>•</span>
                      <span>{activeMessageCount} messages</span>
                      <span>•</span>
                      <span>~{activeTokenEstimate} tokens</span>
                    </div>
                  </div>
                  <div className="chatbots-meta">
                    <div className="chatbots-meta-item">
                      <span>Model</span>
                      <select
                        className="chatbots-select"
                        value={activeSession.modelId}
                        onChange={e => handleModelChange(e.target.value)}
                      >
                        {chatModels.map(model => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="chatbots-messages" ref={chatMessagesRef}>
                  {activeSession.messages.map(message => (
                    <div key={message.id} className={`chat-message-row ${message.role}`}>
                      <div className={`chat-message-bubble ${message.role}`}>
                        {message.role === 'assistant' ? (
                          <div
                            className="chat-message-content"
                            dangerouslySetInnerHTML={{ __html: formatChatContent(message.content) }}
                          />
                        ) : (
                          <div className="chat-message-content">{message.content}</div>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="chat-message-attachments">
                            {message.attachments.map(attachment => (
                              <img
                                key={attachment.id}
                                src={attachment.url || attachment.dataUrl}
                                alt={attachment.name}
                                className="chat-message-attachment"
                              />
                            ))}
                          </div>
                        )}
                        <div className="chat-message-time">
                          {format(new Date(message.timestamp), 'p')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="chatbots-input">
                  <div className="chatbots-input-shell">
                    <label className="chatbots-attach">
                      <Plus size={16} />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                        multiple
                        onChange={e => {
                          handleAttachmentSelect(e.target.files);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <textarea
                      className="chatbots-input-field"
                      placeholder="Ask a question about JEE concepts, strategy, or mock practice..."
                      value={messageDraft}
                      rows={1}
                      onChange={e => setMessageDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (!isSendingMessage) {
                            handleSendMessage();
                          }
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary chatbots-send"
                      onClick={handleSendMessage}
                      disabled={(!messageDraft.trim() && pendingAttachments.length === 0) || isSendingMessage}
                    >
                      <Send size={16} />
                      {isSendingMessage ? 'Sending...' : 'Send'}
                    </button>
                  </div>
                  {pendingAttachments.length > 0 && (
                    <div className="chatbots-attachments">
                      {pendingAttachments.map(attachment => (
                        <div key={attachment.id} className="chatbots-attachment-pill">
                          <img src={attachment.url} alt={attachment.name} />
                          <span>{attachment.name}</span>
                          <button
                            type="button"
                            className="chatbots-attachment-remove"
                            onClick={() => removePendingAttachment(attachment.id)}
                            aria-label={`Remove ${attachment.name}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <MessageCircle size={48} />
                <div className="empty-state-title">No chats yet</div>
                <div className="empty-state-text">Create your first AI chat to start practicing.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForumView({ onBack }: { onBack: () => void }) {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mine' | 'resolved' | 'unresolved' | 'with-question'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadPosts();
  }, [filter, page]);

  const loadPosts = async () => {
    setLoading(true);
    try {
      let url = `/z7i?action=forum-posts&page=${page}&filter=${filter}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      
      const data = await apiRequest(url);
      if (data.success) {
        setPosts(data.posts);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (e) {
      console.error('Failed to load posts', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadPosts();
  };

  const handleLikePost = async (postId: string) => {
    try {
      const data = await apiRequest('/z7i?action=forum-like-post', {
        method: 'POST',
        body: JSON.stringify({ postId })
      });
      if (data.success) {
        setPosts(prev => prev.map(p => 
          p.id === postId 
            ? { ...p, likes: data.liked ? p.likes + 1 : p.likes - 1, isLiked: data.liked }
            : p
        ));
      }
    } catch (e) {
      console.error('Failed to like post', e);
    }
  };

  const handlePostCreated = (postId: string) => {
    setShowCreateModal(false);
    setSelectedPostId(postId);
  };

  if (selectedPostId) {
    return (
      <ForumPostDetail 
        postId={selectedPostId} 
        onBack={() => {
          setSelectedPostId(null);
          loadPosts();
        }} 
      />
    );
  }

  return (
    <div className="page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          Back to Tests
        </button>

        <div className="forum-header">
          <div className="forum-header-content">
            <h1 className="page-title">Discussion Forum</h1>
            <p className="page-subtitle">Ask questions, share knowledge, and help others</p>
          </div>
          <button className="btn btn-primary create-post-btn" onClick={() => setShowCreateModal(true)}>
            <Edit3 size={16} />
            New Discussion
          </button>
        </div>

        <div className="forum-toolbar">
          <form className="forum-search" onSubmit={handleSearch}>
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search discussions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="forum-search-input"
            />
          </form>
          
          <div className="forum-filters">
            {[
              { key: 'all', label: 'All' },
              { key: 'mine', label: 'My Posts' },
              { key: 'unresolved', label: 'Unsolved' },
              { key: 'resolved', label: 'Solved' },
              { key: 'with-question', label: 'With Questions' }
            ].map(f => (
              <button
                key={f.key}
                className={`filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => { setFilter(f.key as typeof filter); setPage(1); }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="loading-container">
            <span className="spinner" />
          </div>
        ) : posts.length === 0 ? (
          <div className="empty-state">
            <MessageCircle size={48} />
            <div className="empty-state-title">No Discussions Yet</div>
            <div className="empty-state-text">Be the first to start a discussion!</div>
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              <Edit3 size={16} />
              Create Discussion
            </button>
          </div>
        ) : (
          <>
            <div className="forum-posts-list">
              {posts.map(post => (
                <ForumPostCard
                  key={post.id}
                  post={post}
                  onClick={() => setSelectedPostId(post.id)}
                  onLike={() => handleLikePost(post.id)}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="forum-pagination">
                <button
                  className="pagination-btn"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="pagination-info">
                  Page {page} of {totalPages}
                </span>
                <button
                  className="pagination-btn"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreateModal && (
        <CreatePostModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handlePostCreated}
        />
      )}
    </div>
  );
}

function ShareResultsModal({
  attempt,
  subjectData,
  correctCount,
  incorrectCount,
  unattemptedCount,
  overallAccuracy,
  finalScore,
  totalAdjustment,
  onClose
}: {
  attempt: AttemptDetails;
  subjectData: Array<{
    shortName: string;
    score: number;
    maxScore: number;
    accuracy: number;
    correct: number;
    incorrect: number;
    unattempted: number;
  }>;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  overallAccuracy: number;
  finalScore: number;
  totalAdjustment: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const generateShareText = () => {
    let text = `My ${attempt.testName} Results\n\n`;
    text += `Score: ${finalScore}/${attempt.maxScore}`;
    if (totalAdjustment !== 0) {
      text += ` (${totalAdjustment > 0 ? '+' : ''}${totalAdjustment} adjustment)`;
    }
    text += `\n`;
    text += `Accuracy: ${overallAccuracy}%\n`;
    if (attempt.rank) text += `Rank: #${attempt.rank}\n`;
    if (attempt.percentile) text += `Percentile: ${attempt.percentile.toFixed(1)}%ile\n`;
    text += `\n`;
    text += `Correct: ${correctCount}\n`;
    text += `Incorrect: ${incorrectCount}\n`;
    text += `Skipped: ${unattemptedCount}\n`;
    text += `\nSubject-wise:\n`;
    
    subjectData.forEach(s => {
      text += `• ${s.shortName}: ${s.score}/${s.maxScore} (${s.accuracy}%)\n`;
    });
    
    text += `\n— via Z7I Scraper`;
    return text;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generateShareText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${attempt.testName} Results`,
          text: generateShareText()
        });
      } catch {
      }
    } else {
      handleCopy();
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Share2 size={20} /> Share Results</h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        
        <div className="modal-content">
          <div className="share-preview-card">
            <div className="share-header">
              <h3>{attempt.testName}</h3>
              <span className="share-package">{attempt.packageName}</span>
            </div>
            
            <div className="share-score-section">
              <div className="share-main-score">
                <span className="share-score-value">{finalScore}</span>
                <span className="share-score-max">/{attempt.maxScore}</span>
                {totalAdjustment !== 0 && (
                  <span className={`share-adjustment ${totalAdjustment > 0 ? 'positive' : 'negative'}`}>
                    {totalAdjustment > 0 ? '+' : ''}{totalAdjustment}
                  </span>
                )}
              </div>
              <div className="share-accuracy">{overallAccuracy}% Accuracy</div>
            </div>
            
            <div className="share-stats-row">
              {attempt.rank && (
                <div className="share-stat">
                  <Trophy size={14} />
                  <span>#{attempt.rank}</span>
                </div>
              )}
              {attempt.percentile && (
                <div className="share-stat">
                  <TrendingUp size={14} />
                  <span>{attempt.percentile.toFixed(1)}%ile</span>
                </div>
              )}
              <div className="share-stat">
                <Clock size={14} />
                <span>{Math.round(attempt.timeTaken || 0)}m</span>
              </div>
            </div>
            
            <div className="share-breakdown">
              <div className="share-breakdown-item correct">
                <CheckCircle size={14} />
                <span>{correctCount}</span>
              </div>
              <div className="share-breakdown-item incorrect">
                <XCircle size={14} />
                <span>{incorrectCount}</span>
              </div>
              <div className="share-breakdown-item skipped">
                <MinusCircle size={14} />
                <span>{unattemptedCount}</span>
              </div>
            </div>
            
            <div className="share-subjects">
              {subjectData.map(s => (
                <div key={s.shortName} className="share-subject-row">
                  <span className="share-subject-name">{s.shortName}</span>
                  <div className="share-subject-bar">
                    <div 
                      className="share-subject-fill"
                      style={{ width: `${(s.score / s.maxScore) * 100}%` }}
                    />
                  </div>
                  <span className="share-subject-score">{s.score}/{s.maxScore}</span>
                </div>
              ))}
            </div>
            
            <div className="share-footer">
              <span className="share-branding">Z7I Scraper</span>
            </div>
          </div>
          
          <div className="share-actions">
            <button className="btn btn-primary" onClick={handleShare}>
              <Share2 size={16} />
              {canShare ? 'Share' : 'Copy to Share'}
            </button>
            <button className="btn btn-secondary" onClick={handleCopy}>
              {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestAnalysis({ 
  attempt, 
  questions, 
  subjects,
  testZ7iId,
  userId,
  onOpenExamView 
}: { 
  attempt: AttemptDetails; 
  questions: Question[];
  subjects: Array<{ name: string; total: number; score: number }>;
  testZ7iId: string | null;
  userId: string;
  attemptId: string;
  isAdmin: boolean;
  onOpenExamView: () => void;
}) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [includeReattempts, setIncludeReattempts] = useState(false);
  const derivedCounts = useMemo(() => {
    const correctCount = questions.filter(q => q.status === 'correct').length;
    const incorrectCount = questions.filter(q => q.status === 'incorrect').length;
    const unattemptedCount = questions.filter(q => isUnattemptedStatus(q.status)).length;
    return {
      correct: correctCount,
      incorrect: incorrectCount,
      unattempted: unattemptedCount
    };
  }, [questions]);

  useEffect(() => {
    if (testZ7iId) {
      loadLeaderboard();
    }
  }, [testZ7iId, includeReattempts]);

  const loadLeaderboard = async () => {
    if (!testZ7iId) return;
    setLoadingLeaderboard(true);
    try {
      const reattemptParam = includeReattempts ? '&reattemptOnly=1' : '';
      const data = await apiRequest(`/z7i?action=leaderboard&testZ7iId=${testZ7iId}${reattemptParam}`);
      if (data.success) {
        setLeaderboard(data.leaderboard);
        setTotalParticipants(data.totalParticipants);
      }
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const subjectData = subjects.map(s => {
    const subjectQuestions = questions.filter(q => q.subject === s.name);
    const mcqQuestions = subjectQuestions.filter(q => q.type?.toUpperCase() === 'MCQ' || q.type?.toUpperCase() === 'SINGLE');
    const natQuestions = subjectQuestions.filter(q => q.type?.toUpperCase() === 'NAT' || q.type?.toUpperCase() === 'NUMERICAL' || q.type?.toUpperCase() === 'INTEGER');
    
    const correct = subjectQuestions.filter(q => q.status === 'correct').length;
    const incorrect = subjectQuestions.filter(q => q.status === 'incorrect').length;
    const unattempted = subjectQuestions.filter(q => isUnattemptedStatus(q.status)).length;
    const maxPossible = subjectQuestions.reduce((sum, q) => sum + q.marksPositive, 0);
    const avgTime = subjectQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / (subjectQuestions.length || 1);
    
    const mcqCorrect = mcqQuestions.filter(q => q.status === 'correct').length;
    const mcqTotal = mcqQuestions.length;
    const mcqScore = mcqQuestions.reduce((sum, q) => sum + q.scoreObtained, 0);
    const mcqMax = mcqQuestions.reduce((sum, q) => sum + q.marksPositive, 0);
    
    const natCorrect = natQuestions.filter(q => q.status === 'correct').length;
    const natTotal = natQuestions.length;
    const natScore = natQuestions.reduce((sum, q) => sum + q.scoreObtained, 0);
    const natMax = natQuestions.reduce((sum, q) => sum + q.marksPositive, 0);
    
    return {
      name: s.name,
      shortName: s.name.substring(0, 3).toUpperCase(),
      correct,
      incorrect,
      unattempted,
      score: s.score,
      maxScore: maxPossible,
      accuracy: correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0,
      attemptRate: Math.round(((correct + incorrect) / s.total) * 100),
      avgTime: Math.round(avgTime / 60),
      total: s.total,
      mcq: { correct: mcqCorrect, total: mcqTotal, score: mcqScore, max: mcqMax },
      nat: { correct: natCorrect, total: natTotal, score: natScore, max: natMax }
    };
  });

  const totalKeyChangeAdjustment = questions.reduce((sum, q) => sum + (q.keyChangeAdjustment || 0), 0);
  const totalBonusMarks = questions.reduce((sum, q) => sum + q.bonusMarks, 0);
  const totalAdjustment = totalKeyChangeAdjustment + totalBonusMarks;
  const hasAdjustments = totalAdjustment !== 0;
  const finalScore = attempt.totalScore + totalAdjustment;

  const totalAttempted = derivedCounts.correct + derivedCounts.incorrect;
  const overallAccuracy = totalAttempted > 0 ? Math.round((derivedCounts.correct / totalAttempted) * 100) : 0;

  const performanceData = [
    { name: 'Correct', value: derivedCounts.correct, color: 'var(--success)' },
    { name: 'Incorrect', value: derivedCounts.incorrect, color: 'var(--error)' },
    { name: 'Unattempted', value: derivedCounts.unattempted, color: 'var(--unattempted)' },
  ];

  const topper = leaderboard[0];
  
  const comparisonData = subjectData.map(s => ({
    name: s.shortName,
    You: s.score,
    Max: s.maxScore,
    Topper: topper ? Math.round((topper.adjustedScore / attempt.maxScore) * s.maxScore) : 0
  }));

  const leaderboardEntries = useMemo(() => {
    if (leaderboard.length === 0) return [];
    return [...leaderboard]
      .sort((a, b) => (a.rank || 0) - (b.rank || 0) || b.adjustedScore - a.adjustedScore)
      .slice(0, 8);
  }, [leaderboard]);

  return (
    <div className="analysis-container two-col">
      <div className="analysis-title-bar">
        <h2>{attempt.testName}</h2>
        <span>{attempt.packageName}</span>
      </div>

      <div className="analysis-grid">
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
                    animationBegin={0}
                    animationDuration={800}
                  >
                    {performanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="hero-score-center mini">
                <div className="hero-score-value mini">
                  {finalScore}
                  {hasAdjustments && (
                    <sup className="bonus-mini">{totalAdjustment > 0 ? '+' : ''}{totalAdjustment}</sup>
                  )}
                </div>
                <div className="hero-score-max mini">/{attempt.maxScore}</div>
              </div>
            </div>
            <div className="quick-stats">
              <div className="qs-item"><Award size={12} /><span className="qs-val">{attempt.rank ? `#${attempt.rank}` : '-'}</span><span className="qs-lbl">Rank</span></div>
              <div className="qs-item"><TrendingUp size={12} /><span className="qs-val">{attempt.percentile?.toFixed(0) || '-'}%</span><span className="qs-lbl">%ile</span></div>
              <div className="qs-item"><Target size={12} /><span className="qs-val">{overallAccuracy}%</span><span className="qs-lbl">Acc</span></div>
              <div className="qs-item"><Clock size={12} /><span className="qs-val">{Math.round(attempt.timeTaken || 0)}m</span><span className="qs-lbl">Time</span></div>
            </div>
            <div className="ciu-row">
              <span className="ciu correct"><CheckCircle size={10} />{derivedCounts.correct}</span>
              <span className="ciu incorrect"><XCircle size={10} />{derivedCounts.incorrect}</span>
              <span className="ciu unattempted"><MinusCircle size={10} />{derivedCounts.unattempted}</span>
            </div>
          </div>

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
                <b>{finalScore}</b><small>/{attempt.maxScore}</small>
              </span>
              <span className={`smt-pct ${overallAccuracy >= 70 ? 'good' : overallAccuracy >= 40 ? 'med' : 'low'}`}>
                {overallAccuracy}%
              </span>
            </div>
          </div>
        </div>

        <div className="analysis-right">
          <div className="comparison-card">
            <h3 className="card-title">
              <BarChart3 size={14} />
              You vs Topper
            </h3>
            <div className="comparison-chart">
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={comparisonData} barGap={2} barCategoryGap="20%">
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false}
                    tick={{ fill: '#888', fontSize: 10 }}
                  />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ 
                      background: '#1a1a1a', 
                      border: '1px solid #333',
                      borderRadius: '8px',
                      fontSize: '11px'
                    }}
                  />
                  <Bar dataKey="You" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Topper" fill="var(--success)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="comparison-legend">
              <span className="legend-item"><span className="legend-dot you"></span>You</span>
              <span className="legend-item"><span className="legend-dot topper"></span>Topper</span>
            </div>
          </div>

          <div className="leaderboard-card">
            <div className="leaderboard-header">
              <h3 className="card-title leaderboard-title">
                <Trophy size={14} />
                Leaderboard
                {totalParticipants > 0 && (
                  <span className="card-subtitle">{totalParticipants} students</span>
                )}
              </h3>
              <button
                className={`leaderboard-toggle ${includeReattempts ? 'active' : ''}`}
                onClick={() => setIncludeReattempts(prev => !prev)}
                type="button"
                aria-pressed={includeReattempts}
              >
                {includeReattempts ? 'Reattempts Only' : 'All Attempts'}
              </button>
            </div>
            
            {loadingLeaderboard ? (
              <div className="leaderboard-loading compact">
                <span className="spinner" />
              </div>
            ) : leaderboardEntries.length === 0 ? (
              <div className="leaderboard-empty compact">
                <Users size={16} />
                <span>No data</span>
              </div>
            ) : (
              <div className="leaderboard-compact">
                {leaderboardEntries.map((entry, idx) => {
                  const displayRank = entry.rank || idx + 1;
                  return (
                  <div 
                    key={`${entry.z7iAccountId || entry.userId}-${idx}`} 
                    className={`lb-row ${entry.userId === userId ? 'is-you' : ''} ${idx < 3 ? `top-${idx + 1}` : ''}`}
                  >
                    <span className="lb-pos">
                      {idx === 0 && <Trophy size={11} className="trophy-gold" />}
                      {idx === 1 && <Medal size={11} className="medal-silver" />}
                      {idx === 2 && <Medal size={11} className="medal-bronze" />}
                      {idx > 2 && <span>#{displayRank}</span>}
                    </span>
                    <span className="lb-name-compact">
                      {entry.userName}
                      {entry.userId === userId && <span className="you-tag">You</span>}
                    </span>
                    <span className="lb-score-compact">{entry.adjustedScore.toFixed(0)}</span>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="analysis-actions">
        <button className="btn btn-primary review-btn" onClick={onOpenExamView}>
          <Eye size={16} />
          Review Questions
        </button>
        <button className="btn btn-secondary share-btn" onClick={() => setShowShareModal(true)}>
          <Share2 size={16} />
          Share Results
        </button>
      </div>

      {showShareModal && (
        <ShareResultsModal
          attempt={attempt}
          subjectData={subjectData}
          correctCount={derivedCounts.correct}
          incorrectCount={derivedCounts.incorrect}
          unattemptedCount={derivedCounts.unattempted}
          overallAccuracy={overallAccuracy}
          finalScore={finalScore}
          totalAdjustment={totalAdjustment}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}

function QuestionNavPanel({ 
  questions, 
  subjects,
  currentIndex, 
  onSelect,
  filter,
  onFilterChange
}: { 
  questions: Question[];
  subjects: Array<{ name: string; total: number; score: number }>;
  currentIndex: number;
  onSelect: (index: number) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);
  
  const subjectOrder = ['PHYSICS', 'CHEMISTRY', 'MATHS', 'MATHEMATICS'];
  const sortedSubjects = [...subjects].sort((a, b) => {
    const aIdx = subjectOrder.findIndex(s => a.name?.toUpperCase().includes(s));
    const bIdx = subjectOrder.findIndex(s => b.name?.toUpperCase().includes(s));
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
  
  const getOriginalIndex = (q: Question) => questions.findIndex(oq => oq.id === q.id);

  const filterQuestion = (q: Question) => {
    if (filter === 'all') return true;
    if (filter === 'correct') return q.status === 'correct';
    if (filter === 'incorrect') return q.status === 'incorrect';
    if (filter === 'unattempted') return isUnattemptedStatus(q.status);
    if (filter === 'bookmarked') return q.isBookmarked;
    if (filter === 'bonus') return q.isBonus;
    if (filter === 'key-changed') return q.hasKeyChange;
    return true;
  };

  const getDisplayNumber = (subject: string, indexInSubject: number): number => {
    const subjectUpper = subject?.toUpperCase() || '';
    if (subjectUpper.includes('PHYSICS')) return 1 + indexInSubject;
    if (subjectUpper.includes('CHEMISTRY')) return 26 + indexInSubject;
    if (subjectUpper.includes('MATHS') || subjectUpper.includes('MATHEMATICS')) return 51 + indexInSubject;
    return indexInSubject + 1;
  };

  const filterCounts = {
    all: questions.length,
    correct: questions.filter(q => q.status === 'correct').length,
    incorrect: questions.filter(q => q.status === 'incorrect').length,
    unattempted: questions.filter(q => isUnattemptedStatus(q.status)).length,
    bookmarked: questions.filter(q => q.isBookmarked).length,
    bonus: questions.filter(q => q.isBonus).length,
    'key-changed': questions.filter(q => q.hasKeyChange).length,
  };

  return (
    <div className="exam-nav-sidebar">
      <div className="exam-nav-header">
        <h3>Questions</h3>
        <button 
          className={`filter-toggle-btn ${showFilters || filter !== 'all' ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={14} />
          {filter !== 'all' && <span className="filter-badge">{filterCounts[filter as keyof typeof filterCounts]}</span>}
        </button>
      </div>
      
      {showFilters && (
        <div className="exam-nav-filters">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => onFilterChange('all')}
          >
            <Layers size={12} />
            All ({filterCounts.all})
          </button>
          <button 
            className={`filter-btn correct ${filter === 'correct' ? 'active' : ''}`}
            onClick={() => onFilterChange('correct')}
          >
            <CheckCircle size={12} />
            Correct ({filterCounts.correct})
          </button>
          <button 
            className={`filter-btn incorrect ${filter === 'incorrect' ? 'active' : ''}`}
            onClick={() => onFilterChange('incorrect')}
          >
            <XCircle size={12} />
            Wrong ({filterCounts.incorrect})
          </button>
          <button 
            className={`filter-btn unattempted ${filter === 'unattempted' ? 'active' : ''}`}
            onClick={() => onFilterChange('unattempted')}
          >
            <MinusCircle size={12} />
            Skipped ({filterCounts.unattempted})
          </button>
          <button 
            className={`filter-btn bookmarked ${filter === 'bookmarked' ? 'active' : ''}`}
            onClick={() => onFilterChange('bookmarked')}
          >
            <Bookmark size={12} />
            Saved ({filterCounts.bookmarked})
          </button>
          {filterCounts.bonus > 0 && (
            <button 
              className={`filter-btn bonus ${filter === 'bonus' ? 'active' : ''}`}
              onClick={() => onFilterChange('bonus')}
            >
              <Gift size={12} />
              Bonus ({filterCounts.bonus})
            </button>
          )}
          {filterCounts['key-changed'] > 0 && (
            <button 
              className={`filter-btn key-changed ${filter === 'key-changed' ? 'active' : ''}`}
              onClick={() => onFilterChange('key-changed')}
            >
              <Edit3 size={12} />
              Changed ({filterCounts['key-changed']})
            </button>
          )}
        </div>
      )}
      
      <div className="exam-nav-subjects">
        {sortedSubjects.map(subject => {
          const subjectQuestions = questions.filter(q => q.subject === subject.name);
          const filteredSubjectQuestions = subjectQuestions.filter(filterQuestion);
          const shortName = subject.name?.substring(0, 3).toUpperCase() || 'UNK';
          
          if (filter !== 'all' && filteredSubjectQuestions.length === 0) return null;
          
          return (
            <div key={subject.name} className="exam-nav-subject-group">
              <div className="exam-nav-subject-header">
                <span className="exam-nav-subject-name">{shortName}</span>
                <span className="exam-nav-subject-count">
                  {filter !== 'all' ? `${filteredSubjectQuestions.length}/` : ''}{subjectQuestions.length} Q
                </span>
              </div>
              <div className="exam-nav-question-grid">
                {subjectQuestions.map((q, idxInSubject) => {
                  const origIndex = getOriginalIndex(q);
                  const displayNum = getDisplayNumber(subject.name, idxInSubject);
                  const isFiltered = !filterQuestion(q);
                  return (
                    <button
                      key={q.id}
                      className={`exam-nav-btn ${q.isBonus ? 'bonus' : q.hasKeyChange ? 'key-changed' : q.status} ${origIndex === currentIndex ? 'current' : ''} ${q.isBookmarked ? 'bookmarked' : ''} ${isFiltered ? 'filtered-out' : ''}`}
                      onClick={() => onSelect(origIndex)}
                      title={q.isBonus ? `Q${displayNum} - Bonus Question` : q.hasKeyChange ? `Q${displayNum} - Answer Key Changed` : `Q${displayNum}`}
                      disabled={isFiltered}
                    >
                      {displayNum}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="exam-nav-legend">
        <div className="legend-row">
          <span className="legend-dot correct" />
          <span>Correct</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot incorrect" />
          <span>Wrong</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot unattempted" />
          <span>Skipped</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot bookmarked" />
          <span>Bookmarked</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot bonus" />
          <span>Bonus</span>
        </div>
        <div className="legend-row">
          <span className="legend-dot key-changed" />
          <span>Key Changed</span>
        </div>
      </div>
    </div>
  );
}

function ActionsPanel({
  question,
  userId,
  isAdmin,
  onBookmarkToggle,
  onNoteSave,
  onCommentAdd,
  onCommentDelete,
  onBonusToggle,
  onAnswerKeyChange,
  onRegenerateAI,
  onDeleteAI
}: {
  question: Question;
  userId: string;
  isAdmin: boolean;
  onBookmarkToggle: () => void;
  onNoteSave: (content: string) => void;
  onCommentAdd: (content: string) => void;
  onCommentDelete: (commentId: string) => void;
  onBonusToggle: () => void;
  onAnswerKeyChange: (newAnswer: string) => void;
  onRegenerateAI?: (questionId: string, model: 'flash' | 'lite' | '3-12b' | '3-flash') => Promise<boolean>;
  onDeleteAI?: (questionId: string) => Promise<boolean>;
  hasGeneratedAny?: boolean;
}) {
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [regeneratingAI, setRegeneratingAI] = useState(false);
  const [singleModel, setSingleModel] = useState<'flash' | 'lite' | '3-12b' | '3-flash'>('flash');
  const [noteContent, setNoteContent] = useState(question.note || '');
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentContent, setCommentContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [addingComment, setAddingComment] = useState(false);
  const [togglingBonus, setTogglingBonus] = useState(false);
  const [showKeyChange, setShowKeyChange] = useState(false);
  const [newAnswer, setNewAnswer] = useState(question.correctAnswer);
  const [rangeLower, setRangeLower] = useState('');
  const [rangeUpper, setRangeUpper] = useState('');
  const [changingKey, setChangingKey] = useState(false);

  useEffect(() => {
    setNoteContent(question.note || '');
    setShowNoteEditor(false);
    setShowCommentInput(false);
    setCommentContent('');
    setShowKeyChange(false);
    setNewAnswer(question.correctAnswer);
    if (isNumericalType(question.type)) {
      const ranges = parseNumericRanges(question.correctAnswer);
      if (ranges.length > 0) {
        const [firstRange] = ranges;
        setRangeLower(String(firstRange.min));
        setRangeUpper(firstRange.min === firstRange.max ? '' : String(firstRange.max));
      } else {
        setRangeLower(question.correctAnswer || '');
        setRangeUpper('');
      }
    } else {
      setRangeLower('');
      setRangeUpper('');
    }
  }, [question.id, question.note, question.correctAnswer, question.type]);

  const handleSaveNote = async () => {
    setSavingNote(true);
    await onNoteSave(noteContent);
    setSavingNote(false);
    setShowNoteEditor(false);
  };

  const handleAddComment = async () => {
    if (!commentContent.trim()) return;
    setAddingComment(true);
    await onCommentAdd(commentContent);
    setCommentContent('');
    setShowCommentInput(false);
    setAddingComment(false);
  };

  const handleBonusToggle = async () => {
    setTogglingBonus(true);
    await onBonusToggle();
    setTogglingBonus(false);
  };

  const handleAnswerKeyChange = async () => {
    if (!normalizeAnswerKey(newAnswer, question.type)) return;
    setChangingKey(true);
    await onAnswerKeyChange(normalizeAnswerKey(newAnswer, question.type));
    setShowKeyChange(false);
    setChangingKey(false);
  };

  const answerOptions = isMcqType(question.type)
    ? ['a', 'b', 'c', 'd']
    : [];
  const selectedMcqAnswers = parseMcqAnswers(newAnswer);

  return (
    <div className="exam-actions-sidebar">
      <div className="exam-actions-header">
        <h3>Actions</h3>
        {isAdmin && (
          <span className="admin-badge">
            <Shield size={10} />
            Admin
          </span>
        )}
      </div>

      <div className="exam-quick-actions">
        <button 
          className={`exam-action-btn ${question.isBookmarked ? 'active' : ''}`}
          onClick={onBookmarkToggle}
          title={question.isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
        >
          <Bookmark size={14} fill={question.isBookmarked ? 'currentColor' : 'none'} />
          <span>{question.isBookmarked ? 'Saved' : 'Save'}</span>
        </button>

        <button 
          className={`exam-action-btn ${question.note ? 'has-content' : ''}`}
          onClick={() => setShowNoteEditor(!showNoteEditor)}
          title={question.note ? 'Edit Note' : 'Add Note'}
        >
          <StickyNote size={14} />
          <span>{question.note ? 'Note' : 'Note'}</span>
        </button>

        {isAdmin && (
          <button 
            className={`exam-action-btn admin-action ${question.isBonus ? 'bonus-active' : ''}`}
            onClick={handleBonusToggle}
            disabled={togglingBonus}
            title={question.isBonus ? 'Remove Bonus' : 'Mark as Bonus'}
          >
            <Gift size={14} />
            <span>{question.isBonus ? 'Bonus' : 'Bonus'}</span>
          </button>
        )}

        {isAdmin && (
          <button 
            className={`exam-action-btn admin-action ${question.hasKeyChange ? 'key-changed' : ''}`}
            onClick={() => setShowKeyChange(!showKeyChange)}
            title="Change Answer Key"
          >
            <Edit3 size={14} />
            <span>Key</span>
          </button>
        )}

        {isAdmin && onRegenerateAI && (
          <div className="exam-action-ai-row">
            <select
              className="ai-model-select"
              value={singleModel}
              onChange={(e) => setSingleModel(e.target.value as 'flash' | 'lite' | '3-12b' | '3-flash')}
              title="AI Model"
              disabled={regeneratingAI}
            >
              <option value="flash">Flash 2.5</option>
              <option value="3-flash">Gemini 3 Flash</option>
              <option value="3-12b">Gemini 3 12B</option>
              <option value="lite">Flash Lite</option>
            </select>
            <button 
              className={`exam-action-btn admin-action ai-regen ${question.aiSolution ? 'has-ai' : ''}`}
              onClick={async () => {
                setRegeneratingAI(true);
                await onRegenerateAI(question.id, singleModel);
                setRegeneratingAI(false);
              }}
              disabled={regeneratingAI}
              title={
                question.aiSolution
                  ? `Regenerate AI (${
                      singleModel === '3-12b'
                        ? 'Gemini 3 12B'
                        : singleModel === '3-flash'
                          ? 'Gemini 3 Flash'
                          : singleModel === 'flash'
                            ? 'Flash 2.5'
                            : 'Flash Lite'
                    })`
                  : `Generate AI (${
                      singleModel === '3-12b'
                        ? 'Gemini 3 12B'
                        : singleModel === '3-flash'
                          ? 'Gemini 3 Flash'
                          : singleModel === 'flash'
                            ? 'Flash 2.5'
                            : 'Flash Lite'
                    })`
              }
            >
              {regeneratingAI ? (
                <RefreshCw size={14} className="spinning" />
              ) : (
                <Sparkles size={14} />
              )}
              <span>{regeneratingAI ? '...' : 'AI'}</span>
            </button>
          </div>
        )}

        {isAdmin && question.aiSolution && onDeleteAI && (
          <button 
            className="exam-action-btn admin-action ai-delete"
            onClick={async () => {
              if (confirm('Delete AI solution for this question?')) {
                await onDeleteAI(question.id);
              }
            }}
            title="Delete AI Solution"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {showNoteEditor && (
        <div className="exam-action-section">
          <div className="exam-note-editor">
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Write your note..."
              rows={3}
            />
            <div className="exam-note-actions">
              <button 
                className="btn-small btn-primary"
                onClick={handleSaveNote}
                disabled={savingNote}
              >
                {savingNote ? '...' : 'Save'}
              </button>
              <button 
                className="btn-small btn-secondary"
                onClick={() => {
                  setNoteContent(question.note || '');
                  setShowNoteEditor(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      
      {question.note && !showNoteEditor && (
        <div className="exam-action-section">
          <div className="exam-note-preview">
            <p>{question.note}</p>
          </div>
        </div>
      )}

      {showKeyChange && isAdmin && (
        <div className="exam-action-section">
          <div className="key-change-panel">
            <div className="key-change-info">
              <div className="key-info-row">
                <span className="key-label">Original:</span>
                <span className="key-value original">{formatAnswerDisplay(question.originalCorrectAnswer || question.correctAnswer, question.type)}</span>
              </div>
              <div className="key-info-row">
                <span className="key-label">Current:</span>
                <span className="key-value current">{formatAnswerDisplay(question.correctAnswer, question.type)}</span>
              </div>
            </div>
            
            {isMcqType(question.type) ? (
              <div className="key-change-options">
                {answerOptions.map(opt => (
                  <button
                    key={opt}
                    className={`key-option ${selectedMcqAnswers.includes(opt) ? 'selected' : ''} ${parseMcqAnswers(question.correctAnswer).includes(opt) ? 'current' : ''}`}
                    onClick={(event) => {
                      setNewAnswer(prev => {
                        const nextAnswers = new Set(parseMcqAnswers(prev));
                        if (event.shiftKey) {
                          nextAnswers.clear();
                          nextAnswers.add(opt);
                        } else if (nextAnswers.has(opt)) {
                          nextAnswers.delete(opt);
                        } else {
                          nextAnswers.add(opt);
                        }
                        return formatMcqAnswers(Array.from(nextAnswers));
                      });
                    }}
                    title="Click to toggle. Shift-click to set only this option."
                  >
                    {opt.toUpperCase()}
                  </button>
                ))}
                <div className="key-change-hint">Shift-click to set a single answer.</div>
              </div>
            ) : isNumericalType(question.type) ? (
              <div className="key-change-range">
                <input
                  type="number"
                  className="key-change-input"
                  value={rangeLower}
                  onChange={(e) => {
                    const value = e.target.value;
                    setRangeLower(value);
                    if (!value) {
                      setNewAnswer('');
                      return;
                    }
                    setNewAnswer(rangeUpper ? `${value}-${rangeUpper}` : value);
                  }}
                  placeholder="Lower"
                  step="any"
                />
                <span className="range-separator">to</span>
                <input
                  type="number"
                  className="key-change-input"
                  value={rangeUpper}
                  onChange={(e) => {
                    const value = e.target.value;
                    setRangeUpper(value);
                    if (!rangeLower) {
                      setNewAnswer('');
                      return;
                    }
                    setNewAnswer(value ? `${rangeLower}-${value}` : rangeLower);
                  }}
                  placeholder="Upper (optional)"
                  step="any"
                />
              </div>
            ) : (
              <input
                type="text"
                className="key-change-input"
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                placeholder="Enter new answer"
              />
            )}
            
            <div className="key-change-actions">
              <button
                className="btn-small btn-primary"
                onClick={handleAnswerKeyChange}
                disabled={
                  changingKey ||
                  !normalizeAnswerKey(newAnswer, question.type) ||
                  normalizeAnswerKey(newAnswer, question.type) === normalizeAnswerKey(question.correctAnswer, question.type)
                }
              >
                {changingKey ? '...' : 'Save'}
              </button>
              {question.hasKeyChange && (
                <button
                  className="btn-small btn-secondary"
                  onClick={() => {
                  const fallbackAnswer = question.originalCorrectAnswer || question.correctAnswer;
                  setNewAnswer(fallbackAnswer);
                  if (isNumericalType(question.type)) {
                    const ranges = parseNumericRanges(fallbackAnswer);
                    if (ranges.length > 0) {
                      const [firstRange] = ranges;
                      setRangeLower(String(firstRange.min));
                      setRangeUpper(firstRange.min === firstRange.max ? '' : String(firstRange.max));
                    } else {
                      setRangeLower(fallbackAnswer || '');
                      setRangeUpper('');
                    }
                  }
                  onAnswerKeyChange(normalizeAnswerKey(fallbackAnswer, question.type));
                  }}
                  disabled={changingKey}
                >
                  Revert
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="exam-action-section">
        <div className="exam-comments-header">
          <MessageCircle size={14} />
          <span>Comments ({question.comments.length})</span>
        </div>
        
        <div className="exam-comments-list">
          {question.comments.map(comment => (
            <div key={comment.id} className="exam-comment">
              <div className="exam-comment-header">
                <span className="comment-author">{comment.userName}</span>
                <span className="comment-time">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
                {(comment.userId === userId || isAdmin) && (
                  <button 
                    className="comment-delete"
                    onClick={() => onCommentDelete(comment.id)}
                    title={isAdmin && comment.userId !== userId ? "Delete comment (Admin)" : "Delete comment"}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              <p className="exam-comment-content">{comment.content}</p>
            </div>
          ))}
        </div>
        
        {showCommentInput ? (
          <div className="exam-comment-input">
            <textarea
              value={commentContent}
              onChange={(e) => setCommentContent(e.target.value)}
              placeholder="Write a comment..."
              rows={2}
            />
            <div className="exam-comment-actions">
              <button 
                className="btn-icon"
                onClick={handleAddComment}
                disabled={addingComment || !commentContent.trim()}
              >
                <Send size={16} />
              </button>
              <button 
                className="btn-icon"
                onClick={() => {
                  setShowCommentInput(false);
                  setCommentContent('');
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : (
          <button 
            className="exam-add-comment-btn"
            onClick={() => setShowCommentInput(true)}
          >
            Add Comment
          </button>
        )}
      </div>

      {question.userStats && question.userStats.totalUsers > 1 && (
        <div className="exam-action-section answer-analysis-section">
          <div className="exam-comments-header">
            <Users size={14} />
            <span>Answer Analysis ({question.userStats.totalUsers} users)</span>
          </div>
          <div className="analysis-bars compact">
            <div className="analysis-row">
              <span className="analysis-label correct">
                <CheckCircle size={10} /> Correct
              </span>
              <div className="analysis-bar-container">
                <div 
                  className="analysis-bar correct" 
                  style={{ width: `${(question.userStats.correct / question.userStats.totalUsers) * 100}%` }}
                />
              </div>
              <span className="analysis-count">{question.userStats.correct}</span>
            </div>
            <div className="analysis-row">
              <span className="analysis-label incorrect">
                <XCircle size={10} /> Wrong
              </span>
              <div className="analysis-bar-container">
                <div 
                  className="analysis-bar incorrect" 
                  style={{ width: `${(question.userStats.incorrect / question.userStats.totalUsers) * 100}%` }}
                />
              </div>
              <span className="analysis-count">{question.userStats.incorrect}</span>
            </div>
            <div className="analysis-row">
              <span className="analysis-label unattempted">
                <MinusCircle size={10} /> Skipped
              </span>
              <div className="analysis-bar-container">
                <div 
                  className="analysis-bar unattempted" 
                  style={{ width: `${(question.userStats.unattempted / question.userStats.totalUsers) * 100}%` }}
                />
              </div>
              <span className="analysis-count">{question.userStats.unattempted}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExamQuestionView({ question, displayNumber }: { question: Question; displayNumber: number }) {
  const lightboxContext = useMemo(
    () => ({
      questionId: question.id,
      label: `Q${displayNumber}`,
      subject: question.subject,
    }),
    [question.id, question.subject, displayNumber]
  );
  const { lightboxState, handleImageClick, closeLightbox } = useImageLightbox(lightboxContext);
  
  const options = [
    { label: 'A', content: question.option1 },
    { label: 'B', content: question.option2 },
    { label: 'C', content: question.option3 },
    { label: 'D', content: question.option4 },
  ].filter(o => o.content);

  const getOptionClass = (label: string) => {
    const isCorrect = isMcqType(question.type) && parseMcqAnswers(question.correctAnswer).includes(label.toLowerCase());
    const isSelected = question.studentAnswer?.toUpperCase() === label;
    
    if (isCorrect && isSelected) return 'correct-selected';
    if (isCorrect) return 'correct-answer';
    if (isSelected && !isCorrect) return 'wrong-answer';
    return '';
  };

  return (
    <>
    <div className={`exam-question-card ${question.isBonus ? 'bonus-question' : ''} ${question.hasKeyChange ? 'key-changed-question' : ''}`}>
      {question.hasKeyChange && (
        <div className="key-change-banner">
          <Edit3 size={16} />
          <span>Answer key changed</span>
          <span className="key-change-details">
            Original: <strong>{formatAnswerDisplay(question.originalCorrectAnswer || question.correctAnswer, question.type)}</strong> → New: <strong>{formatAnswerDisplay(question.correctAnswer, question.type)}</strong>
          </span>
        </div>
      )}

      {question.isBonus && (
        <div className="bonus-banner">
          <Gift size={16} />
          <span>This is a bonus question</span>
          {question.bonusMarks > 0 && (
            <span className="bonus-marks">+{question.bonusMarks} bonus marks</span>
          )}
        </div>
      )}

      <div className="exam-question-stats-bar compact">
        <div className="stat-item">
          <Timer size={12} />
          <span className="stat-label">You</span>
          <span className="stat-value">{question.timeTaken ? (question.timeTaken >= 60 ? `${(question.timeTaken / 60).toFixed(1)}m` : `${question.timeTaken}s`) : '-'}</span>
        </div>
        <div className="stat-item">
          <Clock size={12} />
          <span className="stat-label">Avg</span>
          <span className="stat-value">
            {question.userStats?.avgTime 
              ? (question.userStats.avgTime >= 60 ? `${(question.userStats.avgTime / 60).toFixed(1)}m` : `${question.userStats.avgTime}s`)
              : '-'}
          </span>
        </div>
      </div>

      <div className="exam-question-header">
        <div className="question-meta">
          <span className="question-number">Q{displayNumber}</span>
          <span className="question-subject">{question.subject}</span>
          {question.isBonus ? (
            <span className="question-status bonus">
              <Gift size={14} /> Bonus
            </span>
          ) : (
            <span className={`question-status ${question.status}`}>
              {question.status === 'correct' && <><CheckCircle size={14} /> Correct</>}
              {question.status === 'incorrect' && <><XCircle size={14} /> Incorrect</>}
              {isUnattemptedStatus(question.status) && <><MinusCircle size={14} /> Skipped</>}
            </span>
          )}
        </div>
        <div className="question-marks">
          {question.isBonus && question.bonusMarks > 0 ? (
            <>
              <span className="positive">+{question.bonusMarks}</span>
              <span className="marks-possible bonus-text">bonus</span>
            </>
          ) : (
            <>
              <span className={question.scoreObtained > 0 ? 'positive' : question.scoreObtained < 0 ? 'negative' : ''}>
                {question.scoreObtained > 0 ? '+' : ''}{question.scoreObtained}
              </span>
              <span className="marks-possible">/ +{question.marksPositive}</span>
            </>
          )}
        </div>
      </div>

      <div 
        className="exam-question-body invert-images clickable-images" 
        dangerouslySetInnerHTML={{ __html: question.questionHtml }}
        onClick={handleImageClick}
      />
      
      <div className="exam-options">
        {options.map(({ label, content }) => (
          <div key={label} className={`exam-option ${getOptionClass(label)}`}>
            <span className="option-marker">{label}</span>
            <div 
              className="option-text invert-images clickable-images" 
              dangerouslySetInnerHTML={{ __html: content || '' }}
              onClick={handleImageClick}
            />
          </div>
        ))}
      </div>
      
      <div className="exam-answer-info">
        <div className="answer-item">
          <span className="answer-label">Your Answer</span>
          <span className={`answer-value ${question.studentAnswer ? (matchesAnswer(question.studentAnswer, question.correctAnswer, question.type) ? 'correct' : 'wrong') : 'skipped'}`}>
            {question.studentAnswer?.toUpperCase() || 'Not Attempted'}
          </span>
        </div>
        <div className="answer-item">
          <span className="answer-label">Correct Answer</span>
          <span className="answer-value correct">{formatAnswerDisplay(question.correctAnswer, question.type)}</span>
        </div>
      </div>
      
      {question.solution && (
        <div className="exam-solution" onClick={handleImageClick}>
          <h4>Solution</h4>
          <div className="solution-body invert-images clickable-images" dangerouslySetInnerHTML={{ __html: question.solution }} />
        </div>
      )}

      {question.aiSolution && (
        <div className="exam-solution ai-solution" onClick={handleImageClick}>
          <h4>
            <Sparkles size={16} />
            AI Solution
            {question.aiGeneratedAt && (
              <span className="ai-generated-date">
                Generated {new Date(question.aiGeneratedAt).toLocaleDateString()}
              </span>
            )}
          </h4>
          <div className="solution-body ai-solution-body invert-images clickable-images" dangerouslySetInnerHTML={{ __html: renderLatexInHtml(question.aiSolution) }} />
          <div className="ai-doubt-box">
            <h5>Ask a doubt about this AI solution:</h5>
            <AiDoubtPrompt questionId={question.id} aiSolution={question.aiSolution} />
          </div>
        </div>
      )}
    </div>
    
    {lightboxState && (
      <ImageLightbox
        src={lightboxState.src}
        context={lightboxState.context}
        onClose={closeLightbox}
      />
    )}
    </>
  );
}

function ExamPanelView({ 
  attempt,
  questions,
  subjects,
  userId,
  isAdmin,
  testZ7iId,
  onBack,
  onQuestionsUpdate,
  hideHeader = false,
  initialQuestionId,
}: { 
  attempt: AttemptDetails;
  questions: Question[];
  subjects: Array<{ name: string; total: number; score: number }>;
  userId: string;
  isAdmin: boolean;
  testZ7iId: string | null;
  onBack: () => void;
  onQuestionsUpdate: (questions: Question[]) => void;
  hideHeader?: boolean;
  initialQuestionId?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questionFilter, setQuestionFilter] = useState('all');
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0, failed: 0, success: 0, mistaken: 0 });
  const [aiLogs, setAiLogs] = useState<string[]>([]);
  const [hasGeneratedAny, setHasGeneratedAny] = useState(() => questions.some(q => q.aiSolution));
  const [aiSelectionMode, setAiSelectionMode] = useState(false);
  const [selectedQuestionsForAI, setSelectedQuestionsForAI] = useState<string[]>([]);
  const [aiBatchModel, setAiBatchModel] = useState<'flash' | 'lite' | '3-12b' | '3-flash'>('lite');
  const summaryCounts = useMemo(() => {
    const correctCount = questions.filter(q => q.status === 'correct').length;
    const incorrectCount = questions.filter(q => q.status === 'incorrect').length;
    const unattemptedCount = questions.filter(q => isUnattemptedStatus(q.status)).length;
    return {
      correct: correctCount,
      incorrect: incorrectCount,
      unattempted: unattemptedCount
    };
  }, [questions]);
  
  useEffect(() => {
    if (!initialQuestionId) return;
    const initialIndex = questions.findIndex(question => question.id === initialQuestionId);
    if (initialIndex >= 0) {
      setCurrentIndex(initialIndex);
    }
  }, [initialQuestionId, questions]);

  const currentQuestion = questions[currentIndex];
  
  const goToPrev = () => setCurrentIndex(Math.max(0, currentIndex - 1));
  const goToNext = () => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1));

  const sortedQuestionsForAI = [...questions].sort((a, b) => {
    const subjectOrder = (subj: string) => {
      const s = (subj || '').toUpperCase();
      if (s.includes('PHYSICS')) return 0;
      if (s.includes('CHEMISTRY')) return 1;
      if (s.includes('MATH')) return 2;
      return 3;
    };
    const subjectDiff = subjectOrder(a.subject) - subjectOrder(b.subject);
    if (subjectDiff !== 0) return subjectDiff;
    return a.order - b.order;
  });

  const addLog = (message: string, type?: 'success' | 'error' | 'mistaken') => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'success' ? 'SUCCESS' : type === 'error' ? 'ERROR' : type === 'mistaken' ? 'WARNING' : '';
    setAiLogs(prev => [...prev.slice(-19), `[${timestamp}] ${prefix ? prefix + ' ' : ''}${message}`]);
  };

  const handleGenerateAllAI = async () => {
    setAiGenerating(true);
    setAiProgress({ current: 0, total: 0, failed: 0, success: 0, mistaken: 0 });
    setAiLogs([]);
    addLog('Starting AI solution generation...');
    
    try {
      addLog('Fetching questions that need AI solutions...');
      const data = await apiRequest(`/z7i?action=ai-questions&attemptId=${attempt.id}`);
      if (!data.success) {
        addLog(`ERROR: ${data.error || 'Failed to get questions'}`, 'error');
        return;
      }
      
      const questionIdsOrdered = sortedQuestionsForAI
        .filter(q => (data.questionIds as string[]).includes(q.id))
        .map(q => q.id);
      
      if (questionIdsOrdered.length === 0) {
        addLog('All questions already have AI solutions!');
        return;
      }
      
      addLog(`Found ${questionIdsOrdered.length} questions needing solutions`);
      setAiProgress({ current: 0, total: questionIdsOrdered.length, failed: 0, success: 0, mistaken: 0 });
      
      const modelName =
        aiBatchModel === '3-12b'
          ? 'Gemini 3 12B'
          : aiBatchModel === '3-flash'
            ? 'Gemini 3 Flash'
            : aiBatchModel === 'lite'
              ? 'Flash Lite'
              : 'Flash 2.5';
      addLog(`Using ${modelName} for batch processing...`);
      let failed = 0;
      let success = 0;
      let mistaken = 0;
      const generatedSolutions: Map<string, string> = new Map();
      
      for (let i = 0; i < questionIdsOrdered.length; i++) {
        const questionId = questionIdsOrdered[i];
        const question = questions.find(q => q.id === questionId);
        const displayNum = question ? question.order : i + 1;
        addLog(`Processing Q${displayNum}...`);
        
        try {
          const result = await apiRequest('/z7i?action=generate-ai-solution', {
            method: 'POST',
            body: JSON.stringify({ questionId, model: aiBatchModel })
          });
          
          if (result.success && result.aiSolutionHtml) {
            success++;
            addLog(`Q${displayNum} - Solution generated`, 'success');
            generatedSolutions.set(questionId, result.aiSolutionHtml);
          } else if (result.mistaken) {
            mistaken++;
            addLog(`Q${displayNum} - AI answer mismatch (${result.aiAnswer || '?'} ≠ ${result.correctAnswer})`, 'mistaken');
          } else {
            failed++;
            addLog(`Q${displayNum} - ${result.error || result.details || 'Failed'}`, 'error');
          }
        } catch (err) {
          failed++;
          addLog(`Q${displayNum} - Network error`, 'error');
        }
        
        setAiProgress({ current: i + 1, total: questionIdsOrdered.length, failed, success, mistaken });
      }
      
      addLog(`Completed: ${success} succeeded, ${mistaken} mistaken, ${failed} failed`);
      
      if (generatedSolutions.size > 0) {
        addLog('Updating UI...');
        const now = new Date().toISOString();
        const updatedQuestions = questions.map(q => {
          const aiHtml = generatedSolutions.get(q.id);
          return aiHtml ? { ...q, aiSolution: aiHtml, aiGeneratedAt: now } : q;
        });
        onQuestionsUpdate(updatedQuestions);
        setHasGeneratedAny(true);
      }
      addLog('Done!');
    } catch (error) {
      console.error('AI generation error:', error);
      addLog(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleGenerateSingleAI = async (
    questionId: string,
    questionOrder: number,
    model: 'flash' | 'lite' | '3-12b' | '3-flash' = 'flash'
  ) => {
    const modelName =
      model === '3-12b'
        ? 'Gemini 3 12B'
        : model === '3-flash'
          ? 'Gemini 3 Flash'
          : model === 'lite'
            ? 'Flash Lite'
            : 'Flash 2.5';
    addLog(`Regenerating Q${questionOrder} using ${modelName}...`);
    try {
      const result = await apiRequest('/z7i?action=generate-ai-solution', {
        method: 'POST',
        body: JSON.stringify({ questionId, model })
      });
      
      if (result.success && result.aiSolutionHtml) {
        addLog(`Q${questionOrder} - Solution regenerated (${result.modelUsed || modelName})`, 'success');
        const updatedQuestions = questions.map(q => 
          q.id === questionId 
            ? { ...q, aiSolution: result.aiSolutionHtml, aiGeneratedAt: new Date().toISOString() }
            : q
        );
        onQuestionsUpdate(updatedQuestions);
        setHasGeneratedAny(true);
        return true;
      } else if (result.mistaken) {
        addLog(`Q${questionOrder} - AI answer mismatch (${result.aiAnswer || '?'} ≠ ${result.correctAnswer})`, 'mistaken');
        return false;
      } else {
        addLog(`Q${questionOrder} - ${result.error || result.details || 'Failed'}`, 'error');
        return false;
      }
    } catch (err) {
      addLog(`Q${questionOrder} - Network error`, 'error');
      return false;
    }
  };

  const handleDeleteAI = async (questionId: string) => {
    try {
      const result = await apiRequest('/z7i?action=delete-ai-solution', {
        method: 'POST',
        body: JSON.stringify({ questionId })
      });
      
      if (result.success) {
        const updatedQuestions = questions.map(q => 
          q.id === questionId 
            ? { ...q, aiSolution: null, aiGeneratedAt: null }
            : q
        );
        onQuestionsUpdate(updatedQuestions);
        addLog(`AI solution deleted`, 'success');
        return true;
      }
      return false;
    } catch (err) {
      addLog('Failed to delete AI solution', 'error');
      return false;
    }
  };

  const handleGenerateSelectedAI = async () => {
    if (selectedQuestionsForAI.length === 0) {
      addLog('No questions selected');
      return;
    }

    setAiGenerating(true);
    setAiProgress({ current: 0, total: 0, failed: 0, success: 0, mistaken: 0 });
    setAiLogs([]);
    setAiSelectionMode(false);
    addLog(`Starting AI solution generation for ${selectedQuestionsForAI.length} selected questions...`);
    
    try {
      const selectedIdsOrdered = sortedQuestionsForAI
        .filter(q => selectedQuestionsForAI.includes(q.id))
        .map(q => q.id);
      
      addLog(`Processing ${selectedIdsOrdered.length} selected questions`);
      setAiProgress({ current: 0, total: selectedIdsOrdered.length, failed: 0, success: 0, mistaken: 0 });
      
      const modelName =
        aiBatchModel === '3-12b'
          ? 'Gemini 3 12B'
          : aiBatchModel === '3-flash'
            ? 'Gemini 3 Flash'
            : aiBatchModel === 'lite'
              ? 'Flash Lite'
              : 'Flash 2.5';
      addLog(`Using ${modelName} for batch processing...`);
      let failed = 0;
      let success = 0;
      let mistaken = 0;
      const generatedSolutions: Map<string, string> = new Map();
      
      for (let i = 0; i < selectedIdsOrdered.length; i++) {
        const questionId = selectedIdsOrdered[i];
        const question = questions.find(q => q.id === questionId);
        const displayNum = question ? question.order : i + 1;
        addLog(`Processing Q${displayNum}...`);
        
        try {
          const result = await apiRequest('/z7i?action=generate-ai-solution', {
            method: 'POST',
            body: JSON.stringify({ questionId, model: aiBatchModel })
          });
          
          if (result.success && result.aiSolutionHtml) {
            success++;
            addLog(`Q${displayNum} - Solution generated`, 'success');
            generatedSolutions.set(questionId, result.aiSolutionHtml);
          } else if (result.mistaken) {
            mistaken++;
            addLog(`Q${displayNum} - AI answer mismatch (${result.aiAnswer || '?'} ≠ ${result.correctAnswer})`, 'mistaken');
          } else {
            failed++;
            addLog(`Q${displayNum} - ${result.error || result.details || 'Failed'}`, 'error');
          }
        } catch (err) {
          failed++;
          addLog(`Q${displayNum} - Network error`, 'error');
        }
        
        setAiProgress({ current: i + 1, total: selectedIdsOrdered.length, failed, success, mistaken });
      }
      
      addLog(`Completed: ${success} succeeded, ${mistaken} mistaken, ${failed} failed`);
      
      if (generatedSolutions.size > 0) {
        addLog('Updating UI...');
        const now = new Date().toISOString();
        const updatedQuestions = questions.map(q => {
          const aiHtml = generatedSolutions.get(q.id);
          return aiHtml ? { ...q, aiSolution: aiHtml, aiGeneratedAt: now } : q;
        });
        onQuestionsUpdate(updatedQuestions);
        setHasGeneratedAny(true);
      }
      setSelectedQuestionsForAI([]);
      addLog('Done!');
    } catch (error) {
      console.error('AI generation error:', error);
      addLog(`ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleBookmarkToggle = async () => {
    try {
      const data = await apiRequest('/z7i?action=bookmark', {
        method: 'POST',
        body: JSON.stringify({ questionId: currentQuestion.id })
      });
      if (data.success) {
        const updatedQuestions = [...questions];
        updatedQuestions[currentIndex] = {
          ...currentQuestion,
          isBookmarked: data.bookmarked
        };
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Bookmark failed:', error);
    }
  };

  const handleBonusToggle = async () => {
    try {
      const data = await apiRequest('/z7i?action=toggle-bonus', {
        method: 'POST',
        body: JSON.stringify({ 
          z7iQuestionId: currentQuestion.z7iQuestionId,
          testZ7iId: testZ7iId || attempt.id
        })
      });
      if (data.success) {
        const updatedQuestions = questions.map(q => {
          if (q.z7iQuestionId === currentQuestion.z7iQuestionId) {
            const isBonus = data.isBonus;
            const attempted = !isUnattemptedStatus(q.status);
            return {
              ...q,
              isBonus,
              bonusMarks: isBonus && attempted ? q.marksPositive : 0,
              userStats: data.userStats || q.userStats
            };
          }
          return q;
        });
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Bonus toggle failed:', error);
    }
  };

  const handleNoteSave = async (content: string) => {
    try {
      const data = await apiRequest('/z7i?action=note', {
        method: 'POST',
        body: JSON.stringify({ questionId: currentQuestion.id, content })
      });
      if (data.success) {
        const updatedQuestions = [...questions];
        updatedQuestions[currentIndex] = {
          ...currentQuestion,
          note: data.note
        };
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Note save failed:', error);
    }
  };

  const handleCommentAdd = async (content: string) => {
    try {
      const data = await apiRequest('/z7i?action=comment', {
        method: 'POST',
        body: JSON.stringify({ questionId: currentQuestion.id, content })
      });
      if (data.success) {
        const updatedQuestions = [...questions];
        updatedQuestions[currentIndex] = {
          ...currentQuestion,
          comments: [data.comment, ...currentQuestion.comments]
        };
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Comment add failed:', error);
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    try {
      const data = await apiRequest('/z7i?action=delete-comment', {
        method: 'POST',
        body: JSON.stringify({ commentId })
      });
      if (data.success) {
        const updatedQuestions = [...questions];
        updatedQuestions[currentIndex] = {
          ...currentQuestion,
          comments: currentQuestion.comments.filter(c => c.id !== commentId)
        };
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Comment delete failed:', error);
    }
  };

  const handleAnswerKeyChange = async (newAnswer: string) => {
    try {
      const data = await apiRequest('/z7i?action=change-answer-key', {
        method: 'POST',
        body: JSON.stringify({ 
          z7iQuestionId: currentQuestion.z7iQuestionId,
          testZ7iId: testZ7iId || '',
          newAnswer,
          originalAnswer: currentQuestion.originalCorrectAnswer || currentQuestion.correctAnswer
        })
      });
      if (data.success) {
        const updatedQuestions = questions.map(q => {
          if (q.z7iQuestionId === currentQuestion.z7iQuestionId) {
            const effectiveCorrectAnswer = data.changed ? data.newAnswer : (q.originalCorrectAnswer || q.correctAnswer);
            const hasKeyChange = data.changed;
            const originalCorrectAnswer = q.originalCorrectAnswer || currentQuestion.correctAnswer;
            
            let effectiveStatus = q.status;
            let effectiveScore = q.scoreObtained;
            let keyChangeAdjustment = 0;
            
            if (q.studentAnswer) {
              const matchesNew = matchesAnswer(q.studentAnswer, effectiveCorrectAnswer, q.type);
              const matchesOriginal = matchesAnswer(q.studentAnswer, originalCorrectAnswer, q.type);
              if (matchesNew) {
                effectiveStatus = 'correct';
                effectiveScore = q.marksPositive;
              } else {
                effectiveStatus = 'incorrect';
                effectiveScore = -q.marksNegative;
              }
              if (matchesNew && !matchesOriginal) {
                keyChangeAdjustment = 5;
              } else if (matchesOriginal && !matchesNew) {
                keyChangeAdjustment = -5;
              }
            }
            
            return {
              ...q,
              correctAnswer: effectiveCorrectAnswer,
              hasKeyChange,
              originalCorrectAnswer: hasKeyChange ? originalCorrectAnswer : null,
              status: effectiveStatus,
              originalStatus: hasKeyChange ? q.status : null,
              scoreObtained: effectiveScore,
              originalScoreObtained: hasKeyChange ? q.scoreObtained : null,
              keyChangeAdjustment: hasKeyChange ? keyChangeAdjustment : 0,
              userStats: data.userStats || q.userStats
            };
          }
          return q;
        });
        onQuestionsUpdate(updatedQuestions);
      }
    } catch (error) {
      console.error('Answer key change failed:', error);
    }
  };

  return (
    <div className="exam-panel">
      {!hideHeader && (
        <div className="exam-panel-topbar">
          <button className="exam-back-btn" onClick={onBack}>
            <ChevronLeft size={20} />
            <span>Back</span>
          </button>
          <div className="exam-title">
            <h2>{attempt.testName}</h2>
            <span className="exam-subtitle">{attempt.packageName}</span>
          </div>
          <div className="exam-summary">
            <span className="summary-item correct">
              <CheckCircle size={16} />
              {summaryCounts.correct}
            </span>
            <span className="summary-item incorrect">
              <XCircle size={16} />
              {summaryCounts.incorrect}
            </span>
            <span className="summary-item skipped">
              <MinusCircle size={16} />
              {summaryCounts.unattempted}
            </span>
          </div>
          {isAdmin && (
            <button 
              className="btn-ai-icon"
              onClick={() => setShowAIModal(true)}
              title="AI Solutions"
            >
              <Brain size={18} />
            </button>
          )}
        </div>
      )}

      {showAIModal && isAdmin && (
        <div className="ai-modal-overlay" onClick={() => !aiGenerating && setShowAIModal(false)}>
          <div className="ai-modal" onClick={e => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3><Brain size={18} /> AI Solution Generator</h3>
              <button 
                className="ai-modal-close" 
                onClick={() => !aiGenerating && setShowAIModal(false)}
                disabled={aiGenerating}
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="ai-modal-body">
              {aiSelectionMode ? (
                <div className="ai-question-selector">
                  <div className="ai-selector-header">
                    <h4>Select Questions to Generate Solutions For</h4>
                    <span className="ai-selector-count">{selectedQuestionsForAI.length} selected</span>
                  </div>
                  
                  <div className="ai-question-subjects">
                    {['PHYSICS', 'CHEMISTRY', 'MATHS'].map(subjectKey => {
                      const subjectQuestions = questions.filter(q => {
                        const subj = q.subject?.toUpperCase() || '';
                        if (subjectKey === 'MATHS') return subj.includes('MATHS') || subj.includes('MATHEMATICS');
                        return subj.includes(subjectKey);
                      });
                      if (subjectQuestions.length === 0) return null;
                      const displayName = subjectKey === 'MATHS' ? 'Mathematics' : subjectKey.charAt(0) + subjectKey.slice(1).toLowerCase();
                      const mcqQs = subjectQuestions.filter(q => !(q.type || '').toUpperCase().includes('NAT'));
                      const natQs = subjectQuestions.filter(q => (q.type || '').toUpperCase().includes('NAT'));
                      
                      return (
                        <div key={subjectKey} className="ai-subject-section">
                          <div className="ai-subject-title">{displayName}</div>
                          {mcqQs.length > 0 && (
                            <>
                              <div className="ai-type-label">MCQ</div>
                              <div className="ai-question-grid">
                                {mcqQs.map(q => (
                                  <button
                                    key={q.id}
                                    className={`ai-question-btn ${selectedQuestionsForAI.includes(q.id) ? 'selected' : ''} ${q.aiSolution ? 'has-ai' : ''}`}
                                    onClick={() => {
                                      setSelectedQuestionsForAI(prev => 
                                        prev.includes(q.id) 
                                          ? prev.filter(id => id !== q.id)
                                          : [...prev, q.id]
                                      );
                                    }}
                                    title={`Q${mcqQs.indexOf(q) + 1}${q.aiSolution ? ' (has AI solution)' : ''}`}
                                  >
                                    {mcqQs.indexOf(q) + 1}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                          {natQs.length > 0 && (
                            <>
                              <div className="ai-type-label">NAT</div>
                              <div className="ai-question-grid">
                                {natQs.map(q => (
                                  <button
                                    key={q.id}
                                    className={`ai-question-btn ${selectedQuestionsForAI.includes(q.id) ? 'selected' : ''} ${q.aiSolution ? 'has-ai' : ''}`}
                                    onClick={() => {
                                      setSelectedQuestionsForAI(prev => 
                                        prev.includes(q.id) 
                                          ? prev.filter(id => id !== q.id)
                                          : [...prev, q.id]
                                      );
                                    }}
                                    title={`Q${natQs.indexOf(q) + 1}${q.aiSolution ? ' (has AI solution)' : ''}`}
                                  >
                                    {natQs.indexOf(q) + 1}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    }).filter(Boolean)}
                  </div>
                  
                  <div className="ai-selector-actions">
                    <button 
                      className="btn btn-secondary"
                      onClick={() => setSelectedQuestionsForAI([])}
                    >
                      Clear Selection
                    </button>
                    <button 
                      className="btn btn-secondary"
                      onClick={() => setSelectedQuestionsForAI(questions.filter(q => !q.aiSolution).map(q => q.id))}
                    >
                      Select Without AI
                    </button>
                    <button 
                      className="btn btn-secondary"
                      onClick={() => setSelectedQuestionsForAI(questions.map(q => q.id))}
                    >
                      Select All
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {aiProgress.total > 0 && (
                    <div className="ai-progress-section">
                      <div className="ai-progress-bar">
                        <div 
                          className="ai-progress-fill" 
                          style={{ width: `${(aiProgress.current / aiProgress.total) * 100}%` }}
                        />
                      </div>
                      <div className="ai-progress-stats">
                        <span className="ai-stat">
                          <span className="ai-stat-label">Progress:</span>
                          <span className="ai-stat-value">{aiProgress.current}/{aiProgress.total}</span>
                        </span>
                        <span className="ai-stat success">
                          <CheckCircle size={12} />
                          <span>{aiProgress.success}</span>
                        </span>
                        {aiProgress.mistaken > 0 && (
                          <span className="ai-stat mistaken">
                            <AlertTriangle size={12} />
                            <span>{aiProgress.mistaken}</span>
                          </span>
                        )}
                        <span className="ai-stat failed">
                          <XCircle size={12} />
                          <span>{aiProgress.failed}</span>
                        </span>
                      </div>
                    </div>
                  )}
                  
                  <div className="ai-logs-section">
                    <div className="ai-logs-header">
                      <span>Activity Log</span>
                      {aiLogs.length > 0 && (
                        <button className="ai-logs-clear" onClick={() => setAiLogs([])}>Clear</button>
                      )}
                    </div>
                    <div className="ai-logs">
                      {aiLogs.length === 0 ? (
                        <div className="ai-logs-empty">No logs yet. Click "Generate All" to start generating AI solutions.</div>
                      ) : (
                        aiLogs.map((log, i) => (
                          <div
                            key={i}
                            className={`ai-log-entry ${
                              log.includes('SUCCESS')
                                ? 'success'
                                : log.includes('ERROR')
                                  ? 'error'
                                  : log.includes('WARNING')
                                    ? 'mistaken'
                                    : ''
                            }`}
                          >
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="ai-modal-footer">
              <div className="ai-model-selector">
                <span className="ai-model-label">Model:</span>
                <select 
                  value={aiBatchModel} 
                  onChange={(e) => setAiBatchModel(e.target.value as 'flash' | 'lite' | '3-12b' | '3-flash')}
                  disabled={aiGenerating}
                  className="ai-model-select"
                >
                  <option value="lite">Flash Lite (Fast)</option>
                  <option value="flash">Flash (Better)</option>
                  <option value="3-flash">Gemini 3 Flash</option>
                  <option value="3-12b">Gemini 3 12B</option>
                </select>
              </div>
              
              {aiSelectionMode ? (
                <>
                  <button 
                    className="btn btn-primary ai-generate-btn"
                    onClick={handleGenerateSelectedAI}
                    disabled={selectedQuestionsForAI.length === 0}
                  >
                    <Sparkles size={14} /> Generate {selectedQuestionsForAI.length} Selected
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => {
                      setAiSelectionMode(false);
                      setSelectedQuestionsForAI([]);
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button 
                    className="btn btn-primary ai-generate-btn"
                    onClick={handleGenerateAllAI}
                    disabled={aiGenerating}
                  >
                    {aiGenerating ? (
                      <><RefreshCw size={14} className="spinning" /> Generating...</>
                    ) : (
                      <><Sparkles size={14} /> Generate All</>
                    )}
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => setAiSelectionMode(true)}
                    disabled={aiGenerating}
                  >
                    <CheckCircle size={14} /> Select
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => setShowAIModal(false)}
                    disabled={aiGenerating}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="exam-panel-body">
        <QuestionNavPanel 
          questions={questions}
          subjects={subjects}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
          filter={questionFilter}
          onFilterChange={setQuestionFilter}
        />
        
        <div className="exam-main-content">
          {currentQuestion && (() => {
            const subjectUpper = currentQuestion.subject?.toUpperCase() || '';
            const subjectQuestions = questions.filter(q => q.subject === currentQuestion.subject);
            const idxInSubject = subjectQuestions.findIndex(q => q.id === currentQuestion.id);
            let displayNum = idxInSubject + 1;
            if (subjectUpper.includes('CHEMISTRY')) displayNum = 26 + idxInSubject;
            else if (subjectUpper.includes('MATHS') || subjectUpper.includes('MATHEMATICS')) displayNum = 51 + idxInSubject;
            
            return <ExamQuestionView question={currentQuestion} displayNumber={displayNum} />;
          })()}
          
          <div className="exam-nav-footer">
            <button 
              className="exam-nav-btn-large prev" 
              onClick={goToPrev}
              disabled={currentIndex === 0}
            >
              <ChevronLeft size={20} />
              <span>Previous</span>
            </button>
            <div className="exam-nav-position">
              <span className="current">{currentIndex + 1}</span>
              <span className="separator">/</span>
              <span className="total">{questions.length}</span>
            </div>
            <button 
              className="exam-nav-btn-large next" 
              onClick={goToNext}
              disabled={currentIndex === questions.length - 1}
            >
              <span>Next</span>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        
        {currentQuestion && (
          <ActionsPanel
            question={currentQuestion}
            userId={userId}
            isAdmin={isAdmin}
            onBookmarkToggle={handleBookmarkToggle}
            onNoteSave={handleNoteSave}
            onCommentAdd={handleCommentAdd}
            onCommentDelete={handleCommentDelete}
            onBonusToggle={handleBonusToggle}
            onAnswerKeyChange={handleAnswerKeyChange}
            onRegenerateAI={(questionId, model) => handleGenerateSingleAI(questionId, currentQuestion.order, model)}
            onDeleteAI={handleDeleteAI}
            hasGeneratedAny={hasGeneratedAny}
          />
        )}
      </div>
    </div>
  );
}

function RevisionsView({ attemptId, testName, onBack }: { attemptId: string; testName: string; onBack: () => void }) {
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRevision, setSelectedRevision] = useState<any | null>(null);

  useEffect(() => {
    loadRevisions();
  }, [attemptId]);

  const loadRevisions = async () => {
    setLoading(true);
    try {
      const data = await apiRequest(`/z7i?action=revisions&attemptId=${attemptId}`);
      if (data.success) {
        setRevisions(data.revisions || []);
      }
    } catch (error) {
      console.error('Failed to load revisions:', error);
    }
    setLoading(false);
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

  if (selectedRevision) {
    return (
      <div className="page analysis-page">
        <div className="container">
          <button className="back-btn" onClick={() => setSelectedRevision(null)}>
            <ChevronLeft size={18} /> Back to Revisions
          </button>
          
          <div className="card" style={{ marginTop: '2rem' }}>
            <h2 style={{ marginBottom: '1rem' }}>Revision Details</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Correct</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)' }}>
                  {selectedRevision.correct}
                </p>
              </div>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Incorrect</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--error)' }}>
                  {selectedRevision.incorrect}
                </p>
              </div>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Unattempted</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--unattempted)' }}>
                  {selectedRevision.unattempted}
                </p>
              </div>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Score</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
                  {selectedRevision.totalScore}/{selectedRevision.maxScore}
                </p>
              </div>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Improvement</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: selectedRevision.improvement >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {selectedRevision.improvement >= 0 ? '+' : ''}{selectedRevision.improvement}
                </p>
              </div>
              <div>
                <p style={{ color: '#888', fontSize: '0.875rem' }}>Accuracy</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#8b5cf6' }}>
                  {selectedRevision.accuracy}%
                </p>
              </div>
            </div>

            <p style={{ color: '#888', fontSize: '0.875rem' }}>
              Attempted on: {new Date(selectedRevision.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page analysis-page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} /> Back
        </button>
        
        <h1 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Revisions for {testName}</h1>
        
        {revisions.length === 0 ? (
          <div className="empty-state">
            <Trophy size={48} />
            <div className="empty-state-title">No revisions yet</div>
            <div className="empty-state-text">Take this test again to create a revision</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {revisions.map((revision) => (
              <div
                key={revision.id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedRevision(revision)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '0.875rem', color: '#888' }}>
                      {new Date(revision.createdAt).toLocaleDateString()}
                    </p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#3b82f6' }}>
                      {revision.totalScore}/{revision.maxScore}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.875rem', color: '#888' }}>Improvement</p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: revision.improvement >= 0 ? 'var(--success)' : 'var(--error)' }}>
                      {revision.improvement >= 0 ? '+' : ''}{revision.improvement}
                    </p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                  <div>
                    <CheckCircle size={12} style={{ color: '#888', marginRight: '0.25rem' }} />
                    <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{revision.correct}</span>
                  </div>
                  <div>
                    <XCircle size={12} style={{ color: '#888', marginRight: '0.25rem' }} />
                    <span style={{ color: 'var(--error)', fontWeight: 'bold' }}>{revision.incorrect}</span>
                  </div>
                  <div>
                    <MinusCircle size={12} style={{ color: '#888', marginRight: '0.25rem' }} />
                    <span style={{ color: 'var(--unattempted)', fontWeight: 'bold' }}>{revision.unattempted}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TestDetailView({ 
  attemptId, 
  userId, 
  onBack,
  initialQuestionId
}: { 
  attemptId: string; 
  userId: string; 
  onBack: () => void;
  initialQuestionId?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [subjects, setSubjects] = useState<Array<{ name: string; total: number; score: number }>>([]);
  const [showExamPanel, setShowExamPanel] = useState(Boolean(initialQuestionId));
  const [showRevisions, setShowRevisions] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [testZ7iId, setTestZ7iId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncMessage, setResyncMessage] = useState('');

  useEffect(() => {
    loadQuestions();
  }, [attemptId]);

  const loadQuestions = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest(`/z7i?action=questions&attemptId=${attemptId}`);

      if (data.success) {
        setAttempt(data.attempt);
        const normalizedQuestions = data.questions.map((q: Question) => normalizeQuestion(q));
        setQuestions(normalizedQuestions);
        setSubjects(data.subjects);
        setIsAdmin(data.isAdmin || false);
        setTestZ7iId(data.testZ7iId || null);
      } else {
        setError(data.error || 'Failed to load questions');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResync = async () => {
    if (!testZ7iId) {
      setResyncMessage('Cannot resync: test ID not available');
      return;
    }
    
    setResyncing(true);
    setResyncMessage('');
    
    try {
      const data = await apiRequest('/z7i?action=resync-test', {
        method: 'POST',
        body: JSON.stringify({ testZ7iId, attemptId })
      });
      
      if (data.success) {
        setResyncMessage(`Resynced! Rank: ${data.attempt.rank || 'N/A'}, Score: ${data.attempt.totalScore}/${data.attempt.maxScore}`);
        loadQuestions();
      } else {
        setResyncMessage(data.error || 'Failed to resync');
      }
    } catch {
      setResyncMessage('Network error during resync');
    } finally {
      setResyncing(false);
    }
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

  if (error) {
    return (
      <div className="page">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ChevronLeft size={18} /> Back to Tests
          </button>
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }

  if (showExamPanel && attempt) {
    return (
      <ExamPanelView 
        attempt={attempt}
        questions={questions}
        subjects={subjects}
        userId={userId}
        isAdmin={isAdmin}
        testZ7iId={testZ7iId}
        onBack={() => setShowExamPanel(false)}
        onQuestionsUpdate={(nextQuestions) => setQuestions(nextQuestions.map(question => normalizeQuestion(question)))}
        initialQuestionId={initialQuestionId ?? undefined}
      />
    );
  }

  if (showRevisions && attempt) {
    return (
      <RevisionsView 
        attemptId={attemptId}
        testName={attempt.testName}
        onBack={() => setShowRevisions(false)}
      />
    );
  }

  return (
    <div className="page analysis-page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <button className="back-btn" onClick={onBack}>
            <ChevronLeft size={18} /> Back to Tests
          </button>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {resyncMessage && (
              <span style={{ fontSize: '0.75rem', color: resyncMessage.includes('Resynced') ? 'var(--success)' : 'var(--error)' }}>
                {resyncMessage}
              </span>
            )}
            <button 
              className="btn btn-secondary"
              onClick={handleResync}
              disabled={resyncing || !testZ7iId}
              title="Resync this test to update ranking and marks"
            >
              <RefreshCw size={16} className={resyncing ? 'spinning' : ''} /> {resyncing ? 'Resyncing...' : 'Resync'}
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => setShowRevisions(true)}
              title="View all revisions/reattempts of this paper"
            >
              <Eye size={16} /> Revisions
            </button>
          </div>
        </div>
        
        {attempt && (
          <TestAnalysis 
            attempt={attempt}
            questions={questions}
            subjects={subjects}
            testZ7iId={testZ7iId}
            userId={userId}
            attemptId={attemptId}
            isAdmin={isAdmin}
            onOpenExamView={() => setShowExamPanel(true)}
          />
        )}
      </div>
    </div>
  );
}

function Dashboard({ user, onUserUpdate }: { user: UserType; onUserUpdate: (user: UserType) => void }) {
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [examWriterTest, setExamWriterTest] = useState<Test | null>(null);
  const [timeIntelReview, setTimeIntelReview] = useState<{ attemptId: string; questionId: string } | null>(null);
  const [message, setMessage] = useState('');
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showForum, setShowForum] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTimeIntel, setShowTimeIntel] = useState(false);
  const [showPYP, setShowPYP] = useState(false);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(false);
  const [showAiChats, setShowAiChats] = useState(false);
  const [showNoQuestionResync, setShowNoQuestionResync] = useState(false);
  const [selectedNoQuestionId, setSelectedNoQuestionId] = useState('');
  const [noQuestionResyncing, setNoQuestionResyncing] = useState(false);
  const [noQuestionResyncMessage, setNoQuestionResyncMessage] = useState('');
  const [noQuestionResyncStatus, setNoQuestionResyncStatus] = useState<'success' | 'error' | ''>('');
  const [customTests, setCustomTests] = useState<CustomTest[]>([]);
  const [loadingCustomTests, setLoadingCustomTests] = useState(false);
  const [showCustomTestPanel, setShowCustomTestPanel] = useState(false);
  const [creatingCustomTest, setCreatingCustomTest] = useState(false);
  const [customTestMessage, setCustomTestMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [customTestName, setCustomTestName] = useState('');
  const [customTestTimeLimit, setCustomTestTimeLimit] = useState(180);
  const [customTestModel, setCustomTestModel] = useState<'auto' | '2.5-flash' | '3-flash'>('2.5-flash');
  const [customTestConfig, setCustomTestConfig] = useState<CustomTestConfig>('jee-main');
  const [jeeMainDifficulty, setJeeMainDifficulty] = useState<'mixed' | 'easy' | 'hard'>('mixed');
  const [assignmentSubject, setAssignmentSubject] = useState<AssignmentSubject>('Physics');
  const [assignmentChapterMode, setAssignmentChapterMode] = useState<'all' | 'single' | 'multiple'>('all');
  const [assignmentSelectedChapters, setAssignmentSelectedChapters] = useState<string[]>([]);
  const [assignmentChapterSearch, setAssignmentChapterSearch] = useState('');
  const [assignmentTotalQuestions, setAssignmentTotalQuestions] = useState(20);
  const [assignmentMcqCount, setAssignmentMcqCount] = useState(10);
  const [assignmentNatCount, setAssignmentNatCount] = useState(10);
  const [assignmentDifficulty, setAssignmentDifficulty] = useState<DifficultyChoice>('mixed');
  const [customTestLogs, setCustomTestLogs] = useState<Array<{ timestamp: string; message: string; level: 'info' | 'success' | 'error' }>>([]);
  const [customExamTestId, setCustomExamTestId] = useState<string | null>(null);
  const [customResultsAttemptId, setCustomResultsAttemptId] = useState<string | null>(null);
  const [pendingTestId, setPendingTestId] = useState<string | null>(null);
  
  const isOwnerUser = Boolean(user.isOwner);
  const sortedTests = useMemo(() => {
    return [...tests].sort((a, b) => new Date(b.submitDate).getTime() - new Date(a.submitDate).getTime());
  }, [tests]);
  const testsWithQuestions = useMemo(() => tests.filter(test => test.totalQuestions > 0), [tests]);
  const testsWithoutQuestions = useMemo(() => tests.filter(test => test.totalQuestions === 0), [tests]);
  const assignmentChapterList = useMemo(() => SUBJECT_CHAPTERS[assignmentSubject], [assignmentSubject]);
  const filteredAssignmentChapters = useMemo(() => {
    const query = assignmentChapterSearch.trim().toLowerCase();
    if (query.length < 3) return assignmentChapterList;
    return assignmentChapterList.filter(chapter => chapter.toLowerCase().includes(query));
  }, [assignmentChapterList, assignmentChapterSearch]);
  const assignmentQuestionMismatch = useMemo(
    () => assignmentMcqCount + assignmentNatCount !== assignmentTotalQuestions,
    [assignmentMcqCount, assignmentNatCount, assignmentTotalQuestions]
  );

  useEffect(() => {
    setAssignmentSelectedChapters([]);
    setAssignmentChapterSearch('');
  }, [assignmentSubject]);

  useEffect(() => {
    if (assignmentChapterMode === 'all') {
      setAssignmentSelectedChapters([]);
    }
  }, [assignmentChapterMode]);
  const prepStats = useMemo(() => {
    const totalTests = tests.length;
    const totalQuestions = tests.reduce((acc, test) => acc + test.totalQuestions, 0);
    const totalCorrect = tests.reduce((acc, test) => acc + test.correct, 0);
    const averageAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    const recentWindow = sortedTests.slice(0, 5);
    const recentAccuracy = recentWindow.length
      ? Math.round(
          (recentWindow.reduce((acc, test) => acc + test.correct, 0) /
            recentWindow.reduce((acc, test) => acc + test.totalQuestions, 0)) *
            100
        )
      : 0;
    const lastTestDate = sortedTests[0]?.submitDate ? new Date(sortedTests[0].submitDate) : null;
    const dayDiff = lastTestDate ? Math.floor((Date.now() - lastTestDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
    const lastWeekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const testsLastWeek = sortedTests.filter(test => new Date(test.submitDate).getTime() >= lastWeekCutoff).length;
    const lowestScoreTests = [...tests]
      .map(test => ({
        ...test,
        scorePercent: test.maxScore ? Math.round((test.adjustedScore / test.maxScore) * 100) : 0,
      }))
      .sort((a, b) => a.scorePercent - b.scorePercent)
      .slice(0, 3);

    return {
      totalTests,
      averageAccuracy,
      recentAccuracy,
      dayDiff,
      testsLastWeek,
      lowestScoreTests,
    };
  }, [tests, sortedTests]);

  const resetViews = useCallback(() => {
    setSelectedTest(null);
    setExamWriterTest(null);
    setCustomExamTestId(null);
    setCustomResultsAttemptId(null);
    setTimeIntelReview(null);
    setShowBookmarks(false);
    setShowForum(false);
    setShowTimeIntel(false);
    setShowPYP(false);
    setShowOwnerDashboard(false);
    setShowAiChats(false);
    setPendingTestId(null);
  }, []);

  const navigateTo = useCallback((path: string) => {
    window.history.pushState({}, '', path);
  }, []);

  const applyRoute = useCallback(
    (path: string) => {
      if (!isValidRoute(path)) return;
      resetViews();
      if (path.startsWith('/test/')) {
        const targetId = path.replace('/test/', '');
        setPendingTestId(targetId || null);
        return;
      }
      if (path === '/bookmarks') {
        setShowBookmarks(true);
        return;
      }
      if (path === '/forum') {
        setShowForum(true);
        return;
      }
      if (path === '/pyp') {
        setShowPYP(true);
        return;
      }
      if (path === '/time-intel') {
        setShowTimeIntel(true);
        return;
      }
      if (path === '/owner' && isOwnerUser) {
        setShowOwnerDashboard(true);
        return;
      }
      if (path === '/ai-chats') {
        setShowAiChats(true);
        return;
      }
    },
    [isOwnerUser, resetViews]
  );

  useEffect(() => {
    applyRoute(window.location.pathname);
  }, [applyRoute]);

  useEffect(() => {
    const handlePopState = () => applyRoute(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [applyRoute]);

  useEffect(() => {
    if (!pendingTestId) return;
    const match = tests.find(test => test.id === pendingTestId);
    if (match) {
      setSelectedTest(match);
      setPendingTestId(null);
    }
  }, [pendingTestId, tests]);

  const loadTests = useCallback(async () => {
    if (!user.z7iLinked) return;
    
    setLoading(true);
    try {
      const data = await apiRequest('/z7i?action=tests');
      if (data.success) {
        setTests(data.tests);
      }
    } catch {
      console.error('Failed to load tests');
    } finally {
      setLoading(false);
    }
  }, [user.z7iLinked]);

  const loadCustomTests = useCallback(async () => {
    setLoadingCustomTests(true);
    try {
      const data = await apiRequest('/auth?action=custom-tests-list');
      if (data.success) {
        setCustomTests(data.tests);
      }
    } catch {
      console.error('Failed to load custom tests');
    } finally {
      setLoadingCustomTests(false);
    }
  }, []);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  useEffect(() => {
    loadCustomTests();
  }, [loadCustomTests]);

  useEffect(() => {
    if (!testsWithoutQuestions.length) {
      setSelectedNoQuestionId('');
      return;
    }
    if (!selectedNoQuestionId) {
      setSelectedNoQuestionId(testsWithoutQuestions[0].id);
    }
  }, [testsWithoutQuestions, selectedNoQuestionId]);

  useEffect(() => {
    if (!user.z7iLinked || !user.lastSyncAt || syncing) return;
    
    const lastSync = new Date(user.lastSyncAt).getTime();
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    if (now - lastSync > twoHours) {
      console.log('Auto-syncing: last sync was over 2 hours ago');
      handleSync();
    }
  }, [user.z7iLinked, user.lastSyncAt]); // Only run on mount and when user changes

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    setSyncProgress({ status: 'Connecting to Z7I and fetching your tests...', current: 0, total: 0 });

    try {
      const data = await apiRequest('/z7i?action=sync', { method: 'POST' });
      if (data.success) {
        setSyncProgress({ 
          status: 'Complete', 
          current: data.stats.tests, 
          total: data.stats.questions,
          currentTest: undefined
        });
        setMessage(`Synced ${data.stats.tests} tests with ${data.stats.questions} questions`);
        await loadTests();
        const userData = await apiRequest('/auth?action=me');
        if (userData.success) {
          onUserUpdate(userData.user);
        }
      } else {
        setSyncProgress({ status: `Sync failed: ${data.error}`, current: 0, total: 0 });
        setMessage(`Sync failed: ${data.error}`);
      }
    } catch {
      setSyncProgress({ status: 'Sync failed. Please try again.', current: 0, total: 0 });
      setMessage('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  };

  const showCustomMessage = (type: 'success' | 'error', text: string) => {
    setCustomTestMessage({ type, text });
    setTimeout(() => setCustomTestMessage(null), 4000);
  };

  const applyCustomTestConfig = (config: CustomTestConfig) => {
    setCustomTestConfig(config);
    if (config === 'jee-main') {
      setCustomTestTimeLimit(180);
      setCustomTestModel('2.5-flash');
      setJeeMainDifficulty('mixed');
    } else if (config === 'jee-advanced') {
      setCustomTestTimeLimit(180);
      setCustomTestModel('3-flash');
    } else {
      setCustomTestTimeLimit(60);
      setCustomTestModel('2.5-flash');
      setAssignmentChapterMode('all');
      setAssignmentSelectedChapters([]);
      setAssignmentChapterSearch('');
    }
  };

  const buildCustomTestPrompt = () => {
    if (customTestConfig === 'jee-main') {
      const difficultyLabel = jeeMainDifficulty === 'mixed' ? 'a balanced mix of easy, medium, and hard' : jeeMainDifficulty;
      return `Create a JEE Main style test with 75 questions (25 each in Physics, Chemistry, Mathematics). For each subject include 20 MCQ and 5 NAT. Difficulty should be ${difficultyLabel}. Use JEE Main marking (+4/-1 for MCQ, +4/0 for NAT).`;
    }

    if (customTestConfig === 'jee-advanced') {
      return 'Create a JEE Advanced style test worth 180 marks with an even spread across Physics, Chemistry, and Mathematics. Use extremely hard difficulty throughout. Include a mix of MCQ and NAT, and set marks so the total is 180 (use appropriate negative marking for MCQ and no negative for NAT).';
    }

    const totalQuestions = assignmentTotalQuestions;
    const subject = assignmentSubject;
    const difficultyLabel = assignmentDifficulty === 'mixed' ? 'a balanced mix of easy, medium, and hard' : assignmentDifficulty;
    const chapterSelection =
      assignmentChapterMode === 'all'
        ? 'all chapters'
        : assignmentSelectedChapters.join(', ');

    return `Create an assignment with ${totalQuestions} questions in ${subject}. Chapters: ${chapterSelection}. Include ${assignmentMcqCount} MCQ and ${assignmentNatCount} NAT. Difficulty should be ${difficultyLabel}. Use standard JEE marking (+4/-1 for MCQ, +4/0 for NAT).`;
  };

  const handleCreateCustomTest = async () => {
    if (!customTestName.trim()) {
      showCustomMessage('error', 'Test name is required.');
      return;
    }

    if (customTestConfig === 'assignment') {
      if (assignmentTotalQuestions <= 0) {
        showCustomMessage('error', 'Assignment must have at least 1 question.');
        return;
      }
      if (assignmentChapterMode !== 'all' && assignmentSelectedChapters.length === 0) {
        showCustomMessage('error', 'Select at least one chapter for the assignment.');
        return;
      }
      if (assignmentQuestionMismatch) {
        showCustomMessage('error', 'MCQ + NAT counts must match the total questions.');
        return;
      }
    }

    const prompt = buildCustomTestPrompt();
    setCreatingCustomTest(true);
    setCustomTestLogs([
      { timestamp: new Date().toISOString(), message: 'Starting custom test creation.', level: 'info' },
      { timestamp: new Date().toISOString(), message: 'Sending instructions to the server.', level: 'info' },
    ]);
    try {
      const data = await apiRequest('/auth?action=custom-tests-create', {
        method: 'POST',
        body: JSON.stringify({
          name: customTestName.trim(),
          timeLimit: customTestTimeLimit,
          modelId: customTestModel,
          prompt,
        }),
      });
      if (data.success) {
        const serverLogs = Array.isArray(data.logs)
          ? data.logs.map((log: { timestamp: string; message: string }) => ({
              timestamp: log.timestamp,
              message: log.message,
              level: 'info' as const,
            }))
          : [];
        setCustomTestLogs([
          ...serverLogs,
          { timestamp: new Date().toISOString(), message: 'Custom test saved successfully.', level: 'success' },
        ]);
        showCustomMessage('success', 'Custom test created. Ready for students!');
        setCustomTestName('');
        await loadCustomTests();
      } else {
        setCustomTestLogs(prev => [
          ...prev,
          { timestamp: new Date().toISOString(), message: data.error || 'Failed to create custom test.', level: 'error' },
        ]);
        showCustomMessage('error', data.error || 'Failed to create custom test.');
      }
    } catch {
      setCustomTestLogs(prev => [
        ...prev,
        { timestamp: new Date().toISOString(), message: 'Failed to create custom test.', level: 'error' },
      ]);
      showCustomMessage('error', 'Failed to create custom test.');
    } finally {
      setCreatingCustomTest(false);
    }
  };

  const handleNoQuestionResync = async () => {
    const selectedTest = testsWithoutQuestions.find(test => test.id === selectedNoQuestionId);
    if (!selectedTest) {
      setNoQuestionResyncMessage('Select a paper to resync.');
      setNoQuestionResyncStatus('error');
      return;
    }
    if (!selectedTest.testId) {
      setNoQuestionResyncMessage('Missing test ID for resync.');
      setNoQuestionResyncStatus('error');
      return;
    }

    setNoQuestionResyncing(true);
    setNoQuestionResyncMessage('');
    setNoQuestionResyncStatus('');
    try {
      const data = await apiRequest('/z7i?action=resync-test', {
        method: 'POST',
        body: JSON.stringify({ testZ7iId: selectedTest.testId, attemptId: selectedTest.id })
      });

      if (data.success) {
        setNoQuestionResyncMessage('Resync complete. Checking for questions...');
        setNoQuestionResyncStatus('success');
        await loadTests();
      } else {
        setNoQuestionResyncMessage(data.error || 'Failed to resync.');
        setNoQuestionResyncStatus('error');
      }
    } catch {
      setNoQuestionResyncMessage('Network error during resync.');
      setNoQuestionResyncStatus('error');
    } finally {
      setNoQuestionResyncing(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.reload();
  };

  const handleLinked = async () => {
    const data = await apiRequest('/auth?action=me');
    if (data.success) {
      onUserUpdate(data.user);
    }
  };

  const openBookmarks = () => {
    resetViews();
    setShowBookmarks(true);
    navigateTo('/bookmarks');
  };

  const openForum = () => {
    resetViews();
    setShowForum(true);
    navigateTo('/forum');
  };

  const openPYP = () => {
    resetViews();
    setShowPYP(true);
    navigateTo('/pyp');
  };

  const openTimeIntel = () => {
    resetViews();
    setShowTimeIntel(true);
    navigateTo('/time-intel');
  };

  const openOwnerDashboard = () => {
    if (!isOwnerUser) return;
    resetViews();
    setShowOwnerDashboard(true);
    navigateTo('/owner');
  };

  const openAiChats = () => {
    resetViews();
    setShowAiChats(true);
    navigateTo('/ai-chats');
  };

  const handleSelectTest = (test: Test) => {
    setSelectedTest(test);
    navigateTo(`/test/${test.id}`);
  };

  const goHome = () => {
    resetViews();
    navigateTo('/');
  };

  if (examWriterTest) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <ExamWriter 
          test={examWriterTest} 
          onBack={() => setExamWriterTest(null)} 
          onViewAnalysis={() => {
            setExamWriterTest(null);
            handleSelectTest(examWriterTest);
          }}
        />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (customExamTestId) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <CustomExamWriter
          testId={customExamTestId}
          onBack={() => setCustomExamTestId(null)}
          onSubmitted={() => loadCustomTests()}
        />
        {showProfile && (
          <ProfileModal
            user={user}
            onClose={() => setShowProfile(false)}
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (customResultsAttemptId) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <CustomTestResults
          attemptId={customResultsAttemptId}
          onBack={() => setCustomResultsAttemptId(null)}
        />
        {showProfile && (
          <ProfileModal
            user={user}
            onClose={() => setShowProfile(false)}
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (selectedTest) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <TestDetailView attemptId={selectedTest.id} userId={user.id} onBack={goHome} />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showBookmarks) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <BookmarksView onBack={goHome} />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showForum) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <ForumView onBack={goHome} />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showAiChats) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <AiChatbotsPage
          onBack={goHome}
        />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showPYP) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <PastYearPapers onBack={goHome} />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showTimeIntel) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <TimeIntelligenceDashboard 
          onBack={goHome} 
          onOpenReview={({ attemptId, questionId }) => {
            setShowTimeIntel(false);
            setTimeIntelReview({ attemptId, questionId });
          }}
        />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (showOwnerDashboard) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <OwnerDashboard onBack={goHome} />
        {showProfile && (
          <ProfileModal 
            user={user} 
            onClose={() => setShowProfile(false)} 
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  if (timeIntelReview) {
    return (
      <>
        <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
        <TestDetailView
          attemptId={timeIntelReview.attemptId}
          userId={user.id}
          onBack={() => setTimeIntelReview(null)}
          initialQuestionId={timeIntelReview.questionId}
        />
        {showProfile && (
          <ProfileModal
            user={user}
            onClose={() => setShowProfile(false)}
            onUserUpdate={onUserUpdate}
            onLogout={handleLogout}
          />
        )}
      </>
    );
  }

  const customTestsSection = (
    <section className="custom-tests-section">
      <div className="custom-tests-header">
        <div>
          <h2>Custom Tests</h2>
          <p className="custom-tests-description">Owner-generated papers available to everyone.</p>
        </div>
      </div>

      {customTestMessage && (
        <div className={`alert ${customTestMessage.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {customTestMessage.text}
        </div>
      )}

      {showCustomTestPanel && isOwnerUser && (
        <div
          className="modal-overlay"
          onClick={(event) => event.target === event.currentTarget && setShowCustomTestPanel(false)}
        >
          <div className="modal custom-test-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                <Sparkles size={18} /> Create Custom Test
              </h2>
              <button className="modal-close" onClick={() => setShowCustomTestPanel(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="form-group">
              <label className="form-label">Configuration</label>
              <div className="custom-test-config-grid">
                <button
                  type="button"
                  className={`custom-test-config-card ${customTestConfig === 'jee-main' ? 'active' : ''}`}
                  onClick={() => applyCustomTestConfig('jee-main')}
                >
                  <div className="config-title">JEE Main</div>
                  <div className="config-meta">75 questions • 25 per subject • Gemini 2.5 Flash</div>
                </button>
                <button
                  type="button"
                  className={`custom-test-config-card ${customTestConfig === 'jee-advanced' ? 'active' : ''}`}
                  onClick={() => applyCustomTestConfig('jee-advanced')}
                >
                  <div className="config-title">JEE Advanced</div>
                  <div className="config-meta">180 marks • Extremely hard • Gemini 3 Flash</div>
                </button>
                <button
                  type="button"
                  className={`custom-test-config-card ${customTestConfig === 'assignment' ? 'active' : ''}`}
                  onClick={() => applyCustomTestConfig('assignment')}
                >
                  <div className="config-title">Assignment</div>
                  <div className="config-meta">Choose subjects, chapters, difficulty & types</div>
                </button>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Test name</label>
                <input
                  className="form-input"
                  value={customTestName}
                  onChange={(event) => setCustomTestName(event.target.value)}
                  placeholder="e.g. JEE Mixed Drill #1"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Time limit (minutes)</label>
                <input
                  className="form-input"
                  type="number"
                  min={10}
                  max={300}
                  value={customTestTimeLimit}
                  onChange={(event) => setCustomTestTimeLimit(Number(event.target.value))}
                />
              </div>
            </div>
            {customTestConfig === 'jee-main' && (
              <div className="custom-test-config-panel">
                <div className="form-group">
                  <label className="form-label">Difficulty</label>
                  <select
                    className="form-input"
                    value={jeeMainDifficulty}
                    onChange={(event) => setJeeMainDifficulty(event.target.value as 'mixed' | 'easy' | 'hard')}
                  >
                    <option value="mixed">Mixed (easy/medium/hard)</option>
                    <option value="easy">Easy</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div className="config-note">
                  Generates 25 questions each from Physics, Chemistry, and Mathematics with MCQ + NAT mix.
                </div>
              </div>
            )}
            {customTestConfig === 'jee-advanced' && (
              <div className="custom-test-config-panel">
                <div className="config-note">
                  Difficulty: <strong>Extremely hard</strong>. Model locked to Gemini 3 Flash.
                </div>
              </div>
            )}
            {customTestConfig === 'assignment' && (
              <div className="custom-test-config-panel">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Total questions</label>
                    <input
                      className="form-input"
                      type="number"
                      min={1}
                      value={assignmentTotalQuestions}
                      onChange={(event) => setAssignmentTotalQuestions(Number(event.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Subject</label>
                    <select
                      className="form-input"
                      value={assignmentSubject}
                      onChange={(event) => setAssignmentSubject(event.target.value as AssignmentSubject)}
                    >
                      {Object.keys(SUBJECT_CHAPTERS).map(subject => (
                        <option key={subject} value={subject}>
                          {subject}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Chapters</label>
                  <div className="chapter-mode-row">
                    <label className="chapter-mode-option">
                      <input
                        type="radio"
                        name="assignment-chapter-mode"
                        value="all"
                        checked={assignmentChapterMode === 'all'}
                        onChange={() => setAssignmentChapterMode('all')}
                      />
                      <span>All chapters</span>
                    </label>
                    <label className="chapter-mode-option">
                      <input
                        type="radio"
                        name="assignment-chapter-mode"
                        value="single"
                        checked={assignmentChapterMode === 'single'}
                        onChange={() => setAssignmentChapterMode('single')}
                      />
                      <span>Single chapter</span>
                    </label>
                    <label className="chapter-mode-option">
                      <input
                        type="radio"
                        name="assignment-chapter-mode"
                        value="multiple"
                        checked={assignmentChapterMode === 'multiple'}
                        onChange={() => setAssignmentChapterMode('multiple')}
                      />
                      <span>Multiple chapters</span>
                    </label>
                  </div>
                  {assignmentChapterMode === 'all' ? (
                    <div className="config-note">All chapters in {assignmentSubject} will be included.</div>
                  ) : (
                    <div className="chapter-selector">
                      <div className="chapter-search-row">
                        <input
                          className="form-input"
                          value={assignmentChapterSearch}
                          onChange={(event) => setAssignmentChapterSearch(event.target.value)}
                          placeholder="Search chapters (type 3+ characters)"
                        />
                        <span className="chapter-search-hint">
                          {assignmentChapterSearch.trim().length < 3
                            ? 'Type 3+ characters to filter'
                            : `Matches: ${filteredAssignmentChapters.length}`}
                        </span>
                      </div>
                      <div className="chapter-list">
                        {filteredAssignmentChapters.map(chapter => (
                          <label key={chapter} className="chapter-option">
                            <input
                              type={assignmentChapterMode === 'single' ? 'radio' : 'checkbox'}
                              name="assignment-chapter"
                              checked={assignmentSelectedChapters.includes(chapter)}
                              onChange={() => {
                                if (assignmentChapterMode === 'single') {
                                  setAssignmentSelectedChapters([chapter]);
                                } else {
                                  setAssignmentSelectedChapters(prev =>
                                    prev.includes(chapter) ? prev.filter(item => item !== chapter) : [...prev, chapter]
                                  );
                                }
                              }}
                            />
                            <span>{chapter}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">MCQ count</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={assignmentMcqCount}
                      onChange={(event) => setAssignmentMcqCount(Number(event.target.value))}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">NAT count</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={assignmentNatCount}
                      onChange={(event) => setAssignmentNatCount(Number(event.target.value))}
                    />
                  </div>
                </div>
                {assignmentQuestionMismatch && (
                  <div className="config-warning">MCQ + NAT counts should match total questions.</div>
                )}
                <div className="form-group">
                  <label className="form-label">Difficulty</label>
                  <select
                    className="form-input"
                    value={assignmentDifficulty}
                    onChange={(event) => setAssignmentDifficulty(event.target.value as DifficultyChoice)}
                  >
                    <option value="mixed">Mixed (easy/medium/hard)</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
            )}
            <div className="custom-test-log">
              <div className="custom-test-log-header">
                <span>Creation Log</span>
                {creatingCustomTest && <span className="custom-test-log-status">Working...</span>}
              </div>
              <div className="custom-test-log-body">
                {customTestLogs.length === 0 ? (
                  <div className="custom-test-log-empty">Log entries will appear here while the test is generated.</div>
                ) : (
                  <ul>
                    {customTestLogs.map((log, index) => (
                      <li key={`${log.timestamp}-${index}`} className={`custom-test-log-item ${log.level}`}>
                        <span className="custom-test-log-time">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="custom-test-log-message">{log.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCustomTestPanel(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreateCustomTest} disabled={creatingCustomTest}>
                {creatingCustomTest ? 'Creating...' : 'Create Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingCustomTests ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
          <span className="spinner" />
        </div>
      ) : customTests.length === 0 ? (
        <div className="empty-state">
          <FileText size={36} />
          <div className="empty-state-title">No Custom Tests Yet</div>
          <div className="empty-state-text">Custom tests created by the owner will appear here.</div>
        </div>
      ) : (
        <div className="custom-tests-grid">
          {customTests.map(test => (
            <CustomTestCard
              key={test.id}
              test={test}
              onStart={() => setCustomExamTestId(test.id)}
              onResume={() => setCustomExamTestId(test.id)}
              onViewResults={() => test.attempt && setCustomResultsAttemptId(test.attempt.id)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <Navigation user={user} onSync={handleSync} syncing={syncing} onProfileClick={() => setShowProfile(true)} onHomeClick={goHome} />
      
      <div className="page">
        <div className="container">
          <div className="page-header">
            <div className="page-header-content">
              <h1 className="page-title">Your Tests</h1>
              <p className="page-subtitle">
                {user.z7iLinked 
                  ? `Linked to ${user.z7iEnrollment} | ${tests.length} tests synced`
                  : 'Link your Z7I account to view your test results'}
              </p>
            </div>
            <div className="page-header-actions">
              {isOwnerUser && (
                <button className="btn btn-secondary" onClick={openOwnerDashboard} style={{ background: 'var(--warning)', color: 'black' }}>
                  <Shield size={16} />
                  Owner
                </button>
              )}
              {isOwnerUser && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setCustomTestLogs([]);
                    setShowCustomTestPanel(prev => !prev);
                  }}
                >
                  <Sparkles size={16} />
                  Custom Test
                </button>
              )}
              <button className="btn btn-secondary" onClick={openForum}>
                <MessageSquare size={16} />
                Forum
              </button>
              <button className="btn btn-secondary" onClick={openAiChats}>
                <MessageCircle size={16} />
                AI Chats
              </button>
              <button className="btn btn-secondary" onClick={openPYP}>
                <Trophy size={16} />
                PYP
              </button>
              {user.z7iLinked && (
                <>
                  <button className="btn btn-secondary" onClick={openTimeIntel}>
                    <Clock size={16} />
                    Time Intelligence
                  </button>
                  <button className="btn btn-secondary bookmarks-btn" onClick={openBookmarks}>
                    <Bookmark size={16} />
                    Saved Questions
                  </button>
                </>
              )}
            </div>
          </div>
          
          {message && (
            <div className={`alert ${message.includes('failed') ? 'alert-error' : 'alert-success'}`}>
              {message}
            </div>
          )}

          {!user.z7iLinked ? (
            <>
              <div className="empty-state">
                <Link2 size={48} />
                <div className="empty-state-title">Link Your Z7I Account</div>
                <div className="empty-state-text">Connect your Z7I account to sync and view your test results.</div>
                <button className="btn btn-primary" onClick={() => setShowLinkModal(true)}>
                  <Link2 size={16} />
                  Link Z7I Account
                </button>
              </div>
              {customTestsSection}
            </>
          ) : loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
              <span className="spinner" />
            </div>
          ) : (
            <>
              <TestsList tests={testsWithQuestions} onSelectTest={handleSelectTest} onWriteExam={setExamWriterTest} />
              {customTestsSection}
              <section className="prep-overview">
                <div className="prep-header">
                  <div>
                    <h2>Preparation Focus</h2>
                    <p>Personalized next steps based on your recent performance.</p>
                  </div>
                  <div className="prep-actions">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => sortedTests[0] && handleSelectTest(sortedTests[0])}
                      disabled={!sortedTests[0]}
                    >
                      <TrendingUp size={14} />
                      Review Latest
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={openBookmarks}>
                      <Bookmark size={14} />
                      Review Saved
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={openTimeIntel}>
                      <Timer size={14} />
                      Time Focus
                    </button>
                  </div>
                </div>
                <div className="prep-grid">
                  <div className="prep-card">
                    <div className="prep-card-title">Momentum</div>
                    <div className="prep-metrics">
                      <div>
                        <span className="prep-metric-label">Recent Accuracy</span>
                        <span className="prep-metric-value">{prepStats.recentAccuracy}%</span>
                      </div>
                      <div>
                        <span className="prep-metric-label">Overall Accuracy</span>
                        <span className="prep-metric-value">{prepStats.averageAccuracy}%</span>
                      </div>
                    </div>
                    <div className="prep-footnote">
                      {prepStats.dayDiff === null
                        ? 'Take your first test to start tracking progress.'
                        : prepStats.dayDiff === 0
                          ? 'You tested today. Keep the momentum going!'
                          : `Last test was ${prepStats.dayDiff} day${prepStats.dayDiff === 1 ? '' : 's'} ago.`}
                    </div>
                  </div>
                  <div className="prep-card">
                    <div className="prep-card-title">Consistency</div>
                    <div className="prep-metrics">
                      <div>
                        <span className="prep-metric-label">Tests this week</span>
                        <span className="prep-metric-value">{prepStats.testsLastWeek}</span>
                      </div>
                      <div>
                        <span className="prep-metric-label">Total Tests</span>
                        <span className="prep-metric-value">{prepStats.totalTests}</span>
                      </div>
                    </div>
                    <div className="prep-footnote">Aim for 3–4 focused sessions per week.</div>
                  </div>
                  <div className="prep-card">
                    <div className="prep-card-title">Focus Queue</div>
                    <div className="prep-list">
                      {prepStats.lowestScoreTests.length === 0 ? (
                        <div className="prep-empty">No tests yet. Sync and start your first test.</div>
                      ) : (
                        prepStats.lowestScoreTests.map(test => (
                          <button
                            key={test.id}
                            className="prep-list-item"
                            onClick={() => handleSelectTest(test)}
                          >
                            <span className="prep-list-title">{test.testName}</span>
                            <span className="prep-list-score">{test.scorePercent}%</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </section>
              {testsWithoutQuestions.length > 0 && (
                <section className="zero-question-tests">
                  <div className="zero-question-header">
                    <div>
                      <h2>Unattempted Tests</h2>
                      <p>These tests have no question data yet.</p>
                    </div>
                    <button
                      className="btn btn-secondary btn-small no-question-resync-toggle"
                      onClick={() => setShowNoQuestionResync(prev => !prev)}
                    >
                      <List size={14} />
                      Resync list ({testsWithoutQuestions.length})
                    </button>
                  </div>
                  {showNoQuestionResync && (
                    <div className="no-question-resync-panel">
                      <div className="no-question-resync-row">
                        <select
                          className="form-input no-question-resync-select"
                          value={selectedNoQuestionId}
                          onChange={event => setSelectedNoQuestionId(event.target.value)}
                        >
                          {testsWithoutQuestions.map(test => (
                            <option key={test.id} value={test.id}>
                              {test.testName} • {test.packageName}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={handleNoQuestionResync}
                          disabled={noQuestionResyncing || !selectedNoQuestionId}
                        >
                          <RefreshCw size={14} className={noQuestionResyncing ? 'spinning' : ''} />
                          {noQuestionResyncing ? 'Resyncing...' : 'Resync'}
                        </button>
                      </div>
                      {noQuestionResyncMessage && (
                        <div className={`no-question-resync-message ${noQuestionResyncStatus}`}>
                          {noQuestionResyncMessage}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid grid-3">
                    {testsWithoutQuestions.map(test => (
                      <TestCard
                        key={test.id}
                        test={test}
                        onClick={() => handleSelectTest(test)}
                        onWriteExam={() => setExamWriterTest(test)}
                        className="test-card-muted"
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      
      {showLinkModal && (
        <LinkZ7IModal 
          onClose={() => setShowLinkModal(false)} 
          onLinked={handleLinked}
          onStartSync={handleSync}
        />
      )}
      
      {syncProgress && (
        <SyncProgressModal 
          progress={syncProgress} 
          onClose={() => setSyncProgress(null)} 
        />
      )}
      
      {showProfile && (
        <ProfileModal 
          user={user} 
          onClose={() => setShowProfile(false)} 
          onUserUpdate={onUserUpdate}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}

const themeVars = [
  '--accent',
  '--accent-primary',
  '--primary',
  '--accent-hover',
  '--accent-subtle',
  '--success',
  '--success-bg',
  '--error',
  '--error-bg',
  '--warning',
  '--warning-bg',
  '--unattempted',
  '--unattempted-bg'
];

const normalizeHex = (hex: string) => {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return hex.toLowerCase();
};

const hexToRgb = (hex: string) => {
  const normalized = normalizeHex(hex).replace('#', '');
  const int = parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
};

const toRgba = (hex: string, alpha: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const adjustHex = (hex: string, amount: number) => {
  const { r, g, b } = hexToRgb(hex);
  const adjust = (value: number) => Math.max(0, Math.min(255, Math.round(value + 255 * amount)));
  return `#${[adjust(r), adjust(g), adjust(b)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
};

function ThemeProvider({
  children,
  user,
  onUserUpdate
}: {
  children: React.ReactNode;
  user?: UserType | null;
  onUserUpdate?: (user: UserType) => void;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (user?.themeMode) {
      return user.themeMode;
    }
    const saved = localStorage.getItem('theme');
    return (saved as Theme) || 'dark';
  });
  const [customThemeEnabled, setCustomThemeEnabled] = useState<boolean>(user?.themeCustomEnabled ?? false);
  const [themeColors, setThemeColors] = useState<ThemeColors>({
    accent: user?.themeAccent,
    accentSecondary: user?.themeAccentSecondary,
    success: user?.themeSuccess,
    error: user?.themeError,
    warning: user?.themeWarning,
    unattempted: user?.themeUnattempted
  });

  useEffect(() => {
    if (!user) {
      setCustomThemeEnabled(false);
      setThemeColors({});
      return;
    }
    if (user.themeMode) {
      setTheme(user.themeMode);
    }
    setCustomThemeEnabled(user.themeCustomEnabled ?? false);
    setThemeColors({
      accent: user.themeAccent,
      accentSecondary: user.themeAccentSecondary,
      success: user.themeSuccess,
      error: user.themeError,
      warning: user.themeWarning,
      unattempted: user.themeUnattempted
    });
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (!customThemeEnabled) {
      themeVars.forEach((variable) => {
        root.style.removeProperty(variable);
      });
      return;
    }

    const accent = themeColors.accent;
    const accentSecondary = themeColors.accentSecondary || accent;
    const success = themeColors.success;
    const error = themeColors.error;
    const warning = themeColors.warning;
    const unattempted = themeColors.unattempted || warning;

    if (accent) {
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--primary', accent);
      root.style.setProperty('--accent-hover', adjustHex(accent, -0.12));
      root.style.setProperty('--accent-subtle', toRgba(accent, 0.2));
    }

    if (accentSecondary) {
      root.style.setProperty('--accent-primary', accentSecondary);
    }

    if (success) {
      root.style.setProperty('--success', success);
      root.style.setProperty('--success-bg', toRgba(success, 0.12));
    }

    if (error) {
      root.style.setProperty('--error', error);
      root.style.setProperty('--error-bg', toRgba(error, 0.12));
    }

    if (warning) {
      root.style.setProperty('--warning', warning);
      root.style.setProperty('--warning-bg', toRgba(warning, 0.12));
    }

    if (unattempted) {
      root.style.setProperty('--unattempted', unattempted);
      root.style.setProperty('--unattempted-bg', toRgba(unattempted, 0.12));
    }
  }, [customThemeEnabled, themeColors, theme]);

  const toggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);

    if (!user || !onUserUpdate) {
      return;
    }

    try {
      const response = await apiRequest('/auth?action=update-theme', {
        method: 'POST',
        body: JSON.stringify({ themeMode: nextTheme })
      });

      if (response.success) {
        onUserUpdate({ ...user, ...response.user });
      }
    } catch {
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, customThemeEnabled }}>
      {children}
    </ThemeContext.Provider>
  );
}

function App() {
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'login' | 'register'>('login');
  const [is404, setIs404] = useState(false);
  const handleUserUpdate = (updatedUser: UserType) => setUser(updatedUser);

  useEffect(() => {
    const path = window.location.pathname;
    if (!isValidRoute(path)) {
      setIs404(true);
    }

    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const data = await apiRequest('/auth?action=me');
          if (data.success) {
            setUser(data.user);
          } else {
            localStorage.removeItem('token');
          }
        } catch {
          localStorage.removeItem('token');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  if (is404) {
    return (
      <ThemeProvider user={user} onUserUpdate={handleUserUpdate}>
        <NotFound onBack={() => {
          setIs404(false);
          window.history.pushState({}, '', '/');
        }} />
      </ThemeProvider>
    );
  }

  if (loading) {
    return (
      <ThemeProvider user={user} onUserUpdate={handleUserUpdate}>
        <div className="login-container">
          <span className="spinner" />
        </div>
      </ThemeProvider>
    );
  }

  if (!user) {
    if (view === 'register') {
      return (
        <ThemeProvider user={user} onUserUpdate={handleUserUpdate}>
          <RegisterPage 
            onRegister={(u) => setUser(u)} 
            onSwitchToLogin={() => setView('login')} 
          />
        </ThemeProvider>
      );
    }
    return (
      <ThemeProvider user={user} onUserUpdate={handleUserUpdate}>
        <LoginPage 
          onLogin={(u) => setUser(u)} 
          onSwitchToRegister={() => setView('register')} 
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider user={user} onUserUpdate={handleUserUpdate}>
      <Dashboard user={user} onUserUpdate={handleUserUpdate} />
    </ThemeProvider>
  );
}

export default App;
