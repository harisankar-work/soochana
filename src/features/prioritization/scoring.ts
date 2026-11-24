import type { Row } from "../analytics/calculations";
import { isAssessment, needsReassessment, type Candidate } from "./candidates";

export const factors = ["frequency", "severity", "impact", "confidence"] as const;
export type Factor = (typeof factors)[number];
export const factorLabels: Record<Factor, string> = {
  frequency: "Frequency", severity: "Severity", impact: "Business impact", confidence: "Evidence confidence",
};
export type Weights = Record<Factor, number>;
export const defaults: Weights = { frequency: 30, severity: 30, impact: 25, confidence: 15 };
export const frequencyBenchmark = 20;

export function validWeights(weights: Weights) {
  return factors.every((factor) => Number.isFinite(weights[factor]) && weights[factor] >= 0 && weights[factor] <= 100) &&
    Math.abs(factors.reduce((sum, factor) => sum + weights[factor], 0) - 100) <= 1e-9;
}

export function score(candidate: Candidate, count: number, weights: Weights) {
  const { severity, impact, confidence } = candidate;
  if (!validWeights(weights) || !Number.isInteger(count) || count < 1 ||
    !isAssessment(severity) || !isAssessment(impact) || !isAssessment(confidence)) return null;
  const values: Weights = {
    frequency: Math.min(count / frequencyBenchmark, 1) * 100,
    severity: (severity - 1) * 25, impact: (impact - 1) * 25, confidence: (confidence - 1) * 25,
  };
  const contributions = Object.fromEntries(factors.map((factor) => [factor, values[factor] * weights[factor] / 100])) as Weights;
  const total = Math.min(100, factors.reduce((sum, factor) => sum + contributions[factor], 0));
  return { values, contributions, total };
}

export function evidenceFor(candidate: Candidate, rows: Map<string, Row>, latestDatasetDate: string | null, earliestDatasetDate: string | null) {
  const evidence = [...new Set(candidate.evidenceIds)].flatMap((id) => {
    const row = rows.get(id);
    return row ? [row] : [];
  }).sort((a, b) => a.record.originalRow - b.record.originalRow);
  const classified = evidence.filter((row) => row.sentiment);
  const negative = classified.filter((row) => row.sentiment === "Negative").length;
  const rated = evidence.flatMap((row) => row.rating === null ? [] : [row.rating]);
  const dates = evidence.flatMap((row) => row.date ? [row.date] : []).sort();
  const day = 86_400_000;
  const anchor = latestDatasetDate ? Date.parse(latestDatasetDate) : NaN;
  const datedEnough = earliestDatasetDate && Number.isFinite(anchor) && anchor - Date.parse(earliestDatasetDate) >= 55 * day;
  const recent = dates.filter((date) => anchor - Date.parse(date) < 28 * day).length;
  const previous = dates.filter((date) => {
    const age = anchor - Date.parse(date);
    return age >= 28 * day && age < 56 * day;
  }).length;
  const trend = datedEnough && recent + previous >= 4 && recent > 0 && previous > 0
    ? { recent, previous, anchor: latestDatasetDate } : null;
  return {
    evidence, missing: new Set(candidate.evidenceIds).size - evidence.length,
    classified: classified.length, negative, negativeShare: classified.length ? negative / classified.length : null,
    rated: rated.length, averageRating: rated.length ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length : null,
    dated: dates.length, latest: dates.at(-1) ?? null, trend,
  };
}

export function rank(candidates: { candidate: Candidate; count: number; missing: number }[], weights: Weights) {
  return candidates.flatMap(({ candidate, count, missing }) => {
    const result = missing || needsReassessment(candidate) ? null : score(candidate, count, weights);
    return result ? [{ id: candidate.id, count, result }] : [];
  }).sort((a, b) => b.result.total - a.result.total || b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function sensitivity(current: NonNullable<ReturnType<typeof score>>, baseline: NonNullable<ReturnType<typeof score>>) {
  const changes = factors.map((factor) => ({ factor, delta: current.contributions[factor] - baseline.contributions[factor] }));
  return changes.reduce((largest, change) => Math.abs(change.delta) > Math.abs(largest.delta) ? change : largest);
}
