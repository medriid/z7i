export type LightboxContext = {
  questionId?: string;
  label?: string;
  subject?: string;
  testName?: string;
};

export type DrawingPoint = {
  x: number;
  y: number;
};

export type DrawingStroke = {
  color: string;
  size: number;
  points: DrawingPoint[];
};

export type SavedQuestionNote = {
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

export const loadSavedQuestionNotes = (): SavedQuestionNote[] => {
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

export const saveSavedQuestionNotes = (notes: SavedQuestionNote[]) => {
  localStorage.setItem(SAVED_QUESTION_STORAGE_KEY, JSON.stringify(notes));
};

export const addSavedQuestionNote = (note: SavedQuestionNote) => {
  const next = [note, ...loadSavedQuestionNotes()];
  saveSavedQuestionNotes(next);
  return next;
};

export const removeSavedQuestionNote = (id: string) => {
  const next = loadSavedQuestionNotes().filter(note => note.id !== id);
  saveSavedQuestionNotes(next);
  return next;
};

export const createSavedQuestionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`;
