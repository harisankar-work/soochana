export const MODEL_ID = "Xenova/twitter-roberta-base-sentiment-latest";
export const MODEL_REVISION = "f3ec4d0925f90c3ca7ee7814f52d6ee7cf180445";
export const MAX_ANALYSIS_COUNT = 100;
export const labels = ["Negative", "Neutral", "Positive"] as const;
export type Label = (typeof labels)[number];

export type Prediction = {
  feedbackId: string;
  label: Label;
  confidence: number;
  scores: Record<Label, number>;
  modelId: typeof MODEL_ID;
  modelRevision: typeof MODEL_REVISION;
};

export type WorkerRequest = { run: number; records: { id: string; text: string }[] };
export type WorkerEvent = { run: number } & (
  | { type: "download"; progress?: number }
  | { type: "initialize" | "analyse" | "done" }
  | { type: "result"; id: string; scores: unknown }
  | { type: "row-error"; id: string }
  | { type: "error"; message: string }
);

export function parsePrediction(feedbackId: string, values: unknown): Prediction | null {
  if (!Array.isArray(values) || values.length !== labels.length) return null;
  const scores = new Map<Label, number>();
  for (const value of values) {
    const label = typeof value?.label === "string" ? labels.find((item) => item.toLowerCase() === value.label.toLowerCase()) : undefined;
    const score: unknown = value?.score;
    if (!label || scores.has(label) || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return null;
    scores.set(label, score);
  }
  const normalized = { Negative: scores.get("Negative")!, Neutral: scores.get("Neutral")!, Positive: scores.get("Positive")! };
  if (Math.abs(normalized.Negative + normalized.Neutral + normalized.Positive - 1) > 0.001) return null;
  const label = labels.reduce((best, item) => normalized[item] > normalized[best] ? item : best);
  return { feedbackId, label, confidence: normalized[label], scores: normalized, modelId: MODEL_ID, modelRevision: MODEL_REVISION };
}
