import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRows } from "@/features/analytics/calculations";
import { FeedbackSession, useFeedbackSession } from "@/features/feedback/session";
import type { FeedbackRecord } from "@/features/feedback/validation";
import { cluster, similarityMatrix } from "@/features/issues/clustering";
import type { Event, Request } from "@/features/issues/protocol";
import { attachGroup, newCandidate, snapshotIsStale, validateCandidate, type Candidate, type Grouping } from "@/features/prioritization/candidates";
import { defaults, evidenceFor, rank, score, sensitivity, validWeights } from "@/features/prioritization/scoring";
import { PrioritizationWorkspace } from "@/features/prioritization/workspace";
import { parsePrediction } from "@/features/sentiment/protocol";

const records: FeedbackRecord[] = [
  { id: "a", text: "Checkout fails", originalText: "Checkout fails", originalRow: 2, date: "2026-11-20", source: "App", rating: 1.5, category: null },
  { id: "b", text: "Payment freezes", originalText: "Payment freezes", originalRow: 3, date: null, source: "App", rating: null, category: null },
  { id: "c", text: "Refund pending", originalText: "Refund pending", originalRow: 4, date: "2026-10-15", source: "Support", rating: 3.5, category: null },
];
const scores = [{ label: "negative", score: 0.8 }, { label: "neutral", score: 0.1 }, { label: "positive", score: 0.1 }];
const rows = new Map(makeRows(records, [parsePrediction("a", scores)!]).map((row) => [row.record.id, row]));
const first: Candidate = { ...newCandidate("issue-a"), title: "Checkout", evidenceIds: ["a", "b", "a"], severity: 5, impact: 2, confidence: 3 };
const second: Candidate = { ...newCandidate("issue-b"), title: "Billing", evidenceIds: ["a"], severity: 2, impact: 5, confidence: 4 };
const incomplete: Candidate = { ...newCandidate("issue-c"), title: "Refund", evidenceIds: ["c"] };
const impactOnly = { frequency: 0, severity: 0, impact: 100, confidence: 0 };

describe("priority scoring", () => {
  it("reconciles duplicate evidence, missing data, and exact weighted contributions", () => {
    const observed = evidenceFor(first, rows, "2026-11-20", "2026-10-15");
    expect(observed).toMatchObject({ evidence: expect.any(Array), classified: 1, negative: 1, negativeShare: 1, rated: 1, averageRating: 1.5, dated: 1, latest: "2026-11-20", trend: null });
    expect(observed.evidence.map(({ record }) => record.originalRow)).toEqual([2, 3]);
    expect(score(first, observed.evidence.length, defaults)).toEqual({
      values: { frequency: 10, severity: 100, impact: 25, confidence: 50 },
      contributions: { frequency: 3, severity: 30, impact: 6.25, confidence: 7.5 }, total: 46.75,
    });
    expect(score(second, 1, defaults)?.total).toBe(45.25);
    expect(score(incomplete, 1, defaults)).toBeNull();
    expect(evidenceFor(incomplete, rows, "2026-11-20", "2026-10-15").negativeShare).toBeNull();
  });

  it("validates weights, bounds scores and rejects incomplete or invalid assessments", () => {
    expect(validWeights(defaults)).toBe(true);
    for (const frequency of [35, -1, NaN, Infinity]) expect(validWeights({ ...defaults, frequency })).toBe(false);
    expect(score(first, 0, defaults)).toBeNull();
    expect(score(first, 2, { ...defaults, frequency: 35 })).toBeNull();
    expect(score({ ...first, impact: 5, confidence: 5 }, 100, defaults)?.total).toBe(100);
    expect(score({ ...first, severity: 1, impact: 1, confidence: 1 }, 1, impactOnly)?.total).toBe(0);
    expect(validateCandidate({ ...first, severity: 8 as 5 }, new Set(rows.keys()))).toMatch(/whole numbers/);
    expect(validateCandidate({ ...first, evidenceIds: ["missing"] }, new Set(rows.keys()))).toMatch(/no longer exists/);
  });

  it("reverses rank under alternative weights and breaks ties by evidence then stable ID", () => {
    const input = [
      { candidate: first, count: 2, missing: 0 }, { candidate: second, count: 1, missing: 0 },
      { candidate: incomplete, count: 1, missing: 0 }, { candidate: first, count: 1, missing: 1 },
    ];
    const baseline = rank(input, defaults);
    const alternative = rank(input, impactOnly);
    expect(baseline.map(({ id, result }) => [id, result.total])).toEqual([["issue-a", 46.75], ["issue-b", 45.25]]);
    expect(alternative.map(({ id, result }) => [id, result.total])).toEqual([["issue-b", 100], ["issue-a", 25]]);
    expect(sensitivity(alternative[0].result, baseline[1].result)).toEqual({ factor: "impact", delta: 75 });
    const tied = [{ candidate: { ...first, id: "z" }, count: 5, missing: 0 }, { candidate: first, count: 4, missing: 0 }, { candidate: { ...first, id: "a" }, count: 4, missing: 0 }];
    expect(rank(tied, impactOnly).map(({ id }) => id)).toEqual(["z", "a", "issue-a"]);
  });

  it("preserves provenance and detects changed group settings, evidence population, and missing group", () => {
    const result = cluster(similarityMatrix([{ id: "a", vector: Float32Array.of(1, 0) }, { id: "b", vector: Float32Array.of(1, 0) }]), 0.75);
    const grouping: Grouping = { groups: result.groups, method: result.algorithm, threshold: result.threshold, populationIds: ["b", "a"] };
    const attached = attachGroup(first, result.groups[0], grouping);
    expect(attached.evidenceIds).toEqual(["a", "b"]);
    expect(attached.origin).toMatchObject({ representativeId: "a", method: "complete-link-v1", threshold: 0.75, populationIds: ["a", "b"] });
    const snapshot = attached.origin!;
    expect(snapshotIsStale(snapshot, grouping)).toBe(false);
    expect(snapshotIsStale(snapshot, { ...grouping, threshold: 0.8 })).toBe(true);
    expect(snapshotIsStale(snapshot, { ...grouping, populationIds: ["a", "b", "c"] })).toBe(true);
    expect(snapshotIsStale(snapshot, { ...grouping, groups: [] })).toBe(true);
    expect(snapshotIsStale(snapshot, null)).toBe(true);
  });

  it("only compares equally sized covered date windows with sufficient dated evidence", () => {
    const dates = ["2026-11-20", "2026-11-01", "2026-10-10", "2026-10-01"];
    const datedRows = new Map(makeRows(dates.map((date, index) => ({ ...records[0], id: String(index), date })), []).map((row) => [row.record.id, row]));
    const candidate = { ...first, evidenceIds: ["0", "1", "2", "3"] };
    expect(evidenceFor(candidate, datedRows, "2026-11-20", "2026-09-20").trend).toEqual({ recent: 2, previous: 2, anchor: "2026-11-20" });
    expect(evidenceFor(candidate, datedRows, "2026-11-20", "2026-10-01").trend).toBeNull();
  });
});

class WorkerBoundary {
  static latest: WorkerBoundary;
  onmessage: ((event: MessageEvent<Event>) => void) | null = null;
  postMessage = vi.fn<(request: Request) => void>();
  terminate = vi.fn();
  constructor() { WorkerBoundary.latest = this; }
}

afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const { setDataset, issues, sentiment } = useFeedbackSession();
  return <>
    <button onClick={() => setDataset({ records, name: "sample.csv", size: 20 })}>Load dataset</button>
    <button onClick={() => setDataset({ records: records.slice(2), name: "replacement.csv", size: 10 })}>Replace dataset</button>
    <button onClick={() => setDataset(null)}>Clear dataset</button>
    <button onClick={() => issues.start(records, 2)}>Discover test groups</button>
    <button onClick={() => issues.setThreshold(0.8)}>Change grouping</button>
    <button onClick={() => sentiment.start(records, 2)}>Analyse test sentiment</button>
    <PrioritizationWorkspace />
  </>;
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}

it("curates, validates, scores, edits and confirms removal of an issue without loading a model", () => {
  render(<FeedbackSession><Harness /></FeedbackSession>);
  expect(screen.getByRole("link", { name: "Go to Feedback Analysis" })).toHaveAttribute("href", "/feedback");
  click("Load dataset");
  click("Add Manual Issue");
  change("Issue title", "Checkout");
  click("Save issue");
  expect(screen.getByRole("alert")).toHaveTextContent("Select at least one");
  change("Search imported reviews", "Checkout");
  expect(screen.queryByRole("checkbox", { name: "Include CSV row 3" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Include CSV row 2" }));
  change("Search imported reviews", "Payment");
  fireEvent.click(screen.getByRole("checkbox", { name: "Include CSV row 3" }));
  click("Save issue");
  expect(screen.getByRole("table", { name: "Unscored issues" })).toHaveTextContent("Checkout");
  click("Edit issue and assessments");
  change("Severity", "5");
  change("Business impact", "2");
  change("Evidence confidence", "3");
  change("Investigation status", "Under investigation");
  change("Reviewer rationale", "Inspect payment logs.");
  click("Cancel editing");
  click("Keep editing");
  click("Save issue");
  expect(screen.getByRole("table", { name: "Scored issues" })).toHaveTextContent("46.75");
  expect(screen.getByText("46.75 / 100")).toBeVisible();
  expect(screen.getByText(/Inspect payment logs/)).toBeVisible();
  change("Frequency weight (%)", "10");
  expect(screen.getByRole("alert")).toHaveTextContent("Rankings are hidden");
  expect(screen.queryByRole("table", { name: "Scored issues" })).toBeNull();
  click("Reset to Defaults");
  click("Edit issue and assessments");
  fireEvent.click(screen.getByRole("checkbox", { name: "Include CSV row 3" }));
  click("Save issue");
  expect(screen.getByRole("table", { name: "Scored issues" })).toHaveTextContent("45.25");
  click("Remove issue");
  click("Keep issue");
  expect(screen.getByRole("button", { name: "View Checkout" })).toBeVisible();
  click("Remove issue");
  click("Confirm issue removal");
  expect(screen.getByText(/No issues in the queue/)).toBeVisible();
});

it("shows real references from worker results, retains stale evidence, reconciles explicitly and resets on replacement", () => {
  vi.stubGlobal("Worker", WorkerBoundary);
  render(<FeedbackSession><Harness /></FeedbackSession>);
  click("Load dataset");
  click("Discover test groups");
  const worker = WorkerBoundary.latest;
  const { run } = worker.postMessage.mock.calls[0][0];
  const vector = new Float32Array(384);
  vector[0] = 1;
  act(() => {
    for (const id of ["a", "b"]) worker.onmessage?.({ data: { run, type: "result", id, vector } } as MessageEvent<Event>);
    worker.onmessage?.({ data: { run, type: "done" } } as MessageEvent<Event>);
  });
  click("Add Discovered Group");
  change("Current group", JSON.stringify(["a", "b"]));
  click("Review selected group");
  expect(screen.getByText(/CSV row 2 · App/)).toBeVisible();
  click("Save issue");
  expect(screen.getByText(/Cutoff 0.75 · 2 of 3 imported/)).toBeVisible();
  click("Analyse test sentiment");
  const sentiment = WorkerBoundary.latest;
  const sentimentRun = sentiment.postMessage.mock.calls[0][0].run;
  act(() => sentiment.onmessage?.({ data: { run: sentimentRun, type: "result", id: "a", scores } } as unknown as MessageEvent<Event>));
  expect(screen.getByText("1 negative · 1 of 2 classified")).toBeVisible();
  click("Change grouping");
  expect(screen.getByText(/Grouping snapshot may be stale/)).toBeVisible();
  expect(within(screen.getByRole("table", { name: "Original feedback evidence" })).getByText("Payment freezes")).toBeVisible();
  click("Review grouping snapshot");
  change("Current group", JSON.stringify(["a", "b"]));
  click("Review selected group");
  expect(screen.getByText(/Cutoff 0.75 · 2 of 3 imported/)).toBeVisible();
  click("Save issue");
  expect(screen.getByText(/Cutoff 0.80 · 2 of 3 imported/)).toBeVisible();
  expect(screen.queryByText(/Grouping snapshot may be stale/)).toBeNull();
  click("Replace dataset");
  expect(screen.getByText(/No issues in the queue/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add Discovered Group" })).toBeNull();
  click("Clear dataset");
  expect(screen.getByRole("heading", { name: "Import feedback to prioritize issues" })).toBeVisible();
});
