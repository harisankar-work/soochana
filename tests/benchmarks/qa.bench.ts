// @vitest-environment node
import { test, type BenchResult } from "vitest";
import { parseCsv } from "@/features/feedback/csv";
import { suggestMapping, validateRows } from "@/features/feedback/validation";
import { makeRows, summarize, volumeTrend } from "@/features/analytics/calculations";
import { cluster, similarityMatrix } from "@/features/issues/clustering";
import { newCandidate } from "@/features/prioritization/candidates";
import { defaults, rank } from "@/features/prioritization/scoring";

function report(scope: string, results: BenchResult[]) {
  for (const result of results) {
    console.log(JSON.stringify({ scope, name: result.name, meanMs: result.latency.mean, medianMs: result.latency.p50 }));
  }
}

for (const size of [10, 100, 1_000, 10_000]) {
  const csv = "review,source,date,rating\n" + Array.from({ length: size }, (_, i) =>
    `Synthetic review ${i} ${"x".repeat(440)},Source ${i % 8},2026-11-20,4.5`).join("\n");
  const parsed = parseCsv(csv);
  const mapping = suggestMapping(parsed.headers);
  const records = validateRows(parsed, mapping).accepted;
  test(`${size} records`, async ({ bench }) => {
    report(String(size), [
      await bench("parse CSV", () => { parseCsv(csv); }).run(),
      await bench("validate rows", () => { validateRows(parsed, mapping); }).run(),
      await bench("aggregate dashboard", () => {
        const rows = makeRows(records, []);
        summarize(rows);
        volumeTrend(rows);
      }).run(),
    ]);
  });
}

const vectors = Array.from({ length: 100 }, (_, index) => {
  const vector = new Float32Array(384);
  for (let dimension = 0; dimension < vector.length; dimension++) vector[dimension] = Math.sin(index * 0.17 + dimension * 0.39);
  return { id: String(index), vector };
});
const matrix = similarityMatrix(vectors);
const candidates = Array.from({ length: 100 }, (_, index) => ({
  candidate: { ...newCandidate(String(index)), severity: 5 as const, impact: 3 as const, confidence: 4 as const },
  count: index % 20 + 1, missing: 0,
}));
test("bounded calculations", async ({ bench }) => {
  report("100 inputs", [
    await bench("similarity matrix", () => { similarityMatrix(vectors); }).run(),
    await bench("complete-link cutoff recalculation", () => { cluster(matrix, 0.75); }).run(),
    await bench("rank candidates", () => { rank(candidates, defaults); }).run(),
  ]);
});
