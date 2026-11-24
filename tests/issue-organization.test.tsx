import { expect, it } from "vitest";
import { newCandidate, needsReassessment } from "@/features/prioritization/candidates";
import { availableIssues, editOrganization, emptyOrganization, type Edit } from "@/features/prioritization/issue-state";
import { csvCell } from "@/features/prioritization/exports";
import { defaults, rank } from "@/features/prioritization/scoring";

const rows = Array.from({ length: 20 }, (_, index) => ({
  id: String(index + 1), text: `Review ${index + 1}`, originalText: `Review ${index + 1}`,
  originalRow: index + 2, date: null, source: null, category: null, rating: null,
}));
const ids = rows.map(({ id }) => id);
const first = { ...newCandidate("suggestion-a"), title: "Checkout", evidenceIds: ids.slice(0, 12), review: "AI suggested" as const };
const second = { ...newCandidate("suggestion-b"), title: "Card processing", evidenceIds: ids.slice(12), review: "AI suggested" as const };
const raw = [first, second];

it("merges 12 and 8, splits 5, moves, excludes, restores and keeps reanalysis separate", () => {
  let current = emptyOrganization;
  let now = 0;
  function act(edit: Edit) {
    const next = editOrganization(current, raw, rows, edit, ++now);
    if (typeof next === "string") throw new Error(next);
    current = next;
  }
  act({ type: "merge", ids: [first.id, second.id, second.id], target: first.id, title: "Payment failures" });
  expect(availableIssues(current, raw)).toMatchObject([{ title: "Payment failures", evidenceIds: ids }]);
  act({ type: "create", id: "refunds", title: "Refunds", from: first.id, ids: ids.slice(0, 5) });
  expect(availableIssues(current, raw).map(({ evidenceIds }) => evidenceIds.length)).toEqual([15, 5]);
  act({ type: "assign", target: first.id, from: "refunds", ids: ["1", "1"] });
  expect(availableIssues(current, raw).map(({ evidenceIds }) => evidenceIds.length)).toEqual([16, 4]);
  act({ type: "exclude", ids: ["1"] });
  expect(current.excluded).toEqual(["1"]);
  act({ type: "restore", ids: ["1"] });
  expect(current.excluded).toEqual([]);
  act({ type: "delete", id: "refunds" });
  expect(availableIssues(current, [{ ...first, id: "suggestion-reanalysed" }]).flatMap(({ evidenceIds }) => evidenceIds)).not.toContain("1");
  expect(availableIssues(current, raw)).toHaveLength(1);
});

it("rejects conflicting drafts and duplicate ownership, and flags an assessed evidence change", () => {
  const assessed = { ...first, review: "Reviewed" as const, severity: 5 as const, impact: 4 as const, confidence: 4 as const };
  const initial = editOrganization(emptyOrganization, raw, rows, { type: "save", candidate: assessed, confirmAssessment: true }, 1);
  if (typeof initial === "string") throw new Error(initial);
  const moved = editOrganization(initial, raw, rows, { type: "assign", target: null, from: first.id, ids: ["1"] }, 2);
  if (typeof moved === "string") throw new Error(moved);
  const issue = moved.saved[0];
  expect(issue).toMatchObject({ review: "Needs review", severity: 5, impact: 4, confidence: 4, evidenceVersion: 1 });
  expect(needsReassessment(issue)).toBe(true);
  expect(rank([{ candidate: issue, count: 11, missing: 0 }], defaults)).toEqual([]);
  expect(editOrganization(moved, raw, rows, { type: "save", candidate: initial.saved[0] }, 3)).toMatch(/changed since/);
  expect(editOrganization(moved, raw, rows, { type: "save", candidate: { ...newCandidate("copy"), title: "Copy", evidenceIds: ["2"] } }, 3)).toMatch(/belongs to another issue/);
  expect(editOrganization(moved, raw, rows, { type: "assign", ids: ["2"], target: "missing" }, 3)).toMatch(/no longer available/);
});

it("keeps title-only issues unscored and escapes spreadsheet formulas and quotes", () => {
  const issue = { ...newCandidate("manual"), title: "Request keyboard shortcuts" };
  expect(editOrganization(emptyOrganization, [], [], { type: "save", candidate: issue }, 1)).toMatchObject({ saved: [issue] });
  expect(rank([{ candidate: issue, count: 0, missing: 0 }], defaults)).toEqual([]);
  expect(csvCell('  =HYPERLINK("x")')).toBe('"\'  =HYPERLINK(""x"")"');
  expect(csvCell("Normal, text")).toBe('"Normal, text"');
  expect(csvCell("\n@formula")).toBe('"\'\n@formula"');
});
