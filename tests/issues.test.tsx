import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackSession, useFeedbackSession } from "@/features/feedback/session";
import type { FeedbackRecord } from "@/features/feedback/validation";
import { cluster, cosine, similarityMatrix } from "@/features/issues/clustering";
import { IssueExplorer } from "@/features/issues/issue-explorer";
import { DIMENSIONS, validEmbedding, type Event, type Request } from "@/features/issues/protocol";

function vector(x: number, y = 0) {
  const result = new Float32Array(DIMENSIONS);
  result[0] = x;
  result[1] = y;
  return result;
}

describe("embedding validation and cosine", () => {
  it("requires a finite normalized Float32Array of 384 components", () => {
    expect(validEmbedding(vector(0.8, 0.6))).toBe(true);
    for (const invalid of [[], new Float32Array(3), vector(0), vector(2), vector(NaN), vector(Infinity)]) {
      expect(validEmbedding(invalid)).toBe(false);
    }
  });
  it.each([
    [[1, 0], [3, 0], 1], [[1, 0], [0, 1], 0], [[1, 0], [-1, 0], -1],
    [[1, 0], [0.75, Math.sqrt(1 - 0.75 ** 2)], 0.75],
    [[], [], null], [[1], [1, 0], null], [[0], [1], null],
    [[1e-13], [1], null], [[Infinity], [1], null], [[NaN], [1], null],
  ])("computes cosine for %j and %j", (a, b, expected) => {
    const actual = cosine(a, b);
    if (expected === null) expect(actual).toBeNull();
    else expect(actual).toBeCloseTo(expected, 12);
  });
});

describe("complete-link clustering", () => {
  const point = (id: string, radians: number) => ({ id, vector: vector(Math.cos(radians), Math.sin(radians)) });
  it("leaves singletons and unrelated reviews ungrouped", () => {
    expect(cluster(similarityMatrix([point("a", 0)]), 0.75).ungrouped).toEqual(["a"]);
    expect(cluster(similarityMatrix([point("a", 0), point("b", Math.PI)]), 0.75).groups).toEqual([]);
  });
  it("includes identical embeddings, even at the boundary, and breaks ties by ID", () => {
    const result = cluster(similarityMatrix([point("b", 0), point("a", 0)]), 1);
    expect(result.groups[0]).toMatchObject({ feedbackIds: ["a", "b"], representativeId: "a", cohesion: 1 });
  });
  it("prevents chain merging, preserves IDs across input ordering, and changes groups at the cutoff", () => {
    const points = [point("a", 0), point("b", 0.45), point("c", 0.9)];
    const strict = cluster(similarityMatrix(points), 0.75);
    expect(strict.groups.map((group) => group.feedbackIds)).toEqual([["a", "b"]]);
    expect(strict.ungrouped).toEqual(["c"]);
    expect(cluster(similarityMatrix([...points].reverse()), 0.75)).toEqual(strict);
    const permissive = cluster(similarityMatrix(points), 0.60);
    expect(permissive.groups[0].representativeId).toBe("b");
    expect(permissive.groups[0].cohesion).toBeCloseTo((2 * Math.cos(0.45) + Math.cos(0.9)) / 3);
    expect(cluster(similarityMatrix(points), 0.95).groups).toHaveLength(0);
    expect(() => similarityMatrix([points[0], points[0]])).toThrow(/Duplicate/);
  });
});

const records: FeedbackRecord[] = ["Payment failed", "Charged at checkout", "Arrived at noon"].map((text, index) => ({
  id: String(index), text, originalText: text, originalRow: index + 2,
  date: "2026-11-20", source: "Portal", rating: 1, category: null,
}));
const dataset = { records, name: "synthetic.csv", size: 12 };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<Event>) => void) | null = null;
  postMessage = vi.fn<(request: Request) => void>();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  emit(event: Omit<Event, "run"> | ({ type: "result"; id: string; vector: Float32Array }), prior?: number) {
    const run = prior ?? this.postMessage.mock.calls[0][0].run;
    act(() => this.onmessage?.({ data: { run, ...event } } as MessageEvent<Event>));
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

it("rejects stale, duplicate, unknown, invalid and missing results and resets on dataset changes", () => {
  const { result } = renderHook(useFeedbackSession, { wrapper: FeedbackSession });
  act(() => result.current.setDataset(dataset));
  act(() => result.current.issues.start(records, 3));
  const worker = FakeWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledOnce();
  worker.emit({ type: "result", id: "0", vector: vector(1) }, -1);
  worker.emit({ type: "result", id: "0", vector: vector(1) });
  worker.emit({ type: "result", id: "0", vector: vector(1) });
  worker.emit({ type: "result", id: "1", vector: vector(0) });
  worker.emit({ type: "result", id: "unknown", vector: vector(1) });
  worker.emit({ type: "done" });
  expect(result.current.issues.analysis).toMatchObject({ failed: 2, embeddings: [{ id: "0" }] });
  act(() => result.current.issues.start(records, 3));
  const replacement = FakeWorker.instances[1];
  act(() => result.current.setDataset({ ...dataset, name: "replacement.csv" }));
  replacement.emit({ type: "result", id: "0", vector: vector(1) });
  expect(replacement.terminate).toHaveBeenCalledOnce();
  expect(result.current.issues.analysis).toMatchObject({ phase: "idle", embeddings: [] });
  act(() => result.current.issues.start(records, 3));
  act(() => result.current.setDataset(null));
  expect(FakeWorker.instances[2].terminate).toHaveBeenCalledOnce();
});

it("prevents concurrent models, preserves partial results on cancel, and allows retry", () => {
  const { result } = renderHook(useFeedbackSession, { wrapper: FeedbackSession });
  act(() => result.current.setDataset(dataset));
  act(() => {
    result.current.issues.start(records, 3);
    result.current.sentiment.start(records, 3);
  });
  expect(FakeWorker.instances).toHaveLength(1);
  const worker = FakeWorker.instances[0];
  worker.emit({ type: "result", id: "0", vector: vector(1) });
  act(() => result.current.issues.cancel());
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.emit({ type: "result", id: "1", vector: vector(1) });
  expect(result.current.issues.analysis).toMatchObject({ phase: "cancelled", embeddings: [{ id: "0" }] });
  act(() => result.current.issues.start(records, 3));
  FakeWorker.instances[1].emit({ type: "error" });
  expect(result.current.issues.analysis.phase).toBe("error");
  act(() => result.current.issues.start(records, 3));
  expect(FakeWorker.instances).toHaveLength(3);
});

function Harness() {
  const { setDataset } = useFeedbackSession();
  return <><button onClick={() => setDataset(dataset)}>Load records</button><IssueExplorer /></>;
}

it("announces processing and displays evidence, cutoff recalculation, filters and ungrouped records", () => {
  render(<FeedbackSession><Harness /></FeedbackSession>);
  expect(screen.getByRole("link", { name: "Go to Feedback Analysis" })).toHaveAttribute("href", "/feedback");
  fireEvent.click(screen.getByRole("button", { name: "Load records" }));
  fireEvent.click(screen.getByRole("button", { name: "Discover Feedback Groups" }));
  const worker = FakeWorker.instances[0];
  worker.emit({ type: "download" });
  expect(screen.getByRole("progressbar", { name: "Model download progress" })).toBeVisible();
  worker.emit({ type: "embed" });
  worker.emit({ type: "result", id: "0", vector: vector(1) });
  worker.emit({ type: "result", id: "1", vector: vector(0.8, 0.6) });
  worker.emit({ type: "result", id: "2", vector: vector(-1) });
  expect(screen.getByRole("progressbar", { name: "Embedding progress" })).toHaveValue(3);
  worker.emit({ type: "done" });
  expect(screen.getByText(/1 matching groups/)).toBeVisible();
  expect(screen.getByText("Sentiment unavailable")).toBeVisible();
  const evidence = screen.getByRole("button", { name: "View evidence" });
  fireEvent.click(evidence);
  expect(evidence).toHaveAttribute("aria-expanded", "true");
  const card = within(screen.getByRole("article"));
  expect(card.getByText("Charged at checkout")).toBeVisible();
  fireEvent.change(card.getByLabelText("Search supporting reviews"), { target: { value: "charged" } });
  expect(card.getByRole("region", { name: "Review evidence" })).toHaveTextContent("0.800");
  fireEvent.change(screen.getByLabelText("Group type"), { target: { value: "potential" } });
  expect(screen.getByText(/0 matching groups/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Group type"), { target: { value: "all" } });
  fireEvent.change(screen.getByLabelText("Search review text or label"), { target: { value: "unknown" } });
  expect(screen.getByText(/0 matching groups/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Search review text or label"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Cosine similarity cutoff"), { target: { value: "0.9" } });
  expect(screen.getByText("Ungrouped feedback (3)")).toBeVisible();
  expect(FakeWorker.instances).toHaveLength(1);
});
