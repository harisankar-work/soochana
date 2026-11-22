import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { cluster, similarityMatrix } from "../src/features/issues/clustering.ts";
import { DEFAULT_THRESHOLD, validEmbedding } from "../src/features/issues/protocol.ts";

const fixture = JSON.parse(await readFile(new URL("../evaluation/issues-fixture.json", import.meta.url), "utf-8"));
const base = new URL(process.env.VOICELOOP_URL ?? "http://localhost:3000");
const browser = await chromium.launch({ executablePath: process.env.VOICELOOP_CHROMIUM });
try {
  const page = await browser.newPage();
  const unexpected = [];
  const failed = [];
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === base.origin || url.protocol === "blob:") return;
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
  const groupingStarted = performance.now();
  const result = cluster(matrix, DEFAULT_THRESHOLD);
  const clusteringMs = performance.now() - groupingStarted;
  const ids = fixture.map((_, index) => `feedback-row-${index + 2}`);
  const memberships = new Map(result.groups.flatMap((group) => group.feedbackIds.map((id) => [id, group.id])));
  const falseMerges = [], falseSplits = [];
  let correctPairs = 0;
  for (let i = 0; i < fixture.length; i++) {
    for (let j = i + 1; j < fixture.length; j++) {
      const sameTopic = fixture[i][0] === fixture[j][0];
      const sameGroup = memberships.has(ids[i]) && memberships.get(ids[i]) === memberships.get(ids[j]);
      if (sameGroup && sameTopic) correctPairs++;
      if (sameGroup && !sameTopic) falseMerges.push([fixture[i], fixture[j]]);
      if (!sameGroup && sameTopic) falseSplits.push([fixture[i], fixture[j]]);
    }
  }
  const precision = correctPairs / (correctPairs + falseMerges.length || 1);
  const recall = correctPairs / (correctPairs + falseSplits.length || 1);
  const scores = Object.fromEntries(["AB", "CD", "FG", "AF", "CH"].map(([a, b]) => [
    a + b, matrix.scores[matrix.ids.indexOf(ids[a.charCodeAt(0) - 65])][matrix.ids.indexOf(ids[b.charCodeAt(0) - 65])],
  ]));
  console.log(JSON.stringify({
    count: fixture.length, threshold: DEFAULT_THRESHOLD,
    topics: Object.fromEntries([...new Set(fixture.map(([topic]) => topic))].map((topic) => [topic, fixture.filter(([label]) => label === topic).length])),
    scores, precision, recall, f1: 2 * precision * recall / (precision + recall || 1),
    correctPairs, incorrectPairs: falseMerges.length, missedPairs: falseSplits.length,
    groups: result.groups.length, singletons: result.ungrouped.length,
    secondsThroughResults: (groupingStarted - started) / 1000, clusteringMs, falseMerges, falseSplits,
  }, null, 2));
} finally { await browser.close(); }
