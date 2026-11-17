export interface RawQuestion {
  question_number: number;
  topic: string;
  question: string;
  options: Record<string, string>;
  answer: string | string[];
  explanation: string;
  paraphrase?: string;
}

export interface NormalizedQuestion {
  originalNumber: number;
  topic: string | null;
  question: string;
  options: [string, string][];
  answer: string[];
  explanation: string;
  paraphrase: string | null;
  isMulti: boolean;
}
