"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { marketplaceMethod, readPreparedMarketplace } from "../demo/marketplace";
import { usePrioritization } from "../prioritization/use-prioritization";
import { LIMIT } from "../issues/protocol";
import { useIssues } from "../issues/use-issues";
import { useSentiment } from "../sentiment/use-sentiment";
import type { FeedbackRecord } from "./validation";

export type Dataset = { name: string; size: number; records: FeedbackRecord[]; marketplace?: true };
const noRecords: FeedbackRecord[] = [];

type Session = { demoMode: "prepared" | "live" | null; loadPreparedDemo: () => Promise<void>; runLiveDemo: () => void; autoDiscovery: boolean; setAutoDiscovery: (value: boolean) => void; datasetVersion: number; dataset: Dataset | null; setDataset: (dataset: Dataset | null, confirm?: boolean) => void; sentiment: ReturnType<typeof useSentiment>; issues: ReturnType<typeof useIssues>; prioritization: ReturnType<typeof usePrioritization> };
const FeedbackContext = createContext<Session | null>(null);

export function FeedbackSession({ children }: { children: ReactNode }) {
  const [dataset, updateDataset] = useState<Dataset | null>(null);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const generation = useRef(0);
  const [autoDiscovery, setAutoDiscovery] = useState(true);
  const [demoMode, setDemoMode] = useState<Session["demoMode"]>(null);
  const sentiment = useSentiment();
  const issues = useIssues();
  const grouping = useMemo(() => issues.result ? {
    groups: issues.result.groups, method: issues.result.algorithm, threshold: issues.result.threshold,
    populationIds: issues.analysis.embeddings.map(({ id }) => id),
  } : null, [issues.result, issues.analysis.embeddings]);
  const prioritization = usePrioritization(dataset?.records ?? noRecords, grouping, dataset?.marketplace === true);
  function startMarketplace(records: FeedbackRecord[]) {
    setDemoMode("live");
    sentiment.reset();
    issues.reset();
    issues.configureGrouping(marketplaceMethod);
    const count = Math.min(LIMIT, records.length);
    sentiment.start(records, count, () => {
      if (sentiment.releaseIdleWorker()) issues.start(records, count);
    });
  }

  function setDataset(next: Dataset | null, confirm = false, preserveManual = true) {
    generation.current++;
    sentiment.reset();
    issues.reset();
    prioritization.reset(preserveManual && !dataset && Boolean(next));
    updateDataset(next);
    setDatasetVersion((version) => version + 1);
    setDemoMode(next?.marketplace ? "live" : null);
    if (next?.marketplace) issues.configureGrouping(marketplaceMethod);
    if (confirm && autoDiscovery && next?.records.length) {
      if (next.marketplace) startMarketplace(next.records);
      else issues.start(next.records, Math.min(LIMIT, next.records.length), true);
    }
  }
  async function loadPreparedDemo() {
    const requested = generation.current;
    const prepared = await readPreparedMarketplace();
    if (requested !== generation.current) throw new Error("The workspace changed while the demo was loading. Retry to replace the current workspace.");
    setDataset(prepared.dataset, false, false);
    sentiment.seed(prepared.predictions);
    issues.seed(prepared.dataset.records, prepared.embeddings, marketplaceMethod);
    setDemoMode("prepared");
  }

  function runLiveDemo() {
    if (dataset?.marketplace && !sentiment.busy && !issues.busy) startMarketplace(dataset.records);
  }

  return <FeedbackContext.Provider value={{
    dataset, datasetVersion, setDataset, prioritization, autoDiscovery, setAutoDiscovery, demoMode, loadPreparedDemo, runLiveDemo,
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
