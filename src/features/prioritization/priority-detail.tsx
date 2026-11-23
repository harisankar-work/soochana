import { useEffect, useRef, useState } from "react";
import { percent, ReviewTable } from "../analytics/charts";
import { snapshotIsStale, type Candidate, type Grouping } from "./candidates";
import { factorLabels, factors, frequencyBenchmark, type evidenceFor, type rank, type Weights } from "./scoring";

type QueueEntry = { candidate: Candidate; observed: ReturnType<typeof evidenceFor> };

export const groupingName = (method: string) => method === "complete-link-v1" ? "Complete-link" : "Average-link (exploratory)";

export function PriorityDetail({ entry, grouping, imported, scored, weights, edit, reconcile, remove, locked }: {
  entry: QueueEntry; grouping: Grouping | null; imported: number;
  scored: ReturnType<typeof rank>[number] | undefined; weights: Weights;
  edit: () => void; reconcile: () => void; remove: () => void; locked: boolean;
}) {
  const { candidate, observed } = entry;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [page, setPage] = useState(1);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const snapshot = candidate.origin;
  const denominator = snapshot?.populationIds.length ?? imported;
  const stale = snapshot && snapshotIsStale(snapshot, grouping);
  const representative = observed.evidence.find(({ record }) => record.id === snapshot?.representativeId);
  return <section className="panel import-panel priority-detail" aria-labelledby="issue-detail-title">
    <h2 id="issue-detail-title" ref={heading} tabIndex={-1}>{candidate.title}</h2>
    <p className="import-note">{snapshot ? "Discovered group · Unverified automatic grouping" : "Manual issue · Reviewer-selected evidence"} · {candidate.status}</p>
    {candidate.description && <p className="priority-text">{candidate.description}</p>}
    {snapshot && <p className="import-note">{groupingName(snapshot.method)} · Cutoff {snapshot.threshold.toFixed(2)} · {denominator} of {imported} imported reviews embedded when selected.{representative && ` Representative CSV row ${representative.record.originalRow}.`}</p>}
    {stale && <div className="priority-confirm">
      <p>Grouping snapshot may be stale. The saved evidence is still shown. Review the current groups before choosing replacement evidence.</p>
      <button className="import-button" disabled={locked} onClick={reconcile}>Review grouping snapshot</button>
    </div>}
    <div className="import-actions">
      <button className="import-button" disabled={locked} onClick={edit}>Edit issue and assessments</button>
      <button className="import-button" disabled={locked} onClick={() => setConfirmRemoval(true)}>Remove issue</button>
    </div>
    {confirmRemoval && <div className="priority-confirm" role="group" aria-label="Confirm issue removal">
      <p>Remove this issue and its assessments from this session?</p>
      <div className="import-actions">
        <button className="import-button" onClick={() => setConfirmRemoval(false)}>Keep issue</button>
        <button className="import-button import-danger" disabled={locked} onClick={remove}>Confirm issue removal</button>
      </div>
    </div>}
    <h3>Observed evidence</h3>
    <dl className="quality-stats">
      <div><dt>Evidence frequency</dt><dd><strong>{observed.evidence.length} / {denominator}</strong><span>{percent(observed.evidence.length, denominator)} of {snapshot ? "embedded snapshot" : "imported dataset"}</span></dd></div>
      <div><dt>Negative sentiment</dt><dd><strong>{observed.negativeShare === null ? "Unavailable" : percent(observed.negative, observed.classified)}</strong><span>{observed.negative} negative · {observed.classified} of {observed.evidence.length} classified</span></dd></div>
      <div><dt>Average rating</dt><dd><strong>{observed.averageRating === null ? "Unavailable" : observed.averageRating.toFixed(2)}</strong><span>{observed.rated} of {observed.evidence.length} rated</span></dd></div>
      <div><dt>Latest feedback date</dt><dd><strong>{observed.latest ?? "Unavailable"}</strong><span>{observed.dated} dated reviews</span></dd></div>
    </dl>
    <p className="import-note">{snapshot ? "Frequency share describes the embedded snapshot." : "Manually selected evidence can omit relevant reviews."} Count shares across candidate types use different denominators.</p>
    <p>{observed.trend ? `Dated review trend: ${observed.trend.recent} in the 28 days ending ${observed.trend.anchor} vs ${observed.trend.previous} in the preceding 28 days.` : "Trend unavailable. It requires a 56-day dataset span and at least four dated supporting reviews across both periods, with evidence in each."}</p>
    {observed.missing > 0 && <p className="import-error" role="alert">{observed.missing} saved review references are unavailable. Correct the evidence before scoring.</p>}
    <ReviewTable rows={observed.evidence} page={page} onPage={setPage} />
    <h3>Human assessments</h3>
    <p>Severity {candidate.severity ?? "unassessed"} · Business impact {candidate.impact ?? "unassessed"} · Evidence confidence {candidate.confidence ?? "unassessed"}</p>
    {candidate.notes && <p className="priority-text"><strong>Reviewer rationale</strong> · {candidate.notes}</p>}
    <h3>Score explanation</h3>
    {scored ? <>
      <p><strong>{scored.result.total.toFixed(2)} / 100</strong> · Rank {scored.rank}</p>
      <p className="import-note">{observed.evidence.length} unique supporting reviews divided by the fixed benchmark of {frequencyBenchmark}, capped at 100%. Ratings of 1–5 map to 0, 25, 50, 75, and 100.</p>
      <div className="import-table-scroll" role="region" aria-label="Priority score breakdown" tabIndex={0}>
        <table className="import-table priority-breakdown">
          <thead><tr>{["Factor", "Normalized", "Weight", "Contribution"].map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{factors.map((factor) => <tr key={factor}><th scope="row">{factorLabels[factor]}</th><td>{scored.result.values[factor].toFixed(2)}</td><td>{weights[factor]}%</td><td>{scored.result.contributions[factor].toFixed(2)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="import-note">Scores combine evidence volume and human judgments. Use them to plan investigations. Contributions are rounded for display.</p>
    </> : <p>Unscored. A valid weight configuration, available evidence, and all three assessments are required.</p>}
  </section>;
}
