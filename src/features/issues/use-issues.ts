"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cluster, cosine, similarityMatrix } from "./clustering";
import type { FeedbackRecord } from "../feedback/validation";
import { DEFAULT_THRESHOLD, LIMIT, validEmbedding, type Embedding, type Event, type Request } from "./protocol";

type Analysis = {
  phase: "idle" | "preparing" | "download" | "initialize" | "embed" | "complete" | "cancelled" | "error";
  selected: number;
  failed: number;
  embeddings: Embedding[];
  analysedIds: string[];
  progress?: number;
};

type GroupingMode = "complete-link-v1" | "average-link-v1";
export const groupingDefaults = { "complete-link-v1": DEFAULT_THRESHOLD, "average-link-v1": 0.45 } as const;

const idle: Analysis = { phase: "idle", selected: 0, failed: 0, embeddings: [], analysedIds: [] };

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
  const active = useRef(false);
  const source = useRef<FeedbackRecord[] | null>(null);
  const cache = useRef(new Map<string, Embedding>());

  useEffect(() => {
    const embeddings = cache.current;
    return () => {
      current.current?.terminate();
      current.current = null;
      active.current = false;
      source.current = null;
      embeddings.clear();
    };
  }, []);

  function stop() {
    sequence.current++;
    active.current = false;
    current.current?.terminate();
    current.current = null;
  }

  function reset() {
    stop();
    source.current = null;
    cache.current.clear();
    setAnalysis(idle);
    configureGrouping("complete-link-v1");
  }

  function configureGrouping(next: GroupingMode) {
    setMethod(next);
    setThreshold(groupingDefaults[next]);
  }

  function cancel() {
    if (!active.current) return;
    stop();
    setAnalysis((previous) => ({ ...previous, phase: "cancelled", progress: undefined }));
  }

  function start(records: FeedbackRecord[], count: number) {
    if (active.current || !Number.isInteger(count) || count < 1 || count > Math.min(LIMIT, records.length)) return;
    if (records !== source.current) {
      source.current = records;
      cache.current.clear();
    }
    const run = ++sequence.current;
    const analysedIds = [...cache.current.keys()];
    const selected = records.slice(0, count);
    const reused = selected.flatMap(({ id }) => {
      const embedding = cache.current.get(id);
      return embedding ? [embedding] : [];
    });
    const inputs = selected.filter(({ id }) => !cache.current.has(id)).map(({ id, text }) => ({ id, text }));
    if (!inputs.length) {
      setAnalysis({ ...idle, phase: "complete", selected: count, embeddings: reused, analysedIds });
      return;
    }
    const pending = new Set(inputs.map(({ id }) => id));
    active.current = true;
    setAnalysis({ ...idle, phase: "preparing", selected: count, embeddings: reused, analysedIds });
    function fail() {
      if (run !== sequence.current || !active.current) return;
      stop();
      setAnalysis((previous) => ({ ...previous, phase: "error", progress: undefined }));
    }
    try {
      if (typeof WebAssembly === "undefined") throw new Error("WebAssembly is unavailable");
      const worker = current.current ?? new Worker(new URL("./embeddings.worker.ts", import.meta.url), { type: "module" });
      current.current = worker;
      observe(worker, ({ data }) => {
        if (data?.run !== run || sequence.current !== run || !active.current) return;
        if (data.type === "error") {
          fail();
        } else if (data.type === "done") {
          active.current = false;
          setAnalysis((previous) => ({ ...previous, phase: "complete", failed: previous.failed + pending.size }));
        } else if (data.type === "result" || data.type === "row-error") {
          if (!pending.delete(data.id)) return;
          const vector = data.type === "result" && validEmbedding(data.vector) ? data.vector : null;
          const embedding = vector ? { id: data.id, vector } : null;
          if (embedding) cache.current.set(data.id, embedding);
          setAnalysis((previous) => embedding
            ? { ...previous, embeddings: [...previous.embeddings, embedding], analysedIds: [...previous.analysedIds, embedding.id] }
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

  function releaseIdleWorker() {
    if (active.current) return false;
    stop();
    return true;
  }

  const busy = ["preparing", "download", "initialize", "embed"].includes(analysis.phase);
  const vectors = busy ? null : analysis.embeddings;
  const matrix = useMemo(() => vectors?.length ? similarityMatrix(vectors) : null, [vectors]);
  const result = useMemo(() => matrix ? cluster(matrix, threshold, method) : null, [matrix, threshold, method]);
  function matchAssignments(rowIds: string[], candidates: { id: string; evidenceIds: string[] }[]) {
    const byId = cache.current;
    const evidence = candidates.flatMap(({ id: issueId, evidenceIds }) =>
      evidenceIds.flatMap((id) => {
        const item = byId.get(id);
        return item ? [{ issueId, vector: item.vector }] : [];
      }));
    return rowIds.flatMap((id) => {
      const embedding = byId.get(id);
      if (!embedding) return [];
      let best: { issueId: string; score: number } | null = null;
      for (const { issueId, vector } of evidence) {
        const score = cosine(embedding.vector, vector);
        if (score !== null && (!best || score > best.score)) best = { issueId, score };
      }
      return best && best.score >= 0.60 ? [{ id, ...best }] : [];
    });
  }

  return { analysis, matchAssignments, method, configureGrouping, threshold, setThreshold, start, cancel, reset, result, busy, releaseIdleWorker };
}
