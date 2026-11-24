import { manualDiscovery } from "./manual-discovery.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = (process.env.SOOCHANA_URL ?? process.env.VOICELOOP_URL) ?? "http://localhost:3000";
const screenshots = (process.env.SOOCHANA_SCREENSHOTS ?? process.env.VOICELOOP_SCREENSHOTS);
const browser = await chromium.launch({ executablePath: (process.env.SOOCHANA_CHROMIUM ?? process.env.VOICELOOP_CHROMIUM) });

async function verify(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = (name) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
  const capture = async (name, heading) => {
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((element) => [element.tagName, element.className, Math.round(element.getBoundingClientRect().right)]));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px in ${name}: ${JSON.stringify(overflow)}`);
    if (!screenshots || width !== 1440) return;
    if (heading) await page.getByRole("heading", { name: heading }).evaluate((element) => element.scrollIntoView());
    else await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(screenshots, `${name}.png`), animations: "disabled" });
  };

  try {
    await page.goto(base);
    assert.equal(await page.title(), "Dashboard | Soochana");
    await page.getByRole("link", { name: "Soochana", exact: true }).waitFor();
    assert.equal(await page.locator('meta[property="og:site_name"]').getAttribute("content"), "Soochana");
    assert.equal((await (await page.request.get(new URL("/manifest.webmanifest", base).href)).json()).name, "Soochana");
    assert.doesNotMatch(await page.locator("body").innerText(), /voiceloop/i);
    await capture("dashboard-empty");
    await page.getByRole("link", { name: "Try Demo Dataset" }).click();
    const demoAsset = "**/demo/soochana-demo.csv";
    await page.route(demoAsset, (route) => route.fulfill({ status: 503 }), { times: 1 });
    await button("Try Demo Dataset").click();
    await page.getByRole("alert").filter({ hasText: "The demo CSV could not be loaded" }).waitFor();
    await button("Browse CSV").waitFor();
    const response = page.waitForResponse((result) => new URL(result.url()).pathname === "/demo/soochana-demo.csv" && result.ok());
    await button("Try Demo Dataset").click();
    await response;
    await page.getByRole("heading", { name: "Map Columns" }).waitFor();
    assert.equal(await page.getByLabel("Feedback text").inputValue(), "1");
    assert.equal(await page.getByRole("combobox", { name: /^Category / }).inputValue(), "5");
    await button("Review quality").click();
    await capture("demo-quality");
    await button("Preview accepted records").click();
    await button("Continue to confirmation").click();
    await manualDiscovery(page);
    await page.getByText("100 accepted · 0 excluded", { exact: true }).waitFor();
    await button("Import 100 feedback records").click();
    await page.getByRole("heading", { name: "Imported dataset" }).waitFor();
    await button("Replace dataset").click();
    await button("Try Demo Dataset").click();
    await page.getByRole("heading", { name: "Map Columns" }).waitFor();
    await button("Cancel replacement").click();
    await page.getByText(/100 records/).waitFor();
    await nav("Dashboard");
    await page.getByText(/100 of 100 reviews/).waitFor();
    await page.getByText("2.18 / 5", { exact: true }).waitFor();
    await page.getByText("100 rated reviews", { exact: true }).waitFor();
    await capture("dashboard-demo");
    await page.getByLabel("Feedback source").selectOption({ label: "App review" });
    await page.getByText("25 of 100 reviews in this view · Filters active", { exact: true }).waitFor();
    await button("Reset Filters").click();
    await nav("Prioritization");
    await button("Add Manual Issue").click();
    await page.getByLabel("Issue title").fill("Investigate duplicate checkout charges");
    await page.getByLabel("Search imported reviews").fill("charged my card twice");
    await page.getByRole("checkbox", { name: /Include CSV row/ }).check();
    await page.getByRole("combobox", { name: /^Severity/ }).selectOption("5");
    await page.getByRole("combobox", { name: /^Business impact/ }).selectOption("4");
    await page.getByRole("combobox", { name: /^Evidence confidence/ }).selectOption("4");
    await button("Save issue").click();
    await page.getByText("Investigate duplicate checkout charges", { exact: true }).first().waitFor();
    const rankColumn = await page.getByRole("columnheader", { name: "Rank", exact: true }).first().boundingBox();
    assert.ok(rankColumn && rankColumn.width >= 48, "The rank column has room for its label");
    await button("View Investigate duplicate checkout charges").click();
    await page.getByText("61.50 / 100", { exact: true }).first().waitFor();
    await capture("prioritization-demo", "Ranked issues");
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.reload();
    await page.getByText("Investigate duplicate checkout charges", { exact: true }).first().waitFor({ state: "hidden" });
    await nav("Feedback Analysis");
    await button("Try Demo Dataset").waitFor();
    console.log(`${width}px PASS · recovery, mapping, 100 records, cancellation, dashboard, prioritization and session reset`);
  } finally {
    await page.close();
  }
}

try {
  if (screenshots) await mkdir(screenshots, { recursive: true });
  for (const width of [320, 390, 1440]) await verify(width);
} finally {
  await browser.close();
}
