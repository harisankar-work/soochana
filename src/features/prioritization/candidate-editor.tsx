import { needsReassessment } from "./candidates";
import { useEffect, useMemo, useRef, useState } from "react";
import { CellText, Pagination } from "../feedback/preview";
import { sourceKey, type Row } from "../analytics/calculations";
import { isAssessment, statuses, validateCandidate, type Candidate } from "./candidates";

const PAGE_SIZE = 15;
const scales = {
  severity: ["Minor inconvenience", "Low", "Moderate", "High", "Critical"],
  impact: ["Very low", "Low", "Moderate", "High", "Very high"],
  confidence: ["Very low", "Low", "Moderate", "High", "Very high"],
} as const;

export function CandidateEditor({ draft, rows, sources, update, save, close }: {
  draft: Candidate; rows: Row[]; sources: string[]; update: (draft: Candidate) => void;
  save: (draft: Candidate, confirmed: boolean) => void; close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [discard, setDiscard] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const available = useMemo(() => new Set(rows.map(({ record }) => record.id)), [rows]);
  const selected = new Set(draft.evidenceIds);
  const candidates = rows.filter(({ record }) =>
    (!draft.origin || selected.has(record.id)) && (!selectedOnly || selected.has(record.id)) &&
    (!source || sourceKey(record.source) === source) && record.text.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.ceil(candidates.length / PAGE_SIZE);
  const current = Math.max(1, Math.min(page, pages));
  const [initialEvidence] = useState(() => new Set(draft.evidenceIds));
  const [confirmed, setConfirmed] = useState(false);
  const evidenceChanged = initialEvidence.size !== selected.size || [...selected].some((id) => !initialEvidence.has(id));
  const acknowledge = needsReassessment(draft) || (draft.assessedVersion !== undefined && evidenceChanged);
  const error = validateCandidate(draft, available);

  function change<Key extends keyof Candidate>(key: Key, value: Candidate[Key]) {
    if (key === "evidenceIds") setConfirmed(false);
    update({ ...draft, [key]: value });
  }

  return <section className="panel import-panel" aria-labelledby="priority-editor">
    <h2 id="priority-editor" ref={heading} tabIndex={-1}>Issue editor</h2>
    <p className="import-note">{draft.origin ? "Discovered group snapshot. Review the evidence and add your own assessments." : "Manual issue. Add supporting reviews when available. Issues without evidence remain unscored."}</p>
    <form noValidate onSubmit={(event) => {
      event.preventDefault();
      setSubmitted(true);
      if (!error) save(draft, !acknowledge || confirmed);
    }}>
      <div className="preview-controls priority-fields">
        <label>Issue title<input autoComplete="off" type="text" maxLength={100} required value={draft.title} onChange={(event) => change("title", event.target.value)} /></label>
        <label>Investigation status<select value={draft.status} onChange={(event) => change("status", event.target.value as Candidate["status"])}>
          {statuses.map((status) => <option key={status}>{status}</option>)}
        </select></label>
        <label>Review status<select value={draft.review === "AI suggested" ? "Needs review" : draft.review ?? "Needs review"} onChange={(event) => change("review", event.target.value as Candidate["review"])}>
          <option>Needs review</option><option>Reviewed</option></select></label>
        <label>Description<textarea maxLength={1500} rows={3} value={draft.description} onChange={(event) => change("description", event.target.value)} /></label>
        <label>Reviewer rationale<textarea maxLength={1500} rows={3} value={draft.notes} onChange={(event) => change("notes", event.target.value)} /></label>
      </div>
      <fieldset className="priority-fields">
        <legend>Human assessments</legend>
        <p className="import-note">Assess severity, relative business impact, and confidence that the selected reviews support this issue. Leave an unknown assessment blank. “Validated by reviewer” records a human decision about the evidence.</p>
        <div className="preview-controls">
          {([["severity", "Severity"], ["impact", "Business impact"], ["confidence", "Evidence confidence"]] as const).map(([field, label]) => (
            <label key={field}>{label}<select value={draft[field] ?? ""} onChange={(event) => {
              const value = Number(event.target.value);
              change(field, isAssessment(value) ? value : null);
            }}>
              <option value="">Not assessed</option>
              {scales[field].map((description, index) => <option key={description} value={index + 1}>{index + 1} · {description}</option>)}
            </select></label>
          ))}
        </div>
        <div className="preview-controls">
          {([[ "urgency", "Urgency" ], [ "effort", "Effort" ]] as const).map(([key, label]) => <label key={key}>{label} (optional)<select value={draft[key] ?? ""} onChange={(event) => {
            const value = Number(event.target.value);
            change(key, isAssessment(value) ? value : null);
          }}><option value="">Not assessed</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>)}
          <button type="button" className="import-button" onClick={() => update({ ...draft, severity: null, impact: null, confidence: null, urgency: null, effort: null })}>Reset assessments</button>
        </div>
        <p className="import-note">Urgency and effort are reviewer notes on a 1–5 scale. The default score uses frequency, severity, impact, and evidence confidence.</p>
      </fieldset>
      <fieldset className="priority-fields">
        <legend>Supporting feedback</legend>
        <p role="status">{selected.size} selected · {candidates.length} matching reviews</p>
        <div className="preview-controls">
          <label>Search imported reviews<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
          {sources.length > 0 && sources.length <= 100 && <label>Evidence source<select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
            <option value="">All sources</option><option value="null">No source recorded</option>
            {sources.map((item) => <option key={item} value={sourceKey(item)}>{item}</option>)}
          </select></label>}
        </div>
        {!draft.origin && <label className="priority-checkbox"><input type="checkbox" checked={selectedOnly} onChange={(event) => { setSelectedOnly(event.target.checked); setPage(1); }} />Show selected reviews only</label>}
        {candidates.length ? <ul className="priority-picker">
          {candidates.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(({ record, date, rating, sentiment }) => (
            <li key={record.id}>
              {!draft.origin && <input type="checkbox" checked={selected.has(record.id)} aria-label={`Include CSV row ${record.originalRow}`}
                onChange={(event) => change("evidenceIds", event.target.checked ? [...draft.evidenceIds, record.id] : draft.evidenceIds.filter((id) => id !== record.id))} />}
              <div>
                <p className="import-note">CSV row {record.originalRow} · {record.source ?? "No source"} · {date ?? "No date"} · {rating === null ? "No rating" : `Rating ${rating}`} · {sentiment ?? "Unclassified"}</p>
                <CellText text={record.text} originalText={record.originalText} />
              </div>
            </li>
          ))}
        </ul> : <p>No reviews match these evidence filters.</p>}
        <Pagination page={current} pages={pages} setPage={setPage} />
      </fieldset>
      {acknowledge && <label className="priority-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirm assessments for the updated evidence</label>}
      {submitted && error && <p className="import-error" role="alert">{error}</p>}
      <div className="import-actions">
        <button type="submit" className="import-button import-primary">Save issue</button>
        <button type="button" className="import-button" onClick={() => setDiscard(true)}>Cancel editing</button>
      </div>
      {discard && <div className="priority-confirm" role="group" aria-label="Discard issue draft">
        <p>Discard the changes in this draft?</p>
        <div className="import-actions">
          <button type="button" className="import-button" onClick={() => setDiscard(false)}>Keep editing</button>
          <button type="button" className="import-button import-danger" onClick={close}>Discard draft</button>
        </div>
      </div>}
    </form>
  </section>;
}
