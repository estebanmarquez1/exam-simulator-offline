import { applyRating, autoRate } from './sm2';
import type { Rating } from './sm2';

export type { Rating };

const DB_NAME = 'exam-sim-offline';
const DB_VERSION = 1;

export interface QuestionProgress {
  questionNumber: number;
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReviewDate: string; // YYYY-MM-DD
  recentResults: boolean[]; // last 10 attempts, true = correct
}

export interface AttemptQuestion {
  questionNumber: number;
  topic: string | null;
  questionText: string;
  selectedAnswers: string[];
  correctAnswers: string[];
  isCorrect: boolean;
  rating?: Rating;
}

export interface AttemptRecord {
  id?: number;
  mode: 'EXAM' | 'PRACTICE';
  score: number;
  totalQuestions: number;
  correctCount: number;
  timeTakenSecs: number;
  createdAt: string;
  questions: AttemptQuestion[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('attempts')) {
        db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('questionProgress')) {
        db.createObjectStore('questionProgress', { keyPath: 'questionNumber' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-time patch: any record with interval=1 and nextReviewDate in the future
 * was created before the "due today" fix and should be moved to today.
 * Safe to call on every boot — it's a no-op once dates are correct.
 */
export async function patchFirstVisitDueDates(): Promise<void> {
  const db = await openDB();
  const today = new Date().toISOString().slice(0, 10);

  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readwrite');
    const store = t.objectStore('questionProgress');
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result as QuestionProgress[];
      for (const r of records) {
        if (r.interval === 1 && r.nextReviewDate > today) {
          store.put({ ...r, nextReviewDate: today });
        }
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Clear all SM-2 progress records so every question appears fresh. */
export async function resetProgress(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readwrite');
    t.objectStore('questionProgress').clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Read all SM-2 progress records (for debugging). */
export async function getAllProgress(): Promise<QuestionProgress[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readonly');
    const req = t.objectStore('questionProgress').getAll();
    req.onsuccess = () => resolve(req.result as QuestionProgress[]);
    req.onerror = () => reject(req.error);
  });
}

/** Read all SM-2 progress records due for review today or earlier. */
export async function getDueQuestionNumbers(): Promise<number[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readonly');
    const req = t.objectStore('questionProgress').getAll();
    req.onsuccess = () => {
      const today = new Date().toISOString().slice(0, 10);
      resolve(
        (req.result as QuestionProgress[])
          .filter((p) => p.nextReviewDate <= today)
          .map((p) => p.questionNumber)
      );
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save an attempt to IndexedDB, compute per-question SM-2 ratings, and update
 * all questionProgress records in a single write transaction.
 * Returns the saved attempt id and a map of questionNumber → rating.
 */
export async function saveAttempt(
  attempt: Omit<AttemptRecord, 'id' | 'createdAt'>
): Promise<{ id: number; ratings: Record<number, Rating> }> {
  const db = await openDB();

  // --- Read current progress for all answered questions ---
  const progressMap = new Map<number, QuestionProgress>();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readonly');
    const store = t.objectStore('questionProgress');
    let pending = attempt.questions.length;
    if (pending === 0) { resolve(); return; }
    for (const q of attempt.questions) {
      const req = store.get(q.questionNumber);
      req.onsuccess = () => {
        if (req.result) progressMap.set(q.questionNumber, req.result as QuestionProgress);
        if (--pending === 0) resolve();
      };
      req.onerror = () => reject(req.error);
    }
  });

  // --- Compute ratings and updated SM-2 states ---
  const ratings: Record<number, Rating> = {};
  const updatedProgress: QuestionProgress[] = [];

  for (const q of attempt.questions) {
    const current = progressMap.get(q.questionNumber);
    const recentResults = current?.recentResults ?? [];
    const rating = autoRate(q.isCorrect, recentResults);
    ratings[q.questionNumber] = rating;

    const sm2 = applyRating(
      { interval: current?.interval, easeFactor: current?.easeFactor, repetitions: current?.repetitions },
      rating
    );

    // First-ever encounter: make the card available for review today so the
    // user can drill it immediately after their first session, rather than
    // waiting until tomorrow (SM-2 default interval = 1 day).
    const isNew = !current;
    const nextReviewDate = isNew
      ? new Date().toISOString().slice(0, 10)
      : sm2.nextReviewDate;

    updatedProgress.push({
      questionNumber: q.questionNumber,
      interval: sm2.interval,
      easeFactor: sm2.easeFactor,
      repetitions: sm2.repetitions,
      nextReviewDate,
      recentResults: [...recentResults, q.isCorrect].slice(-10),
    });
  }

  // --- Write attempt + all progress in a single transaction ---
  const recordToSave: AttemptRecord = {
    ...attempt,
    createdAt: new Date().toISOString(),
    questions: attempt.questions.map((q) => ({ ...q, rating: ratings[q.questionNumber] })),
  };

  const id = await new Promise<number>((resolve, reject) => {
    const t = db.transaction(['attempts', 'questionProgress'], 'readwrite');
    const attStore = t.objectStore('attempts');
    const progStore = t.objectStore('questionProgress');

    // Initiate ALL requests before any await so the transaction stays alive.
    const addReq = attStore.add(recordToSave);
    for (const p of updatedProgress) {
      progStore.put(p);
    }

    t.oncomplete = () => resolve(addReq.result as number);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(new Error('Transaction aborted'));
  });

  return { id, ratings };
}

/**
 * Update SM-2 progress for a single question after a review-mode answer.
 * Rating is GREEN (correct) or RED (incorrect) — no YELLOW in review mode.
 */
export async function saveReviewRating(questionNumber: number, rating: 'GREEN' | 'RED'): Promise<void> {
  const db = await openDB();

  // Read current progress
  const current = await new Promise<QuestionProgress | undefined>((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readonly');
    const req = t.objectStore('questionProgress').get(questionNumber);
    req.onsuccess = () => resolve(req.result as QuestionProgress | undefined);
    req.onerror = () => reject(req.error);
  });

  const sm2 = applyRating(
    { interval: current?.interval, easeFactor: current?.easeFactor, repetitions: current?.repetitions },
    rating
  );
  const recentResults = [...(current?.recentResults ?? []), rating === 'GREEN'].slice(-10);

  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('questionProgress', 'readwrite');
    t.objectStore('questionProgress').put({
      questionNumber,
      interval: sm2.interval,
      easeFactor: sm2.easeFactor,
      repetitions: sm2.repetitions,
      nextReviewDate: sm2.nextReviewDate,
      recentResults,
    });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
