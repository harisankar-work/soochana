import { manualDiscovery } from "./manual-discovery.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium, firefox, webkit } from "playwright-core";

const require = createRequire(import.meta.url);
const base = new URL(process.env.SOOCHANA_URL ?? "http://localhost:3000");
const engine = process.env.SOOCHANA_BROWSER ?? "chromium";
const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[engine];
assert.ok(browserType, "SOOCHANA_BROWSER must be chromium, firefox, or webkit.");
const scanWidths = (process.env.SOOCHANA_QA_WIDTHS ?? "320,390,768,1024,1440").split(",").map(Number);
assert.ok(scanWidths.every((width) => Number.isInteger(width) && width > 0), "Widths must be positive integers.");
const cases = [];
const errors = [];
const unexpectedRequests = [];
const violations = [];
const axeEnabled = process.env.SOOCHANA_QA_AXE !== "0";
let axeScans = 0;
const mode = process.argv[2] ?? "flows";
assert.ok(["flows", "datasets", "models"].includes(mode), "Choose flows, datasets, or models.");
const browser = await browserType.launch({ executablePath: engine === "chromium" ? process.env.SOOCHANA_CHROMIUM : undefined });

function controls(page) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const text = (name) => page.getByText(name, { exact: true });
  const heading = (name) => page.getByRole("heading", { name, exact: true });
  const nav = (name) => page.getByRole("navigation").getByRole("link", { name, exact: true });
  const combo = (name) => page.getByRole("combobox", { name });
  async function select(csv, name = "synthetic.csv") {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  }
  async function confirm(count, rejected = 0, replace = false) {
    await button("Continue to confirmation").click();
    await manualDiscovery(page);
    await text(`${count} accepted · ${rejected} excluded`).waitFor();
    await button(`${replace ? "Replace dataset and import" : "Import"} ${count} feedback ${count === 1 ? "record" : "records"}`).click();
    await heading("Imported dataset").waitFor();
  }
  async function importCsv(csv, count, replace = false) {
    await select(csv);
    await button("Review quality").click();
    await button("Preview accepted records").click();
    await confirm(count, 0, replace);
  }
  return { button, text, heading, nav, combo, select, confirm, importCsv };
}

function modelRequest(url) {
  return url.protocol === "https:" && (url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
    (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@")));
}

async function browserCase(name, width, run) {
  const start = performance.now();
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => errors.push({ name, width, message: error.message }));
  context.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.origin !== base.origin && !(mode === "models" && modelRequest(url))) ||
      !["GET", "HEAD"].includes(request.method()) || request.postData()) {
      unexpectedRequests.push({ name, width, host: url.hostname, method: request.method(), hasBody: Boolean(request.postData()) });
    }
  });
  try {
    const details = await run(page);
    cases.push({ name, width, status: "pass", ms: Math.round(performance.now() - start), ...details });
  } catch (error) {
    cases.push({ name, width, status: "fail", message: error.message, ms: Math.round(performance.now() - start) });
    console.error(`${name} at ${width}px failed: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function scan(page, state, width) {
  const actual = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(actual <= width, `${state} has a ${actual}px document at ${width}px`);
  if (!axeEnabled) return;
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const results = await page.evaluate(async () => {
    const report = await window.axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return report.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(({ target }) => target) }));
  });
  axeScans++;
  if (results.length) violations.push({ state, width, findings: results });
}

async function go(page, pathname) {
  await page.goto(new URL(pathname, base).href, { waitUntil: "networkidle" });
}

const manualCsv = [
  "body,created_at,source,rating",
  '"Checkout charged me twice and said ""Try again"" 😕",2026-02-02,App,1',
  '"Courier apologized.\nMerci pour votre aide.",2026-02-05,Support,5',
  '" checkout charged me twice and said ""Try again"" 😕 ",2026-02-12,App,4',
  "   ,2026-02-13,App,3",
  "Refund status clarified,2026-02-30,Support,9",
].join("\r\n");

async function dropFile(page, csv, name) {
  const data = await page.evaluateHandle(({ content, file }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], file, { type: "text/csv" }));
    return transfer;
  }, { content: csv, file: name });
  try {
    await page.locator(".csv-drop").dispatchEvent("drop", { dataTransfer: data });
  } finally {
    await data.dispose();
  }
}

async function responsiveFlow(page, width) {
  const { button, text, heading, nav, combo, select, confirm } = controls(page);
  await go(page, "/");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip to content");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main-content");
  await scan(page, "empty dashboard", width);
  for (const [label, emptyState] of [["Issue Explorer", "Import feedback to discover groups"], ["Prioritization", "Import feedback to prioritize issues"]]) {
    await nav(label).press("Enter");
    await heading(emptyState).waitFor();
    assert.equal(await nav(label).getAttribute("aria-current"), "page");
    await scan(page, `${label} empty`, width);
  }
  await nav("Feedback Analysis").press("Enter");
  await select('review,rating\n"open,2', "malformed.csv");
  await page.getByRole("alert").filter({ hasText: "Malformed CSV" }).waitFor();
  await scan(page, "malformed error", width);
  await dropFile(page, manualCsv, "multilingual.csv");
  await heading("Map Columns").waitFor();
  assert.equal(await heading("Map Columns").evaluate((node) => node === document.activeElement), true);
  await button("Review quality").click();
  await text("Choose a column for Feedback text.").waitFor();
  await combo(/Feedback text/).selectOption("0");
  await combo(/Date/).selectOption("0");
  await button("Review quality").click();
  await text("Use each CSV column for only one field.").waitFor();
  await combo(/Date/).selectOption("1");
  await button("Review quality").click();
  const metric = (name) => text(name).locator("xpath=following-sibling::dd");
  for (const [name, value] of [["Total parsed rows", 5], ["Accepted records", 3], ["Rejected records", 2],
    ["Duplicate records", 1], ["Missing feedback", 1], ["Invalid ratings", 1], ["Invalid dates", 1]]) {
    assert.equal(await metric(name).innerText(), String(value));
  }
  await text("Inspect row issues (3)").click();
  await page.getByRole("row", { name: /4 Excluded Duplicate of row 2/ }).waitFor();
  await scan(page, "quality and evidence", width);
  if (width <= 390) {
    assert.equal(await page.getByRole("region", { name: "Row issues table" }).evaluate((node) => node.scrollWidth > node.clientWidth), true);
  }
  await button("Preview accepted records").click();
  const row = page.getByRole("table", { name: "Accepted feedback" }).locator("tbody tr").first();
  await combo("Sort by").selectOption("highest");
  assert.equal(await row.locator("td").last().innerText(), "3");
  await page.getByRole("searchbox", { name: "Search feedback" }).fill("merci");
  await text("1 matching · 3 accepted records").waitFor();
  await page.getByRole("searchbox", { name: "Search feedback" }).fill("unmatched");
  await text("0 matching · 3 accepted records").waitFor();
  await confirm(3, 2);
  await nav("Dashboard").click();
  await text("3 of 3 reviews in this view · All feedback").waitFor();
  await text("3.00 / 5").waitFor();
  await text("2 rated reviews").waitFor();
  await combo("Feedback source").selectOption({ label: "Support" });
  await text("2 of 3 reviews in this view · Filters active").waitFor();
  await page.getByLabel("From date").fill("2026-02-01");
  await page.getByLabel("To date").fill("2026-02-05");
  await text("1 of 3 reviews in this view · Filters active").waitFor();
  await text("5.00 / 5").waitFor();
  await page.getByLabel("To date").fill("2026-01-01");
  await page.getByRole("alert").filter({ hasText: "Choose an end date" }).waitFor();
  await text("0 of 3 reviews in this view · Filters active").waitFor();
  await button("Reset Filters").click();
  await combo("Rating availability").selectOption({ label: "Unrated only" });
  await text("1 of 3 reviews in this view · Filters active").waitFor();
  await button("Reset Filters").click();
  await button("Support 2").press("Enter");
  await text("2 supporting reviews").waitFor();
  assert.equal(await heading("Review evidence").evaluate((node) => node === document.activeElement), true);
  await scan(page, "filtered dashboard and evidence", width);
  await button("Show all matching reviews").click();

  await nav("Prioritization").click();
  await button("Add Manual Issue").click();
  await button("Save issue").click();
  await text("Enter an issue title between 1 and 100 characters.").waitFor();
  await page.getByRole("textbox", { name: "Issue title" }).fill("Audit payment");

  await page.getByRole("checkbox", { name: "Include CSV row 2" }).press("Space");
  await page.getByRole("checkbox", { name: "Show selected reviews only" }).check();
  await text("1 selected · 1 matching reviews").waitFor();
  for (const [name, value] of [["Severity", "5"], ["Business impact", "4"], ["Evidence confidence", "4"]]) {
    await combo(name).selectOption(value);
  }
  await scan(page, "priority draft", width);
  await button("Save issue").click();
  await text("61.50 / 100").waitFor();
  const frequency = page.getByLabel("Frequency weight (%)");
  const severity = page.getByLabel("Severity weight (%)");
  await frequency.fill("10");
  await page.getByRole("alert").filter({ hasText: "Rankings are hidden" }).waitFor();
  await severity.fill("50");
  await text("80.50 / 100").waitFor();
  await button("Reset to Defaults").click();
  await text("61.50 / 100").waitFor();
  await scan(page, "scored priority and evidence", width);
  await button("Edit issue and assessments").click();
  await page.getByRole("textbox", { name: "Issue title" }).fill("Discard this title");
  await button("Cancel editing").click();
  await button("Keep editing").click();
  await button("Cancel editing").click();
  await button("Discard draft").click();
  await button("View Audit payment").waitFor();

  await nav("Feedback Analysis").click();
  await button("Replace dataset").click();
  await button("Cancel replacement").click();
  await heading("Imported dataset").waitFor();
  await button("Replace dataset").click();
  await controls(page).importCsv("review\nReplacement marker", 1, true);
  await nav("Prioritization").click();
  await text("0 candidates · 0 scored · 0 unscored · 0 distinct supporting reviews").waitFor();
  await nav("Feedback Analysis").click();
  await button("Remove dataset").click();
  await button("Keep dataset").click();
  await heading("Imported dataset").waitFor();
  await button("Remove dataset").click();
  await button("Confirm removal").click();
  await text("Dataset removed.").waitFor();
  await controls(page).importCsv("review\nTemporary audit data", 1);
  await page.reload();
  await button("Browse CSV").waitFor();
  const storage = await page.evaluate(async () => [
    localStorage.length, sessionStorage.length, (await indexedDB.databases()).length, (await caches.keys()).length,
  ]);
  assert.deepEqual(storage, [0, 0, 0, 0]);
}

async function datasetFlow(page, fixture) {
  const { button, text, combo, select, heading, confirm, nav } = controls(page);
  const { csv, name, expected, mapping } = fixture;
  await go(page, "/feedback");
  await select(csv, `${name}.csv`);
  if (expected.error) {
    if (name === "malformed-mapping") await button("Review quality").click();
    await page.getByRole("alert").filter({ hasText: expected.error }).waitFor();
    await button(name === "malformed-mapping" ? "Choose another file" : "Browse CSV").waitFor();
    return;
  }
  await heading("Map Columns").waitFor();
  for (const [key, label] of [["text", "Feedback text"], ["source", "Source"], ["date", "Date"], ["rating", "Rating"], ["category", "Category"]]) {
    if (mapping) await combo(new RegExp(`^${label}`)).selectOption(mapping[key] === null ? "" : String(mapping[key]));
  }
  await button("Review quality").click();
  for (const [key, label] of [["total", "Total parsed rows"], ["accepted", "Accepted records"], ["rejected", "Rejected records"],
    ["duplicates", "Duplicate records"], ["missingText", "Missing feedback"], ["invalidRating", "Invalid ratings"], ["invalidDate", "Invalid dates"]]) {
    assert.equal(await text(label).locator("xpath=following-sibling::dd").innerText(), String(expected[key]));
  }
  await button("Preview accepted records").click();
  if (name === "jira-200") {
    await page.getByRole("searchbox", { name: "Search feedback" }).fill("SYN-201");
    await text(`1 matching · ${expected.accepted} accepted records`).waitFor();
    const evidence = page.getByRole("table", { name: "Accepted feedback" }).locator("tbody tr");
    assert.equal(await evidence.locator("td").last().innerText(), "102");
    await evidence.locator("summary").click();
    await evidence.getByText("Synthetic reference SYN-201.", { exact: false }).waitFor();
  }
  await confirm(expected.accepted, expected.rejected);
  await nav("Dashboard").click();
  await text(`${expected.accepted} of ${expected.accepted} reviews in this view · All feedback`).waitFor();
  const rating = text("Average rating").locator("xpath=following-sibling::dd");
  await rating.getByText(expected.averageRating === null ? "Unavailable" : `${Number(expected.averageRating).toFixed(2)} / 5`, { exact: true }).waitFor();
  await rating.getByText(`${expected.rated} rated reviews`, { exact: true }).waitFor();
  const filters = expected.filters;
  if (filters.source) {
    await combo("Feedback source").selectOption({ label: filters.source });
    await text(`${filters.sourceCount} of ${expected.accepted} reviews in this view · Filters active`).waitFor();
    await page.getByLabel("From date").fill(filters.window[0]);
    await page.getByLabel("To date").fill(filters.window[1]);
    await combo("Rating availability").selectOption({ label: "Rated only" });
    await text(`${filters.combinedCount} of ${expected.accepted} reviews in this view · Filters active`).waitFor();
    await button("Reset Filters").click();
  }
  const evidence = page.getByRole("region", { name: "Review evidence", exact: true });
  if (expected.accepted > 20) {
    await evidence.getByRole("button", { name: "Next", exact: true }).click();
    await evidence.getByText(`Page 2 of ${Math.ceil(expected.accepted / 20)}`, { exact: true }).waitFor();
  }
  if (expected.accepted > 100) {
    for (const [label, action] of [["Feedback Analysis", "Analyse Sentiment"], ["Issue Explorer", "Discover Feedback Groups"]]) {
      await nav(label).click();
      await heading(label).waitFor();
      const selection = page.getByRole("spinbutton", { name: "Records to analyse" });
      assert.equal(await selection.inputValue(), "100");
      assert.equal(await selection.getAttribute("max"), "100");
      await selection.fill("101");
      assert.equal(await button(action).isEnabled(), false);
      await selection.fill("25");
      assert.equal(await button(action).isEnabled(), true);
    }
  }
  return { accepted: expected.accepted, rejected: expected.rejected };
}

async function inputLimits(page) {
  const { button, text, select } = controls(page);
  await go(page, "/feedback");
  for (const [name, contents, error] of [
    ["invalid.txt", "review\nHello", "Choose a file with a .csv extension."],
    ["empty.csv", "", "The file is empty. Choose a CSV with headers and feedback rows."],
    ["oversized.csv", Buffer.alloc(5 * 1024 * 1024 + 1, 120), "The file exceeds 5 MiB. Split it into smaller CSV files."],
    ["wrong-encoding.csv", Buffer.from([0xff, 0xf0]), "This file could not be read as UTF-8. Save it as UTF-8 CSV and try again."],
  ]) {
    await select(contents, name);
    await text(error).waitFor();
  }
  await select("review,date\n,2026-01-01");
  await button("Review quality").click();
  await button("Preview accepted records").click();
  await text("No records passed validation. Review the column mapping or choose another file.").waitFor();
  assert.equal(await button("Continue to confirmation").isEnabled(), false);
}

async function manySources(page) {
  const { button, text, nav, importCsv } = controls(page);
  await go(page, "/feedback");
  const csv = "review,source,rating\n" + Array.from({ length: 102 }, (_, index) =>
    `Fictional review ${index},${index === 101 ? "" : `Source ${index}`},3`).join("\n");
  await importCsv(csv, 102);
  await nav("Dashboard").click();
  const exact = page.getByRole("searchbox", { name: "Feedback source (exact)" });
  await exact.fill("Source 100");
  await text("1 of 102 reviews in this view · Filters active").waitFor();
  await button("Reset Filters").click();
  await page.getByRole("checkbox", { name: "No source recorded" }).check();
  await text("1 of 102 reviews in this view · Filters active").waitFor();
  await button("Reset Filters").click();
  await button("Other recorded sources 93").click();
  await text("93 supporting reviews").waitFor();
}

const modelCsv = "review,source,rating\n" + Array.from({ length: 100 }, (_, i) => {
  const scenario = [
    "The card charged me twice during checkout",
    "I was charged twice when I paid by card",
    "Excellent delivery and the order arrived before the promised date",
    "The app crashed while I was resetting my password",
    "Where can I see the current order status",
  ][i % 5];
  return `${scenario} (case ${i + 1}),App,${i % 5 + 1}`;
}).join("\n");

async function modelScan(page, state) {
  for (const width of scanWidths) {
    await page.setViewportSize({ width, height: 960 });
    await scan(page, state, width);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
}

async function realModelFlow(page) {
  const { button, text, heading, nav, combo, importCsv } = controls(page);
  const context = page.context();
  const modelAssets = [];
  context.on("request", (request) => {
    if (!modelRequest(new URL(request.url()))) return;
    modelAssets.push(request.url());
    if (decodeURIComponent(request.url()).includes("card charged me twice")) {
      unexpectedRequests.push({ name: "review text in model URL" });
    }
  });
  // Count the real worker inputs without modifying requests or responses.
  await page.addInitScript(() => {
    const ActualWorker = window.Worker;
    window.soochanaQaWorkerInputs = [];
    window.Worker = class extends ActualWorker {
      postMessage(message, ...options) {
        if (Array.isArray(message.records)) window.soochanaQaWorkerInputs.push(message.records.length);
        return super.postMessage(message, ...options);
      }
    };
  });
  const workerInputs = () => page.evaluate(() => window.soochanaQaWorkerInputs);
  await go(page, "/feedback");
  await importCsv(modelCsv, 100);
  const records = page.getByRole("spinbutton", { name: "Records to analyse" });
  const coldWait = { timeout: 150_000 };
  // Simulate transport failure only. All success assertions below use actual HTTPS inference.
  const modelHost = "https://huggingface.co/**";
  const failDownload = (route) => route.abort("failed");
  await context.route(modelHost, failDownload);
  await records.fill("10");
  await button("Analyse Sentiment").click();
  await text("Analysis incomplete").waitFor(coldWait);
  await page.locator(".import-error").waitFor();
  await context.unroute(modelHost, failDownload);
  await button("Re-run analysis").click();
  await text("Analysis completed").waitFor(coldWait);
  await page.getByText(/^10 selected · 10 analysed · 0 failed/).waitFor();
  await page.getByRole("table", { name: "Sentiment predictions" }).waitFor();
  const predictedLabel = await page.getByRole("table", { name: "Sentiment predictions" }).locator("tbody tr").first().locator("td").nth(1).innerText();
  assert.ok(["Positive", "Negative", "Neutral"].includes(predictedLabel));
  await combo("Low-confidence threshold").selectOption("90");
  await page.getByRole("checkbox", { name: "Low-confidence only" }).check();
  const visibleConfidence = await page.getByRole("table", { name: "Sentiment predictions" }).locator("tbody tr td:nth-child(3)").allTextContents();
  assert.ok(visibleConfidence.every((cell) => Number.parseFloat(cell) <= 90), "Labels must stay under the active review threshold, after rounding");
  await page.getByRole("checkbox", { name: "Low-confidence only" }).uncheck();
  await combo("Filter sentiment").selectOption(predictedLabel);
  const visibleLabels = await page.getByRole("table", { name: "Sentiment predictions" }).locator("tbody tr td:nth-child(2)").allTextContents();
  assert.ok(visibleLabels.length > 0 && visibleLabels.every((label) => label === predictedLabel));
  await combo("Filter sentiment").selectOption("");
  await combo("Sort predictions").selectOption("low");
  const confidence = (await page.getByRole("table", { name: "Sentiment predictions" }).locator("tbody tr td:nth-child(3)").allTextContents()).map(Number.parseFloat);
  assert.deepEqual(confidence, [...confidence].sort((a, b) => a - b));
  await modelScan(page, "sentiment results");

  const requestsBeforeWarm = modelAssets.length;
  await records.fill("100");
  await button("Re-run analysis").click();
  await page.waitForFunction(() => document.querySelector('progress[aria-label="Classification progress"]')?.value > 0);
  await button("Cancel analysis").click();
  await text("Analysis cancelled").waitFor();
  const partial = (await page.getByText(/^100 selected · [0-9]+ analysed/).innerText()).match(/· (\d+) analysed/);
  assert.ok(Number(partial?.[1]) > 0 && Number(partial?.[1]) < 100);
  assert.equal(modelAssets.length, requestsBeforeWarm, "Warm worker inference fetched model assets");
  await records.fill("10");
  await button("Re-run analysis").click();
  await text("Analysis completed").waitFor(coldWait);

  await nav("Issue Explorer").click();
  await heading("Discover feedback groups").waitFor();
  await records.fill("20");
  await context.route(modelHost, failDownload);
  await button("Discover Feedback Groups").click();
  await text("Analysis could not finish").waitFor(coldWait);
  await page.locator(".import-error").waitFor();
  await context.unroute(modelHost, failDownload);
  await button("Discover Feedback Groups").click();
  await text("Embedding run finished").waitFor(coldWait);
  await page.getByText(/^20 selected · 20 embedded · 0 failed/).waitFor();
  const beforeReuse = (await workerInputs()).length;
  const requestsBeforeReuse = modelAssets.length;
  await records.fill("25");
  await button("Discover Feedback Groups").click();
  await page.getByText(/^25 selected · 25 embedded · 0 failed/).waitFor();
  assert.deepEqual((await workerInputs()).slice(beforeReuse), [5], "Widening discovery from 20 to 25 should send only the five uncached reviews");
  await records.fill("20");
  await button("Discover Feedback Groups").click();
  await page.getByText(/^20 selected · 20 embedded · 0 failed/).waitFor();
  assert.deepEqual((await workerInputs()).slice(beforeReuse), [5], "Narrowing discovery to cached reviews should send no additional work");
  assert.equal(modelAssets.length, requestsBeforeReuse, "Warm discovery fetched model assets");
  await text("Complete-link · Cutoff 0.75").waitFor();
  await text("Advanced grouping settings").click();
  await combo("Grouping method").selectOption("average-link-v1");
  await text("Average-link (exploratory) · Cutoff 0.45").waitFor();
  await combo("Cosine similarity cutoff").selectOption("0.4");
  await text("Average-link (exploratory) · Cutoff 0.40").waitFor();
  const evidence = button("View evidence").first();
  await evidence.click();
  await page.getByRole("table", { name: "Original feedback evidence" }).first().waitFor();
  await page.getByRole("searchbox", { name: "Search supporting reviews" }).first().fill("no matching fixture text");
  await text("No reviews match your search.").waitFor();
  await page.getByRole("searchbox", { name: "Search review text or label" }).fill("unknown review fixture");
  await text("0 matching groups").waitFor();
  await page.getByRole("searchbox", { name: "Search review text or label" }).fill("");
  await combo("Group type").selectOption("ungrouped");
  await page.locator("summary").filter({ hasText: /Unassigned Feedback/ }).click();
  await modelScan(page, "grouped and ungrouped evidence");
  await combo("Group type").selectOption("all");

  await nav("Prioritization").click();
  await page.getByRole("region", { name: "Unscored issues table", exact: true }).getByRole("button", { name: /^View / }).first().click();
  await button("Edit issue and assessments").click();
  await heading("Issue editor").waitFor();
  await button("Save issue").click();
  await page.getByText(/Discovered group · Unverified automatic grouping/).waitFor();
  await nav("Issue Explorer").click();
  await combo("Cosine similarity cutoff").selectOption("0.45");
  await nav("Prioritization").click();
  await heading("Prioritization").waitFor();
  await page.getByRole("region", { name: "Unscored issues table", exact: true }).getByRole("button", { name: /^View / }).first().click();
  await button("Review grouping snapshot").click();
  await heading("Review grouping snapshot").waitFor();
  await button("Close group review").click();
  await nav("Dashboard").click();
  await page.getByRole("region", { name: "Dataset overview", exact: true }).getByText("10 / 100", { exact: true }).waitFor();
  await page.getByRole("region", { name: "Recurring feedback themes", exact: true }).getByText(/20 of 100 imported embedded/).waitFor();
  await combo("Sentiment class").selectOption(predictedLabel);
  await text("90 unanalysed reviews excluded by the sentiment filter after other filters.").waitFor();
  await modelScan(page, "sentiment and groups on dashboard");

  await nav("Issue Explorer").click();
  await heading("Discover feedback groups").waitFor();
  await records.fill("100");
  await button("Discover Feedback Groups").click();
  await page.waitForFunction(() => document.querySelector('progress[aria-label="Embedding progress"]')?.value > 25);
  await button("Cancel discovery").click();
  await text("Analysis cancelled").waitFor();
  const discovered = Number((await page.getByText(/^100 selected · [0-9]+ embedded/).innerText()).match(/· (\d+) embedded/)?.[1]);
  assert.ok(discovered > 25 && discovered < 100);
  await button("Discover Feedback Groups").click();
  await page.getByText(/^100 selected · 100 embedded · 0 failed/).waitFor(coldWait);
  assert.equal((await workerInputs()).at(-1), 100 - discovered, "Retry should send only the records without embeddings");
  await nav("Feedback Analysis").click();
  await button("Replace dataset").click();
  await importCsv("review\nClean replacement", 1, true);
  await text("Ready to analyse").waitFor();
  await nav("Issue Explorer").click();
  await text("Ready to discover groups").waitFor();
  await page.getByRole("heading", { name: "Feedback groups", exact: true }).waitFor({ state: "detached" });
  await button("Discover Feedback Groups").click();
  await page.getByText(/^1 selected · 1 embedded · 0 failed/).waitFor(coldWait);
  assert.equal((await workerInputs()).at(-1), 1, "Replacement must not reuse embeddings from old rows with the same ID");
  return { partialSentiment: Number(partial[1]), newEmbeddingsAfterWidening: 5, partialDiscovery: discovered, finalRetryInputs: 100 - discovered };
}

try {
  if (mode === "flows") {
    for (const width of scanWidths) await browserCase("responsive workflow", width, (page) => responsiveFlow(page, width));
  } else if (mode === "datasets") {
    const { datasetNames, loadDataset } = await import("./evaluate-datasets.mjs");
    const names = process.argv.length > 3 ? process.argv.slice(3) : datasetNames;
    for (const name of names) {
      const fixture = await loadDataset(name);
      await browserCase(name, 1440, (page) => datasetFlow(page, fixture));
    }
    if (process.argv.length === 3) {
      await browserCase("file size and encoding limits", 1440, inputLimits);
      await browserCase("high-cardinality source filters", 1440, manySources);
    }
  } else {
    await browserCase("real model lifecycle", 1440, realModelFlow);
  }
  console.log(JSON.stringify({ mode, engine, browser: browser.version(), cases, errors, unexpectedRequests, axeScans, violations }, null, 2));
  if (cases.some(({ status }) => status === "fail") || errors.length || unexpectedRequests.length || violations.length) process.exitCode = 1;
} finally {
  await browser.close();
}
