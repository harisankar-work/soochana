import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../src/features/feedback/csv.ts";
import { suggestMapping, validateRows } from "../src/features/feedback/validation.ts";
import { cluster, similarityMatrix } from "../src/features/issues/clustering.ts";
import { DIMENSIONS, MODEL_REVISION as embeddingRevision, validEmbedding } from "../src/features/issues/protocol.ts";
import { MODEL_REVISION as sentimentRevision, labels, parsePrediction } from "../src/features/sentiment/protocol.ts";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");
const csv = await load("../public/demo/soochana-demo.csv");
const reference = JSON.parse(await load("../evaluation/ground-truth/marketplace-demo.json"));
const prepared = JSON.parse(await load("../public/demo/marketplace-analysis.json"));
const hash = createHash("sha256").update(csv).digest("hex");
assert.equal(hash, reference.csvSha256);
assert.equal(hash, prepared.csvSha256);
assert.equal(prepared.embeddingRevision, embeddingRevision);
assert.equal(prepared.sentimentRevision, sentimentRevision);
const parsed = parseCsv(csv);
const { accepted, issues } = validateRows(parsed, suggestMapping(parsed.headers));
assert.deepEqual(issues, []);
assert.equal(accepted.length, reference.count);
assert.equal(accepted.reduce((sum, row) => sum + row.rating, 0) / accepted.length, reference.averageRating);
const counts = (values) => {
  const classified = new Map();
  for (const value of values) classified.set(value, (classified.get(value) ?? 0) + 1);
  return Object.fromEntries(classified);
};
assert.deepEqual(counts(accepted.map(({ source }) => source)), reference.sources);
assert.deepEqual(counts(accepted.map(({ date }) => date)), reference.dates);
assert.deepEqual(counts(accepted.map(({ category }) => category)), reference.productAreas);
assert.deepEqual(parsed.rows.map(({ cells, originalRow }) => [cells[0], originalRow]), reference.rows.map(({ feedback_id, originalRow }) => [feedback_id, originalRow]));

const packed = Buffer.from(prepared.embeddings, "base64");
assert.equal(packed.length, reference.count * DIMENSIONS * 4);
const embeddings = accepted.map(({ id }, index) => ({
  id, vector: Float32Array.from({ length: DIMENSIONS }, (_, dimension) => packed.readFloatLE((index * DIMENSIONS + dimension) * 4)),
}));
assert.ok(embeddings.every(({ vector }) => validEmbedding(vector)));
assert.equal(prepared.predictions.length, reference.count);
const predictions = accepted.map(({ id }, index) => parsePrediction(id, prepared.predictions[index]));
assert.ok(predictions.every(Boolean));
const confusionMatrix = labels.map((label) => labels.map((predicted) =>
  reference.rows.filter((row, index) => row.sentiment === label && predictions[index].label === predicted).length));
const matrix = similarityMatrix(embeddings);
const topic = new Map(accepted.map(({ id }, i) => [id, reference.rows[i].topic]));
const sentiment = new Map(predictions.map(({ feedbackId, label }) => [feedbackId, label]));
const ratios = (a, b) => b ? a / b : 0;
const grouping = [["complete-link-v1", 0.75], ["average-link-v1", 0.45]].map(([method, cutoff]) => {
  const start = performance.now();
  const { groups, ungrouped } = cluster(matrix, cutoff, method);
  const clusteringMs = performance.now() - start;
  const memberships = new Map(groups.flatMap(({ id, feedbackIds }) => feedbackIds.map((feedbackId) => [feedbackId, id])));
  let correctPairs = 0, falseMerges = 0, falseSplits = 0;
  for (const [index, { id }] of accepted.entries()) {
    for (const { id: other } of accepted.slice(index + 1)) {
      const same = topic.get(id) === topic.get(other);
      const grouped = memberships.has(id) && memberships.get(id) === memberships.get(other);
      if (same && grouped) correctPairs++;
      if (!same && grouped) falseMerges++;
      if (same && !grouped) falseSplits++;
    }
  }
  const precision = ratios(correctPairs, correctPairs + falseMerges), recall = ratios(correctPairs, correctPairs + falseSplits);
  return { method, cutoff, clusteringMs, recurringGroups: groups.length, grouped: memberships.size, unassigned: ungrouped.length,
    potentialIssues: groups.filter(({ feedbackIds }) => feedbackIds.filter((id) => sentiment.get(id) === "Negative").length > feedbackIds.length / 2).length,
    precision, recall, f1: ratios(2 * precision * recall, precision + recall), falseMerges, falseSplits };
});
assert.ok(grouping[1].recurringGroups > 0 && grouping[1].grouped > 0 && grouping[1].unassigned > 0 && grouping[1].potentialIssues > 0);
console.log(JSON.stringify({
  csvSha256: hash, browser: prepared.browser, embeddingRevision, sentimentRevision, accepted: accepted.length,
  averageRating: reference.averageRating, sources: reference.sources, sentiment: counts(predictions.map(({ label }) => label)),
  sentimentLabelOrder: labels, confusionMatrix, grouping,
}, null, 2));
