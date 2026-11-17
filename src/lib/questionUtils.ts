import type { RawQuestion, NormalizedQuestion } from '../types/question';

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeAnswer(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.flatMap((a) =>
    typeof a === 'string' && a.includes(',')
      ? a.split(',').map((s) => s.trim())
      : [a]
  );
}

export function normalizeQuestions(raw: RawQuestion[]): NormalizedQuestion[] {
  return shuffle(raw).map((q) => {
    const answer = normalizeAnswer(q.answer);
    return {
      originalNumber: q.question_number,
      topic: q.topic ?? null,
      question: q.question,
      options: shuffle(Object.entries(q.options)) as [string, string][],
      answer,
      explanation: q.explanation,
      paraphrase: q.paraphrase ?? null,
      isMulti: answer.length > 1,
    };
  });
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function isAnswerCorrect(selected: Set<string>, correct: string[]): boolean {
  return [...selected].sort().join(',') === [...correct].sort().join(',');
}
