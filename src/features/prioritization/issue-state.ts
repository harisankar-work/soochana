import { attachGroup, newCandidate, validateCandidate, type Candidate, type Grouping } from "./candidates";
import { LIMIT } from "../issues/protocol";
import type { FeedbackRecord } from "../feedback/validation";

export type Organization = { saved: Candidate[]; dismissed: string[]; excluded: string[]; released: string[] };
export const emptyOrganization: Organization = { saved: [], dismissed: [], excluded: [], released: [] };

export function suggestions(grouping: Grouping | null, records: FeedbackRecord[]) {
  if (!grouping) return [];
  const lookup = new Map(records.slice(0, LIMIT).map((record) => [record.id, record]));
  return grouping.groups.map((group) => attachGroup({
    ...newCandidate(`suggestion-${group.id}`),
    title: lookup.get(group.representativeId)?.text.slice(0, 100).trim() || "Suggested issue",
    review: "AI suggested",
  }, group, grouping));
}

export function availableIssues(state: Organization, incoming: Candidate[]) {
  const claimed = new Set([...state.excluded, ...state.released, ...state.saved.flatMap(({ evidenceIds }) => evidenceIds)]);
  const dismissed = new Set(state.dismissed);
  const saved = new Set(state.saved.map(({ id }) => id));
  return [...state.saved, ...incoming.flatMap((candidate) => {
    if (saved.has(candidate.id) || dismissed.has(candidate.id)) return [];
    const evidenceIds = [...new Set(candidate.evidenceIds)].filter((id) => !claimed.has(id));
    // Keep the representative and membership consistent with the raw suggestion.
    if (evidenceIds.length < 2 || evidenceIds.length !== candidate.evidenceIds.length) return [];
    evidenceIds.forEach((id) => claimed.add(id));
    return [{ ...candidate, evidenceIds }];
  })];
}

export type Edit =
  | { type: "save"; candidate: Candidate; confirmAssessment?: boolean }
  | { type: "delete" | "reject"; id: string }
  | { type: "merge"; ids: string[]; target: string; title: string }
  | { type: "assign"; ids: string[]; target: string | null; from?: string }
  | { type: "create"; ids: string[]; id: string; title: string; from?: string }
  | { type: "exclude" | "restore"; ids: string[] }
  | { type: "reset" };

export function editOrganization(state: Organization, incoming: Candidate[], records: FeedbackRecord[], edit: Edit, now: number) {
  if (edit.type === "reset") return emptyOrganization;
  const current = availableIssues(state, incoming);
  const lookup = new Map(current.map((candidate) => [candidate.id, candidate]));
  const owners = new Map(current.flatMap(({ id, evidenceIds }) => evidenceIds.map((evidence) => [evidence, id])));
  const valid = new Set(records.map(({ id }) => id));
  const excluded = new Set(state.excluded);
  const dismissed = new Set(state.dismissed);
  const released = new Set(state.released);
  const saved = new Map(state.saved.map((candidate) => [candidate.id, candidate]));

  function store(candidate: Candidate, confirmAssessment = false) {
    const previous = lookup.get(candidate.id);
    const evidenceIds = [...new Set(candidate.evidenceIds)];
    const changed = Boolean(previous && (previous.evidenceIds.length !== evidenceIds.length ||
      previous.evidenceIds.some((id) => !evidenceIds.includes(id))));
    const evidenceVersion = (previous?.evidenceVersion ?? 0) + Number(changed);
    const assessed = candidate.severity != null && candidate.impact != null && candidate.confidence != null;
    const assessedVersion = assessed ? (confirmAssessment ? evidenceVersion : previous?.assessedVersion) : undefined;
    const review = candidate.review ?? "Needs review";
    saved.set(candidate.id, {
      ...candidate, title: candidate.title.trim(), evidenceIds, evidenceVersion, assessedVersion,
      review: changed && review === "Reviewed" ? "Needs review" : review === "AI suggested" ? "Needs review" : review,
      createdAt: previous?.createdAt ?? now, updatedAt: Math.max(now, (previous?.updatedAt ?? 0) + 1),
    });
  }

  function detach(ids: string[], target: string | null) {
    const selected = new Set(ids);
    for (const id of new Set(ids.map((row) => owners.get(row)))) {
      if (!id || id === target) continue;
      const issue = lookup.get(id)!;
      store({ ...issue, evidenceIds: issue.evidenceIds.filter((row) => !selected.has(row)) });
    }
  }

  if (edit.type === "save") {
    const stored = saved.get(edit.candidate.id);
    if (stored && stored.updatedAt !== edit.candidate.updatedAt) return "This issue changed since you opened it. Close the editor and reopen the current issue.";
    const problem = validateCandidate(edit.candidate, valid);
    if (problem) return problem;
    if (edit.candidate.evidenceIds.some((id) => excluded.has(id) || (owners.has(id) && owners.get(id) !== edit.candidate.id))) {
      return "Some selected feedback belongs to another issue or was excluded. Refresh the selection, or move feedback in Issue Explorer.";
    }
    lookup.get(edit.candidate.id)?.evidenceIds.filter((id) => !edit.candidate.evidenceIds.includes(id)).forEach((id) => released.add(id));
    store(edit.candidate, edit.confirmAssessment);
  } else if (edit.type === "delete" || edit.type === "reject") {
    if (!lookup.has(edit.id)) return "This issue is no longer available.";
    lookup.get(edit.id)!.evidenceIds.forEach((id) => released.add(id));
    saved.delete(edit.id);
    if (edit.id.startsWith("suggestion-")) dismissed.add(edit.id);
  } else if (edit.type === "merge") {
    const ids = [...new Set(edit.ids)];
    const target = lookup.get(edit.target);
    if (!target || !ids.includes(target.id) || ids.length < 2 || ids.some((id) => !lookup.has(id))) return "Select at least two current issues to merge.";
    const candidate = { ...target, title: edit.title, evidenceIds: [...new Set(ids.flatMap((id) => lookup.get(id)!.evidenceIds))] };
    const problem = validateCandidate(candidate, valid);
    if (problem) return problem;
    for (const id of ids.filter((id) => id !== target.id)) {
      saved.delete(id);
      if (id.startsWith("suggestion-")) dismissed.add(id);
    }
    store(candidate);
  } else if ("ids" in edit) {
    const ids = [...new Set(edit.ids)];
    if (!ids.length || ids.some((id) => !valid.has(id))) return "Select feedback from the current dataset.";
    if (edit.type === "restore") ids.forEach((id) => { excluded.delete(id); released.add(id); });
    if (edit.type === "exclude") {
      detach(ids, null);
      ids.forEach((id) => excluded.add(id));
    }
    if (edit.type === "assign" || edit.type === "create") {
      if (ids.some((id) => excluded.has(id))) return "Restore excluded feedback before assigning it.";
      if (edit.from && ids.some((id) => owners.get(id) !== edit.from)) return "The selected feedback has moved. Review the issue and select again.";
      if (edit.type === "create" && edit.from && ids.length >= lookup.get(edit.from)!.evidenceIds.length) {
        return "Leave at least one supporting review in the source issue when splitting.";
      }
      const target = edit.type === "create" ? { ...newCandidate(edit.id), title: edit.title } : edit.target ? lookup.get(edit.target) : null;
      if (edit.type === "create" && lookup.has(edit.id)) return "This issue already exists.";
      if (edit.type === "assign" && edit.target && !target) return "The destination issue is no longer available.";
      if (target) {
        const problem = validateCandidate(target, valid);
        if (problem) return problem;
      }
      detach(ids, target?.id ?? null);
      if (target) store({ ...target, evidenceIds: [...target.evidenceIds, ...ids] });
      else ids.forEach((id) => released.add(id));
    }
  }
  return { saved: [...saved.values()], dismissed: [...dismissed], excluded: [...excluded], released: [...released] };
}
