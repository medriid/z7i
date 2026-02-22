import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext, memo, type CSSProperties } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { 
  ResponsiveContainer, 
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip
} from 'recharts';
import { 
  RefreshCw, LogOut, Link2, ChevronLeft, Clock, Clock3, Target, Award, 
  TrendingUp, CheckCircle, XCircle, MinusCircle, BarChart3, 
  FileText, User, Eye, Bookmark, StickyNote,
  MessageCircle, X, Send, ChevronRight, Users, Timer, Trash2, Gift, Shield, Trophy, Medal, Edit3,
  Search, PenTool, MessageSquare, Settings, Key, Mail, AlertTriangle, Unlink, Save, Plus, List,
  Sun, Moon, Filter, RotateCcw, Shuffle, Download, Share2, Copy, Brain, Layers, Zap, Sparkles, Palette, Pin, Menu, Tag, MessageSquareDot
} from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderLatexInHtml, renderRichTextWithLatex } from './utils/latex';
import { ImageLightbox, useImageLightbox } from './components/ImageLightbox';
import { PageMediaLayer } from './components/PageMediaLayer';
import PdfViewer from './components/PdfViewer';
import {
  loadSavedQuestionNotes,
  removeSavedQuestionNote,
  SavedQuestionNote,
} from './utils/savedQuestionNotes';
import { ExamWriter } from './ExamWriter';
import { CustomExamWriter } from './CustomExamWriter';
import { CustomTestResults } from './CustomTestResults';
import PastYearPapers from './PastYearPapers';
import { NotFound } from './NotFound';
import { OwnerDashboard } from './OwnerDashboard';
import { ZonePage } from './ZonePage';

import { AiDoubtPrompt } from './AiDoubtPrompt';
import ChatRoom, { NotificationBell } from './ChatRoom';
import { UpdatesPage } from './UpdatesPage';
import { API_BASE } from './lib/apiBase';

const VALID_ROUTES = ['/', '/dashboard', '/bookmarks', '/forum', '/pyp', '/time-intel', '/owner', '/ai-chats', '/zone', '/league', '/chat', '/updates'];

const VIDEO_MEDIA_REGEX = /^(data:video\/(mp4|webm);base64,.+|https?:\/\/.+\.(mp4|webm)(\?.*)?)$/i;
const GIF_MEDIA_REGEX = /^(data:image\/gif;base64,.+|https?:\/\/.+\.gif(\?.*)?)$/i;

function isVideoMediaUrl(value?: string | null) {
  return Boolean(value && VIDEO_MEDIA_REGEX.test(value.trim()));
}

function isGifMediaUrl(value?: string | null) {
  return Boolean(value && GIF_MEDIA_REGEX.test(value.trim()));
}

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
  profileImageUrl?: string | null;
  isOwner?: boolean;
  z7iLinked: boolean;
  z7iEnrollment?: string;
  z7iIsGuest?: boolean;
  lastSyncAt?: string;
  syncStatus?: string;
  canUseAiSolutions?: boolean;
  canUseGuestSync?: boolean;
  dashboardBrandName?: string | null;
  dashboardBrandColor?: string | null;
  leagueUnranked?: boolean;
  leagueUnrankedUpdatedAt?: string | null;
  themeMode?: Theme;
  themeCustomEnabled?: boolean;
  themeAccent?: string | null;
  themeAccentSecondary?: string | null;
  themeSuccess?: string | null;
  themeError?: string | null;
  themeWarning?: string | null;
  themeUnattempted?: string | null;
  themeNavBgColor?: string | null;
  themeNavGifUrl?: string | null;
  themeHomeBgGifUrl?: string | null;
  themeHomeBgPositionX?: number | null;
  themeHomeBgPositionY?: number | null;
  themeAiChatsBgGifUrl?: string | null;
  themeAiChatsBgPositionX?: number | null;
  themeAiChatsBgPositionY?: number | null;
  themePyqBgGifUrl?: string | null;
  themePyqBgPositionX?: number | null;
  themePyqBgPositionY?: number | null;
  themeForumBgGifUrl?: string | null;
  themeForumBgPositionX?: number | null;
  themeForumBgPositionY?: number | null;
  themeTestCardBgGifUrl?: string | null;
  themeTestCardBgPositionX?: number | null;
  themeTestCardBgPositionY?: number | null;
  twoFactorEnabled?: boolean;
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
  usingRevisionScore?: boolean;
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

type CustomTestConfig = 'jee-main' | 'jee-advanced' | 'assignment' | 'pdf-import';
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
    'Communication Systems (deleted)',
    'Experimental Physics (idk)',
  ],
  Chemistry: [
    'Some Basic Concepts of Chemistry',
    'Structure of Atom',
    'Classification of Elements and Periodicity',
    'Chemical Bonding and Molecular Structure',
    'States of Matter (gases and liquids)',
    'Thermodynamics',
    'Chemical Equilibrium',
    'Ionic Equilibrium',
    'Redox Reactions',
    'Hydrogen',
    's-Block Elements',
    'p-Block Elements (group 13-14)',
    'p-Block Elements (group 15-18)',
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
    'Purification and Characterisation of Organic Compounds (POC)',
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
    'Linear Programming (CBSE)',
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
  attemptId: string;
  z7iAccountId: string;
  userId: string;
  userName: string;
  profileImageUrl?: string | null;
  originalScore: number;
  bonusMarks: number;
  manualAdjustment: number;
  adjustedScore: number;
  rank: number;
  percentile: number | null;
  correct: number;
  incorrect: number;
  unattempted: number;
  attendedCount: number;
  timeTaken: number | null;
  subjectStats?: Array<{ name: string; marks: number }>;
  enrollmentNo?: string;
  aliasNames?: string[];
  isRevision?: boolean;
  scoreLabel?: string | null;
  originalAttemptScore?: number | null;
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
  usingRevisionScore?: boolean;
}

interface LeagueProfile {
  totalExp: number;
  league: string | null;
  stage: number | null;
  streakCount: number;
  streakBonus: number;
  lastPyqQualifiedAt: string | null;
  stageStart: number;
  stageEnd: number | null;
  stageExp: number | null;
  isUnranked?: boolean;
  unrankedUpdatedAt?: string | null;
  mythicRank?: number | null;
}

interface LeagueLeaderboardEntry {
  rank: number | null;
  userId: string;
  userName: string;
  profileImageUrl?: string | null;
  totalExp: number;
  league: string;
  stage: number | null;
  isYou?: boolean;
  isOwner?: boolean;
  isRanked?: boolean;
  aliasNames?: string[];
  isRevision?: boolean;
  scoreLabel?: string | null;
}

interface LeagueLeaderboardResponse {
  entries: LeagueLeaderboardEntry[];
  totalPages: number;
  page: number;
  ownerEntry: LeagueLeaderboardEntry | null;
}

interface LeagueStatsEntry {
  league: string;
  count: number;
}

const getLeagueIconKey = (league?: string | null) => {
  if (!league) return 'bronze';
  if (league === '???') return 'mystery';
  return league.toLowerCase();
};

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

const decodeBase64ToBytes = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const method = (options.method || 'GET').toUpperCase();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    cache: options.cache ?? (method === 'GET' || method === 'HEAD' ? 'no-store' : undefined),
  });

  const responseText = await res.text();
  let data: unknown = null;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  if (!res.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data
      ? String((data as { error?: string }).error || `Request failed with status ${res.status}`)
      : `Request failed with status ${res.status}`;
    const error = new Error(message) as Error & { status?: number; responseBody?: unknown };
    error.status = res.status;
    error.responseBody = data;
    throw error;
  }

  return data;
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

const formatTimeWithDecimal = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value >= 60) return `${(value / 60).toFixed(1)}m`;
  return `${value.toFixed(1)}s`;
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
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [otpChallengeToken, setOtpChallengeToken] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendingOtp, setResendingOtp] = useState(false);
  const [error, setError] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'forgot'>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtpDigits, setForgotOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [forgotPassword, setForgotPassword] = useState('');
  const [forgotOtpVerified, setForgotOtpVerified] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const forgotOtpInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const otpValue = otpDigits.join('');
  const forgotOtp = forgotOtpDigits.join('');

  useEffect(() => {
    if (!otpMessage) return;
    const timer = window.setTimeout(() => setOtpMessage(''), 7000);
    return () => window.clearTimeout(timer);
  }, [otpMessage]);

  useEffect(() => {
    if (!forgotMessage) return;
    const timer = window.setTimeout(() => setForgotMessage(''), 7000);
    return () => window.clearTimeout(timer);
  }, [forgotMessage]);

  const handleOtpDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtpDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });

    if (digit && index < otpInputRefs.current.length - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const next = Array(6).fill('');
    digits.split('').forEach((digit, index) => {
      next[index] = digit;
    });
    setOtpDigits(next);
    const focusIndex = Math.min(digits.length, 5);
    otpInputRefs.current[focusIndex]?.focus();
  };

  const handleForgotOtpDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setForgotOtpDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < forgotOtpInputRefs.current.length - 1) {
      forgotOtpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleForgotOtpKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !forgotOtpDigits[index] && index > 0) {
      forgotOtpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleForgotOtpPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    const next = Array(6).fill('');
    digits.split('').forEach((digit, index) => {
      next[index] = digit;
    });
    setForgotOtpDigits(next);
    const focusIndex = Math.min(digits.length, 5);
    forgotOtpInputRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOtpMessage('');

    try {
      const data = await apiRequest('/auth?action=login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (data.success && data.requiresTwoFactor) {
        setOtpRequired(true);
        setOtpChallengeToken(data.challengeToken || '');
        setOtpDigits(Array(6).fill(''));
        setOtpMessage(data.message || 'Verification code sent to your email.');
        setTimeout(() => otpInputRefs.current[0]?.focus(), 0);
        return;
      }

      if (data.success) {
        localStorage.setItem('token', data.token);
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (otpValue.length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setOtpLoading(true);
    setError('');
    setOtpMessage('');

    try {
      const data = await apiRequest('/auth?action=verify-login-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: otpChallengeToken, otp: otpValue }),
      });

      if (data.success) {
        localStorage.setItem('token', data.token);
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'OTP verification failed');
      }
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : 'OTP verification failed');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpChallengeToken) return;
    setResendingOtp(true);
    setError('');
    try {
      const data = await apiRequest('/auth?action=resend-login-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: otpChallengeToken }),
      });
      if (data.success) {
        setOtpDigits(Array(6).fill(''));
        setOtpMessage(data.message || 'A new OTP was sent to your email.');
        setTimeout(() => otpInputRefs.current[0]?.focus(), 0);
      }
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Failed to resend OTP');
    } finally {
      setResendingOtp(false);
    }
  };

  const handleForgotRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setError('');
    setForgotMessage('');
    try {
      const data = await apiRequest('/auth?action=request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (data.success) {
        setForgotMessage(data.message || 'If an account exists for this email, OTP has been sent.');
      }
    } catch (forgotError) {
      setError(forgotError instanceof Error ? forgotError.message : 'Failed to request password reset');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotVerifyOtp = async () => {
    setForgotLoading(true);
    setError('');
    try {
      const data = await apiRequest('/auth?action=verify-password-reset-otp', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail, otp: forgotOtp }),
      });
      if (data.success) {
        setForgotOtpVerified(true);
        setForgotMessage('OTP verified. You can now set a new password.');
      }
    } catch (forgotError) {
      setForgotOtpVerified(false);
      setError(forgotError instanceof Error ? forgotError.message : 'Invalid OTP');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotOtpVerified) return;
    setForgotLoading(true);
    setError('');
    try {
      const data = await apiRequest('/auth?action=reset-password-with-otp', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail, otp: forgotOtp, newPassword: forgotPassword }),
      });
      if (data.success) {
        setForgotMessage(data.message || 'Password reset successful. Please sign in.');
        setAuthMode('login');
        setEmail(forgotEmail);
        setPassword('');
        setForgotOtpDigits(Array(6).fill(''));
        setForgotPassword('');
        setForgotOtpVerified(false);
      }
    } catch (forgotError) {
      setError(forgotError instanceof Error ? forgotError.message : 'Failed to reset password');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card card">
        <div className="login-logo">
          <h1>Z7I<span>Scraper</span></h1>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {otpMessage && <div className="alert alert-success">{otpMessage}</div>}
        {forgotMessage && <div className="alert alert-success">{forgotMessage}</div>}

        {authMode === 'login' ? (
          <>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <input type="password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required />
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Sign In'}
              </button>
            </form>
            <button type="button" className="link-btn forgot-link" onClick={() => { setAuthMode('forgot'); setError(''); }}>
              Forgot password?
            </button>
          </>
        ) : (
          <form onSubmit={forgotOtpVerified ? handleForgotResetPassword : handleForgotRequestOtp} className="forgot-password-form">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="your@email.com" required />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={forgotLoading || !forgotEmail}>
              {forgotLoading ? <span className="spinner" /> : 'Send OTP'}
            </button>
            <div className="form-group">
              <label className="form-label">OTP</label>
              <div className="otp-input-grid" role="group" aria-label="Password reset one-time password">
                {forgotOtpDigits.map((digit, index) => (
                  <input
                    key={`forgot-otp-${index}`}
                    ref={(element) => {
                      forgotOtpInputRefs.current[index] = element;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otp-digit-input"
                    value={digit}
                    onChange={(event) => handleForgotOtpDigitChange(index, event.target.value)}
                    onKeyDown={(event) => handleForgotOtpKeyDown(index, event)}
                    onPaste={handleForgotOtpPaste}
                    aria-label={`Password reset OTP digit ${index + 1}`}
                  />
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-full" disabled={forgotLoading || forgotOtp.length !== 6} onClick={handleForgotVerifyOtp}>
              Verify OTP
            </button>
            {forgotOtpVerified && (
              <>
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input type="password" className="form-input" value={forgotPassword} onChange={(e) => setForgotPassword(e.target.value)} minLength={6} placeholder="At least 6 characters" required />
                </div>
                <button type="submit" className="btn btn-primary btn-full" disabled={forgotLoading || forgotPassword.length < 6}>
                  Reset Password
                </button>
              </>
            )}
            <button type="button" className="link-btn forgot-link" onClick={() => { setAuthMode('login'); setError(''); }}>
              Back to login
            </button>
          </form>
        )}

        {otpRequired && (
          <div className="login-otp-panel card">
            <h3>Email Verification</h3>
            <p>Enter the 6-digit code sent to <strong>{email}</strong>.</p>
            <form onSubmit={handleVerifyOtp}>
              <div className="otp-input-grid" role="group" aria-label="One-time password">
                {otpDigits.map((digit, index) => (
                  <input
                    key={`otp-${index}`}
                    ref={(element) => {
                      otpInputRefs.current[index] = element;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otp-digit-input"
                    value={digit}
                    onChange={(event) => handleOtpDigitChange(index, event.target.value)}
                    onKeyDown={(event) => handleOtpKeyDown(index, event)}
                    onPaste={handleOtpPaste}
                    aria-label={`OTP digit ${index + 1}`}
                  />
                ))}
              </div>
              <button type="submit" className="btn btn-primary btn-full" disabled={otpLoading}>
                {otpLoading ? <span className="spinner" /> : 'Verify Code'}
              </button>
            </form>
            <button type="button" className="btn btn-secondary btn-full" onClick={handleResendOtp} disabled={resendingOtp}>
              {resendingOtp ? <span className="spinner" /> : 'Resend Code'}
            </button>
          </div>
        )}

        <div className="login-footer">
          Don't have an account? <button onClick={onSwitchToRegister}>Create one</button>
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
  onStartSync,
  canUseGuestSync
}: { 
  onClose: () => void; 
  onLinked: () => void;
  onStartSync: () => void;
  canUseGuestSync: boolean;
}) {
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [z7iPassword, setZ7iPassword] = useState('');
  const [syncAsGuest, setSyncAsGuest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canUseGuestSync) {
      setSyncAsGuest(false);
    }
  }, [canUseGuestSync]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest('/z7i?action=link', {
        method: 'POST',
        body: JSON.stringify({ enrollmentNo, z7iPassword, syncAsGuest }),
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
              placeholder={syncAsGuest ? "Auto-filled for guest sync" : "e.g., 1110642460002"}
              required={!syncAsGuest}
              disabled={syncAsGuest}
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Z7I Password</label>
            <input
              type="password"
              className="form-input"
              value={z7iPassword}
              onChange={(e) => setZ7iPassword(e.target.value)}
              placeholder={syncAsGuest ? "Auto-filled for guest sync" : "Your Z7I password"}
              required={!syncAsGuest}
              disabled={syncAsGuest}
            />
          </div>
          
          {canUseGuestSync && (
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={syncAsGuest}
                  onChange={(e) => setSyncAsGuest(e.target.checked)}
                />
                <span>Sync as guest</span>
              </label>
              <p className="form-help-text">Guest sync uses a shared outsider account to load practice questions without your answered markings.</p>
            </div>
          )}
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

type GifBackgroundControlProps = {
  title: string;
  description: string;
  gifUrl: string;
  onGifUrlChange: (value: string) => void;
  onGifClear: () => void;
  onGifUpload: (file: File | null) => void;
  allowVideo?: boolean;
  positionX: number;
  positionY: number;
  onPositionXChange: (value: number) => void;
  onPositionYChange: (value: number) => void;
  previewClassName: string;
  previewLabel: string;
};

function GifBackgroundControl({
  title,
  description,
  gifUrl,
  onGifUrlChange,
  onGifClear,
  onGifUpload,
  allowVideo,
  positionX,
  positionY,
  onPositionXChange,
  onPositionYChange,
  previewClassName,
  previewLabel
}: GifBackgroundControlProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const isVideo = isVideoMediaUrl(gifUrl);
  const acceptTypes = allowVideo ? 'image/gif,video/mp4,video/webm' : 'image/gif';
  const uploadLabel = allowVideo ? 'Upload Media' : 'Upload GIF';
  const linkLabel = allowVideo ? 'Media Link' : 'GIF Link';
  const placeholderText = allowVideo ? 'https://example.com/background.mp4' : 'https://example.com/background.gif';

  const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const nextX = ((event.clientX - rect.left) / rect.width) * 100;
    const nextY = ((event.clientY - rect.top) / rect.height) * 100;
    onPositionXChange(clamp(nextX));
    onPositionYChange(clamp(nextY));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gifUrl) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromPointer(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="theme-gif-card">
      <div className="theme-gif-header">
        <div>
          <h4>{title}</h4>
          <p className="form-help-text">{description}</p>
        </div>
      </div>
      <label>{linkLabel}</label>
      <input
        type="text"
        className="form-input"
        value={gifUrl}
        onChange={(event) => onGifUrlChange(event.target.value)}
        placeholder={placeholderText}
      />
      <div className="theme-dashboard-upload">
        <label className="theme-upload-label">
          {uploadLabel}
          <input
            type="file"
            accept={acceptTypes}
            onChange={(event) => onGifUpload(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={onGifClear}
        >
          Clear Media
        </button>
      </div>
      <div className="theme-gif-preview">
        <div
          className={`theme-gif-preview-box ${previewClassName} ${gifUrl ? '' : 'is-empty'}`}
          style={{
            backgroundImage: !isVideo && gifUrl ? `url(${gifUrl})` : 'none',
            backgroundPosition: `${positionX}% ${positionY}%`
          }}
          aria-label={previewLabel}
          ref={previewRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {!gifUrl && <span>No media selected</span>}
          {isVideo && gifUrl && (
            <video
              className="theme-gif-preview-video"
              src={gifUrl}
              muted
              loop
              playsInline
              autoPlay
            />
          )}
          {gifUrl && (
            <>
              <div className="theme-gif-focus" style={{ left: `${positionX}%`, top: `${positionY}%` }} />
              <div className="theme-gif-preview-hint">Drag to set focus</div>
            </>
          )}
        </div>
        {gifUrl && (
          <div className="theme-gif-preview-meta">
            <span>Focus: {Math.round(positionX)}% / {Math.round(positionY)}%</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                onPositionXChange(50);
                onPositionYChange(50);
              }}
            >
              Center
            </button>
          </div>
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
  const [profileImageUrl, setProfileImageUrl] = useState(user.profileImageUrl || '');
  const [dashboardBrandName, setDashboardBrandName] = useState(user.dashboardBrandName || '');
  const [dashboardBrandColor, setDashboardBrandColor] = useState(user.dashboardBrandColor || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(Boolean(user.twoFactorEnabled));

  const [leagueUnranked, setLeagueUnranked] = useState(Boolean(user.leagueUnranked));
  
  const [enrollmentNo, setEnrollmentNo] = useState(user.z7iEnrollment || '');
  const [z7iPassword, setZ7iPassword] = useState('');
  const [syncAsGuest, setSyncAsGuest] = useState(Boolean(user.z7iIsGuest && user.canUseGuestSync));
  
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
  const [themeNavBgMode, setThemeNavBgMode] = useState<'default' | 'color' | 'gif'>('default');
  const [themeNavBgColor, setThemeNavBgColor] = useState(user.themeNavBgColor || '');
  const [themeNavGifUrl, setThemeNavGifUrl] = useState(user.themeNavGifUrl || '');
  const [themeHomeBgGifUrl, setThemeHomeBgGifUrl] = useState(user.themeHomeBgGifUrl || '');
  const [themeHomeBgPositionX, setThemeHomeBgPositionX] = useState(user.themeHomeBgPositionX ?? 50);
  const [themeHomeBgPositionY, setThemeHomeBgPositionY] = useState(user.themeHomeBgPositionY ?? 50);
  const [themeAiChatsBgGifUrl, setThemeAiChatsBgGifUrl] = useState(user.themeAiChatsBgGifUrl || '');
  const [themeAiChatsBgPositionX, setThemeAiChatsBgPositionX] = useState(user.themeAiChatsBgPositionX ?? 50);
  const [themeAiChatsBgPositionY, setThemeAiChatsBgPositionY] = useState(user.themeAiChatsBgPositionY ?? 50);
  const [themePyqBgGifUrl, setThemePyqBgGifUrl] = useState(user.themePyqBgGifUrl || '');
  const [themePyqBgPositionX, setThemePyqBgPositionX] = useState(user.themePyqBgPositionX ?? 50);
  const [themePyqBgPositionY, setThemePyqBgPositionY] = useState(user.themePyqBgPositionY ?? 50);
  const [themeForumBgGifUrl, setThemeForumBgGifUrl] = useState(user.themeForumBgGifUrl || '');
  const [themeForumBgPositionX, setThemeForumBgPositionX] = useState(user.themeForumBgPositionX ?? 50);
  const [themeForumBgPositionY, setThemeForumBgPositionY] = useState(user.themeForumBgPositionY ?? 50);
  const [themeTestCardBgGifUrl, setThemeTestCardBgGifUrl] = useState(user.themeTestCardBgGifUrl || '');
  const [themeTestCardBgPositionX, setThemeTestCardBgPositionX] = useState(user.themeTestCardBgPositionX ?? 50);
  const [themeTestCardBgPositionY, setThemeTestCardBgPositionY] = useState(user.themeTestCardBgPositionY ?? 50);
  const [activeGifTarget, setActiveGifTarget] = useState<'home' | 'ai' | 'pyq' | 'forum'>('home');
  const canUseGuestSync = user.canUseGuestSync === true;
  const isOwnerUser = Boolean(user.isOwner);
  const maxOwnerVideoBytes = 30 * 1024 * 1024;

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
    const navGif = user.themeNavGifUrl || '';
    const navColor = user.themeNavBgColor || '';
    setThemeNavGifUrl(navGif);
    setThemeNavBgColor(navColor);
    setThemeNavBgMode(navGif ? 'gif' : navColor ? 'color' : 'default');
    setThemeHomeBgGifUrl(user.themeHomeBgGifUrl || '');
    setThemeHomeBgPositionX(user.themeHomeBgPositionX ?? 50);
    setThemeHomeBgPositionY(user.themeHomeBgPositionY ?? 50);
    setThemeAiChatsBgGifUrl(user.themeAiChatsBgGifUrl || '');
    setThemeAiChatsBgPositionX(user.themeAiChatsBgPositionX ?? 50);
    setThemeAiChatsBgPositionY(user.themeAiChatsBgPositionY ?? 50);
    setThemePyqBgGifUrl(user.themePyqBgGifUrl || '');
    setThemePyqBgPositionX(user.themePyqBgPositionX ?? 50);
    setThemePyqBgPositionY(user.themePyqBgPositionY ?? 50);
    setThemeForumBgGifUrl(user.themeForumBgGifUrl || '');
    setThemeForumBgPositionX(user.themeForumBgPositionX ?? 50);
    setThemeForumBgPositionY(user.themeForumBgPositionY ?? 50);
    setThemeTestCardBgGifUrl(user.themeTestCardBgGifUrl || '');
    setThemeTestCardBgPositionX(user.themeTestCardBgPositionX ?? 50);
    setThemeTestCardBgPositionY(user.themeTestCardBgPositionY ?? 50);
    setProfileImageUrl(user.profileImageUrl || '');
    setTwoFactorEnabled(Boolean(user.twoFactorEnabled));
    setDashboardBrandName(user.dashboardBrandName || '');
    setDashboardBrandColor(user.dashboardBrandColor || '');
    setLeagueUnranked(Boolean(user.leagueUnranked));
  }, [
    user,
    theme,
    getCssVar
  ]);

  useEffect(() => {
    if (!canUseGuestSync) {
      setSyncAsGuest(false);
    }
  }, [canUseGuestSync]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleMediaUpload = (
    file: File | null,
    onChange: (value: string) => void,
    allowVideo = isOwnerUser
  ) => {
    if (!file) return;
    const isGif = file.type === 'image/gif';
    const isVideo = file.type === 'video/mp4' || file.type === 'video/webm';
    if (!isGif && !isVideo) {
      showMessage('error', 'Please upload a GIF, MP4, or WebM file.');
      return;
    }
    if (isVideo && !allowVideo) {
      showMessage('error', 'Video backgrounds are available for the owner only.');
      return;
    }
    if (isVideo && file.size > maxOwnerVideoBytes) {
      showMessage('error', 'Video must be 30MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleProfileImageUpload = (file: File | null) => {
    if (!file) return;
    const isAllowedImage = file.type === 'image/png' || file.type === 'image/gif';
    if (!isAllowedImage) {
      showMessage('error', 'Please upload a PNG or GIF image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const gifTargets = {
    home: {
      selectorLabel: 'Home',
      selectorHint: 'Dashboard landing page',
      title: 'Homepage Background',
      description: 'Applies to the main dashboard landing page.',
      gifUrl: themeHomeBgGifUrl,
      onGifUrlChange: setThemeHomeBgGifUrl,
      onGifClear: () => setThemeHomeBgGifUrl(''),
      onGifUpload: (file: File | null) => handleMediaUpload(file, setThemeHomeBgGifUrl),
      allowVideo: isOwnerUser,
      positionX: themeHomeBgPositionX,
      positionY: themeHomeBgPositionY,
      onPositionXChange: setThemeHomeBgPositionX,
      onPositionYChange: setThemeHomeBgPositionY,
      previewClassName: 'theme-gif-preview-home',
      previewLabel: 'Homepage background preview'
    },
    ai: {
      selectorLabel: 'AI Chats',
      selectorHint: 'Chat workspace',
      title: 'AI Chats Background',
      description: 'Background GIF for the AI chats workspace.',
      gifUrl: themeAiChatsBgGifUrl,
      onGifUrlChange: setThemeAiChatsBgGifUrl,
      onGifClear: () => setThemeAiChatsBgGifUrl(''),
      onGifUpload: (file: File | null) => handleMediaUpload(file, setThemeAiChatsBgGifUrl),
      allowVideo: isOwnerUser,
      positionX: themeAiChatsBgPositionX,
      positionY: themeAiChatsBgPositionY,
      onPositionXChange: setThemeAiChatsBgPositionX,
      onPositionYChange: setThemeAiChatsBgPositionY,
      previewClassName: 'theme-gif-preview-ai',
      previewLabel: 'AI chats background preview'
    },
    pyq: {
      selectorLabel: 'PYQ',
      selectorHint: 'Past year questions',
      title: 'PYQ Page Background',
      description: 'Background GIF for the past year questions page.',
      gifUrl: themePyqBgGifUrl,
      onGifUrlChange: setThemePyqBgGifUrl,
      onGifClear: () => setThemePyqBgGifUrl(''),
      onGifUpload: (file: File | null) => handleMediaUpload(file, setThemePyqBgGifUrl),
      allowVideo: isOwnerUser,
      positionX: themePyqBgPositionX,
      positionY: themePyqBgPositionY,
      onPositionXChange: setThemePyqBgPositionX,
      onPositionYChange: setThemePyqBgPositionY,
      previewClassName: 'theme-gif-preview-pyq',
      previewLabel: 'PYQ background preview'
    },
    forum: {
      selectorLabel: 'Forum',
      selectorHint: 'Posts feed',
      title: 'Posts Background',
      description: 'Background GIF for the forum posts experience.',
      gifUrl: themeForumBgGifUrl,
      onGifUrlChange: setThemeForumBgGifUrl,
      onGifClear: () => setThemeForumBgGifUrl(''),
      onGifUpload: (file: File | null) => handleMediaUpload(file, setThemeForumBgGifUrl),
      allowVideo: isOwnerUser,
      positionX: themeForumBgPositionX,
      positionY: themeForumBgPositionY,
      onPositionXChange: setThemeForumBgPositionX,
      onPositionYChange: setThemeForumBgPositionY,
      previewClassName: 'theme-gif-preview-forum',
      previewLabel: 'Forum background preview'
    }
  } satisfies Record<
    'home' | 'ai' | 'pyq' | 'forum',
    Omit<GifBackgroundControlProps, 'previewClassName' | 'previewLabel'> & {
      selectorLabel: string;
      selectorHint: string;
      previewClassName: string;
      previewLabel: string;
    }
  >;
  const activeGifConfig = gifTargets[activeGifTarget];

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword && newPassword !== confirmPassword) {
      showMessage('error', 'New passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const body: {
        name?: string;
        currentPassword?: string;
        newPassword?: string;
        dashboardBrandName?: string;
        dashboardBrandColor?: string | null;
        profileImageUrl?: string | null;
        leagueUnranked?: boolean;
        twoFactorEnabled?: boolean;
      } = {};
      
      if (name !== user.name) {
        body.name = name;
      }

      if (dashboardBrandName !== (user.dashboardBrandName || '')) {
        body.dashboardBrandName = dashboardBrandName;
      }

      if (dashboardBrandColor !== (user.dashboardBrandColor || '')) {
        body.dashboardBrandColor = dashboardBrandColor || null;
      }

      if (profileImageUrl !== (user.profileImageUrl || '')) {
        body.profileImageUrl = profileImageUrl || null;
      }

      if (leagueUnranked !== Boolean(user.leagueUnranked)) {
        body.leagueUnranked = leagueUnranked;
      }
      
      if (twoFactorEnabled !== Boolean(user.twoFactorEnabled)) {
        if (!currentPassword) {
          showMessage('error', 'Current password is required to change 2FA settings');
          setLoading(false);
          return;
        }
        body.twoFactorEnabled = twoFactorEnabled;
        body.currentPassword = currentPassword;
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
        onUserUpdate({ ...user, ...response.user });
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

    const navBgPayload =
      themeNavBgMode === 'gif'
        ? { themeNavGifUrl: themeNavGifUrl.trim() || null, themeNavBgColor: null }
        : themeNavBgMode === 'color'
          ? { themeNavBgColor: themeNavBgColor || null, themeNavGifUrl: null }
          : { themeNavBgColor: null, themeNavGifUrl: null };
    const homeBgPayload = themeHomeBgGifUrl.trim()
      ? {
          themeHomeBgGifUrl: themeHomeBgGifUrl.trim(),
          themeHomeBgPositionX: themeHomeBgPositionX,
          themeHomeBgPositionY: themeHomeBgPositionY
        }
      : {
          themeHomeBgGifUrl: null,
          themeHomeBgPositionX: null,
          themeHomeBgPositionY: null
        };
    const aiChatsBgPayload = themeAiChatsBgGifUrl.trim()
      ? {
          themeAiChatsBgGifUrl: themeAiChatsBgGifUrl.trim(),
          themeAiChatsBgPositionX: themeAiChatsBgPositionX,
          themeAiChatsBgPositionY: themeAiChatsBgPositionY
        }
      : {
          themeAiChatsBgGifUrl: null,
          themeAiChatsBgPositionX: null,
          themeAiChatsBgPositionY: null
        };
    const pyqBgPayload = themePyqBgGifUrl.trim()
      ? {
          themePyqBgGifUrl: themePyqBgGifUrl.trim(),
          themePyqBgPositionX: themePyqBgPositionX,
          themePyqBgPositionY: themePyqBgPositionY
        }
      : {
          themePyqBgGifUrl: null,
          themePyqBgPositionX: null,
          themePyqBgPositionY: null
        };
    const forumBgPayload = themeForumBgGifUrl.trim()
      ? {
          themeForumBgGifUrl: themeForumBgGifUrl.trim(),
          themeForumBgPositionX: themeForumBgPositionX,
          themeForumBgPositionY: themeForumBgPositionY
        }
      : {
          themeForumBgGifUrl: null,
          themeForumBgPositionX: null,
          themeForumBgPositionY: null
        };
    const testCardBgPayload = themeTestCardBgGifUrl.trim()
      ? {
          themeTestCardBgGifUrl: themeTestCardBgGifUrl.trim(),
          themeTestCardBgPositionX: themeTestCardBgPositionX,
          themeTestCardBgPositionY: themeTestCardBgPositionY
        }
      : {
          themeTestCardBgGifUrl: null,
          themeTestCardBgPositionX: null,
          themeTestCardBgPositionY: null
        };

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
          themeUnattempted,
          ...navBgPayload,
          ...homeBgPayload,
          ...aiChatsBgPayload,
          ...pyqBgPayload,
          ...forumBgPayload,
          ...testCardBgPayload
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
    
    if (!syncAsGuest && (!enrollmentNo || !z7iPassword)) {
      showMessage('error', 'Both enrollment number and password are required');
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest('/auth?action=update-z7i', {
        method: 'POST',
        body: JSON.stringify({ enrollmentNo, z7iPassword, syncAsGuest })
      });

      if (response.success) {
        showMessage('success', response.message);
        onUserUpdate({ ...user, z7iLinked: true, z7iEnrollment: response.enrollmentNo || enrollmentNo, z7iIsGuest: !!response.isGuest });
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
  const unrankedUpdatedAt = user.leagueUnrankedUpdatedAt ? new Date(user.leagueUnrankedUpdatedAt) : null;
  const unrankedCooldownMs = 7 * 24 * 60 * 60 * 1000;
  const nextUnrankedChangeAt = unrankedUpdatedAt ? new Date(unrankedUpdatedAt.getTime() + unrankedCooldownMs) : null;
  const unrankedCooldownRemaining = nextUnrankedChangeAt
    ? Math.max(0, Math.ceil((nextUnrankedChangeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;
  const canToggleUnranked = !nextUnrankedChangeAt || Date.now() >= nextUnrankedChangeAt.getTime();

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

                <div className="form-group">
                  <label>Dashboard Brand</label>
                  <input
                    type="text"
                    value={dashboardBrandName}
                    onChange={(e) => setDashboardBrandName(e.target.value)}
                    placeholder="Z7I Scraper"
                    className="form-input"
                    maxLength={32}
                  />
                  <p className="form-help-text">Shown in the top-left header.</p>
                </div>

                <div className="form-group">
                  <label>Brand Color</label>
                  <div className="profile-inline-controls">
                    <input
                      type="color"
                      value={dashboardBrandColor || '#6b7280'}
                      onChange={(e) => setDashboardBrandColor(e.target.value)}
                      className="form-color-input"
                    />
                    <input
                      type="text"
                      value={dashboardBrandColor}
                      onChange={(e) => setDashboardBrandColor(e.target.value)}
                      placeholder="#6b7280"
                      className="form-input"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setDashboardBrandColor('')}
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Profile Picture URL</label>
                  <input
                    type="url"
                    value={profileImageUrl}
                    onChange={(e) => setProfileImageUrl(e.target.value)}
                    placeholder="https://... or data:image/..."
                    className="form-input"
                  />
                  <div className="profile-inline-controls">
                    <label className="theme-upload-label">
                      Upload PNG/GIF
                      <input
                        type="file"
                        accept="image/png,image/gif"
                        onChange={(event) => handleProfileImageUpload(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setProfileImageUrl('')}
                    >
                      Clear Picture
                    </button>
                  </div>
                  <div className="profile-picture-preview">
                    {profileImageUrl ? (
                      <img src={profileImageUrl} alt="Profile preview" />
                    ) : (
                      <div className="profile-picture-fallback">
                        <User size={16} />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="profile-section">
                <h3>
                  <Trophy size={16} />
                  League Visibility
                </h3>
                <div className="profile-toggle-row">
                  <div className="profile-toggle-meta">
                    <span className="profile-toggle-label">Unranked</span>
                    <span className="profile-toggle-hint">
                      Hide you from leaderboards and hide leagues from you.
                    </span>
                    {!canToggleUnranked && nextUnrankedChangeAt && (
                      <span className="profile-toggle-hint">
                        Change available in {unrankedCooldownRemaining} day{unrankedCooldownRemaining === 1 ? '' : 's'}.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`profile-toggle-switch ${leagueUnranked ? 'on' : ''}`}
                    onClick={() => canToggleUnranked && setLeagueUnranked((prev) => !prev)}
                    disabled={!canToggleUnranked}
                    aria-pressed={leagueUnranked}
                  >
                    {leagueUnranked ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              <div className="profile-section">
                <h3>
                  <Shield size={16} />
                  Two-Factor Authentication
                </h3>
                <div className="profile-toggle-row">
                  <div className="profile-toggle-meta">
                    <span className="profile-toggle-label">Email OTP (Gmail compatible)</span>
                    <span className="profile-toggle-hint">
                      Adds a second step at sign in. A 6-digit code is sent to your email.
                    </span>
                    <span className="profile-toggle-hint">
                      Changing this requires your current password when saving profile updates.
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`profile-toggle-switch ${twoFactorEnabled ? 'on' : ''}`}
                    onClick={() => setTwoFactorEnabled((prev) => !prev)}
                    aria-pressed={twoFactorEnabled}
                  >
                    {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                  </button>
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
                        <span className="label">Mode:</span>
                        <span className="value">{user.z7iIsGuest ? 'Guest (outsider)' : 'Personal account'}</span>
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
                  {canUseGuestSync && (
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={syncAsGuest}
                          onChange={(e) => setSyncAsGuest(e.target.checked)}
                        />
                        <span>Sync as guest</span>
                      </label>
                      <p className="form-help-text">Use shared outsider sync if you don't have enrollment/password yet.</p>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Enrollment Number</label>
                    <input
                      type="text"
                      value={enrollmentNo}
                      onChange={(e) => setEnrollmentNo(e.target.value)}
                      placeholder={syncAsGuest ? 'Auto-filled for guest sync' : 'Your Z7I enrollment number'}
                      className="form-input"
                      disabled={syncAsGuest}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Z7I Password</label>
                    <input
                      type="password"
                      value={z7iPassword}
                      onChange={(e) => setZ7iPassword(e.target.value)}
                      placeholder={syncAsGuest ? 'Auto-filled for guest sync' : 'Your Z7I password'}
                      className="form-input"
                      disabled={syncAsGuest}
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

                  <div className="theme-toggle-row">
                    <button
                      type="button"
                      className={`theme-toggle-btn ${themeCustomEnabled ? 'active' : ''}`}
                      onClick={() => setThemeCustomEnabled((prev) => !prev)}
                      aria-pressed={themeCustomEnabled}
                    >
                      <span className="theme-toggle-indicator" />
                      <span>Enable custom theme colors</span>
                    </button>
                  </div>

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

                  <div className="theme-dashboard-card">
                    <div className="theme-dashboard-header">
                      <div>
                        <h4>Universal Dashboard Header</h4>
                        <p className="form-help-text">
                          Customize the top bar with a color or a GIF background.
                        </p>
                      </div>
                    </div>
                    <div className="theme-dashboard-options">
                      {(['default', 'color', 'gif'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`theme-choice-btn ${themeNavBgMode === mode ? 'active' : ''}`}
                          onClick={() => setThemeNavBgMode(mode)}
                          aria-pressed={themeNavBgMode === mode}
                        >
                          {mode === 'default' ? 'Default' : mode === 'color' ? 'Color' : 'GIF'}
                        </button>
                      ))}
                    </div>

                    {themeNavBgMode === 'color' && (
                      <div className="theme-dashboard-panel">
                        <label>Header Color</label>
                        <div className="theme-color-control">
                          <input
                            type="color"
                            value={themeNavBgColor || '#111827'}
                            onChange={(e) => setThemeNavBgColor(e.target.value)}
                          />
                          <span>{themeNavBgColor || '#111827'}</span>
                        </div>
                      </div>
                    )}

                    {themeNavBgMode === 'gif' && (
                      <div className="theme-dashboard-panel">
                        <label>GIF Link</label>
                        <input
                          type="text"
                          className="form-input"
                          value={themeNavGifUrl}
                          onChange={(e) => setThemeNavGifUrl(e.target.value)}
                          placeholder="https://example.com/ambient.gif"
                        />
                        <div className="theme-dashboard-upload">
                          <label className="theme-upload-label">
                            Upload GIF
                            <input
                              type="file"
                              accept="image/gif"
                              onChange={(event) => handleMediaUpload(event.target.files?.[0] ?? null, setThemeNavGifUrl, false)}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => setThemeNavGifUrl('')}
                          >
                            Clear GIF
                          </button>
                        </div>
                        <p className="form-help-text">
                          GIF uploads are stored as a data URL. Keep files lightweight for smooth performance.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="theme-dashboard-card">
                    <div className="theme-dashboard-header">
                      <div>
                        <h4>Page Background Media</h4>
                        <p className="form-help-text">
                          Add a GIF or MP4/WebM backdrop to key pages and adjust the crop to keep the right focus.
                        </p>
                      </div>
                    </div>
                    <div className="theme-gif-selector">
                      {(Object.keys(gifTargets) as Array<keyof typeof gifTargets>).map((targetKey) => {
                        const target = gifTargets[targetKey];
                        return (
                          <button
                            key={targetKey}
                            type="button"
                            className={`theme-gif-target ${activeGifTarget === targetKey ? 'active' : ''}`}
                            onClick={() => setActiveGifTarget(targetKey)}
                            aria-pressed={activeGifTarget === targetKey}
                          >
                            <span className="theme-gif-target-title">{target.selectorLabel}</span>
                            <span className="theme-gif-target-meta">{target.selectorHint}</span>
                          </button>
                        );
                      })}
                    </div>
                    <GifBackgroundControl
                      title={activeGifConfig.title}
                      description={activeGifConfig.description}
                      gifUrl={activeGifConfig.gifUrl}
                      onGifUrlChange={activeGifConfig.onGifUrlChange}
                      onGifClear={activeGifConfig.onGifClear}
                      onGifUpload={activeGifConfig.onGifUpload}
                      allowVideo={activeGifConfig.allowVideo}
                      positionX={activeGifConfig.positionX}
                      positionY={activeGifConfig.positionY}
                      onPositionXChange={activeGifConfig.onPositionXChange}
                      onPositionYChange={activeGifConfig.onPositionYChange}
                      previewClassName={activeGifConfig.previewClassName}
                      previewLabel={activeGifConfig.previewLabel}
                    />
                  </div>

                  <div className="theme-dashboard-card">
                    <div className="theme-dashboard-header">
                      <div>
                        <h4>Test Card Background</h4>
                        <p className="form-help-text">
                          Set a general GIF background for test cards on the homepage.
                        </p>
                      </div>
                    </div>
                    <GifBackgroundControl
                      title="Test Card Background"
                      description="Applies to every test card in your test list."
                      gifUrl={themeTestCardBgGifUrl}
                      onGifUrlChange={setThemeTestCardBgGifUrl}
                      onGifClear={() => setThemeTestCardBgGifUrl('')}
                      onGifUpload={(file) => handleMediaUpload(file, setThemeTestCardBgGifUrl, false)}
                      positionX={themeTestCardBgPositionX}
                      positionY={themeTestCardBgPositionY}
                      onPositionXChange={setThemeTestCardBgPositionX}
                      onPositionYChange={setThemeTestCardBgPositionY}
                      previewClassName="theme-gif-preview-card"
                      previewLabel="Test card background preview"
                    />
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
            <h1 className="page-title time-intel-page-title"><Clock3 size={20} /> Time Intelligence</h1>
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
  onHomeClick,
  leagueProfile,
  leagueLoading,
  onOpenLeague,
  onGoToChat,
  forceCompact,
}: { 
  user: UserType; 
  onSync: () => void; 
  syncing: boolean;
  onProfileClick: () => void;
  onHomeClick?: () => void;
  leagueProfile?: LeagueProfile | null;
  leagueLoading?: boolean;
  onOpenLeague?: () => void;
  onGoToChat?: () => void;
  forceCompact?: boolean;
}) {
  const { theme, toggleTheme, customThemeEnabled } = useTheme();
  const compactProgressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const isCompactRef = useRef(false);
  const navBackgroundImage = user.themeNavGifUrl
    ? `linear-gradient(180deg, rgba(6, 10, 23, 0.78), rgba(6, 10, 23, 0.92)), url(${user.themeNavGifUrl})`
    : user.themeNavBgColor
      ? 'linear-gradient(180deg, rgba(6, 10, 23, 0.22), rgba(6, 10, 23, 0.55))'
      : undefined;
  const navBackgroundColor = user.themeNavBgColor || undefined;
  const lastSyncText = user.lastSyncAt 
    ? formatDistanceToNow(new Date(user.lastSyncAt), { addSuffix: true })
    : 'Never';
  const brandName = (user.dashboardBrandName || '').trim();
  const brandColor = (user.dashboardBrandColor || '').trim();
  const leagueStageProgress = leagueProfile?.stageExp
    ? Math.max(0, leagueProfile.totalExp - leagueProfile.stageStart)
    : 0;
  const leagueStagePct = leagueProfile?.stageExp
    ? Math.min(100, (leagueStageProgress / Math.max(leagueProfile.stageExp, 1)) * 100)
    : 100;
  const leagueLabel = leagueProfile
    ? `${leagueProfile.league}${leagueProfile.stage ? ` ${leagueProfile.stage}` : ''}`
    : 'Loading league…';
  const leagueStageExpTarget = Math.max(leagueProfile?.stageExp ?? 0, 0);
  const leagueProgressText = leagueProfile
    ? `${leagueStageProgress.toLocaleString()} / ${leagueStageExpTarget.toLocaleString()} EXP`
    : 'Calculating EXP…';
  const leagueProgressPercentLabel = leagueProfile
    ? `${Math.round(leagueStagePct)}%`
    : '--';

  useEffect(() => {
    const getScrollProgress = () => {
      const start = 4;
      const end = 140;
      const ratio = (window.scrollY - start) / (end - start);
      return Math.min(1, Math.max(0, ratio));
    };

    const syncCompactState = (next: number) => {
      if (Math.abs(compactProgressRef.current - next) < 0.005) return;
      compactProgressRef.current = next;
      const el = navRef.current;
      if (!el) return;
      el.style.setProperty('--nav-compact-progress', String(next));
      const nowCompact = next > 0.98;
      if (nowCompact !== isCompactRef.current) {
        isCompactRef.current = nowCompact;
        el.classList.toggle('nav--compact', nowCompact);
      }
    };

    const updateProgress = () => {
      rafRef.current = null;
      const inImmersiveView = document.body.classList.contains('immersive-view');
      const next = inImmersiveView || forceCompact ? 1 : getScrollProgress();
      syncCompactState(next);
    };

    const handleScroll = () => {
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(updateProgress);
      }
    };

    const bodyClassObserver = new MutationObserver(() => {
      updateProgress();
    });

    updateProgress();
    handleScroll();
    bodyClassObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      bodyClassObserver.disconnect();
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [forceCompact]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    const updateNavHeight = () => {
      const navHeight = navEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--app-nav-height', `${Math.max(0, navHeight)}px`);
    };

    updateNavHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateNavHeight();
    });
    resizeObserver.observe(navEl);
    window.addEventListener('resize', updateNavHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateNavHeight);
      document.documentElement.style.setProperty('--app-nav-height', '0px');
    };
  }, []);
    
  return (
    <nav
      ref={navRef}
      className={`nav ${user.themeNavGifUrl || user.themeNavBgColor ? 'nav--custom' : ''}`}
      style={{
        backgroundColor: navBackgroundColor,
        backgroundImage: navBackgroundImage,
      } as CSSProperties}
    >
      <div className="container nav-content">
        <button className="nav-brand-btn" onClick={onHomeClick} title="Go to Home">
          {brandName ? (
            <span className="nav-brand" style={brandColor ? { color: brandColor } : undefined}>{brandName}</span>
          ) : (
            <span className="nav-brand">Z7I<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Scraper</span></span>
          )}
        </button>
        
        <div className="nav-links">
          {user.z7iEnrollment && (
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
          {(leagueProfile || leagueLoading) && (
            <button
              className="nav-league"
              onClick={() => leagueProfile && onOpenLeague?.()}
              disabled={!leagueProfile}
              aria-label="Open league"
            >
              <span className="league-icon">
                {leagueProfile ? (
                  leagueProfile.mythicRank != null && leagueProfile.mythicRank >= 1 && leagueProfile.mythicRank <= 3 ? (
                    <img
                      src={`/league-icons/trophy-${leagueProfile.mythicRank}.png`}
                      alt={`Rank ${leagueProfile.mythicRank} trophy`}
                      loading="lazy"
                    />
                  ) : (
                    <img
                      src={`/league-icons/${getLeagueIconKey(leagueProfile.league)}.png`}
                      alt={leagueProfile.league || 'League'}
                      loading="lazy"
                    />
                  )
                ) : (
                  <span className="league-loading-dot" />
                )}
              </span>
              <span className="nav-league-meta">
                {leagueProfile?.league === '???' ? (
                  <>
                    <span className="nav-league-label-row">
                      <span className="nav-league-label">{leagueLabel}</span>
                    </span>
                    <span className="nav-league-top">
                      {leagueProfile.mythicRank != null ? `Rank #${leagueProfile.mythicRank}` : 'Unranked'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="nav-league-label-row">
                      <span className="nav-league-label">{leagueLabel}</span>
                      <span className="nav-league-pct">{leagueProgressPercentLabel}</span>
                    </span>
                    <span className="nav-league-bar">
                      <span
                        className={`nav-league-fill ${leagueProfile ? '' : 'loading'}`}
                        style={{ width: `${leagueProfile ? leagueStagePct : 35}%` }}
                      />
                    </span>
                    <span className="nav-league-top">{leagueProgressText}</span>
                  </>
                )}
              </span>
            </button>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {customThemeEnabled ? <Palette size={18} /> : (theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />)}
          </button>
          <NotificationBell onClick={() => onGoToChat?.()} />
          <button className="user-info-btn" onClick={onProfileClick}>
            <div className="user-avatar">
              {user.profileImageUrl ? (
                <img
                  src={user.profileImageUrl}
                  alt={`${user.name || user.email} avatar`}
                  loading="lazy"
                />
              ) : (
                <User size={16} />
              )}
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
        <div className={`test-stat test-stat-rank ${test.usingRevisionScore ? 'test-stat-rank--revision' : ''}`}>
          <Award size={12} />
          <div className="test-stat-value">{test.rank ? `#${test.rank}` : '-'}</div>
        </div>
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
  onViewResults,
  canDelete,
  deleting,
  onDelete
}: {
  test: CustomTest;
  onStart: () => void;
  onResume: () => void;
  onViewResults: () => void;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
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
        {canDelete && (
          <button
            className="btn btn-secondary custom-test-delete-btn"
            onClick={onDelete}
            disabled={deleting}
            title="Delete this custom test for everyone"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
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
  const [groupBy, setGroupBy] = useState<'test' | 'subject' | 'custom'>('test');
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<'list' | 'flashcard' | 'practice'>('list');
  const [customGroups, setCustomGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('bookmark-custom-groups') || '[]'); } catch { return []; }
  });
  const [bookmarkGroupMap, setBookmarkGroupMap] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('bookmark-group-map') || '{}'); } catch { return {}; }
  });
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [assigningBookmark, setAssigningBookmark] = useState<string | null>(null);
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

  const saveCustomGroups = (groups: string[]) => {
    setCustomGroups(groups);
    localStorage.setItem('bookmark-custom-groups', JSON.stringify(groups));
  };

  const saveBookmarkGroupMap = (map: Record<string, string[]>) => {
    setBookmarkGroupMap(map);
    localStorage.setItem('bookmark-group-map', JSON.stringify(map));
  };

  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (!name || customGroups.includes(name)) return;
    saveCustomGroups([...customGroups, name]);
    setNewGroupName('');
    setShowCreateGroup(false);
  };

  const handleDeleteGroup = (groupName: string) => {
    saveCustomGroups(customGroups.filter(g => g !== groupName));
    const newMap = { ...bookmarkGroupMap };
    Object.keys(newMap).forEach(k => {
      newMap[k] = newMap[k].filter(g => g !== groupName);
    });
    saveBookmarkGroupMap(newMap);
    if (filterGroup === groupName) setFilterGroup(null);
  };

  const handleToggleBookmarkGroup = (bookmarkId: string, groupName: string) => {
    const current = bookmarkGroupMap[bookmarkId] || [];
    const newMap = { ...bookmarkGroupMap };
    if (current.includes(groupName)) {
      newMap[bookmarkId] = current.filter(g => g !== groupName);
    } else {
      newMap[bookmarkId] = [...current, groupName];
    }
    saveBookmarkGroupMap(newMap);
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

  const sortedGroups = Object.entries(groupedBookmarksFiltered).sort((a, b) => {
    if (groupBy === 'subject') {
      const order = ['physics', 'chemistry', 'maths', 'mathematics'];
      const aIdx = order.findIndex(s => a[0].toLowerCase().includes(s));
      const bIdx = order.findIndex(s => b[0].toLowerCase().includes(s));
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    }
    if (groupBy === 'custom') {
      if (a[0] === 'Ungrouped') return 1;
      if (b[0] === 'Ungrouped') return -1;
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

  const mcqCount = bookmarks.filter(b => b.question.option1).length;

  const filteredBookmarks = filterGroup
    ? bookmarks.filter(b => (bookmarkGroupMap[b.id] || []).includes(filterGroup))
    : bookmarks;

  const groupedBookmarksFiltered = filteredBookmarks.reduce((acc, bookmark) => {
    if (groupBy === 'custom') {
      const groups = bookmarkGroupMap[bookmark.id] || [];
      if (groups.length === 0) {
        const key = 'Ungrouped';
        if (!acc[key]) acc[key] = [];
        acc[key].push(bookmark);
      } else {
        groups.forEach(g => {
          if (!acc[g]) acc[g] = [];
          acc[g].push(bookmark);
        });
      }
    } else {
      const key = groupBy === 'test' ? bookmark.test.testName : bookmark.question.subject;
      if (!acc[key]) acc[key] = [];
      acc[key].push(bookmark);
    }
    return acc;
  }, {} as Record<string, BookmarkedQuestion[]>);

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
                onClick={() => { setGroupBy('test'); setFilterGroup(null); }}
              >
                <FileText size={14} />
                Test
              </button>
              <button 
                className={`toggle-btn ${groupBy === 'subject' ? 'active' : ''}`}
                onClick={() => { setGroupBy('subject'); setFilterGroup(null); }}
              >
                <BarChart3 size={14} />
                Subject
              </button>
              <button 
                className={`toggle-btn ${groupBy === 'custom' ? 'active' : ''}`}
                onClick={() => setGroupBy('custom')}
              >
                <Tag size={14} />
                Custom
              </button>

              <div className="toggle-separator" />

              {customGroups.length > 0 && (
                <>
                  <span className="toggle-label">Filter:</span>
                  <button
                    className={`toggle-btn filter-btn ${filterGroup === null ? 'active' : ''}`}
                    onClick={() => setFilterGroup(null)}
                  >
                    All
                  </button>
                  {customGroups.map(g => (
                    <button
                      key={g}
                      className={`toggle-btn filter-btn ${filterGroup === g ? 'active' : ''}`}
                      onClick={() => setFilterGroup(filterGroup === g ? null : g)}
                    >
                      {g}
                      <span
                        className="group-delete-x"
                        onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g); }}
                        title={`Delete group "${g}"`}
                      >
                        <X size={10} />
                      </span>
                    </button>
                  ))}
                </>
              )}

              {showCreateGroup ? (
                <form
                  className="inline-create-group"
                  onSubmit={(e) => { e.preventDefault(); handleCreateGroup(); }}
                >
                  <input
                    className="create-group-input"
                    type="text"
                    placeholder="Group name"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    autoFocus
                    maxLength={24}
                  />
                  <button type="submit" className="toggle-btn active" disabled={!newGroupName.trim()}>
                    Add
                  </button>
                  <button type="button" className="toggle-btn" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); }}>
                    <X size={14} />
                  </button>
                </form>
              ) : (
                <button className="toggle-btn create-group-btn" onClick={() => setShowCreateGroup(true)}>
                  <Plus size={14} />
                  New Group
                </button>
              )}
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
            ) : filteredBookmarks.length === 0 ? (
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
                            <div className="bookmark-tag-btn-wrapper" style={{ position: 'relative' }}>
                              <button
                                className="bookmark-tag-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssigningBookmark(assigningBookmark === bookmark.id ? null : bookmark.id);
                                }}
                                title="Assign to group"
                              >
                                <Tag size={12} />
                              </button>
                              {assigningBookmark === bookmark.id && customGroups.length > 0 && (
                                <div className="bookmark-group-dropdown" onClick={(e) => e.stopPropagation()}>
                                  {customGroups.map(g => (
                                    <label key={g} className="bookmark-group-option">
                                      <input
                                        type="checkbox"
                                        checked={(bookmarkGroupMap[bookmark.id] || []).includes(g)}
                                        onChange={() => handleToggleBookmarkGroup(bookmark.id, g)}
                                      />
                                      {g}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
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
  attachmentName?: string | null;
  attachmentData?: string | null;
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

/** Parse @[Name](id) patterns and render as blue-styled spans */
function renderContentWithMentions(text: string): React.ReactNode[] {
  const regex = /@\[([^\]]+)\]\([^)]+\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="mention-tag">@{match[1]}</span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/** Strip @[Name](id) markup to plain @Name for preview */
function stripMentionMarkup(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');
}

/** Textarea that auto-suggests @mentions as you type */
function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows,
  className,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const data = await apiRequest(`/z7i?action=forum-search-users&q=${encodeURIComponent(query)}`) as any;
      if (data.users) {
        setSuggestions(data.users);
        setShowSuggestions(data.users.length > 0);
        setSelectedIndex(0);
      }
    } catch {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    onChange(newVal);

    const cursorPos = e.target.selectionStart;
    // Find the @ that triggered this
    const textBefore = newVal.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex >= 0) {
      // Make sure @ is at start or after whitespace
      const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || atIndex === 0) {
        const query = textBefore.slice(atIndex + 1);
        // Only if it doesn't contain spaces (single-word partial match) or a closing bracket (already completed)
        if (!query.includes('[') && query.length <= 30) {
          setMentionStart(atIndex);
          setMentionQuery(query);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => searchUsers(query), 200);
          return;
        }
      }
    }
    setShowSuggestions(false);
  };

  const insertMention = (user: { id: string; name: string }) => {
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + 1 + mentionQuery.length);
    const mention = `@[${user.name}](${user.id}) `;
    const newVal = before + mention + after;
    onChange(newVal);
    setShowSuggestions(false);
    setSuggestions([]);
    // Focus back and set cursor after the inserted mention
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + mention.length;
        textareaRef.current.focus();
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="mention-textarea-wrapper">
      <textarea
        ref={textareaRef}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        autoFocus={autoFocus}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="mention-suggestions" ref={suggestionsRef}>
          {suggestions.map((user, i) => (
            <button
              key={user.id}
              className={`mention-suggestion-item ${i === selectedIndex ? 'selected' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(user);
              }}
            >
              <User size={14} />
              <span>{user.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentData, setAttachmentData] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState('');

  const MAX_ATTACHMENT_BASE64_BYTES = 8_000_000;
  const MAX_ATTACHMENT_FILE_BYTES = Math.floor((MAX_ATTACHMENT_BASE64_BYTES * 3) / 4);

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setAttachmentName(null);
      setAttachmentData(null);
      setAttachmentError('');
      return;
    }

    if (file.type !== 'application/pdf') {
      setAttachmentError('Only PDF files are supported.');
      setAttachmentName(null);
      setAttachmentData(null);
      event.target.value = '';
      return;
    }

    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      setAttachmentError('PDF must be 6 MB or smaller.');
      setAttachmentName(null);
      setAttachmentData(null);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      if (!base64) {
        setAttachmentError('Failed to read PDF file.');
        return;
      }
      if (base64.length > MAX_ATTACHMENT_BASE64_BYTES) {
        setAttachmentError('PDF is too large after encoding. Please use a smaller file.');
        setAttachmentName(null);
        setAttachmentData(null);
        event.target.value = '';
        return;
      }
      setAttachmentError('');
      setAttachmentName(file.name);
      setAttachmentData(base64);
    };
    reader.onerror = () => {
      setAttachmentError('Failed to read PDF file.');
      setAttachmentName(null);
      setAttachmentData(null);
    };
    reader.readAsDataURL(file);
  };

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
          questionId: selectedQuestion || null,
          attachmentName: attachmentName || null,
          attachmentData: attachmentData || null
        })
      });
      if (data.success) {
        onCreated(data.postId);
      }
    } catch (e) {
      if (e instanceof Error && (e as Error & { status?: number }).status === 413) {
        setAttachmentError('Upload rejected (413 Payload Too Large). Keep PDF under 3 MB.');
      }
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
            <MentionTextarea
              className="form-textarea"
              placeholder="Provide more details... Use @ to mention users"
              value={content}
              onChange={setContent}
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

          <div className="form-group">
            <label className="form-label">Attach PDF (optional)</label>
            <input type="file" className="form-input" accept="application/pdf" onChange={handleAttachmentChange} />
            {attachmentName && <span className="form-hint">Attached: {attachmentName}</span>}
            {attachmentError && <span className="form-hint" style={{ color: 'var(--error)' }}>{attachmentError}</span>}
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

const ForumPostCard = memo(function ForumPostCard({ 
  post, 
  onSelect,
  onLike,
  hasMention
}: { 
  post: ForumPost; 
  onSelect: (postId: string) => void;
  onLike: (postId: string) => void;
  hasMention?: boolean;
}) {
  const plainContent = stripMentionMarkup(post.content);
  return (
    <div
      className={`forum-card ${post.isPinned ? 'pinned' : ''} ${post.isResolved ? 'resolved' : ''} ${hasMention ? 'mentioned' : ''}`}
      onClick={() => onSelect(post.id)}
    >
      <div className="forum-card-votes">
        <button 
          className={`vote-btn ${post.isLiked ? 'liked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onLike(post.id);
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
          {plainContent.length > 150 ? plainContent.substring(0, 150) + '...' : plainContent}
        </p>

        {post.attachmentName && (
          <div className="forum-card-attachment">
            <FileText size={12} />
            <span>{post.attachmentName}</span>
          </div>
        )}
        
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
});

function ForumPostDetail({ 
  postId, 
  onBack,
  canModeratePosts,
  forumMediaUrl,
  forumMediaPositionX,
  forumMediaPositionY
}: { 
  postId: string; 
  onBack: () => void;
  canModeratePosts: boolean;
  forumMediaUrl?: string | null;
  forumMediaPositionX?: number | null;
  forumMediaPositionY?: number | null;
}) {
  const [post, setPost] = useState<ForumPostDetailed | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const attachmentObjectUrl = useMemo(() => {
    if (!post?.attachmentData) return null;
    try {
      const bytes = decodeBase64ToBytes(post.attachmentData);
      return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    } catch (error) {
      console.error('Failed to build PDF preview URL', error);
      return null;
    }
  }, [post?.attachmentData]);

  useEffect(() => {
    return () => {
      if (attachmentObjectUrl) {
        URL.revokeObjectURL(attachmentObjectUrl);
      }
    };
  }, [attachmentObjectUrl]);

  useEffect(() => {
    loadPost();
  }, [postId]);

  useEffect(() => {
    if (!post) return;
    setEditTitle(post.title);
    setEditContent(post.content);
  }, [post]);

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

  const handleSaveEdit = async () => {
    if (!post) return;
    const nextTitle = editTitle.trim();
    const nextContent = editContent.trim();
    if (!nextTitle || !nextContent) return;
    setSavingEdit(true);
    try {
      const data = await apiRequest('/z7i?action=forum-edit-post', {
        method: 'POST',
        body: JSON.stringify({ postId: post.id, title: nextTitle, content: nextContent })
      });
      if (data.success && data.post) {
        setPost(prev => prev ? { ...prev, ...data.post } : prev);
        setIsEditingPost(false);
      }
    } catch (e) {
      console.error('Failed to edit post', e);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    if (!post) return;
    setEditTitle(post.title);
    setEditContent(post.content);
    setIsEditingPost(false);
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
      <div className="page forum-page">
        <PageMediaLayer
          url={forumMediaUrl}
          positionX={forumMediaPositionX}
          positionY={forumMediaPositionY}
          overlayVar="--forum-bg-overlay"
        />
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
      <div className="page forum-page">
        <PageMediaLayer
          url={forumMediaUrl}
          positionX={forumMediaPositionX}
          positionY={forumMediaPositionY}
          overlayVar="--forum-bg-overlay"
        />
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

  const canModeratePost = post.isOwner || canModeratePosts;

  return (
    <div className="page forum-page">
      <PageMediaLayer
        url={forumMediaUrl}
        positionX={forumMediaPositionX}
        positionY={forumMediaPositionY}
        overlayVar="--forum-bg-overlay"
      />
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
            {isEditingPost ? (
              <div className="forum-edit-form">
                <label className="form-label">Title</label>
                <input
                  className="form-input"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  maxLength={200}
                />
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={6}
                />
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveEdit}
                    disabled={!editTitle.trim() || !editContent.trim() || savingEdit}
                  >
                    {savingEdit ? <span className="spinner-small" /> : 'Save changes'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="forum-content-text">{renderContentWithMentions(post.content)}</p>
                {post.attachmentName && post.attachmentData && (
                  <div className="forum-pdf-preview">
                    <div className="forum-pdf-preview-header">
                      <FileText size={16} />
                      <span>{post.attachmentName}</span>
                      {attachmentObjectUrl && (
                        <a
                          className="btn btn-secondary btn-small"
                          href={attachmentObjectUrl}
                          download={post.attachmentName}
                        >
                          <Download size={14} /> Download PDF
                        </a>
                      )}
                    </div>
                    {attachmentObjectUrl ? (
                      <PdfViewer
                        src={attachmentObjectUrl}
                        fileName={post.attachmentName}
                        maxHeight={600}
                      />
                    ) : (
                      <div className="forum-pdf-fallback">
                        Preview unavailable. Please download the file to view it.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
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
              </>
            )}
            {canModeratePost && (
              <>
                <button
                  className="action-btn"
                  onClick={() => setIsEditingPost(true)}
                  disabled={isEditingPost}
                >
                  <Edit3 size={16} />
                  <span>{isEditingPost ? 'Editing' : 'Edit'}</span>
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
                    <p className="reply-content">{renderContentWithMentions(reply.content)}</p>
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
              <MentionTextarea
                className="reply-input"
                placeholder="Write your reply... Use @ to mention users"
                value={replyContent}
                onChange={setReplyContent}
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
  avatarUrl?: string | null;
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

function AiChatbotsPage({ onBack, user }: { onBack: () => void; user: UserType }) {
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
      id: 'hf:black-forest-labs/FLUX.1-schnell',
      label: 'FLUX.1 Schnell (Hugging Face)',
      description: 'Fast high-quality image generation with FLUX.1-schnell.',
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
  const [customPersonalityAvatarUrl, setCustomPersonalityAvatarUrl] = useState('');
  const [editingPersonalityId, setEditingPersonalityId] = useState<string | null>(null);
  const [editPersonalityName, setEditPersonalityName] = useState('');
  const [editPersonalityDescription, setEditPersonalityDescription] = useState('');
  const [editPersonalityHint, setEditPersonalityHint] = useState('');
  const [editPersonalityAvatarUrl, setEditPersonalityAvatarUrl] = useState('');
  const [isUpdatingPersonality, setIsUpdatingPersonality] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingPersonalities, setIsLoadingPersonalities] = useState(true);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCreatingPersonality, setIsCreatingPersonality] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'new' | 'personas'>('chats');

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
          avatarUrl: typeof config.avatarUrl === 'string' ? config.avatarUrl : null,
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
          avatarUrl: customPersonalityAvatarUrl.trim() || null,
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
        avatarUrl: response.config.avatarUrl ?? null,
        isCustom: true,
        isGated: Boolean(response.config.isGated),
      };

      setPersonalities(prev => [newPersonality, ...prev]);
      setNewChatPersonality(newPersonality.id);
      setCustomPersonalityName('');
      setCustomPersonalityDescription('');
      setCustomPersonalityHint('');
      setCustomPersonalityAvatarUrl('');
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
    setEditPersonalityAvatarUrl(personality.avatarUrl || '');
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
          avatarUrl: editPersonalityAvatarUrl.trim() || null,
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
                avatarUrl: editPersonalityAvatarUrl.trim() || null,
              }
            : personality
        )
      );
      setEditingPersonalityId(null);
      setEditPersonalityName('');
      setEditPersonalityDescription('');
      setEditPersonalityHint('');
      setEditPersonalityAvatarUrl('');
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
    setEditPersonalityAvatarUrl('');
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });

  const handlePersonalityAvatarUpload = async (file: File | null, mode: 'create' | 'edit') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!dataUrl) return;
      if (mode === 'create') setCustomPersonalityAvatarUrl(dataUrl);
      else setEditPersonalityAvatarUrl(dataUrl);
    } catch (error) {
      console.error('Failed to read personality avatar', error);
    }
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
      <PageMediaLayer
        url={user.themeAiChatsBgGifUrl}
        positionX={user.themeAiChatsBgPositionX}
        positionY={user.themeAiChatsBgPositionY}
        overlayVar="--ai-chats-bg-overlay"
      />
      <div className="ac-shell">
        <div className="ac-topbar">
          <button className="ac-back" onClick={onBack}>
            <ChevronLeft size={15} />
            <span>Back</span>
          </button>
          <div className="ac-topbar-title">AI Chat</div>
          <button
            type="button"
            className="ac-sidebar-toggle"
            onClick={() => setIsSidebarCollapsed(prev => !prev)}
            aria-label={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <Menu size={16} />
          </button>
        </div>

        <div className={`ac-body ${isSidebarCollapsed ? 'ac-body--collapsed' : ''}`}>
          {/* ── Sidebar ── */}
          <aside className={`ac-sidebar ${isSidebarCollapsed ? 'ac-sidebar--hidden' : ''}`}>
            <nav className="ac-tabs">
              {(['chats', 'new', 'personas'] as const).map(tab => (
                <button
                  key={tab}
                  className={`ac-tab ${sidebarTab === tab ? 'ac-tab--active' : ''}`}
                  onClick={() => setSidebarTab(tab)}
                >
                  {tab === 'chats' && <><MessageCircle size={14} /><span>Chats</span></>}
                  {tab === 'new' && <><Plus size={14} /><span>New</span></>}
                  {tab === 'personas' && <><Sparkles size={14} /><span>Personas</span></>}
                </button>
              ))}
            </nav>

            <div className="ac-sidebar-scroll">
              {/* ── Tab: Chats ── */}
              {sidebarTab === 'chats' && (
                <div className="ac-tab-pane ac-anim-fade">
                  {isLoadingSessions ? (
                    <div className="ac-placeholder"><span className="spinner" /> Loading…</div>
                  ) : sessions.length === 0 ? (
                    <div className="ac-placeholder">No chats yet — create one!</div>
                  ) : (
                    <div className="ac-session-list">
                      {sessions.map(session => {
                        const sp = availablePersonalities.find(i => i.id === session.personalityId);
                        const sm = chatModels.find(i => i.id === session.modelId);
                        return (
                          <div key={session.id} className={`ac-session ${session.id === activeSession?.id ? 'ac-session--active' : ''}`}>
                            <button
                              className="ac-session-btn"
                              onClick={() => setActiveSessionId(session.id)}
                              title={session.title}
                            >
                              <span className="ac-session-name">{session.title}</span>
                              <span className="ac-session-sub">{sp?.label ?? 'Tutor'} · {sm?.label ?? 'Model'}</span>
                            </button>
                            <button
                              type="button"
                              className="ac-session-del"
                              onClick={e => { e.stopPropagation(); handleDeleteSession(session.id); }}
                              aria-label={`Delete ${session.title}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: New Chat ── */}
              {sidebarTab === 'new' && (
                <div className="ac-tab-pane ac-anim-fade">
                  <div className="ac-form-group">
                    <label className="ac-label">Title</label>
                    <input className="ac-input" value={newChatTitle} onChange={e => setNewChatTitle(e.target.value)} placeholder="New Chat" />
                  </div>
                  <div className="ac-form-group">
                    <label className="ac-label">Model</label>
                    <select className="ac-input" value={newChatModel} onChange={e => setNewChatModel(e.target.value)}>
                      {chatModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div className="ac-form-group">
                    <label className="ac-label">Personality</label>
                    <select className="ac-input" value={newChatPersonality} onChange={e => setNewChatPersonality(e.target.value)}>
                      {availablePersonalities.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </div>
                  <button className="ac-btn ac-btn--primary" onClick={handleAddSession} disabled={isCreatingSession || isLoadingPersonalities}>
                    <MessageCircle size={14} />
                    {isCreatingSession ? 'Creating…' : 'Create Chat'}
                  </button>
                </div>
              )}

              {/* ── Tab: Personas ── */}
              {sidebarTab === 'personas' && (
                <div className="ac-tab-pane ac-anim-fade">
                  <div className="ac-section-label">Your personalities</div>
                  <div className="ac-persona-list">
                    {availablePersonalities.map(p => (
                      <div key={p.id} className="ac-persona">
                        <div className="ac-persona-info">
                          <span className="ac-persona-name">
                            {p.avatarUrl ? <img className="ac-persona-avatar" src={p.avatarUrl} alt="" /> : <span className="ac-persona-avatar ac-persona-avatar--fallback">{p.label.charAt(0)}</span>}
                            {p.label}
                          </span>
                          <span className="ac-persona-desc">{p.description}</span>
                        </div>
                        {p.isCustom && (
                          <button type="button" className="ac-persona-edit" onClick={() => startEditPersonality(p)} aria-label={`Edit ${p.label}`}>
                            <Edit3 size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {editingPersonalityId && (
                    <div className="ac-persona-editor ac-anim-fade">
                      <div className="ac-form-group"><label className="ac-label">Name</label><input className="ac-input" value={editPersonalityName} onChange={e => setEditPersonalityName(e.target.value)} /></div>
                      <div className="ac-form-group"><label className="ac-label">Description</label><input className="ac-input" value={editPersonalityDescription} onChange={e => setEditPersonalityDescription(e.target.value)} /></div>
                      <div className="ac-form-group"><label className="ac-label">Hint</label><input className="ac-input" value={editPersonalityHint} onChange={e => setEditPersonalityHint(e.target.value)} /></div>
                      <div className="ac-form-group"><label className="ac-label">Avatar URL / upload</label><input className="ac-input" value={editPersonalityAvatarUrl} onChange={e => setEditPersonalityAvatarUrl(e.target.value)} placeholder="https://... or upload below" /><input className="ac-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={e => { handlePersonalityAvatarUpload(e.target.files?.[0] ?? null, 'edit'); e.currentTarget.value = ''; }} /></div>
                      <div className="ac-persona-btns">
                        <button className="ac-btn ac-btn--ghost" onClick={cancelEditPersonality} disabled={isUpdatingPersonality}>Cancel</button>
                        <button className="ac-btn ac-btn--primary" onClick={handleUpdatePersonality} disabled={isUpdatingPersonality}>{isUpdatingPersonality ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  )}
                  <div className="ac-divider" />
                  <div className="ac-section-label">Create new</div>
                  <div className="ac-form-group"><label className="ac-label">Name</label><input className="ac-input" value={customPersonalityName} onChange={e => setCustomPersonalityName(e.target.value)} placeholder="e.g. Physics Mentor" /></div>
                  <div className="ac-form-group"><label className="ac-label">Description</label><input className="ac-input" value={customPersonalityDescription} onChange={e => setCustomPersonalityDescription(e.target.value)} placeholder="How should this persona help?" /></div>
                  <div className="ac-form-group"><label className="ac-label">Hint</label><input className="ac-input" value={customPersonalityHint} onChange={e => setCustomPersonalityHint(e.target.value)} placeholder="Initial instruction for the AI" /></div>
                  <div className="ac-form-group"><label className="ac-label">Avatar URL / upload</label><input className="ac-input" value={customPersonalityAvatarUrl} onChange={e => setCustomPersonalityAvatarUrl(e.target.value)} placeholder="https://... or upload below" /><input className="ac-input" type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" onChange={e => { handlePersonalityAvatarUpload(e.target.files?.[0] ?? null, 'create'); e.currentTarget.value = ''; }} /></div>
                  <button className="ac-btn ac-btn--secondary" onClick={handleAddCustomPersonality} disabled={isCreatingPersonality}>
                    <Sparkles size={14} />
                    {isCreatingPersonality ? 'Saving…' : 'Add Persona'}
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* ── Main Chat ── */}
          <main className="ac-main">
            {isLoadingSessions ? (
              <div className="ac-empty"><span className="spinner" /> Loading chats…</div>
            ) : activeSession ? (
              <div className="ac-chat ac-anim-fade">
                {/* Header */}
                <div className="ac-chat-head">
                  <div className="ac-chat-head-left">
                    <h2 className="ac-chat-title">{activeSession.title}</h2>
                    <span className="ac-chat-subtitle">{activePersonality?.description ?? 'Ready to help.'}</span>
                  </div>
                  <div className="ac-chat-head-right">
                    <div className="ac-meta-pills">
                      <span className="ac-pill">{activeModel?.label ?? 'Gemini'}</span>
                      <span className="ac-pill">{activeMessageCount} msgs</span>
                      <span className="ac-pill">~{activeTokenEstimate} tok</span>
                    </div>
                    <select
                      className="ac-model-select"
                      value={activeSession.modelId}
                      onChange={e => handleModelChange(e.target.value)}
                    >
                      {chatModels.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Messages */}
                <div className="ac-messages" ref={chatMessagesRef}>
                  {activeSession.messages.map((message, idx) => (
                    <div key={message.id} className={`ac-msg ac-msg--${message.role}`} style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}>
                      {message.role === 'assistant' && (
                        <div className="ac-msg-avatar">
                          {activePersonality?.avatarUrl ? <img src={activePersonality.avatarUrl} alt="" /> : <Sparkles size={14} />}
                        </div>
                      )}
                      <div className="ac-msg-bubble">
                        {message.role === 'assistant' ? (
                          <div className="ac-msg-body" dangerouslySetInnerHTML={{ __html: formatChatContent(message.content) }} />
                        ) : (
                          <div className="ac-msg-body">{message.content}</div>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="ac-msg-attachments">
                            {message.attachments.map(a => (
                              <img key={a.id} src={a.url || a.dataUrl} alt={a.name} className="ac-msg-img" />
                            ))}
                          </div>
                        )}
                        <time className="ac-msg-time">{format(new Date(message.timestamp), 'p')}</time>
                      </div>
                    </div>
                  ))}
                  {isSendingMessage && (
                    <div className="ac-msg ac-msg--assistant">
                      <div className="ac-msg-avatar">
                        {activePersonality?.avatarUrl ? <img src={activePersonality.avatarUrl} alt="" /> : <Sparkles size={14} />}
                      </div>
                      <div className="ac-msg-bubble ac-typing">
                        <span /><span /><span />
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="ac-input-area">
                  {pendingAttachments.length > 0 && (
                    <div className="ac-attach-row ac-anim-fade">
                      {pendingAttachments.map(a => (
                        <div key={a.id} className="ac-attach-chip">
                          <img src={a.url} alt={a.name} />
                          <span>{a.name}</span>
                          <button type="button" onClick={() => removePendingAttachment(a.id)} aria-label={`Remove ${a.name}`}><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ac-compose">
                    <label className="ac-compose-attach">
                      <Plus size={16} />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                        multiple
                        onChange={e => { handleAttachmentSelect(e.target.files); e.currentTarget.value = ''; }}
                      />
                    </label>
                    <textarea
                      className="ac-compose-field"
                      placeholder="Ask about JEE concepts, strategy, or practice…"
                      value={messageDraft}
                      rows={1}
                      onChange={e => setMessageDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (!isSendingMessage) handleSendMessage();
                        }
                      }}
                    />
                    <button
                      className="ac-compose-send"
                      onClick={handleSendMessage}
                      disabled={(!messageDraft.trim() && pendingAttachments.length === 0) || isSendingMessage}
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="ac-empty ac-anim-fade">
                <MessageCircle size={40} strokeWidth={1.2} />
                <div className="ac-empty-heading">No chats yet</div>
                <div className="ac-empty-sub">Create your first AI chat to start practicing.</div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function ForumView({
  onBack,
  isOwnerUser,
  forumMediaUrl,
  forumMediaPositionX,
  forumMediaPositionY,
  onMentionCountChange
}: {
  onBack: () => void;
  isOwnerUser: boolean;
  forumMediaUrl?: string | null;
  forumMediaPositionX?: number | null;
  forumMediaPositionY?: number | null;
  onMentionCountChange?: (delta: number) => void;
}) {
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mine' | 'resolved' | 'unresolved' | 'with-question'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [mentionedPostIds, setMentionedPostIds] = useState<Set<string>>(new Set());

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
        if (data.mentionedPostIds) {
          setMentionedPostIds(new Set(data.mentionedPostIds));
        }
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

  const handleLikePost = useCallback(async (postId: string) => {
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
  }, []);

  const handlePostSelect = useCallback(async (postId: string) => {
    if (mentionedPostIds.has(postId)) {
      // Mark as read — fire and forget
      apiRequest('/z7i?action=forum-mark-mention-read', {
        method: 'POST',
        body: JSON.stringify({ postId })
      }).catch(() => {});
      setMentionedPostIds(prev => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
      onMentionCountChange?.(-1);
    }
    setSelectedPostId(postId);
  }, [mentionedPostIds, onMentionCountChange]);

  const handlePostCreated = (postId: string) => {
    setShowCreateModal(false);
    setSelectedPostId(postId);
  };

  if (selectedPostId) {
    return (
      <ForumPostDetail 
        postId={selectedPostId} 
        canModeratePosts={isOwnerUser}
        forumMediaUrl={forumMediaUrl}
        forumMediaPositionX={forumMediaPositionX}
        forumMediaPositionY={forumMediaPositionY}
        onBack={() => {
          setSelectedPostId(null);
          loadPosts();
        }} 
      />
    );
  }

  return (
    <div className="page forum-page">
      <PageMediaLayer
        url={forumMediaUrl}
        positionX={forumMediaPositionX}
        positionY={forumMediaPositionY}
        overlayVar="--forum-bg-overlay"
      />
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
                  onSelect={handlePostSelect}
                  onLike={handleLikePost}
                  hasMention={mentionedPostIds.has(post.id)}
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
  onOpenExamView,
  onOpenLeaderboardPerspective,
  perspectiveLoadingUserId,
}: { 
  attempt: AttemptDetails; 
  questions: Question[];
  subjects: Array<{ name: string; total: number; score: number }>;
  testZ7iId: string | null;
  userId: string;
  attemptId: string;
  isAdmin: boolean;
  onOpenExamView: () => void;
  onOpenLeaderboardPerspective: (entry: LeaderboardEntry) => void;
  perspectiveLoadingUserId: string | null;
}) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [includeReattempts, setIncludeReattempts] = useState(false);
  const [selectedLeaderboardUserId, setSelectedLeaderboardUserId] = useState<string | null>(null);
  const [currentUserEnrollment, setCurrentUserEnrollment] = useState<string | null>(null);
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
        setCurrentUserEnrollment(data.currentUserEnrollment || null);
      }
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  const subjectData = useMemo(() => subjects.map(s => {
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
  }), [subjects, questions]);

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
                    isAnimationActive={false}
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
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  />
                  <YAxis hide />
                  <Tooltip 
                    contentStyle={{ 
                      background: 'var(--card)', 
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '11px'
                    }}
                  />
                  <Bar dataKey="You" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Bar dataKey="Topper" fill="var(--success)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
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
            </div>
            <div className="leaderboard-tab-toggle">
              <button
                className={`leaderboard-tab ${!includeReattempts ? 'active' : ''}`}
                onClick={() => setIncludeReattempts(false)}
                type="button"
              >
                All Attempts
              </button>
              <button
                className={`leaderboard-tab ${includeReattempts ? 'active' : ''}`}
                onClick={() => setIncludeReattempts(true)}
                type="button"
              >
                Reattempts Only
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
                  const isYou = currentUserEnrollment ? entry.enrollmentNo === currentUserEnrollment : entry.userId === userId;
                  return (
                    <div key={`${entry.enrollmentNo || entry.z7iAccountId || entry.userId}-${idx}`}>
                      <div
                        className={`lb-row ${isYou ? 'is-you' : ''} ${idx < 3 ? `top-${idx + 1}` : ''} ${selectedLeaderboardUserId === (entry.enrollmentNo || entry.userId) ? 'active' : ''}`}
                        onClick={() => setSelectedLeaderboardUserId(prev => prev === (entry.enrollmentNo || entry.userId) ? null : (entry.enrollmentNo || entry.userId))}
                      >
                        <span className="lb-pos">
                          {idx === 0 && <Trophy size={11} className="trophy-gold" />}
                          {idx === 1 && <Medal size={11} className="medal-silver" />}
                          {idx === 2 && <Medal size={11} className="medal-bronze" />}
                          {idx > 2 && <span>#{displayRank}</span>}
                        </span>
                        <span className="lb-name-compact">
                          <span className="lb-avatar" aria-hidden>
                            {entry.profileImageUrl ? (
                              <img src={entry.profileImageUrl} alt="" loading="lazy" />
                            ) : (
                              <User size={11} />
                            )}
                          </span>
                          <span className="lb-name-wrapper">
                            <span className="lb-primary-name">
                              {entry.userName}
                              {isYou && <span className="you-tag">You</span>}
                            </span>
                            {entry.aliasNames && entry.aliasNames.length > 0 && (
                              <span className="lb-alias-names">a.k.a. {entry.aliasNames.join(', ')}</span>
                            )}
                          </span>
                        </span>
                        <span className="lb-score-compact">
                          {typeof entry.originalAttemptScore === 'number' && entry.adjustedScore > entry.originalAttemptScore
                            ? <span className="lb-score-structured"><span className="lb-score-original">(Original: {entry.originalAttemptScore.toFixed(0)})</span> <strong>{entry.adjustedScore.toFixed(0)}</strong></span>
                            : (entry.scoreLabel || entry.adjustedScore.toFixed(0))}
                        </span>
                      </div>
                      {selectedLeaderboardUserId === (entry.enrollmentNo || entry.userId) && (
                        <div className="lb-user-card">
                          <div className="lb-user-card-row">
                            <span>Attended</span>
                            <strong>{entry.attendedCount}/{entry.correct + entry.incorrect + entry.unattempted}</strong>
                          </div>
                          <div className="lb-user-card-row">
                            <span>C / I / U</span>
                            <strong>{entry.correct} / {entry.incorrect} / {entry.unattempted}</strong>
                          </div>
                          <div className="lb-user-subjects">
                            {(entry.subjectStats || []).map((subject) => (
                              <div key={`${entry.userId}-${subject.name}`} className="lb-user-subject-row">
                                <span>{subject.name}</span>
                                <strong>{subject.marks.toFixed(0)}</strong>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary lb-view-perspective-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenLeaderboardPerspective(entry);
                            }}
                            disabled={perspectiveLoadingUserId === entry.userId}
                          >
                            <Eye size={14} />
                            {perspectiveLoadingUserId === entry.userId ? 'Opening…' : `View as ${entry.userName.split(' ')[0] || 'user'}`}
                          </button>
                        </div>
                      )}
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
  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => {
    const aIdx = subjectOrder.findIndex(s => a.name?.toUpperCase().includes(s));
    const bIdx = subjectOrder.findIndex(s => b.name?.toUpperCase().includes(s));
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  }), [subjects]);
  
  const questionIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    questions.forEach((q, i) => map.set(q.id, i));
    return map;
  }, [questions]);
  const getOriginalIndex = (q: Question) => questionIndexMap.get(q.id) ?? -1;

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

  const filterCounts = useMemo(() => ({
    all: questions.length,
    correct: questions.filter(q => q.status === 'correct').length,
    incorrect: questions.filter(q => q.status === 'incorrect').length,
    unattempted: questions.filter(q => isUnattemptedStatus(q.status)).length,
    bookmarked: questions.filter(q => q.isBookmarked).length,
    bonus: questions.filter(q => q.isBonus).length,
    'key-changed': questions.filter(q => q.hasKeyChange).length,
  }), [questions]);

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
          <span className="stat-value">{formatTimeWithDecimal(question.timeTaken)}</span>
        </div>
        <div className="stat-item">
          <Clock size={12} />
          <span className="stat-label">Avg</span>
          <span className="stat-value">
            {formatTimeWithDecimal(question.userStats?.avgTime ?? null)}
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
          <div className="solution-body ai-solution-body invert-images clickable-images" dangerouslySetInnerHTML={{ __html: renderRichTextWithLatex(question.aiSolution) }} />
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
        shouldInvert={lightboxState.shouldInvert}
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

  useEffect(() => {
    document.body.classList.add('immersive-view');
    return () => {
      document.body.classList.remove('immersive-view');
    };
  }, []);
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

  const displayOrderedQuestions = useMemo(() => {
    const subjectOrder = (subj: string) => {
      const s = (subj || '').toUpperCase();
      if (s.includes('PHYSICS')) return 0;
      if (s.includes('CHEMISTRY')) return 1;
      if (s.includes('MATH')) return 2;
      return 3;
    };
    return [...questions].sort((a, b) => {
      const subjectDiff = subjectOrder(a.subject) - subjectOrder(b.subject);
      if (subjectDiff !== 0) return subjectDiff;
      return a.order - b.order;
    });
  }, [questions]);

  const displayIndex = useMemo(() => {
    if (!currentQuestion) return 0;
    const idx = displayOrderedQuestions.findIndex(q => q.id === currentQuestion.id);
    return idx >= 0 ? idx : currentIndex;
  }, [currentQuestion, currentIndex, displayOrderedQuestions]);

  const goToPrev = () => {
    const prevIndex = Math.max(0, displayIndex - 1);
    const prevQuestion = displayOrderedQuestions[prevIndex];
    if (!prevQuestion) return;
    const nextCurrentIndex = questions.findIndex(q => q.id === prevQuestion.id);
    if (nextCurrentIndex >= 0) setCurrentIndex(nextCurrentIndex);
  };

  const goToNext = () => {
    const nextIndex = Math.min(displayOrderedQuestions.length - 1, displayIndex + 1);
    const nextQuestion = displayOrderedQuestions[nextIndex];
    if (!nextQuestion) return;
    const nextCurrentIndex = questions.findIndex(q => q.id === nextQuestion.id);
    if (nextCurrentIndex >= 0) setCurrentIndex(nextCurrentIndex);
  };

  const sortedQuestionsForAI = useMemo(() => [...questions].sort((a, b) => {
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
  }), [questions]);

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
            let displayNum = currentIndex + 1;
            if (subjectUpper.includes('PHYSICS') || subjectUpper.includes('CHEMISTRY') || subjectUpper.includes('MATHS') || subjectUpper.includes('MATHEMATICS')) {
              const subjectQuestions = questions.filter(q => q.subject === currentQuestion.subject);
              const idxInSubject = subjectQuestions.findIndex(q => q.id === currentQuestion.id);
              displayNum = idxInSubject + 1;
              if (subjectUpper.includes('CHEMISTRY')) displayNum = 26 + idxInSubject;
              else if (subjectUpper.includes('MATHS') || subjectUpper.includes('MATHEMATICS')) displayNum = 51 + idxInSubject;
            }
            
            return <ExamQuestionView question={currentQuestion} displayNumber={displayNum} />;
          })()}
          
          <div className="exam-nav-footer">
            <button 
              className="exam-nav-btn-large prev" 
              onClick={goToPrev}
              disabled={displayIndex === 0}
            >
              <ChevronLeft size={20} />
              <span>Previous</span>
            </button>
            <div className="exam-nav-position">
              <span className="current">{displayIndex + 1}</span>
              <span className="separator">/</span>
              <span className="total">{displayOrderedQuestions.length}</span>
            </div>
            <button 
              className="exam-nav-btn-large next" 
              onClick={goToNext}
              disabled={displayIndex === displayOrderedQuestions.length - 1}
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
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Correct</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)' }}>
                  {selectedRevision.correct}
                </p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Incorrect</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--error)' }}>
                  {selectedRevision.incorrect}
                </p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Unattempted</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--unattempted)' }}>
                  {selectedRevision.unattempted}
                </p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Score</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                  {selectedRevision.totalScore}/{selectedRevision.maxScore}
                </p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Improvement</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: selectedRevision.improvement >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {selectedRevision.improvement >= 0 ? '+' : ''}{selectedRevision.improvement}
                </p>
              </div>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Accuracy</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                  {selectedRevision.accuracy}%
                </p>
              </div>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
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
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                      {new Date(revision.createdAt).toLocaleDateString()}
                    </p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                      {revision.totalScore}/{revision.maxScore}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Improvement</p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: revision.improvement >= 0 ? 'var(--success)' : 'var(--error)' }}>
                      {revision.improvement >= 0 ? '+' : ''}{revision.improvement}
                    </p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                  <div>
                    <CheckCircle size={12} style={{ color: 'var(--text-muted)', marginRight: '0.25rem' }} />
                    <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>{revision.correct}</span>
                  </div>
                  <div>
                    <XCircle size={12} style={{ color: 'var(--text-muted)', marginRight: '0.25rem' }} />
                    <span style={{ color: 'var(--error)', fontWeight: 'bold' }}>{revision.incorrect}</span>
                  </div>
                  <div>
                    <MinusCircle size={12} style={{ color: 'var(--text-muted)', marginRight: '0.25rem' }} />
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

function LeagueBoardRow({ entry, showTrophy }: { entry: LeagueLeaderboardEntry; showTrophy: boolean }) {
  const rankDisplay = entry.rank !== null ? `#${entry.rank}` : '—';
  const hasTrophy = showTrophy && entry.rank !== null && entry.rank >= 1 && entry.rank <= 3;
  const isOwnerRow = Boolean(entry.isOwner);
  const rowClass = [
    'league-board-row',
    entry.isYou ? 'is-you' : '',
    isOwnerRow ? 'is-owner' : '',
    entry.rank === 1 ? 'top-1' : '',
    entry.rank === 2 ? 'top-2' : '',
    entry.rank === 3 ? 'top-3' : '',
    entry.rank === 0 ? 'top-0' : '',
  ].filter(Boolean).join(' ');

  const showTrophyIcon = hasTrophy || (isOwnerRow && entry.rank !== null && entry.rank >= 1 && entry.rank <= 3);
  const iconSrc = showTrophyIcon
    ? `/league-icons/trophy-${entry.rank}.png`
    : `/league-icons/${getLeagueIconKey(entry.league)}.png`;
  const iconAlt = showTrophyIcon
    ? `Rank ${entry.rank} trophy`
    : entry.league || 'League';

  return (
    <div className={rowClass}>
      <span className="league-rank">
        <img
          className="league-row-icon"
          src={iconSrc}
          alt={iconAlt}
          loading="lazy"
        />
        {rankDisplay}
      </span>
      <span className="league-name">
        <span className="league-avatar" aria-hidden>
          {entry.profileImageUrl ? (
            <img src={entry.profileImageUrl} alt="" loading="lazy" />
          ) : (
            <User size={12} />
          )}
        </span>
        <span className="league-name-wrapper">
          <span className="league-primary-name">
            {entry.userName}
            {entry.isYou && <span className="you-tag">You</span>}
          </span>
          {entry.aliasNames && entry.aliasNames.length > 0 && (
            <span className="league-alias-names">a.k.a. {entry.aliasNames.join(', ')}</span>
          )}
        </span>
      </span>
      <span className="league-exp">{isOwnerRow ? '—' : `${entry.totalExp} EXP`}</span>
    </div>
  );
}

function LeagueBoardPagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="league-board-pagination">
      <button
        className="league-page-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="league-page-info">
        {page} / {totalPages}
      </span>
      <button
        className="league-page-btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function LeaguePage({ profile, onBack }: { profile: LeagueProfile | null; onBack: () => void }) {
  const [topLeaderboard, setTopLeaderboard] = useState<LeagueLeaderboardEntry[]>([]);
  const [topOwnerEntry, setTopOwnerEntry] = useState<LeagueLeaderboardEntry | null>(null);
  const [topPage, setTopPage] = useState(1);
  const [topTotalPages, setTopTotalPages] = useState(0);
  const [divisionLeaderboard, setDivisionLeaderboard] = useState<LeagueLeaderboardEntry[]>([]);
  const [divisionOwnerEntry, setDivisionOwnerEntry] = useState<LeagueLeaderboardEntry | null>(null);
  const [divisionPage, setDivisionPage] = useState(1);
  const [divisionTotalPages, setDivisionTotalPages] = useState(0);
  const [leagueStats, setLeagueStats] = useState<LeagueStatsEntry[]>([]);
  const [expandedLeague, setExpandedLeague] = useState<string | null>(null);
  const [expandedMembers, setExpandedMembers] = useState<LeagueLeaderboardEntry[]>([]);
  const [expandedPage, setExpandedPage] = useState(1);
  const [expandedTotalPages, setExpandedTotalPages] = useState(0);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadMembers = useCallback(async (league: string, page: number) => {
    setExpandedLoading(true);
    try {
      const data = (await apiRequest(`/league?action=members&league=${encodeURIComponent(league)}&page=${page}`)) as {
        success?: boolean;
        entries?: LeagueLeaderboardEntry[];
        totalPages?: number;
        page?: number;
      } | null;
      setExpandedMembers((data?.entries || []) as LeagueLeaderboardEntry[]);
      setExpandedTotalPages(data?.totalPages ?? 0);
      setExpandedPage(data?.page ?? 1);
    } catch {
      setExpandedMembers([]);
    } finally {
      setExpandedLoading(false);
    }
  }, []);

  const handleToggleLeague = useCallback((league: string) => {
    if (expandedLeague === league) {
      setExpandedLeague(null);
      setExpandedMembers([]);
      return;
    }
    setExpandedLeague(league);
    setExpandedPage(1);
    loadMembers(league, 1);
  }, [expandedLeague, loadMembers]);

  const handleExpandedPageChange = useCallback((newPage: number) => {
    if (!expandedLeague) return;
    loadMembers(expandedLeague, newPage);
  }, [expandedLeague, loadMembers]);

  const loadBoard = useCallback(async (scope: 'top' | 'division', page: number) => {
    const data = (await apiRequest(`/league?action=leaderboard&scope=${scope}&page=${page}`)) as LeagueLeaderboardResponse | null;
    return {
      entries: (data?.entries || []) as LeagueLeaderboardEntry[],
      totalPages: data?.totalPages ?? 0,
      page: data?.page ?? 1,
      ownerEntry: data?.ownerEntry ?? null,
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const loadLeaderboards = async () => {
      setLoading(true);
      setError('');
      try {
        const [topData, divisionData, statsData] = await Promise.all([
          loadBoard('top', 1),
          loadBoard('division', 1),
          apiRequest('/league?action=stats') as Promise<{ success?: boolean; leagues?: LeagueStatsEntry[] } | null>,
        ]);
        setTopLeaderboard(topData.entries);
        setTopTotalPages(topData.totalPages);
        setTopPage(topData.page);
        setTopOwnerEntry(topData.ownerEntry);
        setDivisionLeaderboard(divisionData.entries);
        setDivisionTotalPages(divisionData.totalPages);
        setDivisionPage(divisionData.page);
        setDivisionOwnerEntry(divisionData.ownerEntry);
        setLeagueStats(statsData?.leagues ?? []);
      } catch (err) {
        console.error('Failed to load league leaderboards', err);
        setError('Unable to load league leaderboards.');
      } finally {
        setLoading(false);
      }
    };
    loadLeaderboards();
  }, [profile?.league, profile?.stage, loadBoard]);

  const handleTopPageChange = useCallback(async (newPage: number) => {
    try {
      const data = await loadBoard('top', newPage);
      setTopLeaderboard(data.entries);
      setTopTotalPages(data.totalPages);
      setTopPage(data.page);
    } catch {
      setError('Failed to load page.');
    }
  }, [loadBoard]);

  const handleDivisionPageChange = useCallback(async (newPage: number) => {
    try {
      const data = await loadBoard('division', newPage);
      setDivisionLeaderboard(data.entries);
      setDivisionTotalPages(data.totalPages);
      setDivisionPage(data.page);
    } catch {
      setError('Failed to load page.');
    }
  }, [loadBoard]);

  if (!profile) {
    return (
      <div className="page league-page">
        <div className="container">
          <button className="back-btn" onClick={onBack}>
            <ChevronLeft size={18} /> Back
          </button>
          <div className="empty-state">
            <Trophy size={48} />
            <div className="empty-state-title">League unavailable</div>
            <div className="empty-state-text">Sync your account to start earning EXP.</div>
          </div>
        </div>
      </div>
    );
  }

  const stageProgress = profile.stageExp
    ? Math.max(0, profile.totalExp - profile.stageStart)
    : 0;
  const stageProgressPct = profile.stageExp
    ? Math.min(100, (stageProgress / Math.max(profile.stageExp, 1)) * 100)
    : 100;
  const isUnranked = Boolean(profile.isUnranked);
  const isTop3 = profile.mythicRank != null && profile.mythicRank >= 1 && profile.mythicRank <= 3;

  return (
    <div className="page league-page">
      <div className="container">
        <button className="back-btn" onClick={onBack}>
          <ChevronLeft size={18} /> Back
        </button>

        <div className="league-hero">
          <div className="league-hero-main">
            <div className="league-title">
              <span className="league-icon">
                {isTop3 ? (
                  <img
                    src={`/league-icons/trophy-${profile.mythicRank}.png`}
                    alt={`Rank ${profile.mythicRank} trophy`}
                  />
                ) : (
                  <img
                    src={`/league-icons/${getLeagueIconKey(profile.league)}.png`}
                    alt={profile.league || 'League'}
                  />
                )}
              </span>
              <div>
                <h1>{profile.league}</h1>
                <div className="league-title-meta">
                  <span className="league-tag">{profile.league}{profile.stage ? ` ${profile.stage}` : ''}</span>
                  <span className="league-tag muted">
                    {profile.stageEnd ? `Next at ${profile.stageEnd} EXP` : 'Top league unlocked'}
                  </span>
                </div>
                <p className="league-subtitle">Earn EXP from tests and streaked PYQ practice to climb divisions.</p>
              </div>
            </div>

            <div className="league-hero-stats">
              <div className="league-stat-card">
                <span>Total EXP</span>
                <strong>{profile.totalExp}</strong>
              </div>
              <div className="league-stat-card">
                <span>PYQ streak</span>
                <strong>{profile.streakCount} days</strong>
              </div>
              <div className="league-stat-card">
                <span>Streak bonus</span>
                <strong>+{profile.streakBonus} EXP</strong>
              </div>
            </div>
          </div>

          {profile.league !== '???' && (
            <div className="league-hero-progress">
              <div className="league-progress-card">
                <div className="league-progress-top">
                  <span>Division progress</span>
                  {profile.stageEnd ? (
                    <span>{stageProgress} / {profile.stageExp} EXP</span>
                  ) : (
                    <span>Top league unlocked</span>
                  )}
                </div>
                {profile.stageEnd && (
                  <div className="league-progress-bar">
                    <div className="league-progress-fill" style={{ width: `${stageProgressPct}%` }} />
                  </div>
                )}
                {profile.stageEnd && (
                  <div className="league-progress-meta">
                    <span>Next stage at {profile.stageEnd} EXP</span>
                    <span>+{profile.streakBonus} streak bonus</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {isUnranked && (
          <div className="league-hidden-note">
            <Shield size={16} />
            <span>Unranked is enabled. Leaderboards are hidden for you and your profile is hidden from others.</span>
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {!isUnranked && (
          <div className="league-boards">
            <div className="league-board-card">
              <div className="league-board-header">
                <h3>
                  <Trophy size={16} /> Global Leaderboard
                </h3>
              </div>
              {loading ? (
                <div className="leaderboard-loading">
                  <span className="spinner" />
                </div>
              ) : leagueStats.length === 0 ? (
                <div className="leaderboard-empty">
                  <Users size={16} />
                  <span>No entries yet.</span>
                </div>
              ) : (
                <div className="league-stats-list">
                  {leagueStats.map((stat) => (
                    <div key={stat.league}>
                      <div
                        className={`league-stats-row ${stat.league === profile.league ? 'is-you' : ''} ${expandedLeague === stat.league ? 'expanded' : ''}`}
                        onClick={() => stat.count > 0 && handleToggleLeague(stat.league)}
                        style={{ cursor: stat.count > 0 ? 'pointer' : 'default' }}
                      >
                        <span className="league-stats-icon">
                          <img
                            src={`/league-icons/${getLeagueIconKey(stat.league)}.png`}
                            alt={stat.league}
                            loading="lazy"
                          />
                        </span>
                        <span className="league-stats-name">{stat.league}</span>
                        <span className="league-stats-count">
                          {stat.count} {stat.count === 1 ? 'member' : 'members'}
                          {stat.count > 0 && (
                            <ChevronRight size={12} className={`league-stats-chevron ${expandedLeague === stat.league ? 'rotated' : ''}`} />
                          )}
                        </span>
                      </div>
                      {expandedLeague === stat.league && (
                        <div className="league-stats-members">
                          {expandedLoading ? (
                            <div className="leaderboard-loading"><span className="spinner" /></div>
                          ) : expandedMembers.length === 0 ? (
                            <div className="leaderboard-empty"><Users size={14} /><span>No members.</span></div>
                          ) : (
                            <>
                              <div className="league-board-list">
                                {expandedMembers.map((entry) => (
                                  <LeagueBoardRow key={`member-${entry.userId}`} entry={entry} showTrophy={false} />
                                ))}
                              </div>
                              <LeagueBoardPagination page={expandedPage} totalPages={expandedTotalPages} onPageChange={handleExpandedPageChange} />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="league-board-card">
              <div className="league-board-header">
                <h3>
                  <Users size={16} /> Your division
                </h3>
                <span>{profile.league}{profile.stage ? ` ${profile.stage}` : ''}</span>
              </div>
              {loading ? (
                <div className="leaderboard-loading">
                  <span className="spinner" />
                </div>
              ) : divisionLeaderboard.length === 0 && !divisionOwnerEntry ? (
                <div className="leaderboard-empty">
                  <Users size={16} />
                  <span>No entries yet.</span>
                </div>
              ) : (
                <>
                  <div className="league-board-list">
                    {divisionOwnerEntry && divisionPage === 1 && (
                      <LeagueBoardRow entry={divisionOwnerEntry} showTrophy={false} />
                    )}
                    {divisionLeaderboard.map((entry) => (
                      <LeagueBoardRow key={`division-${entry.userId}`} entry={entry} showTrophy={false} />
                    ))}
                  </div>
                  <LeagueBoardPagination page={divisionPage} totalPages={divisionTotalPages} onPageChange={handleDivisionPageChange} />
                </>
              )}
            </div>
          </div>
        )}

        {!isUnranked && (
          <div className="league-exp-guide">
            <h3><Zap size={16} /> Earning EXP</h3>
            <div className="league-exp-guide-list">
              <div className="league-exp-guide-item">
                <strong>Tests (300 max)</strong>
                <span>250+ → 400 EXP · 200+ → 200 · 150+ → 100</span>
              </div>
              <div className="league-exp-guide-item">
                <strong>Tests (180 max)</strong>
                <span>150+ → 400 EXP · 120+ → 200 · 90+ → 100</span>
              </div>
              <div className="league-exp-guide-item">
                <strong>PYQ daily</strong>
                <span>100+ Qs &amp; 2hrs → 100 EXP/day</span>
              </div>
              <div className="league-exp-guide-item">
                <strong>Streaks</strong>
                <span>Consecutive PYQ days → up to +100 bonus/day</span>
              </div>
            </div>
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
  const [perspectiveLoadingUserId, setPerspectiveLoadingUserId] = useState<string | null>(null);
  const [perspectiveUserName, setPerspectiveUserName] = useState<string | null>(null);
  const ownAttemptSnapshotRef = useRef<{
    attempt: AttemptDetails | null;
    questions: Question[];
    subjects: Array<{ name: string; total: number; score: number }>;
    isAdmin: boolean;
    testZ7iId: string | null;
  } | null>(null);

  useEffect(() => {
    ownAttemptSnapshotRef.current = null;
    setPerspectiveUserName(null);
    loadQuestions();
  }, [attemptId]);

  const loadQuestions = async () => {
    setLoading(true);
    setError('');

    try {
      const data = await apiRequest(`/z7i?action=questions&attemptId=${attemptId}`);

      if (data.success) {
        if (!ownAttemptSnapshotRef.current) {
          ownAttemptSnapshotRef.current = {
            attempt: data.attempt,
            questions: data.questions.map((q: Question) => normalizeQuestion(q)),
            subjects: data.subjects,
            isAdmin: data.isAdmin || false,
            testZ7iId: data.testZ7iId || null,
          };
        }
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

  const restoreOwnAttempt = useCallback(() => {
    const snapshot = ownAttemptSnapshotRef.current;
    if (!snapshot) return;
    setAttempt(snapshot.attempt);
    setQuestions(snapshot.questions);
    setSubjects(snapshot.subjects);
    setIsAdmin(snapshot.isAdmin);
    setTestZ7iId(snapshot.testZ7iId);
    setPerspectiveUserName(null);
  }, []);

  const handleOpenLeaderboardPerspective = useCallback(async (entry: LeaderboardEntry) => {
    setPerspectiveLoadingUserId(entry.userId);
    try {
      const data = await apiRequest(`/z7i?action=questions&attemptId=${entry.attemptId}&asUserId=${entry.userId}`);
      if (!data.success) {
        setError(data.error || 'Failed to load user perspective');
        return;
      }
      setAttempt(data.attempt);
      setQuestions(data.questions.map((q: Question) => normalizeQuestion(q)));
      setSubjects(data.subjects || []);
      setIsAdmin(data.isAdmin || false);
      setTestZ7iId(data.testZ7iId || null);
      setPerspectiveUserName(entry.userName || 'Selected User');
      setShowExamPanel(true);
    } catch {
      setError('Network error while opening selected user perspective.');
    } finally {
      setPerspectiveLoadingUserId(null);
    }
  }, []);

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
        onBack={() => {
          setShowExamPanel(false);
          if (perspectiveUserName) {
            restoreOwnAttempt();
          }
        }}
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
            {perspectiveUserName && (
              <button className="btn btn-secondary" onClick={restoreOwnAttempt}>
                <RotateCcw size={16} /> Exit {perspectiveUserName}'s view
              </button>
            )}
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
            onOpenLeaderboardPerspective={handleOpenLeaderboardPerspective}
            perspectiveLoadingUserId={perspectiveLoadingUserId}
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
  const [forumMentionCount, setForumMentionCount] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [showTimeIntel, setShowTimeIntel] = useState(false);
  const [showPYP, setShowPYP] = useState(false);
  const [showOwnerDashboard, setShowOwnerDashboard] = useState(false);
  const [showAiChats, setShowAiChats] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showZone, setShowZone] = useState(false);
  const [showUpdates, setShowUpdates] = useState(false);
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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfImportModel, setPdfImportModel] = useState<'2.5-flash' | '3-flash'>('2.5-flash');
  const [customExamTestId, setCustomExamTestId] = useState<string | null>(null);
  const [customResultsAttemptId, setCustomResultsAttemptId] = useState<string | null>(null);
  const [pendingTestId, setPendingTestId] = useState<string | null>(null);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [leagueProfile, setLeagueProfile] = useState<LeagueProfile | null>(null);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [showLeague, setShowLeague] = useState(false);
  const hasEnrollment = Boolean(user.z7iEnrollment);
  
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
    setShowChat(false);
    setShowZone(false);
    setShowUpdates(false);
    setShowLeague(false);
    setPendingTestId(null);
  }, []);

  const navigateTo = useCallback((path: string) => {
    window.history.pushState({}, '', path);
  }, []);

  const applyRoute = useCallback(
    (path: string) => {
      if (!isValidRoute(path)) return;
      if (!hasEnrollment && path !== '/' && path !== '/dashboard') {
        navigateTo('/');
        resetViews();
        return;
      }
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
      if (path === '/chat') {
        setShowChat(true);
        return;
      }
      if (path === '/zone') {
        setShowZone(true);
        return;
      }
      if (path === '/updates') {
        setShowUpdates(true);
        return;
      }
      if (path === '/league') {
        setShowLeague(true);
        return;
      }
    },
    [hasEnrollment, isOwnerUser, navigateTo, resetViews]
  );

  useEffect(() => {
    applyRoute(window.location.pathname);
  }, [applyRoute]);

  useEffect(() => {
    if (!hasEnrollment) {
      resetViews();
      navigateTo('/');
    }
  }, [hasEnrollment, navigateTo, resetViews]);

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
    if (!hasEnrollment) return;
    
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
  }, [hasEnrollment]);

  const loadCustomTests = useCallback(async () => {
    if (!hasEnrollment) return;
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
  }, [hasEnrollment]);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  useEffect(() => {
    // Fetch unread forum mention count
    if (hasEnrollment) {
      apiRequest('/z7i?action=forum-mentions-count')
        .then(data => { if (typeof data.count === 'number') setForumMentionCount(data.count); })
        .catch(() => {});
    }
  }, [hasEnrollment]);

  useEffect(() => {
    loadCustomTests();
  }, [loadCustomTests]);

  useEffect(() => {
    if (!user?.id || !hasEnrollment) {
      setLeagueProfile(null);
      setLeagueLoading(false);
      return;
    }
    const loadLeagueProfile = async () => {
      setLeagueLoading(true);
      try {
        const data = await apiRequest('/league?action=profile');
        if (data?.success) {
          setLeagueProfile(data.profile as LeagueProfile);
        }
      } catch (error) {
        console.error('Failed to load league profile', error);
      } finally {
        setLeagueLoading(false);
      }
    };
    loadLeagueProfile();
  }, [user?.id, hasEnrollment]);

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
    if (!hasEnrollment || !user.lastSyncAt || syncing) return;
    
    const lastSync = new Date(user.lastSyncAt).getTime();
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    if (now - lastSync > twoHours) {
      console.log('Auto-syncing: last sync was over 2 hours ago');
      handleSync();
    }
  }, [hasEnrollment, user.lastSyncAt]); // Only run on mount and when user changes

  const handleSync = async () => {
    if (!requireEnrollment()) return;
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
        setTimeout(() => setMessage(''), 3000);
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
    } else if (config === 'pdf-import') {
      setCustomTestTimeLimit(180);
      setPdfFile(null);
      setPdfImportModel('2.5-flash');
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

  const handleCreateFromPdf = async () => {
    if (!customTestName.trim()) {
      showCustomMessage('error', 'Test name is required.');
      return;
    }
    if (!pdfFile) {
      showCustomMessage('error', 'Please select a PDF file.');
      return;
    }

    setCreatingCustomTest(true);
    setCustomTestLogs([
      { timestamp: new Date().toISOString(), message: 'Reading PDF file...', level: 'info' },
    ]);

    try {
      const buffer = await pdfFile.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      setCustomTestLogs(prev => [
        ...prev,
        { timestamp: new Date().toISOString(), message: 'Sending PDF to AI for question extraction...', level: 'info' },
      ]);

      const data = await apiRequest('/auth?action=custom-tests-create-from-pdf', {
        method: 'POST',
        body: JSON.stringify({
          name: customTestName.trim(),
          timeLimit: customTestTimeLimit,
          modelId: pdfImportModel,
          pdfBase64: base64,
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
        const subjectiveNote = data.hasSubjective
          ? 'This test contains subjective questions — marks will not be counted on submission.'
          : 'All questions are gradable — marks will be counted.';

        // Process diagram images from PDF if any
        const diagramMeta = Array.isArray(data.diagramMeta) ? data.diagramMeta as Array<{
          questionId: string;
          questionOrder: number;
          diagramPage: number;
          diagramBounds: { x: number; y: number; width: number; height: number };
        }> : [];

        let diagramLogs: typeof serverLogs = [];

        if (diagramMeta.length > 0 && pdfFile) {
          diagramLogs.push({
            timestamp: new Date().toISOString(),
            message: `Extracting ${diagramMeta.length} diagram image(s) from PDF...`,
            level: 'info' as const,
          });
          setCustomTestLogs(prev => [
            ...prev,
            ...diagramLogs,
          ]);

          try {
            // Dynamically import pdfjs-dist
            const pdfjs = await import('pdfjs-dist');
            pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;

            const pdfBuffer = await pdfFile.arrayBuffer();
            const pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

            const updates: Array<{ questionId: string; imageDataUrl: string }> = [];

            // Group diagrams by page to avoid rendering the same page multiple times
            const byPage = new Map<number, typeof diagramMeta>();
            for (const dm of diagramMeta) {
              const arr = byPage.get(dm.diagramPage) || [];
              arr.push(dm);
              byPage.set(dm.diagramPage, arr);
            }

            for (const [pageNum, diagrams] of byPage) {
              if (pageNum < 1 || pageNum > pdfDoc.numPages) continue;
              const page = await pdfDoc.getPage(pageNum);
              const viewport = page.getViewport({ scale: 2 });

              // Render full page to offscreen canvas
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const ctx = canvas.getContext('2d')!;
              await page.render({ canvasContext: ctx, viewport }).promise;

              // Crop each diagram from this page
              for (const dm of diagrams) {
                const b = dm.diagramBounds;
                const sx = Math.round((b.x / 100) * viewport.width);
                const sy = Math.round((b.y / 100) * viewport.height);
                const sw = Math.round((b.width / 100) * viewport.width);
                const sh = Math.round((b.height / 100) * viewport.height);

                if (sw <= 0 || sh <= 0) continue;

                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = sw;
                cropCanvas.height = sh;
                const cropCtx = cropCanvas.getContext('2d')!;
                cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

                const dataUrl = cropCanvas.toDataURL('image/png');
                updates.push({ questionId: dm.questionId, imageDataUrl: dataUrl });
              }

              page.cleanup();
            }

            pdfDoc.destroy();

            if (updates.length > 0) {
              setCustomTestLogs(prev => [
                ...prev,
                { timestamp: new Date().toISOString(), message: `Uploading ${updates.length} diagram image(s)...`, level: 'info' as const },
              ]);

              const imgRes = await apiRequest('/auth?action=custom-tests-update-question-images', {
                method: 'POST',
                body: JSON.stringify({ updates }),
              });

              if (imgRes.success) {
                diagramLogs = [{
                  timestamp: new Date().toISOString(),
                  message: `${imgRes.updated || updates.length} diagram image(s) embedded successfully.`,
                  level: 'success' as const,
                }];
              } else {
                diagramLogs = [{
                  timestamp: new Date().toISOString(),
                  message: `Diagram upload issue: ${imgRes.error || 'unknown error'}`,
                  level: 'error' as const,
                }];
              }
            }
          } catch (imgErr) {
            console.error('Diagram extraction error:', imgErr);
            diagramLogs = [{
              timestamp: new Date().toISOString(),
              message: 'Failed to extract diagram images from PDF. Questions created without images.',
              level: 'error' as const,
            }];
          }
        }

        setCustomTestLogs([
          ...serverLogs,
          ...diagramLogs,
          { timestamp: new Date().toISOString(), message: subjectiveNote, level: data.hasSubjective ? 'info' : 'success' },
          { timestamp: new Date().toISOString(), message: 'Custom test created from PDF successfully.', level: 'success' },
        ]);
        showCustomMessage('success', 'Custom test created from PDF!');
        setCustomTestName('');
        setPdfFile(null);
        await loadCustomTests();
      } else {
        setCustomTestLogs(prev => [
          ...prev,
          { timestamp: new Date().toISOString(), message: data.error || 'Failed to create test from PDF.', level: 'error' },
        ]);
        showCustomMessage('error', data.error || 'Failed to create test from PDF.');
      }
    } catch {
      setCustomTestLogs(prev => [
        ...prev,
        { timestamp: new Date().toISOString(), message: 'Failed to create custom test from PDF.', level: 'error' },
      ]);
      showCustomMessage('error', 'Failed to create custom test from PDF.');
    } finally {
      setCreatingCustomTest(false);
    }
  };


  const handleDeleteCustomTest = async (testId: string) => {
    if (!isOwnerUser) return;
    const confirmed = window.confirm('Delete this custom test for everyone? This will remove all attempts.');
    if (!confirmed) return;

    try {
      const data = await apiRequest('/auth?action=custom-tests-delete', {
        method: 'POST',
        body: JSON.stringify({ testId }),
      });

      if (data.success) {
        showCustomMessage('success', 'Custom test deleted for everyone.');
        setCustomTests(prev => prev.filter(test => test.id !== testId));
      } else {
        showCustomMessage('error', data.error || 'Failed to delete custom test.');
      }
    } catch {
      showCustomMessage('error', 'Failed to delete custom test.');
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

  const requireEnrollment = () => {
    if (hasEnrollment) return true;
    setMessage('Link your Z7I enrollment number (or enable guest sync) to unlock features.');
    setShowLinkModal(true);
    return false;
  };

  const openBookmarks = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowBookmarks(true);
    navigateTo('/bookmarks');
  };

  const openForum = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowForum(true);
    navigateTo('/forum');
  };

  const openPYP = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowPYP(true);
    navigateTo('/pyp');
  };

  const openTimeIntel = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowTimeIntel(true);
    navigateTo('/time-intel');
  };

  const openOwnerDashboard = () => {
    if (!requireEnrollment()) return;
    if (!isOwnerUser) return;
    setShowQuickMenu(false);
    resetViews();
    setShowOwnerDashboard(true);
    navigateTo('/owner');
  };

  const openAiChats = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowAiChats(true);
    navigateTo('/ai-chats');
  };

  const openChat = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowChat(true);
    navigateTo('/chat');
  };

  const openZone = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowZone(true);
    navigateTo('/zone');
  };

  const openLeague = () => {
    if (!requireEnrollment()) return;
    setShowQuickMenu(false);
    resetViews();
    setShowLeague(true);
    navigateTo('/league');
  };

  const openUpdates = () => {
    setShowQuickMenu(false);
    resetViews();
    setShowUpdates(true);
    navigateTo('/updates');
  };

  const handleSelectTest = (test: Test) => {
    if (!requireEnrollment()) return;
    setSelectedTest(test);
    navigateTo(`/test/${test.id}`);
  };

  const goHome = () => {
    resetViews();
    navigateTo('/');
  };

  const navigationProps = {
    user,
    onSync: handleSync,
    syncing,
    onProfileClick: () => setShowProfile(true),
    onHomeClick: goHome,
    leagueProfile,
    leagueLoading,
    onOpenLeague: openLeague,
    onGoToChat: openChat,
    forceCompact: showChat || showAiChats,
  };

  if (examWriterTest) {
    return (
      <>
        <Navigation {...navigationProps} />
        <ExamWriter 
          test={examWriterTest} 
          onBack={() => setExamWriterTest(null)} 
          onSubmitted={async () => {
            await loadTests();
          }}
          onViewAnalysis={() => {
            setExamWriterTest(null);
            loadTests().then(() => {
              handleSelectTest(examWriterTest);
            });
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
        <ForumView 
          onBack={goHome} 
          isOwnerUser={Boolean(user.isOwner)}
          onMentionCountChange={(delta) => setForumMentionCount(c => Math.max(0, c + delta))}
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

  if (showAiChats) {
    return (
      <>
        <Navigation {...navigationProps} />
        <AiChatbotsPage
          onBack={goHome}
          user={user}
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

  if (showChat) {
    return (
      <>
        <Navigation {...navigationProps} />
        <ChatRoom
          onBack={goHome}
          userId={user.id}
          isOwner={isOwnerUser}
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

  if (showZone) {
    return (
      <>
        <Navigation {...navigationProps} />
        <ZonePage
          tests={tests.map(test => ({ id: test.id, testName: test.testName, packageName: test.packageName }))}
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

  if (showUpdates) {
    return (
      <>
        <Navigation {...navigationProps} />
        <UpdatesPage />
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

  if (showLeague) {
    return (
      <>
        <Navigation {...navigationProps} />
        <LeaguePage profile={leagueProfile} onBack={goHome} />
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
        <Navigation {...navigationProps} />
        <PastYearPapers onBack={goHome} canUseAiSolutions={Boolean(user.canUseAiSolutions || user.isOwner)} />
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
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
        <Navigation {...navigationProps} />
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
            <div className="custom-test-panel-body">
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
                  <button
                    type="button"
                    className={`custom-test-config-card ${customTestConfig === 'pdf-import' ? 'active' : ''}`}
                    onClick={() => applyCustomTestConfig('pdf-import')}
                  >
                    <div className="config-title">PDF Import</div>
                    <div className="config-meta">Upload a PDF paper • AI extracts questions</div>
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
                    <div className="custom-test-choice-row">
                      {(['mixed', 'easy', 'hard'] as const).map(option => (
                        <button
                          key={option}
                          type="button"
                          className={`custom-test-choice ${jeeMainDifficulty === option ? 'active' : ''}`}
                          onClick={() => setJeeMainDifficulty(option)}
                          aria-pressed={jeeMainDifficulty === option}
                        >
                          {option === 'mixed' ? 'Mixed' : option === 'easy' ? 'Easy' : 'Hard'}
                          <span className="custom-test-choice-subtext">
                            {option === 'mixed' ? 'Easy / Medium / Hard blend' : option === 'easy' ? 'More straightforward questions' : 'High difficulty focus'}
                          </span>
                        </button>
                      ))}
                    </div>
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
                      <div className="custom-test-choice-row">
                        {Object.keys(SUBJECT_CHAPTERS).map(subject => (
                          <button
                            key={subject}
                            type="button"
                            className={`custom-test-choice ${assignmentSubject === subject ? 'active' : ''}`}
                            onClick={() => setAssignmentSubject(subject as AssignmentSubject)}
                            aria-pressed={assignmentSubject === subject}
                          >
                            {subject}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Chapters</label>
                    <div className="custom-test-choice-row">
                      {(['all', 'single', 'multiple'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          className={`custom-test-choice ${assignmentChapterMode === mode ? 'active' : ''}`}
                          onClick={() => setAssignmentChapterMode(mode)}
                          aria-pressed={assignmentChapterMode === mode}
                        >
                          {mode === 'all' ? 'All chapters' : mode === 'single' ? 'Single chapter' : 'Multiple chapters'}
                        </button>
                      ))}
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
                            <button
                              key={chapter}
                              type="button"
                              className={`chapter-option ${assignmentSelectedChapters.includes(chapter) ? 'active' : ''}`}
                              onClick={() => {
                                if (assignmentChapterMode === 'single') {
                                  setAssignmentSelectedChapters([chapter]);
                                } else {
                                  setAssignmentSelectedChapters(prev =>
                                    prev.includes(chapter) ? prev.filter(item => item !== chapter) : [...prev, chapter]
                                  );
                                }
                              }}
                              aria-pressed={assignmentSelectedChapters.includes(chapter)}
                            >
                              <span className="chapter-option-indicator" />
                              <span>{chapter}</span>
                            </button>
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
                    <div className="custom-test-choice-row">
                      {(['mixed', 'easy', 'medium', 'hard'] as const).map(option => (
                        <button
                          key={option}
                          type="button"
                          className={`custom-test-choice ${assignmentDifficulty === option ? 'active' : ''}`}
                          onClick={() => setAssignmentDifficulty(option)}
                          aria-pressed={assignmentDifficulty === option}
                        >
                          {option === 'mixed' ? 'Mixed' : option.charAt(0).toUpperCase() + option.slice(1)}
                          <span className="custom-test-choice-subtext">
                            {option === 'mixed'
                              ? 'Balanced difficulty spread'
                              : option === 'easy'
                                ? 'Confidence builders'
                                : option === 'medium'
                                  ? 'Core exam mix'
                                  : 'Challenging problems'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {customTestConfig === 'pdf-import' && (
                <div className="custom-test-config-panel">
                  <div className="form-group">
                    <label className="form-label">Upload PDF</label>
                    <div className="pdf-upload-area">
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        id="pdf-upload-input"
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file && file.type === 'application/pdf') {
                            setPdfFile(file);
                          } else if (file) {
                            showCustomMessage('error', 'Please select a valid PDF file.');
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary pdf-upload-btn"
                        onClick={() => document.getElementById('pdf-upload-input')?.click()}
                      >
                        <FileText size={16} />
                        {pdfFile ? 'Change PDF' : 'Choose PDF'}
                      </button>
                      {pdfFile && (
                        <span className="pdf-file-name">{pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                      )}
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">AI Model</label>
                    <div className="custom-test-choice-row">
                      <button
                        type="button"
                        className={`custom-test-choice ${pdfImportModel === '2.5-flash' ? 'active' : ''}`}
                        onClick={() => setPdfImportModel('2.5-flash')}
                        aria-pressed={pdfImportModel === '2.5-flash'}
                      >
                        Gemini 2.5 Flash
                        <span className="custom-test-choice-subtext">Fast & balanced</span>
                      </button>
                      <button
                        type="button"
                        className={`custom-test-choice ${pdfImportModel === '3-flash' ? 'active' : ''}`}
                        onClick={() => setPdfImportModel('3-flash')}
                        aria-pressed={pdfImportModel === '3-flash'}
                      >
                        Gemini 3 Flash
                        <span className="custom-test-choice-subtext">Better for complex papers</span>
                      </button>
                    </div>
                  </div>
                  <div className="config-note">
                    The AI will extract questions from the PDF and determine their types (MCQ, MAQ, NAT, or Subjective).
                    If the paper contains subjective questions, marks will <strong>not</strong> be counted on submission.
                    Papers with only MCQ/MAQ/NAT questions will be fully graded.
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
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCustomTestPanel(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={customTestConfig === 'pdf-import' ? handleCreateFromPdf : handleCreateCustomTest} disabled={creatingCustomTest}>
                {creatingCustomTest ? 'Creating...' : customTestConfig === 'pdf-import' ? 'Import from PDF' : 'Create Test'}
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
              canDelete={isOwnerUser}
              onDelete={() => handleDeleteCustomTest(test.id)}
            />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <Navigation {...navigationProps} />
      
      <div className="page home-page">
        <div className="container">
          <div className="page-header">
            <div className="page-header-content">
              <h1 className="page-title">
                <span className="page-title-avatar" aria-hidden>
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" loading="lazy" />
                  ) : (
                    <User size={16} />
                  )}
                </span>
                Your Tests
              </h1>
              <p className="page-subtitle">
                {hasEnrollment
                  ? `Linked to ${user.z7iEnrollment} | ${tests.length} tests synced`
                  : 'Link your Z7I enrollment number or enable guest sync to unlock features'}
              </p>
            </div>
            <div className="page-header-actions quick-menu-wrapper">
              <button
                className={`btn btn-secondary quick-menu-toggle ${showQuickMenu ? 'open' : ''}`}
                onClick={() => setShowQuickMenu(prev => !prev)}
                aria-expanded={showQuickMenu}
                aria-haspopup="menu"
              >
                <Menu size={16} />
                Menu
              </button>
              <div className={`quick-menu-items ${showQuickMenu ? 'open' : ''}`}>
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
                      setShowQuickMenu(false);
                      setCustomTestLogs([]);
                      setShowCustomTestPanel(prev => !prev);
                    }}
                  >
                    <Sparkles size={16} />
                    Custom Test
                  </button>
                )}
                <button className="btn btn-secondary forum-btn-with-badge" onClick={openForum}>
                  <MessageSquare size={16} />
                  Forum
                  {forumMentionCount > 0 && (
                    <span className="forum-mention-badge">{forumMentionCount}</span>
                  )}
                </button>
                <button className="btn btn-secondary" onClick={openAiChats}>
                  <MessageCircle size={16} />
                  AI Chats
                </button>
                <button className="btn btn-secondary" onClick={openChat}>
                  <MessageSquareDot size={16} />
                  Chat
                </button>
                <button className="btn btn-secondary" onClick={openZone}>
                  <Layers size={16} />
                  Zone
                </button>
                <button className="btn btn-secondary" onClick={openUpdates}>
                  <List size={16} />
                  Updates
                </button>
                <button className="btn btn-secondary" onClick={openPYP}>
                  <Trophy size={16} />
                  PYQ
                </button>
                {hasEnrollment && (
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
          </div>
          
          {message && (
            <div className={`alert ${message.includes('failed') ? 'alert-error' : 'alert-success'}`}>
              {message}
            </div>
          )}

          {!hasEnrollment ? (
            <>
              <div className="empty-state">
                <Link2 size={48} />
                <div className="empty-state-title">Link Your Enrollment</div>
                <div className="empty-state-text">Sync your Z7I enrollment number or use guest sync to unlock all features.</div>
                <button className="btn btn-primary" onClick={() => setShowLinkModal(true)}>
                  <Link2 size={16} />
                  Link Z7I Account
                </button>
              </div>
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
          canUseGuestSync={user.canUseGuestSync === true}
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

  useEffect(() => {
    const root = document.documentElement;
    const overlay = 'linear-gradient(180deg, rgba(6, 10, 23, 0.6), rgba(6, 10, 23, 0.9))';
    const applyBackgroundVars = (
      key: string,
      url?: string | null,
      x?: number | null,
      y?: number | null
    ) => {
      const hasVideo = isVideoMediaUrl(url);
      const hasGif = isGifMediaUrl(url);
      const hasMedia = hasVideo || hasGif;
      root.style.setProperty(`--${key}-bg-image`, hasGif ? `url("${url}")` : 'none');
      root.style.setProperty(`--${key}-bg-position`, `${x ?? 50}% ${y ?? 50}%`);
      root.style.setProperty(`--${key}-bg-overlay`, hasMedia ? overlay : 'none');
    };

    if (!user) {
      applyBackgroundVars('home', null, 50, 50);
      applyBackgroundVars('ai-chats', null, 50, 50);
      applyBackgroundVars('pyq', null, 50, 50);
      applyBackgroundVars('forum', null, 50, 50);
      root.style.setProperty('--test-card-bg-image', 'none');
      root.style.setProperty('--test-card-bg-position', '50% 50%');
      return;
    }

    applyBackgroundVars('home', user.themeHomeBgGifUrl, user.themeHomeBgPositionX, user.themeHomeBgPositionY);
    applyBackgroundVars('ai-chats', user.themeAiChatsBgGifUrl, user.themeAiChatsBgPositionX, user.themeAiChatsBgPositionY);
    applyBackgroundVars('pyq', user.themePyqBgGifUrl, user.themePyqBgPositionX, user.themePyqBgPositionY);
    applyBackgroundVars('forum', user.themeForumBgGifUrl, user.themeForumBgPositionX, user.themeForumBgPositionY);
    root.style.setProperty(
      '--test-card-bg-image',
      user.themeTestCardBgGifUrl ? `url("${user.themeTestCardBgGifUrl}")` : 'none'
    );
    root.style.setProperty(
      '--test-card-bg-position',
      `${user.themeTestCardBgPositionX ?? 50}% ${user.themeTestCardBgPositionY ?? 50}%`
    );
  }, [user]);

  const toggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startViewTransition = (document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    }).startViewTransition;

    const fallbackTransition = () => {
      root.classList.remove('theme-transition-active');
      void root.offsetWidth;
      root.classList.add('theme-transition-active');
      root.setAttribute('data-theme', nextTheme);
      window.setTimeout(() => {
        root.classList.remove('theme-transition-active');
      }, 700);
      setTheme(nextTheme);
    };

    if (!reduceMotion && startViewTransition) {
      try {
        root.classList.remove('theme-transition-active');
        void root.offsetWidth;
        root.classList.add('theme-transition-active');
        const transition = startViewTransition(() => {
          root.setAttribute('data-theme', nextTheme);
          setTheme(nextTheme);
        });
        transition.finished.finally(() => {
          root.classList.remove('theme-transition-active');
        });
      } catch {
        fallbackTransition();
      }
    } else {
      fallbackTransition();
    }

    if (!user || !onUserUpdate) {
      return;
    }

    onUserUpdate({ ...user, themeMode: nextTheme });

    try {
      const response = await apiRequest('/auth?action=update-theme', {
        method: 'POST',
        body: JSON.stringify({ themeMode: nextTheme })
      });

      if (response.success) {
        onUserUpdate({ ...user, ...response.user });
      }
    } catch {
      onUserUpdate({ ...user, themeMode: theme });
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
