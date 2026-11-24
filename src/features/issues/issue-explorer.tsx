"use client";

import { Compass } from "lucide-react";
import Link from "next/link";
import { PreparedDemoButton } from "../demo/demo-controls";
import { IssueManagement } from "./issue-management";
import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { CellText } from "../feedback/preview";
import { useFeedbackSession } from "../feedback/session";
import type { FeedbackRecord } from "../feedback/validation";
import type { Prediction } from "../sentiment/protocol";
import type { IssueGroup } from "./clustering";
import { groupingDefaults } from "./use-issues";
import { LIMIT, MODEL_ID, MODEL_REVISION } from "./protocol";

const status = {
  idle: "Ready to discover groups", preparing: "Preparing model", download: "Downloading MiniLM",
  initialize: "Initializing model", embed: "Embedding feedback", complete: "Embedding run finished",
  cancelled: "Analysis cancelled", error: "Analysis could not finish",
};

function Evidence({ records, predictions, similarities }: {
  records: FeedbackRecord[]; predictions: Map<string, Prediction>; similarities?: IssueGroup["similarities"];
}) {
  const [query, setQuery] = useState("");
  const matching = records.filter((record) => record.text.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="issue-evidence">
      <label>Search supporting reviews<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {!matching.length ? <p>No reviews match your search.</p> : (
        <div className="import-table-scroll" role="region" aria-label="Review evidence" tabIndex={0}>
          <table className="import-table feedback-table">
            <caption className="sr-only">Original feedback evidence</caption>
            <thead><tr>{["Feedback", "CSV row", "Source", "Date", "Rating", "Sentiment", "Similarity"].map((name) => <th scope="col" key={name}>{name}</th>)}</tr></thead>
            <tbody>{matching.map((record) => (
              <tr key={record.id}>
                <td><CellText text={record.text} originalText={record.originalText} /></td>
                <td>{record.originalRow}</td><td>{record.source ?? "—"}</td><td>{record.date ?? "—"}</td>
                <td>{record.rating ?? "—"}</td><td>{predictions.get(record.id)?.label ?? "—"}</td>
                <td>{similarities?.[record.id]?.toFixed(3) ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GroupCard({ group, records, representative, predictions, potential }: {
  group: IssueGroup; records: FeedbackRecord[]; representative: FeedbackRecord;
  predictions: Map<string, Prediction>; potential: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mix = { Negative: 0, Neutral: 0, Positive: 0 };
  for (const record of records) {
    const label = predictions.get(record.id)?.label;
    if (label) mix[label]++;
  }
  const covered = mix.Negative + mix.Neutral + mix.Positive;
  const excerpt = Array.from(representative.text).slice(0, 180).join("");
  return (
    <article className="panel issue-card">
      <p className="import-note">{potential ? "Potential issue" : "Recurring feedback theme"} · Automatic label from representative review</p>
      <h3>{excerpt}{excerpt.length < representative.text.length ? "…" : ""}</h3>
      <p>{records.length} supporting reviews · Mean pairwise similarity {group.cohesion.toFixed(3)}</p>
      <p className="import-note">{covered ? `Sentiment coverage ${covered}/${records.length} · ${mix.Negative} negative · ${mix.Neutral} neutral · ${mix.Positive} positive` : "Sentiment unavailable"}</p>
      {mix.Positive > 0 && mix.Negative > 0 && (
        <p className="issue-caution">Mixed sentiment. Reviews may describe different experiences. Compare the evidence.</p>
      )}
      <button className="import-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide evidence" : "View evidence"}</button>
      {open && <><p className="import-note">Similarities are measured against the representative review on CSV row {representative.originalRow}.</p><Evidence records={records} predictions={predictions} similarities={group.similarities} /></>}
    </article>
  );
}

function DiscoveryPanel() {
  const { dataset, issues, sentiment, demoMode } = useFeedbackSession();
  const [count, setCount] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [minimum, setMinimum] = useState(2);
  const { analysis, busy, method, configureGrouping, threshold, setThreshold, result } = issues;

  if (!dataset) {
    return <><EmptyState icon={Compass} title="Import feedback to discover groups">
      <p>Upload and confirm a CSV in Feedback Analysis to explore recurring themes and their supporting reviews.</p>
      <Link className="import-button import-primary mt-3" href="/feedback">Go to Feedback Analysis</Link>
      <Link className="import-button mt-3" href="/feedback#demo">Try Demo Dataset</Link>
      <PreparedDemoButton />
    </EmptyState><IssueManagement /></>;
  }

  const maximum = Math.min(dataset.records.length, LIMIT);
  const selected = Number(count ?? maximum);
  const valid = Number.isInteger(selected) && selected >= 1 && selected <= maximum;
  const lookup = new Map(dataset.records.slice(0, LIMIT).map((record) => [record.id, record]));
  const predictions = new Map(sentiment.analysis.predictions.map((prediction) => [prediction.feedbackId, prediction]));
  const query = search.trim().toLowerCase();
  const matching = (record: FeedbackRecord) => record.text.toLowerCase().includes(query);
  const recordsFor = (ids: string[]) => ids.map((id) => lookup.get(id)!).sort((a, b) => a.originalRow - b.originalRow);
  const groups = result?.groups.map((group) => {
    const records = recordsFor(group.feedbackIds);
    // A strict majority of all members must have an available Negative prediction.
    const potential = records.filter((record) => predictions.get(record.id)?.label === "Negative").length > records.length / 2;
    return { group, records, potential, representative: lookup.get(group.representativeId)! };
  }) ?? [];
  const shown = groups.filter(({ records, potential }) =>
    records.length >= minimum && records.some(matching) &&
    (filter === "all" || filter === (potential ? "potential" : "themes")));
  const singletons = recordsFor(result?.ungrouped ?? []).filter(matching);
  const embedded = analysis.embeddings.length;

  return (
    <div className="feedback-import">
      <section className="panel import-panel" aria-labelledby="discovery-title">
        <h2 id="discovery-title">Discover feedback groups</h2>
        <p className="file-info"><strong>{dataset.name}</strong> · {dataset.records.length} imported records</p>
        <p className="import-note">Issue discovery runs in this browser. The first run downloads a model and runtime files.</p>
        <details className="quality-details">
          <summary>Model details</summary>
          <p><a className="underline" href={`https://huggingface.co/${MODEL_ID}/tree/${MODEL_REVISION}`}>MiniLM</a> downloads about 22 MiB of model weights. Reviews and derived results stay in session memory.</p>
        </details>
        <div className="preview-controls">
          <label>Records to analyse<input className="sentiment-count" type="number" min="1" max={maximum} value={count ?? maximum} disabled={busy}
            aria-describedby="issue-scope" onChange={(event) => setCount(event.target.value)} /></label>
        </div>
        <p id="issue-scope" className="import-note">Choose 1–{maximum} records, starting at the first accepted CSV row. Groups describe only the analysed sample.</p>
        <div className="import-actions">
          <button className="import-button import-primary" disabled={demoMode === "prepared" || busy || sentiment.busy || !valid} onClick={() => issues.start(dataset.records, selected)}>Discover Feedback Groups</button>
          {!busy && analysis.phase !== "idle" && <button className="import-button" disabled={demoMode === "prepared" || sentiment.busy || !valid} onClick={() => issues.start(dataset.records, selected)}>Retry discovery</button>}
          {busy && <button className="import-button" onClick={issues.cancel}>Cancel discovery</button>}
        </div>
        {sentiment.busy && <p className="import-note">Wait for sentiment analysis to finish before starting discovery.</p>}
        <p role="status">{demoMode === "prepared" ? "Prepared discovery results" : status[analysis.phase]}{busy && analysis.phase === "embed" ? ` · ${embedded + analysis.failed} of ${analysis.selected} attempted` : ""}</p>
        {analysis.phase === "download" && <progress className="sentiment-progress" aria-label="Model download progress" max={100} value={analysis.progress} />}
        {analysis.phase === "embed" && <progress className="sentiment-progress" aria-label="Embedding progress" max={analysis.selected} value={embedded + analysis.failed} />}
        {analysis.phase === "error" && <p className="import-error" role="alert">Check your connection, available memory, and WebAssembly support, then retry discovery.</p>}
        {analysis.selected > 0 && <p>{analysis.selected} selected · {embedded} embedded · {analysis.failed} failed · {dataset.records.length - embedded} unanalysed in dataset</p>}
        {!busy && analysis.selected > embedded && <p className="import-note">Analysis is incomplete. Results cover only reviews with valid embeddings.</p>}
      </section>
      <IssueManagement />
      {result && embedded > 0 && (
        <section className="panel import-panel" aria-labelledby="results-title">
          <h2 id="results-title">Feedback groups</h2>
          {issues.usedBroaderSuggestions && <p className="issue-caution">Strict discovery found no recurring groups. These broader suggestions can combine distinct issues. Review their evidence before using them.</p>}
          {!groups.length && method === "complete-link-v1" && <button className="import-button" onClick={() => configureGrouping("average-link-v1")}>Explore broader suggestions</button>}
          <p className="import-note">{method === "complete-link-v1" ? "Complete-link" : "Average-link (exploratory)"} · Cutoff {threshold.toFixed(2)}</p>
          <dl className="quality-stats">
            {[["Recurring groups", groups.length], ["Grouped records", embedded - result.ungrouped.length], ["Unassigned records", result.ungrouped.length], ["Potential issues", groups.filter(({ potential }) => potential).length]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <p className="import-note">A recurring group needs at least two reviews. A group is marked as a potential issue when more than half of all members have negative sentiment predictions. Use the original reviews to judge whether the group describes a problem.</p>
          <div className="preview-controls">
            <label>Cosine similarity cutoff<select value={threshold} onChange={(event) => {
              setThreshold(Number(event.target.value));
              setFilter("all");
            }}>
              {(method === "complete-link-v1" ? [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90] : [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]).map((value) =>
                <option key={value} value={value}>{value.toFixed(2)}{value === groupingDefaults[method] ? " (default)" : ""}</option>)}
            </select></label>
            <label>Group type<select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All groups</option><option value="potential">Potential issues</option><option value="themes">Other recurring themes</option><option value="ungrouped">Unassigned Feedback</option>
            </select></label>
            <label>Minimum group size<select value={minimum} disabled={filter === "ungrouped"} onChange={(event) => setMinimum(Number(event.target.value))}>
              {[2, 3, 5, 10].map((value) => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label>Search review text or label<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          </div>
          <p className="import-note">{method === "complete-link-v1"
            ? "Complete-link requires every pair in a group to meet the cutoff."
            : "Average-link uses the mean similarity between two groups to decide whether to merge them."} Higher cutoffs can leave more reviews unassigned. Cosine is a similarity score rather than a calibrated probability.</p>
          <details className="quality-details">
            <summary>Advanced grouping settings</summary>
            <div className="preview-controls">
              <label>Grouping method<select value={method} onChange={(event) => {
                configureGrouping(event.target.value === "average-link-v1" ? "average-link-v1" : "complete-link-v1");
                setFilter("all");
              }}>
                <option value="complete-link-v1">Complete-link (default)</option>
                <option value="average-link-v1">Average-link (exploratory)</option>
              </select></label>
            </div>
            <p className="issue-caution">Average-link can group more paraphrases, but it can also merge different topics. Review the supporting evidence before drawing conclusions.</p>
          </details>
          <p role="status">{shown.length} matching groups</p>
          {shown.map((item) => <GroupCard key={`${method}:${threshold}:${item.group.id}`} {...item} predictions={predictions} />)}
          {filter !== "ungrouped" && !shown.length && <p>No recurring groups match the current settings.</p>}
          {(filter === "all" || filter === "ungrouped") && (
            <details className="quality-details" key={`${method}:${threshold}`}>
              <summary>Unassigned Feedback ({singletons.length})</summary>
              {singletons.length > 0 ? <Evidence records={singletons} predictions={predictions} /> : <p>No unassigned reviews match the current search.</p>}
            </details>
          )}
        </section>
      )}
    </div>
  );
}

export function IssueExplorer() {
  const { datasetVersion } = useFeedbackSession();
  return <DiscoveryPanel key={datasetVersion} />;
}
