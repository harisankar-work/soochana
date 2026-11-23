"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cluster, similarityMatrix } from "./clustering";
import type { FeedbackRecord } from "../feedback/validation";
import { DEFAULT_THRESHOLD, LIMIT, validEmbedding, type Embedding, type Event, type Request } from "./protocol";

type Analysis = {
  phase: "idle" | "preparing" | "download" | "initialize" | "embed" | "complete" | "cancelled" | "error";
  selected: number;
  failed: number;
  embeddings: Embedding[];
  progress?: number;
};

type GroupingMode = "complete-link-v1" | "average-link-v1";
export const groupingDefaults = { "complete-link-v1": DEFAULT_THRESHOLD, "average-link-v1": 0.45 } as const;

const idle: Analysis = { phase: "idle", selected: 0, failed: 0, embeddings: [] };

function observe(worker: Worker, message: (event: MessageEvent<Event>) => void, error: () => void) {
  worker.onmessage = message;
  worker.onerror = error;
  worker.onmessageerror = error;
}

export function useIssues() {
  const [analysis, setAnalysis] = useState(idle);
  const [method, setMethod] = useState<GroupingMode>("complete-link-v1");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const current = useRef<Worker | null>(null);
  const sequence = useRef(0);

  useEffect(() => () => {
    current.current?.terminate();
    current.current = null;
    sequence.current++;
  }, []);

  function stop() {
    sequence.current++;
    current.current?.terminate();
    current.current = null;
  }

  function reset() {
    stop();
    setAnalysis(idle);
    configureGrouping("complete-link-v1");
  }

  function configureGrouping(next: GroupingMode) {
    setMethod(next);
    setThreshold(groupingDefaults[next]);
  }

  function cancel() {
    if (!current.current) return;
    stop();
    setAnalysis((previous) => ({ ...previous, phase: "cancelled", progress: undefined }));
  }

  function start(records: FeedbackRecord[], count: number) {
    if (current.current || !Number.isInteger(count) || count < 1 || count > Math.min(LIMIT, records.length)) return;
    const run = ++sequence.current;
    const inputs = records.slice(0, count).map(({ id, text }) => ({ id, text }));
    const pending = new Set(inputs.map(({ id }) => id));
    setAnalysis({ ...idle, phase: "preparing", selected: count });
    function fail() {
      if (run !== sequence.current) return;
      stop();
      setAnalysis((previous) => ({ ...previous, phase: "error", progress: undefined }));
    }
    try {
      if (typeof WebAssembly === "undefined") throw new Error("WebAssembly is unavailable");
      const worker = new Worker(new URL("./embeddings.worker.ts", import.meta.url), { type: "module" });
      current.current = worker;
      observe(worker, ({ data }) => {
        if (data?.run !== run || sequence.current !== run) return;
        if (data.type === "error") {
          fail();
        } else if (data.type === "done") {
          stop();
          setAnalysis((previous) => ({ ...previous, phase: "complete", failed: previous.failed + pending.size }));
        } else if (data.type === "result" || data.type === "row-error") {
          if (!pending.delete(data.id)) return;
          const vector = data.type === "result" && validEmbedding(data.vector) ? data.vector : null;
          setAnalysis((previous) => vector
            ? { ...previous, embeddings: [...previous.embeddings, { id: data.id, vector }] }
            : { ...previous, failed: previous.failed + 1 });
        } else if (data.type === "download" || data.type === "initialize" || data.type === "embed") {
          const phase = data.type;
          setAnalysis((previous) => ({ ...previous, phase, progress: data.type === "download" && typeof data.progress === "number" && Number.isFinite(data.progress) && data.progress >= 0 && data.progress <= 100 ? data.progress : undefined }));
        }
      }, fail);
      worker.postMessage({ run, records: inputs } satisfies Request);
    } catch {
      fail();
    }
  }

  const busy = ["preparing", "download", "initialize", "embed"].includes(analysis.phase);
  const vectors = busy ? null : analysis.embeddings;
  const matrix = useMemo(() => vectors?.length ? similarityMatrix(vectors) : null, [vectors]);
  const result = useMemo(() => matrix ? cluster(matrix, threshold, method) : null, [matrix, threshold, method]);
  return { analysis, method, configureGrouping, threshold, setThreshold, start, cancel, reset, result, busy, isRunning: () => current.current !== null };
}
