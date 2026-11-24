import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { manualDiscovery } from "./manual-discovery.mjs";

const base = new URL(process.env.SOOCHANA_URL ?? "http://127.0.0.1:3000");
const output = process.env.SOOCHANA_SCREENSHOTS;
const expected = JSON.parse(await readFile(new URL("../evaluation/ground-truth/marketplace-demo.json", import.meta.url)));
const evaluated = JSON.parse(await readFile(new URL("../evaluation/reports/milestone-11-marketplace-demo.json", import.meta.url)));
const groups = evaluated.grouping.find(({ method }) => method === "average-link-v1");
const browser = await chromium.launch({ executablePath: process.env.SOOCHANA_CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
let requests = 0;
context.on("request", (request) => {
  const url = new URL(request.url());
  if (url.protocol === "blob:") return;
  const asset = url.protocol === "https:" && (url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
    (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@")));
  if (asset) requests++;
  if (!(asset || url.origin === base.origin) || !["GET", "HEAD"].includes(request.method()) || request.postData()) problems.push(url.hostname);
});
page.on("pageerror", (error) => problems.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const heading = (name) => page.getByRole("heading", { name, exact: true });
const text = (value) => page.getByText(value, { exact: true });
const nav = (name) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
const metric = (scope, label, value) => scope.getByText(label, { exact: true }).locator("xpath=following-sibling::dd").filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) }).waitFor();

async function screen(name, anchor) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows at ${width}px`);
    if (!output) continue;
    await mkdir(output, { recursive: true });
    await heading(anchor).evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${output}/${name}-${width}.png`, animations: "disabled" });
  }
}

async function groupStats() {
  const section = page.getByRole("region", { name: "Feedback groups", exact: true });
  await metric(section, "Recurring groups", groups.recurringGroups);
  await metric(section, "Grouped records", groups.grouped);
  await metric(section, "Unassigned records", groups.unassigned);
  await metric(section, "Potential issues", groups.potentialIssues);
}

try {
  await page.goto(base.href);
  const started = performance.now();
  await button("Explore completed demo").click();
  await heading("Prepared synthetic demo").waitFor();
  await text(`${expected.averageRating.toFixed(2)} / 5`).waitFor();
  const preparedMs = performance.now() - started;
  await text("100 of 100 reviews in this view · All feedback").waitFor();
  await page.getByLabel("Feedback source").selectOption({ label: "App review" });
  await text("25 of 100 reviews in this view · Filters active").waitFor();
  await button("Reset Filters").click();
  await screen("dashboard", "Dataset overview");

  await nav("Feedback Analysis");
  await text("Prepared sentiment results").waitFor();
  const sentiment = page.getByRole("region", { name: "AI Sentiment Analysis" });
  for (const [label, count] of Object.entries(evaluated.sentiment)) await metric(sentiment, label, count);
  await screen("sentiment", "AI Sentiment Analysis");
  await nav("Issue Explorer");
  await groupStats();
  await screen("issues", "Feedback groups");
  assert.equal(requests, 0, "The prepared workspace must not download models.");

  await nav("Prioritization");
  const scored = page.getByRole("table", { name: "Scored issues", exact: true }).locator("tbody tr");
  const unscored = page.getByRole("table", { name: "Unscored issues", exact: true }).locator("tbody tr");
  const reviewed = page.getByRole("table", { name: "Scored issues", exact: true }).getByText("Reviewed", { exact: true });
  const initialScored = await scored.count();
  assert.ok(initialScored >= 2 && await unscored.count() > 0 && await reviewed.count() > 0);
  const initialUnscored = await unscored.count();
  const issue = scored.first().getByRole("button");
  const title = await issue.innerText();
  const cells = await scored.first().locator("td").allTextContents();
  const evidence = Number(cells[2]), severity = Number(cells[3]), impact = Number(cells[4]), confidence = Number(cells[5]);
  const independentScore = Math.min(evidence, 20) * 1.5 + (severity - 1) * 7.5 + (impact - 1) * 6.25 + (confidence - 1) * 3.75;
  assert.equal(Number(cells[8]), independentScore);
  await screen("prioritization", "Ranked issues");
  await issue.click();
  await button("Generate Jira-ready draft").click();
  assert.match(await page.getByLabel("Jira-ready description").inputValue(), /MKT-\d+/);
  const download = page.waitForEvent("download");
  await button("Export prioritized issues as CSV").click();
  assert.match(await readFile(await (await download).path(), "utf8"), /Illustrative demo assessments/);

  await nav("Issue Explorer");
  await button(title).click();
  await button("Edit issue details").click();
  await page.getByLabel("Issue title").fill("Reviewed and renamed across modes");
  await button("Save issue details").click();
  await heading("Reviewed and renamed across modes").waitFor();
  const live = performance.now();
  await button("Run live analysis").click();
  await heading("Live synthetic demo").waitFor();
  await nav("Feedback Analysis");
  await text("Analysis completed").waitFor({ timeout: 180000 });
  await text("Issue discovery finished.").waitFor({ timeout: 180000 });
  const liveMs = performance.now() - live;
  for (const [label, count] of Object.entries(evaluated.sentiment)) await metric(sentiment, label, count);
  assert.ok(requests > 0, "Live mode must load the actual pinned artifacts in a fresh context.");
  await nav("Issue Explorer");
  await groupStats();
  await button("Reviewed and renamed across modes").waitFor();
  await nav("Prioritization");
  await button("View Reviewed and renamed across modes").waitFor();
  await button("Restore prepared demo").click();
  await button("Confirm prepared demo replacement").click();
  await heading("Prepared synthetic demo").waitFor();
  await button(`View ${title}`).waitFor();
  assert.equal(await button("View Reviewed and renamed across modes").count(), 0);

  await nav("Feedback Analysis");
  await button("Replace dataset").click();
  await page.locator('input[type=file]').setInputFiles({
    name: "soochana-demo.csv", mimeType: "text/csv", buffer: Buffer.from("review,rating\nA privately uploaded replacement,3\n"),
  });
  for (const step of ["Review quality", "Preview accepted records", "Continue to confirmation"]) await button(step).click();
  await manualDiscovery(page);
  await button("Replace dataset and import 1 feedback record").click();
  await heading("Imported dataset").waitFor();
  assert.equal(await heading("Prepared synthetic demo").count(), 0);
  assert.equal(await heading("Live synthetic demo").count(), 0);
  await nav("Prioritization");
  await text("No issues in the queue. Add a manual issue to start reviewing feedback.").waitFor();
  await page.reload();
  await heading("Import feedback to prioritize issues").waitFor();
  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ browser: browser.version(), preparedMs: Math.round(preparedMs), liveMs: Math.round(liveMs), modelRequests: requests,
    scored: initialScored, unscored: initialUnscored, topIssue: title, topScore: independentScore, errors: problems }, null, 2));
} finally {
  await browser.close();
}
