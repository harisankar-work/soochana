import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { readCsv } from "../src/features/feedback/csv.ts";
import { mappingError, suggestMapping, validateRows } from "../src/features/feedback/validation.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const authoredPath = resolve(directory, "../evaluation/ground-truth/authored-reviews.tsv");
const demoPath = resolve(directory, "../evaluation/datasets/historical-demo-96.csv");

const manifest = JSON.parse(readFileSync(resolve(directory, "../evaluation/datasets/manifest.json"), "utf8"));
const headers = ["External ID", "Feedback", "Date", "Source", "Rating", "Category"];
const mapping = { text: 1, date: 2, source: 3, rating: 4, category: 5 };
const jiraHeaders = ["Issue key", "Summary", "Description", "Created at", "Issue Type", "Source", "Priority"];
const jiraMapping = { text: 2, date: 3, source: 5, rating: null, category: 4 };
const sources = ["App review", "Support ticket", "Web survey", "Help centre"];
const dateMessage = "Date must be a valid calendar date in YYYY-MM-DD format.";
const ratingMessage = "Rating must be a number from 1 to 5.";
const malformed = {
  "malformed-quote": { csv: 'review\n"Not closed', error: "Malformed CSV near record 2. Check that quotes are closed and escaped." },
  "malformed-control": { csv: "review\nBad\0value", error: "The file contains unsupported control characters. Export it as a UTF-8 CSV." },
  "malformed-header-only": { csv: "review,rating\n", error: "The CSV contains headers but no feedback rows." },
  "malformed-mapping": { csv: "Subject,Urgency\nUnable to sign in,High", error: "Choose a column for Feedback text." },
  "malformed-width": { csv: "review,source\nExtra,Support,field\nValid,Support" },
  "malformed-row-limit": { csv: () => ["review", ...Array.from({ length: 10001 }, (_, i) => `Review ${i + 1}`)].join("\n"), error: "The CSV exceeds 10,000 data rows. Split it into smaller CSV files." },
  "malformed-column-limit": { csv: () => [Array.from({ length: 201 }, (_, i) => `Column ${i + 1}`).join(","), Array(201).fill("text").join(",")].join("\n"), error: "The CSV exceeds 200 columns. Remove unused columns and try again." },
};
export const datasetNames = Object.freeze([...Object.keys(manifest), ...Object.keys(malformed)]);

function authorRows() {
  const [, ...lines] = readFileSync(authoredPath, "utf8").trimEnd().split("\n");
  assert.equal(lines.length, 100, "The frozen author-assigned benchmark has 100 reviews");
  return lines.map((line, index) => {
    const [sentiment, category, topic, originalText] = line.split("\t");
    assert.ok(["Negative", "Neutral", "Positive"].includes(sentiment) && category && topic && originalText, `Invalid authored row ${index + 2}`);
    return { sentiment, category, topic, originalText };
  });
}

function csvCell(value, delimiter) {
  const text = String(value ?? "");
  return text.includes(delimiter) || /["\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serialise(header, rows, { delimiter = ",", newline = "\n", bom = "" } = {}) {
  return bom + [header, ...rows].map((cells) => cells.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join(newline) + newline;
}

function referenceRecord(index, attributes) {
  const originalRow = index + 2;
  return {
    id: `feedback-row-${originalRow}`, originalRow, duplicateOf: null,
    sentiment: null, topic: null, category: null, source: null, date: null, rating: null,
    outcome: "Accepted", reasons: [], ...attributes,
  };
}

function synthetic(size, jira) {
  const authored = authorRows();
  const rows = [];
  const records = [];
  for (let index = 0; index < size; index++) {
    const seed = authored[index % authored.length];
    const reference = String(index + 1).padStart(5, "0");
    const jiraKey = `SYN-${index + 101}`;
    let originalText = (index < authored.length || jira) ? seed.originalText : `${seed.originalText} Synthetic case reference ${reference}.`;
    if (jira) originalText += `\nEnvironment: synthetic test workspace. Reproduction reference: ${jiraKey}.`;
    const source = index >= 100 && index % 19 === 0 ? null : sources[index % sources.length];
    let date = index >= 100 && index % 23 === 0 ? null : `2026-10-${String(index % 28 + 1).padStart(2, "0")}`;
    let rating = jira || (index >= 100 && index % 29 === 0) ? null : index % 5 + 1;
    let rawDate = date;
    let rawRating = rating;
    let outcome = "Accepted", duplicateOf = null, reasons = [];
    if (index >= 100 && index % 47 === 0) {
      originalText = "";
      outcome = "Excluded";
      reasons = ["Feedback text is missing."];
    } else if (index >= 100 && index % 41 === 0) {
      originalText = records[0].originalText.toUpperCase() + "  ";
      outcome = "Excluded";
      duplicateOf = records[0].id;
      reasons = ["Duplicate of row 2 after case and whitespace normalization."];
    } else {
      if (index >= 100 && index % 31 === 0) {
        rawDate = "09/Nov/26 11:30 AM";
        date = null;
        reasons.push(dateMessage);
      }
      if (index >= 100 && index % 37 === 0 && !jira) {
        rawRating = 8;
        rating = null;
        reasons.push(ratingMessage);
      }
      if (reasons.length) outcome = "Accepted with warning";
    }
    const category = jira ? (index % 3 === 0 ? "Task" : "Bug") : seed.category;
    rows.push(jira ? [jiraKey, seed.topic.replaceAll("-", " "), originalText, rawDate, category, source, "Medium"]
      : [`SYN-${reference}`, originalText, rawDate, source, rawRating, category]);
    records.push(referenceRecord(index, {
      originalText, source, date, rating, outcome, duplicateOf, reasons, category,
      sentiment: index < 100 && !jira ? seed.sentiment : null,
      topic: index < 100 && !jira ? seed.topic : null,
      ...(jira ? { jiraKey, jiraSummary: seed.topic.replaceAll("-", " "), jiraPriority: "Medium" } : {}),
    }));
  }
  // Keep the benchmark definition fixed. Large fixtures add a near-limit multiline description.
  if (size > 100) {
    const index = 100;
    const suffix = jira ? 2 : 1;
    const originalText = `Steps to reproduce:\nOpen the panel marked "Saved reports".\n${"The page keeps the old filter after navigating home. ".repeat(170)}\nSynthetic reference ${jira ? records[index].jiraKey : "SYN-00101"}.`;
    rows[index][suffix] = originalText;
    records[index].originalText = originalText;
  }
  return { rows, records };
}

function expectations(records) {
  const accepted = records.filter(({ outcome }) => outcome !== "Excluded");
  const ratings = accepted.flatMap(({ rating }) => rating === null ? [] : [rating]);
  const sources = {};
  for (const record of accepted) {
    const key = record.source ?? "No source recorded";
    sources[key] = (sources[key] ?? 0) + 1;
  }
  const firstSource = accepted.find(({ source }) => source !== null)?.source ?? null;
  const window = ["2026-10-01", "2026-10-14"];
  return {
    total: records.length,
    accepted: accepted.length,
    rejected: records.length - accepted.length,
    duplicates: records.filter(({ duplicateOf }) => duplicateOf !== null).length,
    missingText: records.filter(({ reasons }) => reasons.includes("Feedback text is missing.")).length,
    invalidRating: records.filter(({ reasons }) => reasons.includes(ratingMessage)).length,
    invalidDate: records.filter(({ reasons }) => reasons.includes(dateMessage)).length,
    averageRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
    rated: ratings.length,
    dated: accepted.filter(({ date }) => date !== null).length,
    sources,
    filters: {
      source: firstSource,
      sourceCount: firstSource ? sources[firstSource] : 0,
      window,
      windowCount: accepted.filter(({ date }) => date !== null && date >= window[0] && date <= window[1]).length,
      combinedCount: accepted.filter(({ date, rating, source }) => source === firstSource && rating !== null && date !== null && date >= window[0] && date <= window[1]).length,
    },
  };
}

function readDemo() {
  // The historical demo uses one logical review per line. Read the original CSV using
  // an independent line/field expression rather than the application's parser.
  const csv = readFileSync(demoPath, "utf8");
  const lines = csv.trimEnd().split(/\r?\n/u);
  const split = (line) => [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/gu)]
    .map((match) => match[1] === undefined ? match[2] : match[1].replaceAll('""', '"'));
  const demoHeaders = split(lines.shift());
  assert.deepEqual(demoHeaders, ["review", "date", "source", "rating", "category"]);
  const records = lines.map((line, index) => {
    const fields = split(line);
    assert.equal(fields.length, 5, `Invalid demo reference row ${index + 2}`);
    const [originalText, date, source, rating, category] = fields;
    return referenceRecord(index, { originalText, date: date || null, source: source || null, rating: rating ? Number(rating) : null, category: category || null });
  });
  assert.equal(records.length, 96);
  return { csv, records, headers: demoHeaders, mapping: { text: 0, date: 1, source: 2, rating: 3, category: 4 } };
}

export function loadDataset(name) {
  if (Object.hasOwn(malformed, name)) {
    const fixture = malformed[name];
    const csv = typeof fixture.csv === "function" ? fixture.csv() : fixture.csv;
    const records = name === "malformed-width" ? [
      referenceRecord(0, { originalText: "Extra", source: "Support", outcome: "Excluded", reasons: ["The number of fields does not match the header."] }),
      referenceRecord(1, { originalText: "Valid", source: "Support" }),
    ] : [];
    return { name, csv, records, expected: fixture.error ? { error: fixture.error } : expectations(records) };
  }
  assert.ok(Object.hasOwn(manifest, name), `Unknown dataset: ${name}`);
  const size = manifest[name].rows;
  if (name === "demo-96") {
    const fixture = readDemo();
    return { name, ...fixture, expected: expectations(fixture.records) };
  }
  const jira = name === "jira-200";
  const { rows, records } = synthetic(size, jira);
  const format = jira ? { newline: "\r\n", bom: "\uFEFF" }
    : name === "small-25" ? { delimiter: ";" }
    : name === "medium-50" ? { delimiter: "\t" } : {};
  const fixtureHeaders = jira ? jiraHeaders : headers;
  return {
    name, csv: serialise(fixtureHeaders, rows, format), records,
    headers: fixtureHeaders, mapping: jira ? jiraMapping : mapping,
    expected: expectations(records),
  };
}

export async function verifyDataset(fixture) {
  const { name, records, expected, csv, headers, mapping } = fixture;
  const file = new File([csv], `${name}.csv`, { type: "text/csv" });
  const start = performance.now();
  let parsed;
  try {
    parsed = await readCsv(file);
    const problem = mappingError(suggestMapping(parsed.headers), parsed.headers.length);
    if (problem) throw new Error(problem);
  } catch (error) {
    assert.ok(expected.error, `${name} unexpectedly failed: ${error.message}`);
    assert.equal(error.message, expected.error);
    return { name, bytes: file.size, error: error.message, parseMs: performance.now() - start };
  }
  assert.equal(expected.error, undefined, `${name} unexpectedly passed`);
  const parseMs = performance.now() - start;
  const validationStart = performance.now();
  if (headers) assert.deepEqual(parsed.headers, headers);
  const actualMapping = suggestMapping(parsed.headers);
  if (mapping) assert.deepEqual(actualMapping, mapping);
  const report = validateRows(parsed, actualMapping);
  const validationMs = performance.now() - validationStart;
  const accepted = records.filter(({ outcome }) => outcome !== "Excluded");
  if (Object.hasOwn(manifest, name)) assert.equal(expected.accepted, manifest[name].accepted);
  assert.equal(report.accepted.length, expected.accepted);
  assert.deepEqual(report.counts, Object.fromEntries(Object.entries(expected).filter(([key]) => ["total", "rejected", "duplicates", "missingText", "invalidRating", "invalidDate"].includes(key))));
  for (const [index, actual] of report.accepted.entries()) {
    const reference = accepted[index];
    const { id, originalRow, originalText, date, rating, source, category } = reference;
    assert.deepEqual(actual, { id, originalRow, originalText, text: originalText.trim(), date, rating, source, category });
    if (reference.jiraKey) {
      const cells = parsed.rows[reference.originalRow - 2].cells;
      assert.equal(cells[0], reference.jiraKey);
      assert.equal(cells[1], reference.jiraSummary);
      assert.equal(cells[6], reference.jiraPriority);
    }
  }
  assert.deepEqual(report.issues, records.filter(({ reasons }) => reasons.length).map(({ originalRow, outcome, reasons }) => ({
    originalRow, disposition: outcome, reasons,
  })));
  return { name, bytes: file.size, parseMs, validationMs, expected, actual: { ...report.counts, accepted: report.accepted.length } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name = "all", output, directory] = process.argv.slice(2);
  if (name === "--export") {
    assert.ok(output && directory, "Provide a dataset name and an export directory.");
    const { csv, ...reference } = loadDataset(output);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${reference.name}.csv`), csv);
    writeFileSync(join(directory, `${reference.name}.reference.json`), JSON.stringify(reference, null, 2) + "\n");
  } else {
    const names = name === "all" ? datasetNames : [name];
    const results = [];
    for (const selected of names) results.push(await verifyDataset(loadDataset(selected)));
    const json = JSON.stringify({ node: process.version, results }, null, 2);
    if (output) writeFileSync(output, json + "\n");
    else console.log(json);
  }
}
