"use client";

import { useState } from "react";
import type { Candidate } from "./candidates";
import { defaults, type Factor } from "./scoring";

export const defaultWeightInputs = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, String(value)])) as Record<Factor, string>;

export function usePrioritization() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [draft, setDraft] = useState<Candidate | null>(null);
  const [weightInputs, setWeightInputs] = useState(defaultWeightInputs);

  function save(candidate: Candidate) {
    const cleaned = { ...candidate, title: candidate.title.trim(), evidenceIds: [...new Set(candidate.evidenceIds)] };
    setCandidates((previous) => previous.some(({ id }) => id === cleaned.id)
      ? previous.map((item) => item.id === cleaned.id ? cleaned : item) : [...previous, cleaned]);
    setDraft(null);
  }

  function remove(id: string) {
    setCandidates((previous) => previous.filter((candidate) => candidate.id !== id));
  }

  function reset() {
    setCandidates([]);
    setDraft(null);
    setWeightInputs(defaultWeightInputs);
  }

  return { candidates, draft, setDraft, save, remove, weightInputs, setWeightInputs, reset };
}
