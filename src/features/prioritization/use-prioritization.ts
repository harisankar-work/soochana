"use client";

import { illustrateMarketplaceIssues } from "../demo/marketplace";
import { useMemo, useState } from "react";
import type { FeedbackRecord } from "../feedback/validation";
import type { Candidate, Grouping } from "./candidates";
import { availableIssues, editOrganization, emptyOrganization, suggestions, type Edit, type Organization } from "./issue-state";
import { defaults, type Factor } from "./scoring";

export const defaultWeightInputs = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, String(value)])) as Record<Factor, string>;

export function usePrioritization(records: FeedbackRecord[], grouping: Grouping | null, marketplace = false) {
  const [history, setHistory] = useState<Organization[]>([emptyOrganization]);
  const [draft, setDraft] = useState<Candidate | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [weightInputs, setWeightInputs] = useState(defaultWeightInputs);
  const state = history.at(-1)!;
  const incoming = useMemo(() => {
    const raw = suggestions(grouping, records);
    return marketplace ? illustrateMarketplaceIssues(raw, records) : raw;
  }, [grouping, records, marketplace]);
  const candidates = useMemo(() => availableIssues(state, incoming), [state, incoming]);

  function edit(action: Edit) {
    const result = editOrganization(state, incoming, records, action, Date.now());
    setProblem(typeof result === "string" ? result : "");
    if (typeof result === "string") return false;
    setHistory((previous) => [...previous.slice(-19), result]);
    return true;
  }

  function save(candidate: Candidate, confirmAssessment = false) {
    if (!edit({ type: "save", candidate, confirmAssessment })) return false;
    setDraft(null);
    return true;
  }

  function undo() {
    setHistory((previous) => previous.length > 1 ? previous.slice(0, -1) : previous);
    setDraft(null);
    setProblem("");
  }

  function reset(keepManual = false) {
    setHistory([keepManual ? { ...emptyOrganization, saved: state.saved.filter((item) => !item.evidenceIds.length && !item.origin) } : emptyOrganization]);
    setDraft(null);
    setFocused(null);
    setProblem("");
    setWeightInputs(defaultWeightInputs);
  }

  return { candidates, draft, setDraft, save, remove: (id: string) => edit({ type: "delete", id }),
    edit, undo, canUndo: history.length > 1, focused, setFocused, excluded: state.excluded, problem, weightInputs, setWeightInputs, reset };
}
