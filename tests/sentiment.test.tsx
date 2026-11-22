import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackSession, useFeedbackSession } from "@/features/feedback/session";
import { SentimentPanel } from "@/features/sentiment/sentiment-panel";
import { parsePrediction, type WorkerEvent, type WorkerRequest } from "@/features/sentiment/protocol";
import type { FeedbackRecord } from "@/features/feedback/validation";
import { useSentiment } from "@/features/sentiment/use-sentiment";

const positive = [{ label: "positive", score: 0.9 }, { label: "neutral", score: 0.07 }, { label: "negative", score: 0.03 }];
const neutral = [{ label: "Negative", score: 0.12 }, { label: "Neutral", score: 0.54 }, { label: "Positive", score: 0.34 }];
const records: FeedbackRecord[] = ["Service was great", "Received at noon"].map((text, index) => ({
  id: String(index), text, originalText: text, originalRow: index + 2,
  date: null, source: "Test source", rating: null, category: null,
}));

class FakeWorker {
  static workers: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn<(request: WorkerRequest) => void>();
  terminate = vi.fn();
  constructor() { FakeWorker.workers.push(this); }
  emit(data: WorkerEvent) { act(() => this.onmessage?.({ data } as MessageEvent<WorkerEvent>)); }
}

beforeEach(() => {
  FakeWorker.workers = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe("model score validation", () => {
  it("maps case-insensitive class names using actual scores and preserves the record ID", () => {
    expect(parsePrediction("record", positive)).toMatchObject({ feedbackId: "record", label: "Positive", confidence: 0.9 });
    expect(parsePrediction("record", neutral)).toMatchObject({ label: "Neutral", confidence: 0.54 });
  });
  it.each([
    [[...positive.slice(0, 2), positive[0]]],
    [[...positive.slice(0, 2), { label: "negative", score: NaN }]],
    [[...positive.slice(0, 2), { label: "negative", score: -1 }]],
    [[...positive.slice(0, 2), { label: "negative", score: 2 }]],
    [[...positive.slice(0, 2), { label: "other", score: 0.03 }]],
    [[...positive.slice(0, 2), { label: "negative", score: 0.5 }]],
    [positive.slice(0, 2)],
  ])("rejects invalid or incomplete probability output", (values) => {
    expect(parsePrediction("record", values)).toBeNull();
  });
});

describe("analysis worker lifecycle", () => {
  it("starts lazily, bounds requests and tracks genuine progress and incomplete results", () => {
    const { result } = renderHook(useSentiment);
    expect(FakeWorker.workers).toHaveLength(0);
    act(() => result.current.start(records, 3));
    expect(FakeWorker.workers).toHaveLength(0);
    act(() => {
      result.current.start(records, 2);
      result.current.start(records, 2);
    });
    expect(result.current.analysis.phase).toBe("preparing");
    const worker = FakeWorker.workers[0];
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ run: 1, records: records.map(({ id, text }) => ({ id, text })) });
    worker.emit({ run: 1, type: "download", progress: 47 });
    expect(result.current.analysis).toMatchObject({ phase: "download", progress: 47 });
    worker.emit({ run: 1, type: "initialize" });
    expect(result.current.analysis.phase).toBe("initialize");
    worker.emit({ run: 1, type: "analyse" });
    expect(result.current.analysis.phase).toBe("analyse");
    worker.emit({ run: 1, type: "result", id: "unknown", scores: positive });
    worker.emit({ run: 0, type: "result", id: "1", scores: neutral });
    worker.emit({ run: 1, type: "result", id: "0", scores: positive });
    worker.emit({ run: 1, type: "result", id: "0", scores: neutral });
    worker.emit({ run: 1, type: "done" });
    expect(result.current.analysis).toMatchObject({ phase: "error", failed: 1, predictions: [{ label: "Positive", feedbackId: "0" }] });
  });

  it("retains cancelled partial results, ignores late messages and starts a clean retry", () => {
    const { result } = renderHook(useSentiment);
    act(() => result.current.start(records, 2));
    const worker = FakeWorker.workers[0];
    worker.emit({ run: 1, type: "result", id: "0", scores: positive });
    act(() => result.current.cancel());
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.emit({ run: 1, type: "result", id: "1", scores: neutral });
    expect(result.current.analysis.phase).toBe("cancelled");
    expect(result.current.analysis.predictions).toHaveLength(1);
    act(() => result.current.start(records, 1));
    expect(result.current.analysis.predictions).toHaveLength(0);
    const next = FakeWorker.workers[1];
    const { run } = next.postMessage.mock.calls[0][0];
    next.emit({ run, type: "result", id: "0", scores: positive });
    next.emit({ run, type: "done" });
    expect(result.current.analysis.phase).toBe("complete");
    act(() => result.current.start(records, 1));
    expect(FakeWorker.workers).toHaveLength(2);
  });

  it("handles a model download failure and permits retry", () => {
    const { result } = renderHook(useSentiment);
    act(() => result.current.start(records, 2));
    FakeWorker.workers[0].emit({ run: 1, type: "error", message: "Check your internet connection." });
    expect(result.current.analysis).toMatchObject({ phase: "error", message: "Check your internet connection." });
    act(() => result.current.start(records, 1));
    expect(FakeWorker.workers).toHaveLength(2);
  });

  it("invalidates analysis when the dataset is replaced or removed, including reused IDs", () => {
    const { result } = renderHook(useFeedbackSession, { wrapper: FeedbackSession });
    act(() => result.current.setDataset({ records, name: "First", size: 1 }));
    act(() => result.current.sentiment.start(records, 2));
    const worker = FakeWorker.workers[0];
    const { run } = worker.postMessage.mock.calls[0][0];
    worker.emit({ run, type: "result", id: "0", scores: positive });
    act(() => result.current.setDataset({ records, name: "Second", size: 1 }));
    worker.emit({ run, type: "result", id: "1", scores: neutral });
    expect(result.current.sentiment.analysis).toMatchObject({ phase: "idle", predictions: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
    act(() => result.current.sentiment.start(records, 2));
    act(() => result.current.setDataset(null));
    expect(result.current.dataset).toBeNull();
    expect(FakeWorker.workers[1].terminate).toHaveBeenCalledOnce();
  });
});

function PanelHarness() {
  const { setDataset } = useFeedbackSession();
  return <><button onClick={() => setDataset({ records, name: "Synthetic", size: 2 })}>Load dataset</button><SentimentPanel /></>;
}

it("announces progress and displays searchable, sortable, filterable predictions with a review threshold", () => {
  render(<FeedbackSession><PanelHarness /></FeedbackSession>);
  expect(screen.queryByRole("button", { name: "Analyse Sentiment" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load dataset" }));
  fireEvent.click(screen.getByRole("button", { name: "Analyse Sentiment" }));
  const worker = FakeWorker.workers[0];
  const { run } = worker.postMessage.mock.calls[0][0];
  worker.emit({ run, type: "download", progress: 38 });
  expect(screen.getByRole("progressbar", { name: "Model download progress" })).toHaveValue(38);
  expect(screen.getByRole("status")).toHaveTextContent("Downloading model");
  expect(screen.getByRole("button", { name: "Cancel analysis" })).toBeEnabled();
  worker.emit({ run, type: "analyse" });
  worker.emit({ run, type: "result", id: "0", scores: positive });
  worker.emit({ run, type: "result", id: "1", scores: neutral });
  worker.emit({ run, type: "done" });
  const table = screen.getByRole("table", { name: "Sentiment predictions" });
  fireEvent.change(screen.getByLabelText("Sort predictions"), { target: { value: "low" } });
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent("54.0%Review");
  fireEvent.click(screen.getByLabelText("Low-confidence only"));
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Filter sentiment"), { target: { value: "Positive" } });
  expect(screen.getByText(/no predictions match/i)).toBeVisible();
  fireEvent.click(screen.getByLabelText("Low-confidence only"));
  fireEvent.change(screen.getByLabelText("Search predictions"), { target: { value: "NOON" } });
  expect(screen.getByText(/no predictions match/i)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Filter sentiment"), { target: { value: "Neutral" } });
  expect(within(screen.getByRole("table")).getByText("Received at noon")).toBeVisible();
});
