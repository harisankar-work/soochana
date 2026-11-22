"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useSentiment } from "../sentiment/use-sentiment";
import type { FeedbackRecord } from "./validation";

export type Dataset = { name: string; size: number; records: FeedbackRecord[] };
type Session = { dataset: Dataset | null; setDataset: (dataset: Dataset | null) => void; sentiment: ReturnType<typeof useSentiment> };
const FeedbackContext = createContext<Session | null>(null);

export function FeedbackSession({ children }: { children: ReactNode }) {
  const [dataset, updateDataset] = useState<Dataset | null>(null);
  const sentiment = useSentiment();
  function setDataset(next: Dataset | null) {
    sentiment.reset();
    updateDataset(next);
  }
  return <FeedbackContext.Provider value={{ dataset, setDataset, sentiment }}>{children}</FeedbackContext.Provider>;
}

export function useFeedbackSession() {
  const session = useContext(FeedbackContext);
  if (!session) throw new Error("FeedbackSession is required.");
  return session;
}
