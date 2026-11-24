import { manualDiscovery } from "./manual-discovery.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { labels, parsePrediction, MODEL_REVISION as sentimentRevision } from "../src/features/sentiment/protocol.ts";
import { validEmbedding, MODEL_REVISION as embeddingRevision } from "../src/features/issues/protocol.ts";
import { cluster, similarityMatrix } from "../src/features/issues/clustering.ts";
import { loadDataset } from "./evaluate-datasets.mjs";

const [output, revision, baselinePath, publicDirectory] = process.argv.slice(2);
assert.ok(output && revision, "Provide the output JSON path and the revision being served.");
const base = new URL(process.env.SOOCHANA_URL ?? "http://127.0.0.1:3141");
const nodeModules = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
const fixtures = ["tiny-10", "small-25", "medium-50", "benchmark-100"];
const reuseOnly = baselinePath === "--reuse";
const publicOnly = baselinePath === "--public-sentiment";
assert.ok(!publicOnly || publicDirectory, "Provide the directory populated by evaluate-datasets-public.py.");
const baseline = baselinePath && !reuseOnly && !publicOnly ? JSON.parse(await readFile(baselinePath)) : null;
const publicFixture = publicOnly ? {
  csv: await readFile(join(publicDirectory, "public-amazon-24.csv"), "utf8"),
  ...JSON.parse(await readFile(join(publicDirectory, "public-amazon-24.reference.json"), "utf8")),
} : null;
if (publicFixture) {
  assert.equal(publicFixture.records.length, 24);
  for (const label of ["Negative", "Positive"]) {
    assert.equal(publicFixture.records.filter(({ sentiment }) => sentiment === label).length, 12);
  }
}
const divide = (a, b) => b ? a / b : 0;
const f1 = (p, r) => divide(2 * p * r, p + r);
const summarize = (matrix, observedClassesOnly) => {
  const perClass = labels.map((label, i) => {
    const support = matrix[i].reduce((a, b) => a + b);
    const precision = divide(matrix[i][i], matrix.reduce((sum, row) => sum + row[i], 0));
    const recall = divide(matrix[i][i], support);
    return { label, support, precision, recall, f1: f1(precision, recall) };
  });
  const macroClasses = observedClassesOnly ? perClass.filter(({ support }) => support > 0) : perClass;
  const macro = (metric) => macroClasses.reduce((sum, row) => sum + row[metric], 0) / macroClasses.length;
  return { accuracy: divide(matrix.reduce((sum, row, i) => sum + row[i], 0), perClass.reduce((sum, row) => sum + row.support, 0)),
    macroPrecision: macro("precision"), macroRecall: macro("recall"), macroF1: macro("f1"), confusionMatrix: matrix, perClass };
};

function sentimentQuality(records, events, observedClassesOnly) {
  const byId = new Map(events.map(({ id, scores }) => [id, parsePrediction(id, scores)]));
  const matrix = labels.map(() => labels.map(() => 0));
  const errors = [], predictions = [];
  for (const { id, sentiment, originalRow, sourceId } of records) {
    const actual = byId.get(`feedback-row-${originalRow}`);
    assert.ok(actual, `Missing sentiment for ${id}`);
    const prediction = { id, ...(sourceId ? { sourceId } : {}), expected: sentiment, actual: actual.label, confidence: actual.confidence };
    predictions.push(prediction);
    if (!labels.includes(sentiment)) continue;
    matrix[labels.indexOf(sentiment)][labels.indexOf(actual.label)]++;
    if (sentiment !== actual.label) errors.push(prediction);
  }
  return { ...summarize(matrix, observedClassesOnly), errors, predictions };
}

function embeddingQuality(records, events, prior) {
  const byId = new Map(events.map(({ id, vector }) => [id, Float32Array.from(vector)]));
  const embeddings = records.map(({ id, originalRow }) => ({ id, vector: byId.get(`feedback-row-${originalRow}`) }));
  assert.ok(embeddings.every(({ vector }) => validEmbedding(vector)));
  const started = performance.now();
  const matrix = similarityMatrix(embeddings);
  const matrixMs = performance.now() - started;
  const specs = new Map(records.map((r) => [r.id, r]));
  const pairs = [], earlier = new Map((prior?.similarities ?? []).map(({ left, right, score }) => [`${left}/${right}`, score]));
  for (let i = 0; i < matrix.ids.length; i++) {
    for (let j = i + 1; j < matrix.ids.length; j++) {
      const left = matrix.ids[i], right = matrix.ids[j];
      const first = specs.get(left).topic, second = specs.get(right).topic;
      if (!first || !second) continue;
      pairs.push({ left, right, sameTopic: first === second, score: matrix.scores[i][j] });
    }
  }
  const configurations = [["complete-link-v1", 0.75], ["average-link-v1", 0.45]].map(([method, cutoff]) => {
    const start = performance.now();
    const result = cluster(matrix, cutoff, method);
    const clusteringMs = performance.now() - start;
    const member = new Map(result.groups.flatMap(({ id, feedbackIds }) => feedbackIds.map((row) => [row, id])));
    let correct = 0;
    const falseMerges = [], falseSplits = [];
    for (const pair of pairs) {
      const grouped = member.has(pair.left) && member.get(pair.left) === member.get(pair.right);
      if (grouped && pair.sameTopic) correct++;
      if (grouped && !pair.sameTopic) falseMerges.push(pair);
      if (!grouped && pair.sameTopic) falseSplits.push(pair);
    }
    const precision = divide(correct, correct + falseMerges.length), recall = divide(correct, correct + falseSplits.length);
    return { method, cutoff, precision, recall, f1: f1(precision, recall), correct, falseMerges, falseSplits,
      groups: result.groups, ungrouped: result.ungrouped, coverage: member.size / records.length, clusteringMs };
  });
  const diffs = pairs.flatMap(({ left, right, score }) => {
    const value = earlier.get(`${left}/${right}`);
    return value === undefined ? [] : [Math.abs(score - value)];
  });
  return { matrixMs, configurations, similarities: pairs, maxCosineDrift: diffs.length ? Math.max(...diffs) : null };
}

async function evaluate(model, names) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const requests = [], problems = [];
    let assetRequests = 0;
    let inputTexts = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "blob:") return;
      const asset = url.protocol === "https:" && (url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
        (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@")));
      if (asset) assetRequests++;
      if ((url.origin !== base.origin && !asset) || !["GET", "HEAD"].includes(request.method()) || request.postData() || inputTexts.some((text) => url.href.includes(encodeURIComponent(text)))) {
        requests.push(`${request.method()} ${url.origin}`);
      }
    });
    context.on("requestfailed", (request) => problems.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));
    page.on("pageerror", (error) => problems.push(error.message));
    await page.addInitScript(() => {
      window.qaEvents = [];
      const Worker = window.Worker;
      window.Worker = class extends Worker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => window.qaEvents.push({
            ...data, vector: data.vector ? Array.from(data.vector) : undefined, time: performance.now(),
          }));
        }
      };
    });
    const rows = [];
    for (const [index, name] of names.entries()) {
      const fixture = publicOnly ? publicFixture : await loadDataset(name);
      const records = fixture.records.filter(({ outcome }) => outcome !== "Excluded");
      inputTexts = records.map(({ originalText }) => originalText.trim()).filter((text) => text.length >= 8);
      await page.goto(new URL("/feedback", base).href);
      const button = (name) => page.getByRole("button", { name, exact: true });
      const importStarted = performance.now();
      await page.locator('input[type="file"]').setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(fixture.csv) });
      for (const step of ["Review quality", "Preview accepted records", "Continue to confirmation", `Import ${records.length} feedback records`]) {
        if (step.startsWith("Import ") || step.startsWith("Replace dataset and import ")) await manualDiscovery(page);
        await button(step).click();
      }
      await page.getByRole("heading", { name: "Imported dataset" }).waitFor();
      const importMs = performance.now() - importStarted;
      if (model === "embeddings") await page.getByRole("navigation").getByRole("link", { name: "Issue Explorer" }).click();
      const before = assetRequests;
      const started = performance.now();
      await button(model === "embeddings" ? "Discover Feedback Groups" : "Analyse Sentiment").click();
      const outcome = page.getByText(/^(Embedding run finished|Analysis could not finish|Analysis completed|Analysis incomplete)$/);
      await outcome.waitFor({ timeout: 180_000 });
      const totalMs = performance.now() - started;
      const events = await page.evaluate(() => window.qaEvents);
      const valid = events.filter(({ type }) => type === "result");
      assert.equal(valid.length, records.length, problems.join("\n"));
      if (index > 0) assert.equal(assetRequests, before, "Warm model requested remote assets");
      const phase = events.find(({ type }) => type === "embed" || type === "analyse");
      const download = events.find(({ type }) => type === "download");
      const done = events.find(({ type }) => type === "done");
      const prior = baseline?.runs.find((r) => r.model === model && r.dataset === name)?.quality;
      const quality = model === "sentiment" ? sentimentQuality(records, valid, publicOnly) : embeddingQuality(records, valid, prior);
      rows.push({ dataset: name, model, accepted: records.length, rejected: fixture.records.length - records.length,
        cache: index ? "warm artifacts, fresh worker" : "cold fresh context", importMs, totalMs,
        loadInitMs: phase.time - download.time, inferenceMs: done.time - phase.time,
        assetRequests: assetRequests - before, quality });
      console.error(`${model} ${name}: ${Math.round(totalMs)} ms, ${records.length} outputs`);
      if (reuseOnly) {
        assert.equal(model, "embeddings");
        const reuse = [];
        for (const count of [25, 50, 100, 100]) {
          await page.getByRole("spinbutton", { name: "Records to analyse" }).fill(String(count));
          const before = await page.evaluate(() => window.qaEvents.length);
          const start = performance.now();
          await button("Discover Feedback Groups").click();
          await page.getByText(`${count} selected · ${count} embedded · 0 failed · ${records.length - count} unanalysed in dataset`, { exact: true }).waitFor({ timeout: 180_000 });
          const elapsedMs = performance.now() - start;
          const fresh = await page.evaluate((offset) => window.qaEvents.slice(offset), before);
          reuse.push({ count, elapsedMs, freshEmbeddings: fresh.filter(({ type }) => type === "result").length,
            initializedModel: fresh.some(({ type }) => type === "download") });
        }
        rows.at(-1).sameDatasetReruns = reuse;
      }
    }
    assert.deepEqual(requests, []);
    assert.deepEqual(problems, []);
    return rows;
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: process.env.SOOCHANA_CHROMIUM });
const started = performance.now();
try {
  const runs = [];
  if (publicOnly) runs.push(...await evaluate("sentiment", ["public-amazon-24"]));
  else if (reuseOnly) runs.push(...await evaluate("embeddings", ["benchmark-100"]));
  else for (const model of ["sentiment", "embeddings"]) runs.push(...await evaluate(model, fixtures));
  await writeFile(output, JSON.stringify({
    revision, backend: "single-threaded ONNX Runtime WASM (q8)", browser: browser.version(),
    runtime: nodeModules.packages["node_modules/onnxruntime-web"].version,
    transformers: nodeModules.packages["node_modules/@huggingface/transformers"].version,
    os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, node: process.version,
    hostMemoryBytes: totalmem(), peakMemory: null,
    revisions: { sentiment: sentimentRevision, embeddings: embeddingRevision },
    ...(publicFixture ? { provenance: {
      dataset: publicFixture.dataset, archiveSha256: publicFixture.archiveSha256,
      license: publicFixture.license, annotation: publicFixture.annotation,
      macroClasses: ["Negative", "Positive"],
    } } : {}),
    totalMs: performance.now() - started, runs,
  }) + "\n");
} finally {
  await browser.close();
}
