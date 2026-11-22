"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedbackRecord } from "../feedback/validation";
import { MAX_ANALYSIS_COUNT, parsePrediction, type Prediction, type WorkerEvent, type WorkerRequest } from "./protocol";

type Phase = "idle" | "preparing" | "download" | "initialize" | "analyse" | "complete" | "cancelled" | "error";
type Analysis = {
  phase: Phase;
  selected: number;
  failed: number;
  predictions: Prediction[];
  progress?: number;
  message?: string;
};
const idle: Analysis = { phase: "idle", selected: 0, failed: 0, predictions: [] };

function observeWorker(worker: Worker, onMessage: (event: MessageEvent<WorkerEvent>) => void, onError: (message: string) => void) {
  worker.onerror = () => onError("The analysis worker stopped. Close unused tabs or retry in an up-to-date browser.");
  worker.onmessageerror = () => onError("The browser could not read the analysis results. Retry the analysis.");
  worker.onmessage = onMessage;
}

export function useSentiment() {
  const [analysis, setAnalysis] = useState<Analysis>(idle);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const active = useRef(false);

  useEffect(() => () => {
    sequence.current += 1;
    active.current = false;
    worker.current?.terminate();
    worker.current = null;
  }, []);

  function stopWorker() {
    sequence.current += 1;
    active.current = false;
    worker.current?.terminate();
    worker.current = null;
  }

  function reset() {
    stopWorker();
    setAnalysis(idle);
  }

  function cancel() {
    if (!active.current) return;
    stopWorker();
    setAnalysis((previous) => ({ ...previous, phase: "cancelled", progress: undefined }));
  }

  function start(records: FeedbackRecord[], count: number) {
    if (active.current || !Number.isInteger(count) || count < 1 || count > Math.min(records.length, MAX_ANALYSIS_COUNT)) return;
    const run = ++sequence.current;
    active.current = true;
    const inputs = records.slice(0, count).map(({ id, text }) => ({ id, text }));
    const pending = new Set(inputs.map(({ id }) => id));
    setAnalysis({ ...idle, phase: "preparing", selected: count });

    function fail(message: string) {
      if (sequence.current !== run || !active.current) return;
      stopWorker();
      setAnalysis((previous) => ({ ...previous, phase: "error", message }));
    }

    try {
      if (typeof WebAssembly === "undefined") throw new Error("WebAssembly is unavailable.");
      const current = worker.current ?? new Worker(new URL("./sentiment.worker.ts", import.meta.url), { type: "module" });
      worker.current = current;
      observeWorker(current, ({ data }) => {
        if (sequence.current !== run || data.run !== run || !active.current) return;
        switch (data.type) {
          case "download":
            setAnalysis((previous) => ({ ...previous, phase: "download", progress: data.progress }));
            break;
          case "initialize":
          case "analyse":
            setAnalysis((previous) => ({ ...previous, phase: data.type === "analyse" ? "analyse" : "initialize", progress: undefined }));
            break;
          case "row-error":
          case "result": {
            if (!pending.delete(data.id)) break;
            const prediction = data.type === "result" ? parsePrediction(data.id, data.scores) : null;
            setAnalysis((previous) => prediction
              ? { ...previous, predictions: [...previous.predictions, prediction] }
              : { ...previous, failed: previous.failed + 1 });
            break;
          }
          case "done": {
            active.current = false;
            const missing = pending.size;
            setAnalysis((previous) => {
              const failed = previous.failed + missing;
              return {
                ...previous, failed, phase: failed ? "error" : "complete",
                message: failed ? "Some predictions failed. Available results are shown below. Try a smaller batch or retry." : undefined,
              };
            });
            break;
          }
          case "error":
            fail(data.message);
            break;
        }
      }, fail);
      current.postMessage({ run, records: inputs } satisfies WorkerRequest);
    } catch {
      fail("Could not start local analysis. Use an up-to-date browser with Web Workers and WebAssembly enabled.");
    }
  }

  const busy = ["preparing", "download", "initialize", "analyse"].includes(analysis.phase);
  return { analysis, busy, start, cancel, reset };
}
