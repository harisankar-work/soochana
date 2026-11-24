import type { IssueGroup, Method } from "../issues/clustering";

export const statuses = ["Needs review", "Under investigation", "Validated by reviewer", "Deferred"] as const;
export type Status = (typeof statuses)[number];
export type Assessment = 1 | 2 | 3 | 4 | 5;
export type GroupSnapshot = {
  groupId: string;
  method: Method;
  threshold: number;
  representativeId: string;
  populationIds: string[];
};
export type Grouping = { groups: IssueGroup[]; method: Method; threshold: number; populationIds: string[] };

export type Candidate = {
  id: string;
  title: string;
  description: string;
  evidenceIds: string[];
  origin: GroupSnapshot | null;
  severity: Assessment | null;
  impact: Assessment | null;
  confidence: Assessment | null;
  status: Status;
  notes: string;
  review?: "AI suggested" | "Needs review" | "Reviewed";
  urgency?: Assessment | null;
  effort?: Assessment | null;
  createdAt?: number;
  updatedAt?: number;
  evidenceVersion?: number;
  assessedVersion?: number;

};

export function newCandidate(id: string): Candidate {
  return { id, title: "", description: "", evidenceIds: [], origin: null, severity: null, impact: null, confidence: null, status: "Needs review", notes: "" };
}

export function attachGroup(candidate: Candidate, group: IssueGroup, grouping: Grouping): Candidate {
  return {
    ...candidate, evidenceIds: [...new Set(group.feedbackIds)], origin: {
      groupId: group.id, method: grouping.method, threshold: grouping.threshold, representativeId: group.representativeId,
      populationIds: [...new Set(grouping.populationIds)].sort(),
    },
  };
}

export function snapshotIsStale(snapshot: GroupSnapshot, grouping: Grouping | null) {
  const matching = grouping?.groups.find(({ id }) => id === snapshot.groupId);
  return !grouping || !matching || matching.representativeId !== snapshot.representativeId ||
    grouping.method !== snapshot.method || grouping.threshold !== snapshot.threshold ||
    JSON.stringify([...new Set(grouping.populationIds)].sort()) !== JSON.stringify(snapshot.populationIds);
}

export function isAssessment(value: unknown): value is Assessment {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function validateCandidate(candidate: Candidate, available: ReadonlySet<string>) {
  if (!candidate.title.trim() || candidate.title.trim().length > 100) return "Enter an issue title between 1 and 100 characters.";
  if (candidate.evidenceIds.some((id) => !available.has(id))) return "Some evidence no longer exists in this dataset. Review the selection.";
  if ([candidate.severity, candidate.impact, candidate.confidence, candidate.urgency, candidate.effort].some((value) => value != null && !isAssessment(value))) {
    return "Assessments must be whole numbers between 1 and 5.";
  }
  return null;
}

export function needsReassessment(candidate: Candidate) {
  return candidate.assessedVersion !== undefined && candidate.assessedVersion !== (candidate.evidenceVersion ?? 0);
}
