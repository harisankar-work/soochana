"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFeedbackSession } from "../feedback/session";
import { LIMIT } from "../issues/protocol";
import { labels } from "../sentiment/protocol";
import { BarChart, percent, ReviewTable, TrendChart } from "./charts";
import { defaultFilters, filterRows, groupSources, makeRows, sourceKey, summarize, summarizeGroups, volumeTrend, type Bucket, type Filters } from "./calculations";

type Chart = "volume" | "sentiment" | "source" | "rating" | "group";
type Selection = { chart: Chart; key: string };
const chartTitles: Record<Chart, string> = { volume: "Period", sentiment: "Sentiment", source: "Source", rating: "Rating", group: "Grouping" };
const phaseLabels = {
  idle: "Not run", preparing: "Preparing", download: "Downloading model", initialize: "Initializing model",
  analyse: "Analysing", embed: "Embedding", complete: "Run finished", cancelled: "Cancelled", error: "Incomplete",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="panel import-panel" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>;
}

type Session = ReturnType<typeof useFeedbackSession>;

export function DashboardData({ empty }: { empty: ReactNode }) {
  const session = useFeedbackSession();
  return session.dataset ? <Analytics key={session.datasetVersion} dataset={session.dataset} sentiment={session.sentiment} issues={session.issues} /> : empty;
}

function Analytics({ dataset, sentiment, issues }: { dataset: NonNullable<Session["dataset"]>; sentiment: Session["sentiment"]; issues: Session["issues"] }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [page, setPage] = useState(1);
  const evidenceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selection) evidenceHeading.current?.focus();
  }, [selection]);
  const all = useMemo(() => makeRows(dataset.records, sentiment.analysis.predictions), [dataset.records, sentiment.analysis.predictions]);
  const sourceOptions = useMemo(() => groupSources(all), [all]);
  const classifiedTotal = sentiment.analysis.predictions.length;
  const { matched, excludedUnanalysed } = useMemo(() => filterRows(all, filters), [all, filters]);
  const summary = useMemo(() => summarize(matched), [matched]);
  const trend = useMemo(() => volumeTrend(matched), [matched]);
  const grouping = useMemo(() => summarizeGroups(matched, issues.analysis.embeddings, issues.result?.groups), [matched, issues.analysis.embeddings, issues.result]);
  const byId = useMemo(() => new Map(dataset.records.slice(0, LIMIT).map((record) => [record.id, record])), [dataset.records]);
  const active = Object.keys(defaultFilters).some((key) => filters[key as keyof Filters] !== defaultFilters[key as keyof Filters]);
  const groupBuckets = grouping.visibleGroups.map(({ group, members }) => {
    const text = byId.get(group.representativeId)?.text ?? "Recurring theme";
    const label = text.length > 130 ? `${text.slice(0, 130)}…` : text;
    return { key: group.id, label, rows: members };
  }).sort((a, b) => b.rows.length - a.rows.length);
  const buckets = {
    volume: trend.periods, sentiment: summary.sentiments, source: summary.sources,
    rating: summary.ratings, group: [...groupBuckets, { key: "ungrouped", label: "Unassigned Feedback (model view)", rows: grouping.ungrouped }],
  };
  const picked = selection ? buckets[selection.chart].find((bucket) => bucket.key === selection.key) : undefined;

  function change<Key extends keyof Filters>(key: Key, value: Filters[Key]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setSelection(null);
    setPage(1);
  }

  function choose(chart: Chart, bucket: Bucket) {
    setSelection({ chart, key: bucket.key });
    setPage(1);
  }

  const chart = (kind: Chart) => ({
    buckets: buckets[kind], selected: selection?.chart === kind ? selection.key : undefined,
    choose: (bucket: Bucket) => choose(kind, bucket),
  });

  return <div className="feedback-import analytics-dashboard">
    <Section id="dataset-overview" title="Dataset overview">
      <p className="file-info"><strong>{dataset.name}</strong> · {all.length} imported reviews</p>
      <p role="status">{matched.length} of {all.length} reviews in this view · {active ? "Filters active" : "All feedback"}</p>
      <fieldset className="analytics-filters">
        <legend>Filter feedback</legend>
        <label>From date<input type="date" value={filters.from} onChange={(event) => change("from", event.target.value)} /></label>
        <label>To date<input type="date" value={filters.to} onChange={(event) => change("to", event.target.value)} /></label>
        {sourceOptions.length <= 100 ? <label>Feedback source<select value={filters.source} onChange={(event) => change("source", event.target.value)}>
          <option value="">All sources</option>
          {sourceOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </select></label> : <>
          <label>Feedback source (exact)<input type="search" value={filters.source && filters.source !== "null" ? JSON.parse(filters.source) : ""} onChange={(event) => change("source", event.target.value ? sourceKey(event.target.value) : "")} /></label>
          <label className="analytics-check"><input type="checkbox" checked={filters.source === "null"} onChange={(event) => change("source", event.target.checked ? "null" : "")} />No source recorded</label>
        </>}
        <label>Rating availability<select value={filters.rating} onChange={(event) => change("rating", event.target.value as Filters["rating"])}>
          <option value="all">All ratings</option><option value="rated">Rated only</option><option value="missing">Unrated only</option>
        </select></label>
        {(classifiedTotal > 0 || filters.sentiment) && <label>Sentiment class<select value={filters.sentiment} onChange={(event) => change("sentiment", event.target.value as Filters["sentiment"])}>
          <option value="">All sentiment states</option>{labels.map((label) => <option key={label}>{label}</option>)}
        </select></label>}
      </fieldset>
      <div className="import-actions"><button className="import-button" disabled={!active} onClick={() => { setFilters(defaultFilters); setSelection(null); setPage(1); }}>Reset Filters</button></div>
      {filters.from && filters.to && filters.from > filters.to && <p className="import-error" role="alert">Choose an end date on or after the start date.</p>}
      {filters.sentiment && <p className="import-note">{excludedUnanalysed} unanalysed reviews excluded by the sentiment filter after other filters.</p>}
      {!matched.length && <p>No reviews match these filters.</p>}
      <dl className="analytics-metrics">
        <div><dt>Total feedback in view</dt><dd><strong>{matched.length}</strong><span>Of {all.length} imported</span></dd></div>
        <div><dt>Sentiment analysed</dt><dd><strong>{summary.analysed} / {matched.length}</strong><span>{classifiedTotal} of {all.length} imported</span></dd></div>
        <div><dt>Negative sentiment share</dt><dd><strong>{summary.negativeShare === null ? "Not analysed" : percent(summary.sentiments[0].rows.length, summary.analysed)}</strong><span>{summary.sentiments[0].rows.length} of {summary.analysed} classified in view</span></dd></div>
        <div><dt>Average rating</dt><dd><strong>{summary.average === null ? "Unavailable" : `${summary.average.toFixed(2)} / 5`}</strong><span>{summary.rated} rated reviews</span></dd></div>
        <div><dt>Recurring groups in view</dt><dd><strong>{issues.result ? grouping.visibleGroups.length : "Unavailable"}</strong><span>{grouping.embeddedCount} embedded in view</span></dd></div>
      </dl>
    </Section>

    <Section id="volume-chart" title="Feedback volume over time">
      <p className="import-note">{trend.unit} volume{trend.unit === "Weekly" ? " by week starting Monday" : ""} · {matched.length - summary.dated} undated reviews excluded. Periods with no dated feedback are omitted.</p>
      {trend.periods.length ? <TrendChart title="Feedback volume periods" {...chart("volume")} /> : <p>No valid dates in this view.</p>}
    </Section>

    <div className="analytics-chart-grid">
      <Section id="sentiment-chart" title="Sentiment distribution">
        <p className="import-note">{phaseLabels[sentiment.analysis.phase]} · {summary.analysed} classified, {matched.length - summary.analysed} unanalysed in view. Shares use classified reviews.</p>
        {summary.analysed ? <BarChart title="Sentiment counts" {...chart("sentiment")} denominator={summary.analysed} />
          : <p>No sentiment predictions in this view. <Link href="/feedback" className="underline">Analyse Sentiment in Feedback Analysis</Link>.</p>}
      </Section>
      <Section id="source-chart" title="Feedback by source">
        <p className="import-note">{summary.unsourced} reviews without a source.{summary.namedSources > 8 && " Top eight recorded sources shown separately."}</p>
        {summary.namedSources === 0 && <p>No recorded sources in this view.</p>}
        {summary.sources.length > 0 && <BarChart title="Source counts" {...chart("source")} />}
      </Section>
      <Section id="rating-chart" title="Rating distribution">
        <p className="import-note">{summary.rated} rated · {matched.length - summary.rated} unrated in view. Decimal ratings stay in their labelled intervals.</p>
        {summary.rated ? <BarChart title="Rating counts" {...chart("rating")} /> : <p>No valid ratings in this view.</p>}
      </Section>
      <Section id="source-sentiment" title="Sentiment by source">
        <p className="import-note">Coverage is classified / all matching reviews for each source. Percentages use each source’s classified subset. Under 10 predictions is a small sample.</p>
        {summary.analysed ? (
          <div className="import-table-scroll" role="region" aria-label="Source sentiment table" tabIndex={0}>
            <table className="import-table analytics-source-table">
              <caption className="sr-only">Sentiment by source in this filtered view</caption>
              <thead><tr>{["Source", "Coverage", ...labels].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{summary.sourceSentiment.map(({ key, label, rows, counts, analysed }) => <tr key={key}>
                <th scope="row">{label}</th><td>{analysed} / {rows.length}{analysed > 0 && analysed < 10 && <small> · Small sample</small>}</td>
                {labels.map((label) => <td key={label}>{counts[label]} · {percent(counts[label], analysed)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        ) : <p>No source has classified feedback in this view.</p>}
      </Section>
    </div>

    <Section id="group-summary" title="Recurring feedback themes">
      <p>{issues.method === "complete-link-v1" ? "Complete-link" : "Average-link (exploratory)"} · Cutoff {issues.threshold.toFixed(2)} · {phaseLabels[issues.analysis.phase]}</p>
      <p className="import-note">{issues.analysis.selected} selected for embedding · {issues.analysis.embeddings.length} of {all.length} imported embedded · {issues.analysis.failed} failed · {grouping.embeddedCount} of {matched.length} in this view embedded.</p>
      {!issues.busy && issues.analysis.selected > issues.analysis.embeddings.length && <p className="import-note">Embedding coverage is incomplete. The summary uses available results.</p>}
      {issues.result ? <>
        <p>{grouping.visibleGroups.length} recurring groups intersect this view · {grouping.groupedCount} grouped and {grouping.ungrouped.length} unassigned embedded reviews in view.</p>
        <p className="import-note">Groups were discovered on the analysed sample. Filters show matching members without regrouping them. Treat groups as themes to investigate. A zero count can occur even when recurring problems exist.</p>
        {!grouping.visibleGroups.length && <p>No recurring groups were detected in this view at the current settings.</p>}
        {grouping.visibleGroups.length > 5 && <p className="import-note">Showing the five groups with the most matching members.</p>}
        {(groupBuckets.length > 0 || grouping.ungrouped.length > 0) && <BarChart title="Theme evidence" {...chart("group")} buckets={[...groupBuckets.slice(0, 5), ...(grouping.ungrouped.length ? buckets.group.slice(-1) : [])]} />}
      </> : <p>Group results are unavailable for this view.</p>}
      {issues.method === "average-link-v1" && <p className="issue-caution">Exploratory grouping can merge unrelated feedback. Inspect the original reviews before drawing conclusions.</p>}
      <Link className="underline" href="/issues">Open Issue Explorer</Link>
    </Section>

    <section className="panel import-panel" aria-labelledby="dashboard-evidence">
      <h2 id="dashboard-evidence" ref={evidenceHeading} tabIndex={-1}>Review evidence</h2>
      {picked && selection && <div className="import-actions">
        <p className="file-info"><strong>{chartTitles[selection.chart]}</strong> · {picked.label}</p>
        <button className="import-button" onClick={() => { setSelection(null); setPage(1); }}>Show all matching reviews</button>
      </div>}
      <ReviewTable rows={picked?.rows ?? matched} page={page} onPage={setPage} />
    </section>
  </div>;
}
