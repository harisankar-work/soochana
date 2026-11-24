"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePrioritization } from "../prioritization/use-prioritization";
import { LIMIT } from "../issues/protocol";
import { useIssues } from "../issues/use-issues";
import { useSentiment } from "../sentiment/use-sentiment";
import type { FeedbackRecord } from "./validation";

export type Dataset = { name: string; size: number; records: FeedbackRecord[] };
const noRecords: FeedbackRecord[] = [];

type Session = { autoDiscovery: boolean; setAutoDiscovery: (value: boolean) => void; datasetVersion: number; dataset: Dataset | null; setDataset: (dataset: Dataset | null, confirm?: boolean) => void; sentiment: ReturnType<typeof useSentiment>; issues: ReturnType<typeof useIssues>; prioritization: ReturnType<typeof usePrioritization> };
const FeedbackContext = createContext<Session | null>(null);

export function FeedbackSession({ children }: { children: ReactNode }) {
  const [dataset, updateDataset] = useState<Dataset | null>(null);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [autoDiscovery, setAutoDiscovery] = useState(true);
  const sentiment = useSentiment();
  const issues = useIssues();
  const grouping = useMemo(() => issues.result ? {
    groups: issues.result.groups, method: issues.result.algorithm, threshold: issues.result.threshold,
    populationIds: issues.analysis.embeddings.map(({ id }) => id),
  } : null, [issues.result, issues.analysis.embeddings]);
  const prioritization = usePrioritization(dataset?.records ?? noRecords, grouping);
  function setDataset(next: Dataset | null, confirm = false) {
    sentiment.reset();
    issues.reset();
    prioritization.reset(!dataset && Boolean(next));
    updateDataset(next);
    setDatasetVersion((version) => version + 1);
    if (confirm && autoDiscovery && next?.records.length) issues.start(next.records, Math.min(LIMIT, next.records.length));
  }
  return <FeedbackContext.Provider value={{
    dataset, datasetVersion, setDataset, prioritization, autoDiscovery, setAutoDiscovery,
    sentiment: { ...sentiment, start: (records, count) => {
      if (issues.releaseIdleWorker()) sentiment.start(records, count);
    } },
    issues: { ...issues, start: (records, count) => {
      if (sentiment.releaseIdleWorker()) issues.start(records, count);
    } },
  }}>{children}</FeedbackContext.Provider>;
}

export function useFeedbackSession() {
  const session = useContext(FeedbackContext);
  if (!session) throw new Error("FeedbackSession is required.");
  return session;
}
