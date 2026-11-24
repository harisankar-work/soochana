import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseCsv } from "@/features/feedback/csv";
import { suggestMapping, validateRows } from "@/features/feedback/validation";
import { illustrateMarketplaceIssues, marketplaceCutoff, marketplaceMethod, withMarketplaceMetadata } from "@/features/demo/marketplace";
import { cluster, similarityMatrix } from "@/features/issues/clustering";
import { DIMENSIONS, MODEL_REVISION, validEmbedding } from "@/features/issues/protocol";
import { suggestions } from "@/features/prioritization/issue-state";
import { defaults, rank } from "@/features/prioritization/scoring";

it("binds prepared real model outputs to the CSV and only illustrates evidence-backed scores", () => {
  const csv = readFileSync("public/demo/soochana-demo.csv", "utf8");
  const asset = JSON.parse(readFileSync("public/demo/marketplace-analysis.json", "utf8"));
  const reference = JSON.parse(readFileSync("evaluation/ground-truth/marketplace-demo.json", "utf8"));
  const hash = createHash("sha256").update(csv).digest("hex");
  expect(hash).toBe(reference.csvSha256);
  expect(hash).toBe(asset.csvSha256);
  expect(asset.embeddingRevision).toBe(MODEL_REVISION);
  const parsed = parseCsv(csv);
  const { accepted, issues } = validateRows(parsed, suggestMapping(parsed.headers));
  expect(issues).toEqual([]);
  const records = withMarketplaceMetadata(parsed, accepted);
  expect(records).toHaveLength(100);
  expect(records.map(({ marketplace }) => marketplace?.feedbackId)).toEqual(reference.rows.map(({ feedback_id }: { feedback_id: string }) => feedback_id));
  expect(records.reduce((sum, { rating }) => sum + (rating ?? 0), 0) / records.length).toBe(reference.averageRating);
  const packed = Buffer.from(asset.embeddings, "base64");
  expect(packed.length).toBe(records.length * DIMENSIONS * 4);
  const vectors = records.map(({ id }, index) => ({
    id, vector: Float32Array.from({ length: DIMENSIONS }, (_, dimension) => packed.readFloatLE((index * DIMENSIONS + dimension) * 4)),
  }));
  expect(vectors.every(({ vector }) => validEmbedding(vector))).toBe(true);
  const result = cluster(similarityMatrix(vectors), marketplaceCutoff, marketplaceMethod);
  expect(result.groups.length).toBeGreaterThan(0);
  expect(result.ungrouped.length).toBeGreaterThan(0);
  const raw = suggestions({ groups: result.groups, method: marketplaceMethod, threshold: marketplaceCutoff, populationIds: records.map(({ id }) => id) }, records);
  expect(raw.every(({ severity }) => severity === null)).toBe(true);
  const demo = illustrateMarketplaceIssues(raw, records);
  const ranked = rank(demo.map((candidate) => ({ candidate, count: candidate.evidenceIds.length, missing: 0 })), defaults);
  expect(ranked.length).toBeGreaterThanOrEqual(2);
  expect(ranked.length).toBeLessThan(demo.length);
  expect(demo.some(({ illustrative, review }) => illustrative && review === "Reviewed")).toBe(true);
  for (const { id, count, result } of ranked) {
    const candidate = demo.find((issue) => issue.id === id)!;
    expect(candidate.illustrative).toBe(true);
    expect(candidate.evidenceIds).toEqual(raw.find((issue) => issue.id === id)?.evidenceIds);
    expect(result.total).toBeCloseTo(Math.min(count, 20) * 1.5 + (candidate.severity! - 1) * 7.5 +
      (candidate.impact! - 1) * 6.25 + (candidate.confidence! - 1) * 3.75);
  }
});
