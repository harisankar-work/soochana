import { manualDiscovery } from "./manual-discovery.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { stageModelAssets } from "./qa-model-assets.mjs";
import { cluster, METHODS, similarityMatrix } from "../src/features/issues/clustering.ts";
import { validEmbedding } from "../src/features/issues/protocol.ts";

const [mode = "baseline", method, rawCutoff] = process.argv.slice(2);
const cutoff = Number(rawCutoff);
const lexicalWeight = Number(process.env.SOOCHANA_LEXICAL_WEIGHT ?? 0);
assert.ok(Number.isFinite(lexicalWeight) && lexicalWeight >= 0 && lexicalWeight <= 0.3, "Lexical weight must be between 0 and 0.3.");
assert.ok(["baseline", "development", "holdout"].includes(mode), "Choose baseline, development or holdout.");
if (mode === "holdout") {
  assert.ok(METHODS.includes(method) && Number.isFinite(cutoff) && cutoff >= 0.4 && cutoff <= 0.85,
    "Holdout requires a fixed method and cutoff chosen on development.");
}
const loadFixture = async (name) => JSON.parse(await readFile(new URL(`../evaluation/${name}.json`, import.meta.url), "utf-8"));
const fixture = mode === "holdout" ? await loadFixture("issues-holdout") : await loadFixture("issues-fixture");
if (mode === "development") fixture.push(...await loadFixture("issues-development-additions"));
const base = new URL((process.env.SOOCHANA_URL ?? process.env.VOICELOOP_URL) ?? "http://localhost:3000");
const browser = await chromium.launch({ executablePath: (process.env.SOOCHANA_CHROMIUM ?? process.env.VOICELOOP_CHROMIUM) });
let staged;
try {
  const page = await browser.newPage();
  if ((process.env.SOOCHANA_QA_STAGE_MODELS ?? process.env.VOICELOOP_QA_STAGE_MODELS) === "1") staged = await stageModelAssets(page.context());
  const unexpected = [];
  const failed = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin || url.origin === staged?.origin || url.protocol === "blob:") return;
    const assetHost = url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
      (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@"));
    if (!assetHost || !["GET", "HEAD"].includes(request.method()) || request.postData() ||
      fixture.some(([, text]) => request.url().includes(encodeURIComponent(text)))) unexpected.push(url.hostname);
  });
  page.context().on("requestfailed", (request) => failed.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));
  // Observe real worker output without replacing the application model or inference code.
  await page.addInitScript(() => {
    window.evaluationVectors = [];
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "result" && data.vector instanceof Float32Array) {
            window.evaluationVectors.push({ id: data.id, vector: Array.from(data.vector) });
          }
        });
      }
    };
  });
  await page.goto(new URL("/feedback", base).href);
  const csv = ["review", ...fixture.map(([, text]) => `"${text.replaceAll('"', '""')}"`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "synthetic-issues.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  for (const name of ["Review quality", "Preview accepted records", "Continue to confirmation", `Import ${fixture.length} feedback records`]) {
    if (name.startsWith("Import ")) await manualDiscovery(page);
    await page.getByRole("button", { name, exact: true }).click();
  }
  await page.getByRole("navigation").getByRole("link", { name: "Issue Explorer" }).click();
  const started = performance.now();
  await page.getByRole("button", { name: "Discover Feedback Groups" }).click();
  await page.getByText(/^(Embedding run finished|Analysis could not finish)$/).waitFor({ timeout: 240_000 });
  assert.equal(await page.getByRole("alert").filter({ hasText: /retry discovery/i }).count(), 0, failed.join("\n"));
  assert.deepEqual(unexpected, []);
  const browserVectors = await page.evaluate(() => window.evaluationVectors);
  const embeddings = browserVectors.map(({ id, vector }) => ({ id, vector: Float32Array.from(vector) }));
  assert.equal(embeddings.length, fixture.length);
  assert.ok(embeddings.every(({ vector }) => validEmbedding(vector)));

  const matrix = similarityMatrix(embeddings);
  const secondsThroughEmbeddings = (performance.now() - started) / 1000;
  const ids = fixture.map((_, index) => `feedback-row-${index + 2}`);
  const indexById = new Map(matrix.ids.map((id, index) => [id, index]));
  const clusteringMatrix = lexicalWeight === 0 ? matrix : {
    ids: matrix.ids,
    scores: matrix.scores.map((row) => row.slice()),
  };
  if (lexicalWeight > 0) {
    const words = new Map(fixture.map(([, text], index) => [ids[index], new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]));
    for (let i = 0; i < matrix.ids.length; i++) {
      for (let j = i + 1; j < matrix.ids.length; j++) {
        const first = words.get(matrix.ids[i]), second = words.get(matrix.ids[j]);
        const overlap = [...first].filter((word) => second.has(word)).length;
        const lexical = first.size + second.size ? 2 * overlap / (first.size + second.size) : 0;
        const score = (1 - lexicalWeight) * matrix.scores[i][j] + lexicalWeight * lexical;
        clusteringMatrix.scores[i][j] = clusteringMatrix.scores[j][i] = score;
      }
    }
  }
  const pairs = [];
  for (let i = 0; i < fixture.length; i++) {
    for (let j = i + 1; j < fixture.length; j++) {
      pairs.push({
        i, j, sameTopic: fixture[i][0] === fixture[j][0],
        score: clusteringMatrix.scores[indexById.get(ids[i])][indexById.get(ids[j])],
      });
    }
  }

  function evaluate(strategy, threshold, includeErrors) {
    const start = performance.now();
    const result = cluster(clusteringMatrix, threshold, strategy);
    const clusteringMs = performance.now() - start;
    const memberships = new Map(result.groups.flatMap((group) => group.feedbackIds.map((id) => [id, group.id])));
    const falseMerges = [], falseSplits = [];
    let correctPairs = 0;
    for (const { i, j, sameTopic, score } of pairs) {
      const sameGroup = memberships.has(ids[i]) && memberships.get(ids[i]) === memberships.get(ids[j]);
      if (sameGroup && sameTopic) correctPairs++;
      if (sameGroup && !sameTopic) falseMerges.push({ rows: [i + 2, j + 2], score });
      if (!sameGroup && sameTopic) falseSplits.push({ rows: [i + 2, j + 2], score });
    }
    const precision = correctPairs / (correctPairs + falseMerges.length || 1);
    const recall = correctPairs / (correctPairs + falseSplits.length || 1);
    return {
      strategy, threshold, precision, recall, f1: 2 * precision * recall / (precision + recall || 1),
      correctPairs, incorrectPairs: falseMerges.length, missedPairs: falseSplits.length,
      groups: result.groups.length, singletons: result.ungrouped.length,
      largestGroup: Math.max(0, ...result.groups.map((group) => group.feedbackIds.length)),
      averageCohesion: result.groups.length ? result.groups.reduce((sum, group) => sum + group.cohesion, 0) / result.groups.length : null,
      clusteringMs, ...(includeErrors ? { falseMerges, falseSplits } : {}),
    };
  }

  function distribution(sameTopic) {
    const values = pairs.filter((pair) => pair.sameTopic === sameTopic).map(({ score }) => score).sort((a, b) => a - b);
    return {
      count: values.length, min: values[0], p25: values[Math.floor((values.length - 1) * 0.25)],
      median: values[Math.floor((values.length - 1) * 0.5)], p75: values[Math.floor((values.length - 1) * 0.75)],
      max: values.at(-1),
    };
  }

  const thresholds = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
  const configurations = mode === "development"
    ? METHODS.flatMap((strategy) => thresholds.map((threshold) => evaluate(strategy, threshold, false)))
    : [evaluate("complete-link-v1", 0.75, true)];
  if (method && mode !== "development") configurations.push(evaluate(method, cutoff, true));
  const eligible = configurations.filter((configuration) => configuration.precision >= 0.8);
  eligible.sort((a, b) => b.f1 - a.f1 || b.precision - a.precision || b.threshold - a.threshold);
  const selected = eligible[0];
  console.log(JSON.stringify({
    mode, lexicalWeight, count: fixture.length, secondsThroughEmbeddings,
    distribution: { sameTopic: distribution(true), differentTopic: distribution(false) },
    configurations,
    ...(mode === "development" && selected ? { selected: evaluate(selected.strategy, selected.threshold, true) } : {}),
  }, null, 2));
} finally {
  await browser.close();
  await staged?.close();
}
