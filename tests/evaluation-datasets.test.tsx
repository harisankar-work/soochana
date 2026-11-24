import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../scripts/evaluate-datasets.mjs";
import { defaultFilters, filterRows, makeRows, sourceKey, summarize } from "@/features/analytics/calculations";
import { parseCsv } from "@/features/feedback/csv";
import { FeedbackPreview } from "@/features/feedback/preview";
import { suggestMapping, validateRows } from "@/features/feedback/validation";
import { newCandidate } from "@/features/prioritization/candidates";
import { defaults, evidenceFor, score } from "@/features/prioritization/scoring";

function imported(name: string) {
  const fixture = loadDataset(name);
  const parsed = parseCsv(fixture.csv);
  return { fixture, records: validateRows(parsed, suggestMapping(parsed.headers)).accepted };
}

describe("Milestone 10 independent dataset expectations", () => {
  it.each(["tiny-10", "small-25", "medium-50", "demo-96", "benchmark-100", "jira-200", "large-500", "stress-1000", "limit-10000"])(
    "reconciles dashboard and filters for %s", (name) => {
      const { fixture, records } = imported(name);
      const { expected } = fixture;
      if ("error" in expected) throw new Error(expected.error);
      const filters = expected.filters;
      const rows = makeRows(records, []);
      const metrics = summarize(rows);
      expect(rows).toHaveLength(expected.accepted!);
      expect(metrics).toMatchObject({ rated: expected.rated, dated: expected.dated, average: expected.averageRating, analysed: 0 });
      expect(Object.fromEntries(metrics.sources.map(({ label, rows }) => [label, rows.length]))).toEqual(expected.sources);
      expect(filterRows(rows, { ...defaultFilters, source: sourceKey(filters.source) }).matched).toHaveLength(filters.sourceCount);
      const [from, to] = filters.window;
      expect(filterRows(rows, { ...defaultFilters, from, to }).matched).toHaveLength(filters.windowCount);
      expect(filterRows(rows, { ...defaultFilters, from, to, rating: "rated", source: sourceKey(filters.source) }).matched).toHaveLength(filters.combinedCount);
    },
  );

  it("orders imported rows by rating, preserving source order for ties", () => {
    const { records } = imported("tiny-10");
    render(<FeedbackPreview records={records} />);
    const displayedRows = () => within(screen.getByRole("table", { name: "Accepted feedback" })).getAllByRole("row")
      .slice(1).map((row) => Number(within(row).getAllByRole("cell").at(-1)!.textContent));
    expect(displayedRows()).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "highest" } });
    expect(displayedRows()).toEqual([6, 11, 5, 10, 4, 9, 3, 8, 2, 7]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "oldest" } });
    expect(displayedRows()).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("uses real demo evidence and checks the score against independent arithmetic", () => {
    const rows = makeRows(imported("demo-96").records, []);
    const chosen = rows.find(({ record }) => record.originalRow === 2)!;
    expect(chosen.record.originalText).toMatch(/charged twice/i);
    const candidate = {
      ...newCandidate("duplicate-payment"),
      evidenceIds: [chosen.record.id, chosen.record.id],
      severity: 5 as const, impact: 4 as const, confidence: 4 as const,
    };
    const observed = evidenceFor(candidate, new Map(rows.map((row) => [row.record.id, row])), null, null);
    expect(observed).toMatchObject({ evidence: [chosen], missing: 0 });
    expect(score(candidate, observed.evidence.length, defaults)).toEqual({
      values: { frequency: 5, severity: 100, impact: 75, confidence: 75 },
      contributions: { frequency: 1.5, severity: 30, impact: 18.75, confidence: 11.25 },
      total: 61.5,
    });
  });
});
