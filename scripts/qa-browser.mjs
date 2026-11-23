import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const base = new URL((process.env.SOOCHANA_URL ?? process.env.VOICELOOP_URL) ?? "http://localhost:3000");
const mode = process.argv[2] ?? "smoke";
assert.ok(["smoke", "cold", "benchmark"].includes(mode), "Choose smoke, cold, or benchmark.");
const browser = await chromium.launch({ executablePath: (process.env.SOOCHANA_CHROMIUM ?? process.env.VOICELOOP_CHROMIUM) });

function controls(page) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = (name) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
  const text = (value) => page.getByText(value, { exact: true }).waitFor();
  async function select(csv, name = "synthetic.csv") {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  }
  async function importCsv(csv, count, replacement = false) {
    await select(csv);
    for (const label of ["Review quality", "Preview accepted records", "Continue to confirmation",
      `${replacement ? "Replace dataset and import" : "Import"} ${count} feedback ${count === 1 ? "record" : "records"}`]) await button(label).click();
  }
  return { button, nav, text, select, importCsv };
}

const modelHosts = (url) => url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
  (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@"));
const reviews = ["Checkout crashes whenever I pay.", "The checkout crashes every time I pay.", "The delivery was excellent."];

async function cold() {
  const outcomes = [];
  for (const route of ["sentiment", "embeddings"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { button, nav, importCsv } = controls(page);
    const requests = [], failures = [], statuses = [], sizes = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (modelHosts(url)) requests.push({ host: url.hostname, file: url.pathname.split("/").at(-1), method: request.method() });
    });
    context.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (modelHosts(url)) failures.push({ host: url.hostname, error: request.failure()?.errorText });
    });
    context.on("response", (response) => {
      const url = new URL(response.url());
      if (modelHosts(url)) statuses.push(response.status());
    });
    context.on("requestfinished", (request) => {
      if (modelHosts(new URL(request.url()))) sizes.push(request.sizes().then(({ responseBodySize }) => Math.max(0, responseBodySize), () => 0));
    });
    await page.goto(new URL("/feedback", base).href);
    await importCsv(`review\n${reviews.join("\n")}`, 3);
    if (route === "embeddings") await nav("Issue Explorer");
    const start = performance.now();
    await button(route === "sentiment" ? "Analyse Sentiment" : "Discover Feedback Groups").click();
    const status = page.getByText(/^(Analysis completed|Analysis incomplete|Embedding run finished|Analysis could not finish)$/);
    await status.waitFor({ timeout: 240_000 });
    const outcome = await status.innerText();
    const outcomeSeconds = (performance.now() - start) / 1000;
    const resultVisible = route === "sentiment"
      ? await page.getByRole("table", { name: "Sentiment predictions" }).isVisible()
      : await page.getByRole("region", { name: "Feedback groups", exact: true }).isVisible();
    outcomes.push({
      model: route, outcome, inference: resultVisible, seconds: outcomeSeconds, requests, statuses, failures,
      responseBytes: (await Promise.all(sizes)).reduce((sum, value) => sum + value, 0),
    });
    await context.close();
  }
  console.log(JSON.stringify({ mode, browser: browser.version(), outcomes }, null, 2));
  if (outcomes.some(({ inference }) => !inference)) process.exitCode = 1;
}

async function benchmark() {
  const page = await browser.newPage();
  const { button, nav, text } = controls(page);
  await page.addInitScript(() => {
    window.qaLongTasks = [];
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => window.qaLongTasks.push(...list.getEntries().map(({ duration }) => duration))).observe({ type: "longtask" });
    }
  });
  const directory = await mkdtemp(join(tmpdir(), "soochana-csv-qa-"));
  const file = join(directory, "synthetic.csv");
  const results = [];
  try {
    for (const count of [10, 100, 1_000, 10_000]) {
      const csv = "review,source,date,rating\n" + Array.from({ length: count }, (_, i) =>
        `Synthetic review ${i} ${"x".repeat(440)},Source ${i % 8},2026-11-20,4.5`).join("\n");
      await page.goto(new URL("/feedback", base).href);
      await writeFile(file, csv);
      const start = performance.now();
      await page.locator('input[type="file"]').setInputFiles(file);
      await page.getByRole("heading", { name: "Map Columns" }).waitFor();
      const parseAndMappingMs = performance.now() - start;
      const validation = performance.now();
      await button("Review quality").click();
      await page.getByRole("heading", { name: "Review Quality" }).waitFor();
      const validationAndRenderMs = performance.now() - validation;
      await button("Preview accepted records").click();
      const search = performance.now();
      await page.getByRole("searchbox", { name: "Search feedback" }).fill("does not occur");
      await text(`0 matching · ${count} accepted records`);
      const searchMs = performance.now() - search;
      await button("Continue to confirmation").click();
      await button(`Import ${count} feedback records`).click();
      const dashboard = performance.now();
      await nav("Dashboard");
      await text(`${count} of ${count} reviews in this view · All feedback`);
      const dashboardMs = performance.now() - dashboard;
      const evidence = page.getByRole("region", { name: "Review evidence", exact: true });
      let paginationMs = null;
      if (count > 20) {
        const start = performance.now();
        await evidence.getByRole("button", { name: "Next", exact: true }).click();
        await evidence.getByText(`Page 2 of ${Math.ceil(count / 20)}`, { exact: true }).waitFor();
        paginationMs = performance.now() - start;
      }
      const measurement = await page.evaluate(() => ({ longTasksMs: window.qaLongTasks, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null }));
      results.push({ count, bytes: Buffer.byteLength(csv), parseAndMappingMs, validationAndRenderMs, searchMs, dashboardMs, paginationMs, ...measurement });
    }
    console.log(JSON.stringify({ mode, browser: browser.version(), results }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function smoke() {
  const page = await browser.newPage();
  const { button, nav, importCsv, select, text } = controls(page);
  const errors = [], external = [], violations = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.context().on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin || !["GET", "HEAD"].includes(request.method()) || request.postData()) external.push(url.origin);
  });

  async function audit(width, state) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}px in ${state}`);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const findings = await page.evaluate(async () => {
      const result = await window.axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
      return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(({ target }) => target) }));
    });
    if (findings.length) violations.push({ width, state, findings });
  }

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(base.href);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.id), "main-content");
    await audit(width, "empty dashboard");
    await nav("Feedback Analysis");
    const csv = "review,date,source,rating\r\n" +
      "Checkout is broken,2026-10-01,App Store,1.5\r\n" +
      '“Delivery was fast”,2026-10-02,Support,4.5\r\n' +
      '"<script>window.qaUnexpected = true</script>",2026-10-03,Support,3';
    await select("review\n", "invalid.csv");
    await page.getByRole("alert").filter({ hasText: /headers but no feedback rows/ }).waitFor();
    await select("review\n", "invalid.csv");
    await page.getByRole("alert").filter({ hasText: /headers but no feedback rows/ }).waitFor();
    await audit(width, "import error");
    await importCsv(csv, 3);
    await nav("Dashboard");
    await text("3 of 3 reviews in this view · All feedback");
    await text("3.00 / 5");
    await page.getByRole("button", { name: "Support 2" }).press("Enter");
    await text("2 supporting reviews");
    assert.equal(await page.evaluate(() => window.qaUnexpected), undefined);
    assert.equal(await page.getByRole("cell", { name: "<script>window.qaUnexpected = true</script>" }).count(), 1);
    await audit(width, "populated dashboard and evidence");
    await nav("Prioritization");
    await button("Add Manual Issue").press("Enter");
    await page.getByRole("textbox", { name: "Issue title" }).fill("Checkout issue");
    await page.getByRole("checkbox", { name: "Include CSV row 2" }).press("Space");
    for (const [name, value] of [["Severity", "5"], ["Business impact", "2"], ["Evidence confidence", "3"]]) {
      await page.getByRole("combobox", { name, exact: true }).selectOption(value);
    }
    await audit(width, "candidate editor");
    await button("Save issue").click();
    await text("45.25 / 100");
    await audit(width, "scored candidate");
    await button("Remove issue").click();
    await button("Keep issue").click();
    await nav("Dashboard");
    await nav("Prioritization");
    await page.getByRole("button", { name: "View Checkout issue" }).waitFor();
    await nav("Feedback Analysis");
    await button("Replace dataset").click();
    await importCsv("review\nReplacement", 1, true);
    await nav("Prioritization");
    await text("0 candidates · 0 scored · 0 unscored · 0 distinct supporting reviews");
    await nav("Feedback Analysis");
    await button("Remove dataset").click();
    await button("Confirm removal").click();
    await nav("Dashboard");
    await page.getByRole("link", { name: "Upload Feedback" }).waitFor();
    await nav("Feedback Analysis");
    await importCsv("review\nTemporary", 1);
    await page.reload();
    await page.getByRole("button", { name: "Browse CSV" }).waitFor();
    assert.deepEqual(await page.evaluate(async () =>
      [localStorage.length, sessionStorage.length, (await indexedDB.databases()).length, (await caches.keys()).length]), [0, 0, 0, 0]);
    console.log(`${width}px functional checks passed`);
  }
  console.log(JSON.stringify({ mode, browser: browser.version(), violations, errors, external }, null, 2));
  assert.deepEqual(violations, [], "Automated accessibility findings");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], "Unexpected network requests during browser-only workflow");
}

try {
  if (mode === "cold") await cold();
  else if (mode === "benchmark") await benchmark();
  else await smoke();
} finally {
  await browser.close();
}
