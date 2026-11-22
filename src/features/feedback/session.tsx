"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { FeedbackRecord } from "./validation";

export type Dataset = { name: string; size: number; records: FeedbackRecord[] };
type Session = { dataset: Dataset | null; setDataset: (dataset: Dataset | null) => void };
const FeedbackContext = createContext<Session | null>(null);

export function FeedbackSession({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  return <FeedbackContext.Provider value={{ dataset, setDataset }}>{children}</FeedbackContext.Provider>;
}

export function useFeedbackSession() {
  const session = useContext(FeedbackContext);
  if (!session) throw new Error("FeedbackSession is required.");
  return session;
}
