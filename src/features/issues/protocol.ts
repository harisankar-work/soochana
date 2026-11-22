export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
export const DIMENSIONS = 384;
export const LIMIT = 100;
export const DEFAULT_THRESHOLD = 0.75;

export type Embedding = { id: string; vector: Float32Array };
export type Request = { run: number; records: { id: string; text: string }[] };
export type Event = { run: number } & (
  | { type: "download"; progress?: number }
  | { type: "initialize" | "embed" | "done" | "error" }
  | { type: "result"; id: string; vector: Float32Array }
  | { type: "row-error"; id: string }
);

export function validEmbedding(vector: unknown): vector is Float32Array {
  if (!(vector instanceof Float32Array) || vector.length !== DIMENSIONS) return false;
  const norm = Math.hypot(...vector);
  return Number.isFinite(norm) && Math.abs(norm - 1) <= 0.001;
}
