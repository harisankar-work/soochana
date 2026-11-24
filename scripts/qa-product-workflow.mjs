import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { loadDataset } from "./evaluate-datasets.mjs";

const base = new URL(process.env.SOOCHANA_URL ?? "http://localhost:3151");
const browser = await chromium.launch({ executablePath: process.env.SOOCHANA_CHROMIUM });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const button = (name) => page.getByRole("button", { name, exact: true });
const link = (name) => page.getByRole("link", { name, exact: true });
const heading = (name) => page.getByRole("heading", { name, exact: true });
const errors = [], traffic = [], accessibility = [];
const axeScript = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
let artifactRequests = 0;
context.on("request", (request) => {
  const url = new URL(request.url());
  if (url.protocol === "blob:") return;
  const external = url.protocol === "https:" && (url.hostname === "huggingface.co" || url.hostname.endsWith(".hf.co") ||
    (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith("/npm/onnxruntime-web@")));
  if (external) artifactRequests++;
  if ((!external && url.origin !== base.origin) || !["GET", "HEAD"].includes(request.method()) || request.postData()) traffic.push(url.hostname);
});
page.on("pageerror", (error) => errors.push(error.message));
const route = (path) => page.goto(new URL(path, base).href);
const nav = (name) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
const screenshotDirectory = process.env.SOOCHANA_SCREENSHOTS;
const stats = [];
async function responsiveAudit(state) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state} overflows at ${width}px`);
    if (width !== 320 && width !== 1440) continue;
    await page.addScriptTag({ path: axeScript });
    const violations = await page.evaluate(async () => (await window.axe.run({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })));
    accessibility.push({ state, width, violations });
    assert.deepEqual(violations, []);
  }
}
async function screenshot(name) {
  if (!screenshotDirectory) return;
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/${name}.png` });
}
async function confirm(count, replacing = false) {
  for (const action of ["Review quality", "Preview accepted records", "Continue to confirmation"]) await button(action).click();
  const start = performance.now();
  await button(`${replacing ? "Replace dataset and import" : "Import"} ${count} feedback records`).click();
  await heading("Imported dataset").waitFor();
  return start;
}
async function complete(count, start, trigger = "confirmation") {
  await page.getByText("Issue discovery finished.", { exact: true }).waitFor({ timeout: 180_000 });
  await link("Review issues and unassigned feedback").click();
  await page.getByText(new RegExp(`^${count} selected · ${count} embedded · 0 failed`)).waitFor();
  stats.push({ count, trigger, throughIssueExplorerMs: Math.round(performance.now() - start) });
}
try {
  await route("/prioritization");
  await button("Add Manual Issue").click();
  await page.getByLabel("Issue title").fill("=1+1 Problem recorded before import");
  await button("Save issue").click();
  await button("View =1+1 Problem recorded before import").waitFor();
  await page.getByText(/Unscored. A valid weight configuration/).waitFor();
  await link("Try Demo Dataset").click();
  await heading("Map Columns").waitFor();
  assert.equal(artifactRequests, 0);
  await confirm(96);
  await button("Cancel discovery").click();
  await page.getByText("Issue discovery cancelled.", { exact: true }).waitFor();
  const retry = performance.now();
  await button("Retry discovery").click();
  await complete(96, retry, "retry after cancellation");
  if (await button("Explore broader suggestions").count()) await button("Explore broader suggestions").click();
  else {
    await page.getByText("Advanced grouping settings", { exact: true }).click();
    await page.getByLabel("Grouping method").selectOption("average-link-v1");
  }
  const management = page.getByRole("region", { name: "Manage issues" });
  const available = management.getByRole("group", { name: "Available issues" });
  const options = available.getByRole("checkbox");
  assert.ok(await options.count() >= 3);
  const suggestion = (await options.nth(1).getAttribute("aria-label")).replace("Select issue ", "");
  await available.getByRole("button", { name: suggestion, exact: true }).first().click();
  await button("Edit issue details").click();
  await page.getByLabel("Issue title").fill("Reviewed checkout evidence");
  await page.getByLabel("Problem description").fill("Customers need a reliable way to finish payment.");
  await button("Save issue details").click();
  await button("Mark as reviewed").click();
  await button("Retry discovery").click();
  await available.getByRole("button", { name: "Reviewed checkout evidence", exact: true }).waitFor();
  await available.getByRole("checkbox", { name: "Select issue Reviewed checkout evidence" }).check();
  await options.nth(2).check();
  await page.getByLabel("Merged issue title").fill("Merged investigation");
  await button("Merge selected issues").click();
  await heading("Merged investigation").waitFor();
  const row = management.getByRole("checkbox", { name: /^Select CSV row/ }).first();
  await row.check();
  await page.getByLabel("New issue title").fill("Single review issue");
  await button("Split into new issue").click();
  await heading("Single review issue").waitFor();
  await responsiveAudit("issue editor and supporting feedback");
  if (screenshotDirectory) await heading("Single review issue").scrollIntoViewIfNeeded();
  await screenshot("issue-workspace");
  await link("Send to Prioritization").click();
  await heading("Single review issue").waitFor();
  await button("Edit issue and assessments").click();
  for (const [name, value] of [["Severity", "5"], ["Business impact", "4"], ["Evidence confidence", "4"]]) await page.getByRole("combobox", { name: new RegExp(`^${name}`) }).selectOption(value);
  await button("Save issue").click();
  await page.getByText("61.50 / 100", { exact: true }).waitFor();
  await page.getByLabel("Jira priority to confirm").selectOption("High");
  await button("Generate Jira-ready draft").click();
  const draft = page.getByLabel("Jira-ready description");
  assert.match(await draft.inputValue(), /User-confirmed priority: High/);
  await draft.fill("Human-edited Jira description");
  assert.equal(await draft.inputValue(), "Human-edited Jira description");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.origin });
  await button("Copy Jira-ready description").click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Human-edited Jira description");
  const exported = page.waitForEvent("download");
  await button("Export prioritized issues as CSV").click();
  const issueFile = await exported;
  assert.equal(issueFile.suggestedFilename(), "soochana-prioritized-issues.csv");
  assert.ok((await readFile(await issueFile.path(), "utf8")).includes("'=1+1 Problem recorded before import"));
  const evidenceDownload = page.waitForEvent("download");
  await button("Export issue evidence and assessments").click();
  const evidenceFile = await evidenceDownload;
  assert.equal(evidenceFile.suggestedFilename(), "soochana-issue-evidence.csv");
  assert.match(await readFile(await evidenceFile.path(), "utf8"), /Original feedback/);
  await responsiveAudit("prioritization and Jira draft");
  if (screenshotDirectory) await heading("Jira-ready draft").scrollIntoViewIfNeeded();
  await screenshot("prioritization-jira");
  await nav("Issue Explorer");
  await management.getByRole("button", { name: "Merged investigation", exact: true }).click();
  await management.getByRole("checkbox", { name: /^Select CSV row/ }).first().check();
  await page.getByLabel("Destination issue").selectOption({ label: "Single review issue" });
  await button("Move selected feedback").click();
  await management.getByRole("button", { name: "Single review issue", exact: true }).click();
  await link("Send to Prioritization").click();
  await page.getByText(/Evidence changed. Reassess/).waitFor();
  await nav("Issue Explorer");
  await management.getByRole("button", { name: "Single review issue", exact: true }).click();
  await management.getByRole("checkbox", { name: /^Select CSV row/ }).first().check();
  await button("Exclude selected feedback").click();
  await button("Return to feedback pools").click();
  await page.getByRole("combobox", { name: "Feedback pool" }).selectOption("excluded");
  await management.getByRole("checkbox", { name: /^Select CSV row/ }).first().check();
  await button("Restore selected feedback").click();
  await page.getByRole("combobox", { name: "Feedback pool" }).selectOption("analysed");
  await management.getByRole("checkbox", { name: /^Select CSV row/ }).first().check();
  await button("Suggest assignments").click();
  await heading("Suggested assignments").waitFor();
  await page.getByLabel("New issue title").fill("Issue from unassigned");
  await button("Create issue from selected feedback").click();
  await heading("Issue from unassigned").waitFor();
  await button("Delete issue").click();
  await button("Confirm issue deletion").click();
  await button("Undo issue change").click();
  await management.getByRole("button", { name: "Issue from unassigned", exact: true }).waitFor();

  // Retry is separately measured above. Confirm directly for three other warm workloads.
  for (const [name, count] of [["small-25", 25], ["medium-50", 50], ["benchmark-100", 100]]) {
    await nav("Feedback Analysis");
    await button("Replace dataset").click();
    const fixture = loadDataset(name);
    await page.locator('input[type=file]').setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(fixture.csv) });
    const start = await confirm(count, true);
    await complete(count, start);
    assert.equal(await management.getByRole("button", { name: "Reviewed checkout evidence", exact: true }).count(), 0);
  }
  await nav("Feedback Analysis");
  await button("Replace dataset").click();
  await button("Try Demo Dataset").click();
  await complete(96, await confirm(96, true));
  await page.reload();
  await heading("Import feedback to discover groups").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(traffic, []);
  console.log(JSON.stringify({ browser: browser.version(), stats, errors, traffic, accessibility }, null, 2));
} finally {
  await browser.close();
}
