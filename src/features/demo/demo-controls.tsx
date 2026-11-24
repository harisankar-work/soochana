"use client";

import { useState } from "react";
import { useFeedbackSession } from "../feedback/session";

export function PreparedDemoButton({ label = "Explore completed demo", className = "import-button import-primary" }: {
  label?: string; className?: string;
}) {
  const { dataset, prioritization, loadPreparedDemo } = useFeedbackSession();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    if (loading) return;
    setConfirming(false);
    setLoading(true);
    setError("");
    try { await loadPreparedDemo(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "The prepared demo could not be loaded."); }
    finally { setLoading(false); }
  }

  return <div>
    <button type="button" className={className} disabled={loading} onClick={() => {
      if (dataset || prioritization.candidates.length || prioritization.draft) setConfirming(true);
      else void load();
    }}>{loading ? "Loading prepared demo…" : label}</button>
    {confirming && <div className="priority-confirm" role="group" aria-label="Replace workspace with prepared demo">
      <p>This replaces the dataset and its session work. Export anything you want to keep first.</p>
      <div className="import-actions">
        <button type="button" className="import-button import-primary" onClick={() => void load()}>Confirm prepared demo replacement</button>
        <button type="button" className="import-button" onClick={() => setConfirming(false)}>Keep current workspace</button>
      </div>
    </div>}
    {error && <p role="alert" className="import-error">{error}</p>}
  </div>;
}

export function DemoStatus() {
  const { demoMode, sentiment, issues, runLiveDemo } = useFeedbackSession();
  if (!demoMode) return null;
  const busy = sentiment.busy || issues.busy;
  const phase = sentiment.busy ? sentiment.analysis.phase : issues.analysis.phase;
  const remaining = sentiment.busy ? sentiment.analysis : issues.analysis;
  const completed = sentiment.busy ? sentiment.analysis.predictions.length : issues.analysis.embeddings.length;
  const progress = phase === "download" ? remaining.progress :
    phase === "analyse" || phase === "embed" ? completed + remaining.failed : undefined;
  const status = phase === "download" ? "Downloading model" : phase === "initialize" ? "Initializing model" :
    phase === "analyse" || phase === "embed" ? `${completed + remaining.failed} of ${remaining.selected} attempted` : "Preparing analysis";
  return <section className="panel import-panel mb-4" aria-labelledby="demo-mode-title">
    <h2 id="demo-mode-title">{demoMode === "prepared" ? "Prepared synthetic demo" : "Live synthetic demo"}</h2>
    <p>{demoMode === "prepared" ? "This workspace uses precomputed output from the pinned models. Sample business assessments and review decisions are illustrative." :
      "Sentiment and issue discovery run in this browser. Sample business assessments and review decisions are illustrative."}</p>
    {busy && <>
      <p role="status">{sentiment.busy ? "Sentiment" : "Issue discovery"} · {status}</p>
      <progress aria-label="Live demo analysis progress" max={phase === "download" ? 100 : Math.max(1, remaining.selected)} value={progress} />
    </>}
    {!busy && demoMode === "live" && sentiment.analysis.phase === "cancelled" && <p role="status">Live demo cancelled during sentiment.</p>}
    {!busy && demoMode === "live" && sentiment.analysis.phase === "error" && <p role="status">Sentiment was incomplete. Available results are still shown.</p>}
    <div className="import-actions">
      {busy ? <button className="import-button" onClick={() => sentiment.busy ? sentiment.cancel() : issues.cancel()}>Cancel demo analysis</button> :
        <button className="import-button" onClick={runLiveDemo}>{demoMode === "prepared" ? "Run live analysis" : "Rerun live analysis"}</button>}
      <PreparedDemoButton label="Restore prepared demo" className="import-button" />
    </div>
  </section>;
}
