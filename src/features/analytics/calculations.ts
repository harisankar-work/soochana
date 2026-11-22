import type { FeedbackRecord } from "../feedback/validation";
import type { IssueGroup } from "../issues/clustering";
import { labels, type Label, type Prediction } from "../sentiment/protocol";

export type Filters = { from: string; to: string; source: string; rating: "all" | "rated" | "missing"; sentiment: Label | "" };
export const defaultFilters: Filters = { from: "", to: "", source: "", rating: "all", sentiment: "" };
export type Row = { record: FeedbackRecord; date: string | null; rating: number | null; sentiment: Label | null };
export type Bucket = { key: string; label: string; rows: Row[] };
export const sourceKey = (source: string | null) => JSON.stringify(source);
export const missingSource = "No source recorded";
const DAY_MS = 86_400_000;

function dateValue(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

export function makeRows(records: FeedbackRecord[], predictions: Prediction[]): Row[] {
  const predictionsById = new Map(predictions.map(({ feedbackId, label }) => [feedbackId, label]));
  return records.map((record) => ({
    record, date: dateValue(record.date),
    rating: record.rating !== null && Number.isFinite(record.rating) && record.rating >= 1 && record.rating <= 5 ? record.rating : null,
    sentiment: predictionsById.get(record.id) ?? null,
  }));
}

export function filterRows(rows: Row[], { from, to, source, rating, sentiment }: Filters) {
  let excludedUnanalysed = 0;
  const matched = rows.filter((row) => {
    if ((from && (!row.date || row.date < from)) || (to && (!row.date || row.date > to))) return false;
    if (source && source !== sourceKey(row.record.source)) return false;
    if ((rating === "rated" && row.rating === null) || (rating === "missing" && row.rating !== null)) return false;
    if (sentiment && row.sentiment === null) excludedUnanalysed++;
    return !sentiment || row.sentiment === sentiment;
  });
  return { matched, excludedUnanalysed };
}

function makeBucket(key: string, label = key): Bucket {
  return { key, label, rows: [] };
}

export function groupSources(rows: Row[]) {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const source = row.record.source;
    const key = sourceKey(source);
    const bucket = buckets.get(key) ?? makeBucket(key, source ?? missingSource);
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

export function countSentiments(rows: Row[]) {
  const counts = { Negative: 0, Neutral: 0, Positive: 0 };
  for (const { sentiment } of rows) if (sentiment) counts[sentiment]++;
  return counts;
}

export function summarize(rows: Row[]) {
  const sentiments = labels.map((label) => makeBucket(label));
  const ratings = ["1 to <2", "2 to <3", "3 to <4", "4 to <5", "5 exactly"].map((label, index) => makeBucket(String(index), label));
  let analysed = 0, rated = 0, ratingSum = 0, dated = 0;
  for (const row of rows) {
    if (row.date) dated++;
    if (row.sentiment) {
      analysed++;
      sentiments[labels.indexOf(row.sentiment)].rows.push(row);
    }
    if (row.rating !== null) {
      rated++;
      ratingSum += row.rating;
      ratings[Math.floor(row.rating) - 1].rows.push(row);
    }
  }
  const allSources = groupSources(rows);
  const missing = allSources.find(({ key }) => key === sourceKey(null));
  const named = allSources.filter(({ key }) => key !== sourceKey(null));
  const sources = named.slice(0, 8);
  if (named.length > 8) sources.push({ key: "other", label: "Other recorded sources", rows: named.slice(8).flatMap((bucket) => bucket.rows) });
  if (missing) sources.push(missing);
  const sourceSentiment = sources.map((bucket) => {
    const counts = countSentiments(bucket.rows);
    return { ...bucket, counts, analysed: counts.Negative + counts.Neutral + counts.Positive };
  });
  return {
    analysed, rated, dated, average: rated ? ratingSum / rated : null,
    negativeShare: analysed ? sentiments[0].rows.length / analysed : null,
    sentiments, ratings, sources, sourceSentiment, unsourced: missing?.rows.length ?? 0,
    namedSources: named.length,
  };
}

export function volumeTrend(rows: Row[]) {
  let first = Infinity, last = -Infinity;
  const dates: { row: Row; time: number }[] = [];
  for (const row of rows) {
    if (!row.date) continue;
    const time = Date.parse(`${row.date}T00:00:00Z`);
    dates.push({ row, time });
    first = Math.min(first, time);
    last = Math.max(last, time);
  }
  const span = (last - first) / DAY_MS;
  const firstYear = new Date(first).getUTCFullYear();
  const lastYear = new Date(last).getUTCFullYear();
  const yearStride = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 60));
  const unit = span <= 30 ? "Daily" : span <= 180 ? "Weekly" : span <= 1825 ? "Monthly" : "Yearly";
  const periods = new Map<string, Bucket>();
  for (const { row, time } of dates) {
    let label = row.date!;
    if (unit === "Weekly") {
      const weekday = new Date(time).getUTCDay();
      label = new Date(time - ((weekday + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    } else if (unit === "Monthly") {
      label = label.slice(0, 7);
    } else if (unit === "Yearly") {
      const year = Number(label.slice(0, 4));
      const start = firstYear + Math.floor((year - firstYear) / yearStride) * yearStride;
      label = yearStride === 1 ? String(year).padStart(4, "0") : `${String(start).padStart(4, "0")}–${Math.min(lastYear, start + yearStride - 1)}`;
    }
    const bucket = periods.get(label) ?? makeBucket(label);
    bucket.rows.push(row);
    periods.set(label, bucket);
  }
  return { unit: yearStride > 1 && unit === "Yearly" ? "Multi-year" : unit, periods: [...periods.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

export function summarizeGroups(rows: Row[], embeddings: readonly { id: string }[], groups: IssueGroup[] | undefined) {
  const visible = new Map(rows.map((row) => [row.record.id, row]));
  const embedded = new Set(embeddings.map(({ id }) => id));
  const memberIds = new Set<string>();
  const visibleGroups = (groups ?? []).flatMap((group) => {
    const members = group.feedbackIds.flatMap((id) => {
      const row = visible.get(id);
      if (!row || !embedded.has(id)) return [];
      memberIds.add(id);
      return [row];
    });
    return members.length ? [{ group, members }] : [];
  });
  const embeddedCount = rows.filter(({ record }) => embedded.has(record.id)).length;
  const ungrouped = groups ? rows.filter(({ record }) => embedded.has(record.id) && !memberIds.has(record.id)) : [];
  return { embeddedCount, groupedCount: memberIds.size, ungrouped, visibleGroups };
}
