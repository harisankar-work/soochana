"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePrioritization } from "../prioritization/use-prioritization";
import { useIssues } from "../issues/use-issues";
import { useSentiment } from "../sentiment/use-sentiment";
import type { FeedbackRecord } from "./validation";

export type Dataset = { name: string; size: number; records: FeedbackRecord[] };
type Session = { datasetVersion: number; dataset: Dataset | null; setDataset: (dataset: Dataset | null) => void; sentiment: ReturnType<typeof useSentiment>; issues: ReturnType<typeof useIssues>; prioritization: ReturnType<typeof usePrioritization> };
const FeedbackContext = createContext<Session | null>(null);

export function FeedbackSession({ children }: { children: ReactNode }) {
  const [dataset, updateDataset] = useState<Dataset | null>(null);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const sentiment = useSentiment();
  const issues = useIssues();
  const prioritization = usePrioritization();
  function setDataset(next: Dataset | null) {
    sentiment.reset();
    issues.reset();
    prioritization.reset();
    updateDataset(next);
    setDatasetVersion((version) => version + 1);
  }
  return <FeedbackContext.Provider value={{
    dataset, datasetVersion, setDataset, prioritization,
    sentiment: { ...sentiment, start: (records, count) => {
      if (!issues.isRunning()) sentiment.start(records, count);
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
