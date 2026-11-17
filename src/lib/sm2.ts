export type Rating = 'GREEN' | 'YELLOW' | 'RED';

const QUALITY: Record<Rating, number> = { GREEN: 5, YELLOW: 3, RED: 1 };
const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;

export interface ProgressInput {
  interval?: number;
  easeFactor?: number;
  repetitions?: number;
}

export interface ProgressOutput {
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReviewDate: string; // YYYY-MM-DD
}

export function applyRating(current: ProgressInput, rating: Rating): ProgressOutput {
  const q = QUALITY[rating];
  const ef = current.easeFactor ?? DEFAULT_EASE;
  const reps = current.repetitions ?? 0;
  const prevInterval = current.interval ?? 1;

  const newEase = Math.max(MIN_EASE, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  let newInterval: number;
  let newRepetitions: number;
  if (q < 3) {
    newRepetitions = 0;
    newInterval = 1;
  } else {
    newRepetitions = reps + 1;
    if (reps === 0) newInterval = 1;
    else if (reps === 1) newInterval = 6;
    else newInterval = Math.round(prevInterval * ef);
  }

  const date = new Date();
  date.setDate(date.getDate() + newInterval);
  date.setHours(0, 0, 0, 0);
  const nextReviewDate = date.toISOString().slice(0, 10);

  return { interval: newInterval, easeFactor: newEase, repetitions: newRepetitions, nextReviewDate };
}

/** Mirrors the backend auto-rating logic applied when saving an attempt. */
export function autoRate(isCorrect: boolean, recentResults: boolean[]): Rating {
  if (!isCorrect) return 'RED';
  if (recentResults.length < 10 || recentResults.some((r) => !r)) return 'YELLOW';
  return 'GREEN';
}
