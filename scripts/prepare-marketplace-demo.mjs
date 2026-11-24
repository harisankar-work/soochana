import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { manualDiscovery } from "./manual-discovery.mjs";
import { MODEL_REVISION as sentimentRevision, parsePrediction } from "../src/features/sentiment/protocol.ts";
import { MODEL_REVISION as embeddingRevision, validEmbedding } from "../src/features/issues/protocol.ts";

const base = process.env.SOOCHANA_URL ?? "http://127.0.0.1:3000";
const csv = await readFile(new URL("../public/demo/soochana-demo.csv", import.meta.url));
const reference = JSON.parse(await readFile(new URL("../evaluation/ground-truth/marketplace-demo.json", import.meta.url)));
const csvSha256 = createHash("sha256").update(csv).digest("hex");
assert.equal(csvSha256, reference.csvSha256);
const browser = await chromium.launch({ executablePath: process.env.SOOCHANA_CHROMIUM });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.demoPreparation = [];
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "result") {
            window.demoPreparation.push(data.vector ? { id: data.id, vector: Array.from(data.vector) } : { id: data.id, scores: data.scores });
          }
        });
      }
    };
  });
  await page.goto(new URL("/feedback", base).href);
  await page.locator('input[type=file]').setInputFiles({ name: "marketplace-artifact-input.csv", mimeType: "text/csv", buffer: csv });
  const button = (name) => page.getByRole("button", { name, exact: true });
  for (const step of ["Review quality", "Preview accepted records", "Continue to confirmation"]) await button(step).click();
  await manualDiscovery(page);
  await button("Import 100 feedback records").click();
  await button("Analyse Sentiment").click();
  await page.getByText("Analysis completed", { exact: true }).waitFor({ timeout: 180000 });
  await page.getByRole("navigation").getByRole("link", { name: "Issue Explorer" }).click();
  await button("Discover Feedback Groups").click();
  await page.getByText("Embedding run finished", { exact: true }).waitFor({ timeout: 180000 });

  const events = await page.evaluate(() => window.demoPreparation);
  const predictions = new Map(events.filter(({ scores }) => scores).map(({ id, scores }) => {
    assert.ok(parsePrediction(id, scores));
    return [id, scores];
  }));
  const embeddings = new Map(events.filter(({ vector }) => vector).map(({ id, vector }) => {
    const values = Float32Array.from(vector);
    assert.ok(validEmbedding(values));
    return [id, values];
  }));
  assert.equal(predictions.size, reference.count);
  assert.equal(embeddings.size, reference.count);
  const bytes = Buffer.alloc(reference.count * 384 * 4);
  for (let index = 0; index < reference.count; index++) {
    const id = `feedback-row-${index + 2}`;
    embeddings.get(id).forEach((value, dimension) => bytes.writeFloatLE(value, (index * 384 + dimension) * 4));
  }
  await writeFile(new URL("../public/demo/marketplace-analysis.json", import.meta.url), JSON.stringify({
    schema: 1, csvSha256, browser: browser.version(), sentimentRevision, embeddingRevision,
    predictions: reference.rows.map(({ originalRow }) => predictions.get(`feedback-row-${originalRow}`)),
    embeddings: bytes.toString("base64"),
  }) + "\n");
  console.log(`Prepared ${predictions.size} real sentiment predictions and ${embeddings.size} real embeddings using Chromium ${browser.version()}.`);
} finally {
  await browser.close();
}
