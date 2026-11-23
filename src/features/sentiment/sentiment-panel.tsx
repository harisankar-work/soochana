"use client";

import { useState } from "react";
import { CellText, Pagination } from "../feedback/preview";
import { useFeedbackSession } from "../feedback/session";
import { labels, MAX_ANALYSIS_COUNT, MODEL_ID, type Label, type Prediction } from "./protocol";
import type { FeedbackRecord } from "../feedback/validation";

const statusText = {
  idle: "Ready to analyse",
  preparing: "Preparing AI model",
  download: "Downloading model",
  initialize: "Initializing model",
  analyse: "Analysing feedback",
  complete: "Analysis completed",
  cancelled: "Analysis cancelled",
  error: "Analysis incomplete",
};

const PAGE_SIZE = 10;

function SentimentResults({ predictions, records }: { predictions: Prediction[]; records: FeedbackRecord[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Label | "">("");
  const [order, setOrder] = useState("row");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [threshold, setThreshold] = useState(60);
  const [page, setPage] = useState(1);
  const source = new Map(records.slice(0, MAX_ANALYSIS_COUNT).map((record) => [record.id, record]));
  const results = predictions.flatMap((prediction) => {
    const record = source.get(prediction.feedbackId);
    if (!record || (filter && prediction.label !== filter) || (reviewOnly && prediction.confidence >= threshold / 100)) return [];
    if (!record.text.toLowerCase().includes(query.trim().toLowerCase())) return [];
    return [{ prediction, record }];
  }).sort((a, b) => {
    if (order === "high") return b.prediction.confidence - a.prediction.confidence;
    if (order === "low") return a.prediction.confidence - b.prediction.confidence;
    return a.record.originalRow - b.record.originalRow;
  });

  return (
    <>
      <h3 className="font-bold">Review predictions</h3>
      <p className="import-note">Confidence is the model’s assigned score. The review threshold helps identify predictions to inspect manually.</p>
      <div className="preview-controls">
        <label>Search predictions<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
        <label>Filter sentiment<select value={filter} onChange={(event) => { setFilter(event.target.value as Label | ""); setPage(1); }}>
          <option value="">All sentiments</option>
          {labels.map((label) => <option key={label}>{label}</option>)}
        </select></label>
        <label>Sort predictions<select value={order} onChange={(event) => { setOrder(event.target.value); setPage(1); }}>
          <option value="row">Original row order</option>
          <option value="high">Confidence, highest first</option>
          <option value="low">Confidence, lowest first</option>
        </select></label>
        <label>Low-confidence threshold<select value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); setPage(1); }}>
          {[50, 60, 70, 80, 90].map((value) => <option key={value} value={value}>Below {value}%</option>)}
        </select></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={reviewOnly} onChange={(event) => { setReviewOnly(event.target.checked); setPage(1); }} />Low-confidence only</label>
      </div>
      <p role="status">{results.length} matching predictions</p>
      {results.length === 0 ? <p className="import-note">No predictions match. Adjust your filters or search.</p> : (
        <div className="import-table-scroll" role="region" aria-label="Sentiment results table" tabIndex={0}>
          <table className="import-table feedback-table">
            <caption className="sr-only">Sentiment predictions</caption>
            <thead><tr>{["Feedback", "Sentiment", "Model confidence", "Source", "Rating", "Original row"].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>{results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ prediction, record }) => (
              <tr key={record.id}>
                <td><CellText text={record.text} originalText={record.originalText} /></td>
                <td className="font-bold">{prediction.label}</td>
                <td>{(prediction.confidence * 100).toFixed(1)}%{prediction.confidence < threshold / 100 && <div className="import-note">Review</div>}</td>
                <td>{record.source ?? "—"}</td><td>{record.rating ?? "—"}</td><td>{record.originalRow}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.ceil(results.length / PAGE_SIZE)} setPage={setPage} />
    </>
  );
}

export function SentimentPanel() {
  const { dataset, issues, sentiment: { analysis, busy, start, cancel } } = useFeedbackSession();
  const maximum = Math.min(dataset?.records.length ?? 0, MAX_ANALYSIS_COUNT);
  const [count, setCount] = useState<string | null>(null);
  if (!dataset) return null;
  const selected = Number(count ?? maximum);
  const valid = Number.isInteger(selected) && selected >= 1 && selected <= maximum;
  const completed = analysis.predictions.length;
  const remaining = Math.max(0, analysis.selected - completed - analysis.failed);

  return (
    <section className="panel import-panel" aria-labelledby="sentiment-title">
      <h2 id="sentiment-title">AI Sentiment Analysis</h2>
      <p>Model <a className="underline underline-offset-4" href={`https://huggingface.co/${MODEL_ID}`}>Twitter RoBERTa Sentiment</a></p>
      <p className="import-note">The browser downloads the model (about 120 MiB plus runtime files) and analyses feedback locally. It can reuse cached model files when available. Reviews and predictions stay in memory until you refresh or close this tab.</p>
      <div className="preview-controls">
        <label>Records to analyse
          <input className="sentiment-count" type="number" min="1" max={maximum} step="1" value={count ?? maximum} disabled={busy}
            aria-describedby="sentiment-scope" onChange={(event) => setCount(event.target.value)} />
        </label>
      </div>
      <p id="sentiment-scope" className="import-note">Select 1–{maximum} of {dataset.records.length} imported records. Analysis starts at the first accepted CSV row.</p>
      <div className="import-actions">
        <button className="import-button import-primary" disabled={busy || issues.busy || !valid} onClick={() => start(dataset.records, selected)}>{analysis.phase === "idle" ? "Analyse Sentiment" : "Re-run analysis"}</button>
        {busy && <button className="import-button" onClick={cancel}>Cancel analysis</button>}
      </div>
      {issues.busy && <p className="import-note">Wait for issue discovery to finish before running sentiment analysis.</p>}
      <p role="status">{statusText[analysis.phase]}{busy && analysis.phase === "analyse" && ` · ${completed + analysis.failed} of ${analysis.selected} attempted`}</p>
      {analysis.phase === "download" && (
        <progress className="sentiment-progress" aria-label="Model download progress" max={100} value={analysis.progress} />
      )}
      {analysis.phase === "analyse" && (
        <progress className="sentiment-progress" aria-label="Classification progress" max={analysis.selected} value={completed + analysis.failed} />
      )}
      {analysis.message && <p className="import-error" role="alert">{analysis.message}</p>}
      {analysis.phase === "cancelled" && <p className="import-note">Available results are partial. Restarting creates a fresh run and may reload model files.</p>}
      {analysis.selected > 0 && (
        <>
          <p className="import-note">{analysis.selected} selected · {completed} analysed · {analysis.failed} failed · {remaining} remaining in selection · {dataset.records.length - completed} not analysed in dataset (includes failures)</p>
          {completed > 0 && (
            <>
              <dl className="quality-stats">
                {labels.map((label) => {
                  const total = analysis.predictions.filter((prediction) => prediction.label === label).length;
                  return <div key={label}><dt>{label}</dt><dd>{total}<meter className="sentiment-progress" min={0} max={completed} value={total} aria-label={`${label} among analysed records`} /></dd></div>;
                })}
              </dl>
              <SentimentResults predictions={analysis.predictions} records={dataset.records} />
            </>
          )}
        </>
      )}
      <p className="import-note">The model was trained on English tweets. Product feedback, sarcasm, negation, mixed or very short reviews, and other languages can produce misleading results. Long text may be truncated for inference. The original review remains available.</p>
    </section>
  );
}
