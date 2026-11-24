import { manualDiscovery } from "./manual-discovery.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { stageModelAssets } from "./qa-model-assets.mjs";

const examples = JSON.parse(await readFile(new URL("../evaluation/sentiment-fixture.json", import.meta.url), "utf-8"));
const classes = ["Negative", "Neutral", "Positive"];
const base = (process.env.SOOCHANA_URL ?? process.env.VOICELOOP_URL) ?? "http://localhost:3000";
const origin = new URL(base).origin;
const browser = await chromium.launch({ executablePath: (process.env.SOOCHANA_CHROMIUM ?? process.env.VOICELOOP_CHROMIUM) });
let staged;
try {
  const page = await browser.newPage();
  if ((process.env.SOOCHANA_QA_STAGE_MODELS ?? process.env.VOICELOOP_QA_STAGE_MODELS) === "1") staged = await stageModelAssets(page.context());
  const unexpected = [];
  const failed = [];
  const external = new Set();
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin || url.origin === staged?.origin || url.protocol === "blob:") return;
    external.add(url.hostname);
    const allowed = url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
      (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@"));
    if (!allowed || !["GET", "HEAD"].includes(request.method()) || request.postData() ||
      examples.some(([, text]) => decodeURIComponent(request.url()).includes(text))) {
      unexpected.push(`${request.method()} ${url.hostname}`);
    }
  });
  page.context().on("requestfailed", (request) => failed.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`));

  await page.goto(new URL("/feedback", base).href);
  const csv = ["review", ...examples.map(([, text]) => `"${text.replaceAll('"', '""')}"`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-evaluation.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  async function button(name) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  for (const name of ["Review quality", "Preview accepted records", "Continue to confirmation", `Import ${examples.length} feedback records`]) {
    if (name.startsWith("Import ")) await manualDiscovery(page);
    await button(name);
  }
  const started = performance.now();
  await button("Analyse Sentiment");
  await page.getByText(/^(Analysis completed|Analysis incomplete)$/).waitFor({ timeout: 240_000 });
  const panel = page.getByRole("region", { name: "AI Sentiment Analysis" });
  const failure = await panel.getByRole("alert").allTextContents();
  assert.equal(failure.length, 0, [...failure, ...failed].join("\n"));
  assert.deepEqual(unexpected, [], "Unexpected external requests");

  const predictions = new Map();
  const table = panel.getByRole("table", { name: "Sentiment predictions" });
  for (let offset = 0; offset < examples.length; offset += 10) {
    for (const row of await table.locator("tbody tr").all()) {
      const cells = await row.locator("td").allTextContents();
      const index = Number(cells[5]) - 2;
      assert.equal(cells[0], examples[index][1]);
      assert.ok(classes.includes(cells[1]));
      assert.ok(!predictions.has(index));
      predictions.set(index, { label: cells[1], confidence: Number.parseFloat(cells[2]) / 100 });
    }
    if (offset + 10 < examples.length) await panel.getByRole("button", { name: "Next", exact: true }).click();
  }
  assert.equal(predictions.size, examples.length);
  const matrix = classes.map(() => classes.map(() => 0));
  const errors = [];
  for (const [index, [expected, input]] of examples.entries()) {
    const prediction = predictions.get(index);
    matrix[classes.indexOf(expected)][classes.indexOf(prediction.label)] += 1;
    if (expected !== prediction.label) errors.push({ input, expected, ...prediction });
  }
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : 0;
  const metrics = classes.map((label, i) => {
    const support = matrix[i].reduce((sum, count) => sum + count, 0);
    const precision = ratio(matrix[i][i], matrix.reduce((sum, row) => sum + row[i], 0));
    const recall = ratio(matrix[i][i], support);
    return { label, support, precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
  });
  console.log(JSON.stringify({
    count: examples.length, classes, matrix, metrics,
    accuracy: matrix.reduce((sum, row, i) => sum + row[i], 0) / examples.length,
    macroF1: metrics.reduce((sum, row) => sum + row.f1, 0) / classes.length,
    secondsThroughResults: (performance.now() - started) / 1000,
    externalHosts: [...external],
    smoke: examples.slice(0, 5).map(([, input], index) => ({ input, ...predictions.get(index) })),
    errors,
  }, null, 2));
} finally {
  await browser.close();
  await staged?.close();
}
