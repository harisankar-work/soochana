import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Dashboard from "@/app/page";
import { defaultFilters, filterRows, groupSources, makeRows, sourceKey, summarize, summarizeGroups, volumeTrend } from "@/features/analytics/calculations";
import { FeedbackSession, useFeedbackSession } from "@/features/feedback/session";
import type { FeedbackRecord } from "@/features/feedback/validation";
import { cluster, similarityMatrix } from "@/features/issues/clustering";
import { parsePrediction } from "@/features/sentiment/protocol";

const records: FeedbackRecord[] = [
  { id: "a", text: "Checkout failure", originalText: "Checkout failure", originalRow: 2, date: "2026-10-30", source: "App Store", rating: 1.5, category: null },
  { id: "b", text: "Payment failed", originalText: "Payment failed", originalRow: 3, date: "2026-10-30", source: "App Store", rating: 2, category: null },
  { id: "c", text: "Arrived today", originalText: "Arrived today", originalRow: 4, date: "2026-10-31", source: "Support", rating: 5, category: null },
  { id: "d", text: "Easy setup", originalText: "Easy setup", originalRow: 5, date: "2026-11-02", source: "Support", rating: 4.5, category: null },
  { id: "e", text: "Anonymous note", originalText: "Anonymous note", originalRow: 6, date: null, source: null, rating: null, category: null },
  { id: "f", text: "Another app review", originalText: "Another app review", originalRow: 7, date: null, source: "App Store", rating: null, category: null },
];

const classifications = (["negative", "negative", "neutral", "positive"] as const).map((winner, i) =>
  parsePrediction(records[i].id, ["negative", "neutral", "positive"].map((label) => ({ label, score: label === winner ? 0.8 : 0.1 })))!);
const rows = makeRows(records, classifications);
const counts = (buckets: { rows: unknown[] }[]) => buckets.map((bucket) => bucket.rows.length);

describe("analytics calculations", () => {
  it("reconciles independent coverage and computes exact source, sentiment and rating statistics", () => {
    const analytics = summarize(rows);
    expect(rows).toHaveLength(6);
    expect(analytics).toMatchObject({ analysed: 4, rated: 4, dated: 4, unsourced: 1, average: 3.25, negativeShare: 0.5 });
    expect(counts(analytics.sentiments)).toEqual([2, 1, 1]);
    expect(counts(analytics.ratings)).toEqual([1, 1, 0, 1, 1]);
    expect(analytics.sources.map(({ label, rows }) => [label, rows.length])).toEqual([["App Store", 3], ["Support", 2], ["No source recorded", 1]]);
    expect(analytics.sourceSentiment[0]).toMatchObject({ analysed: 2, counts: { Negative: 2, Neutral: 0, Positive: 0 } });
  });

  it("applies inclusive dates, source, rating and sentiment to one set of rows", () => {
    const select = (filters: Partial<typeof defaultFilters>) => filterRows(rows, { ...defaultFilters, ...filters });
    expect(select({ from: "2026-10-30", to: "2026-10-31" }).matched.map(({ record }) => record.id)).toEqual(["a", "b", "c"]);
    expect(select({ source: sourceKey(null), rating: "missing" }).matched.map(({ record }) => record.id)).toEqual(["e"]);
    expect(select({ from: "2026-11-02", to: "2026-10-30" }).matched).toEqual([]);
    const { matched, excludedUnanalysed } = select({ source: sourceKey("App Store"), sentiment: "Negative" });
    expect(excludedUnanalysed).toBe(1);
    const analytics = summarize(matched);
    expect(matched.map(({ record }) => record.id)).toEqual(["a", "b"]);
    expect(analytics).toMatchObject({ average: 1.75, negativeShare: 1, analysed: 2, rated: 2, dated: 2 });
    expect(analytics.sources[0].rows).toEqual(matched);
    expect(summarize([])).toMatchObject({ average: null, negativeShare: null, analysed: 0 });
  });

  it("aggregates sparse calendar periods in UTC and excludes invalid dates", () => {
    expect(volumeTrend(rows).periods.map((item) => [item.label, item.rows.length])).toEqual([["2026-10-30", 2], ["2026-10-31", 1], ["2026-11-02", 1]]);
    const dates = (...dates: string[]) => makeRows(dates.map((date, i) => ({ ...records[i], date })), []);
    expect(volumeTrend(dates("2026-01-01", "2026-02-15")).periods.map(({ label }) => label)).toEqual(["2025-12-29", "2026-02-09"]);
    expect(volumeTrend(dates("2025-01-01", "2026-02-15")).periods.map(({ label }) => label)).toEqual(["2025-01", "2026-02"]);
    expect(volumeTrend(dates("0025-01-01", "9999-12-31")).unit).toBe("Multi-year");
    expect(volumeTrend(dates("2026-02-30", "invalid")).periods).toEqual([]);
  });

  it("preserves source names and the exact members of the Other bucket", () => {
    const many = makeRows(Array.from({ length: 12 }, (_, index) => ({ ...records[0], id: String(index), source: `Source ${index}` })), []);
    expect(groupSources(many)).toHaveLength(12);
    const aggregated = summarize(many).sources;
    expect(aggregated).toHaveLength(9);
    expect(aggregated.at(-1)?.key).toBe("other");
    expect(aggregated.at(-1)?.rows).toHaveLength(4);
    expect(counts(aggregated).reduce((sum, value) => sum + value, 0)).toBe(12);
  });

  it("counts only embedded records as grouped or ungrouped and intersects existing groups", () => {
    const embeddings = [
      { id: "a", vector: Float32Array.of(1, 0) }, { id: "b", vector: Float32Array.of(1, 0) },
      { id: "c", vector: Float32Array.of(0, 1) },
    ];
    const result = cluster(similarityMatrix(embeddings), 0.75);
    const groups = summarizeGroups(rows, embeddings, result.groups);
    expect(groups).toMatchObject({ embeddedCount: 3, groupedCount: 2, ungrouped: [{ record: { id: "c" } }] });
    expect(groups.visibleGroups).toHaveLength(1);
    const filtered = summarizeGroups(rows.filter(({ record }) => record.id === "b"), embeddings, result.groups);
    expect(filtered).toMatchObject({ embeddedCount: 1, groupedCount: 1, ungrouped: [], visibleGroups: [{ members: [{ record: { id: "b" } }] }] });
    expect(summarizeGroups(rows, embeddings, undefined).ungrouped).toEqual([]);
    expect(summarizeGroups(rows, embeddings, []).ungrouped).toHaveLength(3);
  });
});

function Harness() {
  const { setDataset } = useFeedbackSession();
  return <>
    <button onClick={() => setDataset({ name: "sample.csv", size: 100, records })}>Load sample</button>
    <button onClick={() => setDataset({ name: "replacement.csv", size: 20, records: records.slice(2, 3) })}>Replace sample</button>
    <button onClick={() => setDataset(null)}>Remove sample</button>
    <Dashboard />
  </>;
}

it("renders analytics, opens keyboard-accessible evidence, resets filters, and clears stale selections on dataset changes", () => {
  render(<FeedbackSession><Harness /></FeedbackSession>);
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
  expect(screen.getByRole("link", { name: "Upload Feedback" })).toBeVisible();
  click("Load sample");
  expect(screen.getByText("3.25 / 5")).toBeVisible();
  expect(screen.getByText("Not analysed", { exact: true })).toBeVisible();
  expect(screen.queryByLabelText("Sentiment class")).toBeNull();
  click(/App Store 3/);
  const evidence = within(screen.getByRole("region", { name: "Review evidence" }).closest("section")!);
  expect(evidence.getByText("3 supporting reviews")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Review evidence" })).toHaveFocus();
  expect(evidence.getByText("Checkout failure")).toBeVisible();
  expect(evidence.queryByText("Easy setup")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Feedback source"), { target: { value: sourceKey("Support") } });
  expect(screen.getByText(/2 of 6 reviews in this view/)).toBeVisible();
  expect(screen.getByText("4.75 / 5")).toBeVisible();
  click("Reset Filters");
  expect(screen.getByText(/6 of 6 reviews in this view/)).toBeVisible();
  click(/1 to <2 1/);
  expect(evidence.getByText("1 supporting review")).toBeVisible();
  click("Replace sample");
  expect(screen.getByText(/1 of 1 reviews in this view/)).toBeVisible();
  expect(screen.queryByText("Checkout failure")).not.toBeInTheDocument();
  click("Remove sample");
  expect(screen.getByRole("link", { name: "Upload Feedback" })).toBeVisible();
});
