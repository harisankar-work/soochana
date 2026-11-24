"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFeedbackSession } from "../feedback/session";
import type { FeedbackRecord } from "../feedback/validation";
import { newCandidate, type Candidate } from "../prioritization/candidates";
import { CellText, Pagination } from "../feedback/preview";

const noRecords: FeedbackRecord[] = [];
const pageSize = 10;

export function IssueManagement() {
  const { dataset, issues, sentiment, prioritization: queue } = useFeedbackSession();
  const records = dataset?.records ?? noRecords;
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [issueId, setIssueId] = useState("");
  const [view, setView] = useState(issues.analysis.analysedIds.length ? "analysed" : "pending");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [destination, setDestination] = useState("");
  const [title, setTitle] = useState("");
  const [mergeTitle, setMergeTitle] = useState("");
  const [confirmation, setConfirmation] = useState<"delete" | "reset" | null>(null);
  const [assignmentRequested, setAssignmentRequested] = useState(false);
  const [issueDraft, setIssueDraft] = useState<Candidate | null>(null);
  const current = queue.candidates.find(({ id }) => id === issueId);
  const validSelection = selected.filter((id) => records.some((record) => record.id === id));
  const analysed = useMemo(() => new Set(issues.analysis.analysedIds), [issues.analysis.analysedIds]);
  const excluded = useMemo(() => new Set(queue.excluded), [queue.excluded]);
  const owners = useMemo(() => new Set(queue.candidates.flatMap(({ evidenceIds }) => evidenceIds)), [queue.candidates]);
  const suggested = useMemo(() => new Set(queue.candidates.filter(({ review }) => review === "AI suggested").flatMap(({ evidenceIds }) => evidenceIds)), [queue.candidates]);
  const lookup = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const predicted = useMemo(() => new Map(sentiment.analysis.predictions.map((prediction) => [prediction.feedbackId, prediction.label])), [sentiment.analysis.predictions]);
  const sources = useMemo(() => [...new Set(records.flatMap(({ source }) => source ? [source] : []))].sort(), [records]);
  const evidence = current?.evidenceIds.flatMap((id) => lookup.get(id) ?? []) ?? [];
  const matching = useMemo(() => records.filter((record) => {
    const id = record.id;
    const inView = view === "excluded" ? excluded.has(id) : view === "suggested" ? suggested.has(id) : view === "assigned" ? owners.has(id) && !suggested.has(id) :
      !excluded.has(id) && !owners.has(id) && (view === "analysed" ? analysed.has(id) : !analysed.has(id));
    return inView && (!source || source === record.source) && record.text.toLowerCase().includes(search.trim().toLowerCase());
  }), [records, view, owners, excluded, analysed, suggested, source, search]);
  const rows = current ? evidence : matching;
  const activePage = Math.max(1, Math.min(page, Math.ceil(rows.length / pageSize)));
  const assignments = assignmentRequested && !current ? issues.matchAssignments(validSelection.filter((id) => !owners.has(id) && !excluded.has(id)), queue.candidates) : [];
  function clearSelection() {
    setSelected([]);
    setAssignmentRequested(false);
  }
  function choose(id: string) {
    setIssueId(id);
    setPage(1);
    clearSelection();
    setIssueDraft(null);
    setTitle("");
    setDestination("");
    setConfirmation(null);
  }
  function toggle(values: string[], value: string, apply: (next: string[]) => void) {
    apply(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }
  const dates = evidence.flatMap(({ date }) => date ? [date] : []).sort();
  const stats = (values: (string | null | undefined)[]) => {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].map(([value, count]) => `${value} (${count})`).join(", ") || "Unavailable";
  };

  return <section className="panel import-panel" aria-labelledby="issue-management">
    <h2 id="issue-management">Manage issues</h2>
    <p className="import-note">Review suggestions and organize the original feedback. Changes are shared with Prioritization and clear on refresh or tab close.</p>
    <dl className="quality-stats">
      {[
        ["Total imported", records.length], ["Analysed", analysed.size],
        ["Pending analysis", records.filter(({ id }) => !analysed.has(id) && !excluded.has(id)).length],
        ["Suggested issues", queue.candidates.filter(({ review }) => review === "AI suggested").length],
        ["Reviewed issues", queue.candidates.filter(({ review }) => review === "Reviewed").length],
        ["Analysed and unassigned", records.filter(({ id }) => analysed.has(id) && !excluded.has(id) && !owners.has(id)).length],
        ["Excluded feedback", excluded.size],
      ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
    </dl>
    {queue.problem && <p role="alert" className="import-error">{queue.problem}</p>}
    <div className="import-actions">
      <button className="import-button" onClick={() => { choose(""); setIssueDraft(newCandidate(crypto.randomUUID())); }}>Create issue manually</button>
      <button className="import-button" disabled={!queue.canUndo} onClick={() => { queue.undo(); choose(""); }}>Undo issue change</button>
      <button className="import-button" onClick={() => setConfirmation("reset")}>Reset organization</button>
    </div>
    {confirmation === "reset" && <div className="priority-confirm">
      <p>Discard saved issues, assessments, and exclusions? Current AI suggestions will be available again.</p>
      <button className="import-button import-danger" onClick={() => { queue.edit({ type: "reset" }); choose(""); }}>Confirm organization reset</button>
      <button className="import-button" onClick={() => setConfirmation(null)}>Keep organization</button>
    </div>}
    {queue.candidates.length > 0 && <fieldset>
      <legend>Available issues</legend>
      <ul className="priority-picker">
        {queue.candidates.map((candidate) => <li key={candidate.id}>
          <input type="checkbox" aria-label={`Select issue ${candidate.title}`} checked={selectedIssues.includes(candidate.id)} onChange={() => toggle(selectedIssues, candidate.id, setSelectedIssues)} />
          <div><button className="priority-title-button" onClick={() => choose(candidate.id)}>{candidate.title}</button>
            <p>{candidate.origin ? "AI origin" : "Manual origin"} · {candidate.review ?? "Needs review"} · {candidate.evidenceIds.length} supporting reviews</p>
          </div>
        </li>)}
      </ul>
      {selectedIssues.length >= 2 && <form className="preview-controls priority-fields" onSubmit={(event) => {
        event.preventDefault();
        if (queue.edit({ type: "merge", ids: selectedIssues, target: selectedIssues[0], title: mergeTitle })) { choose(selectedIssues[0]); setSelectedIssues([]); setMergeTitle(""); }
      }}>
        <label>Merged issue title<input required maxLength={100} value={mergeTitle} onChange={(event) => setMergeTitle(event.target.value)} /></label>
        <p className="import-note">The first selected issue keeps its assessments. Review them against the combined evidence.</p>
        <button className="import-button" type="submit">Merge selected issues</button>
      </form>}
    </fieldset>}
    {issueDraft && <form className="preview-controls priority-fields" onSubmit={(event) => {
      event.preventDefault();
      if (queue.save(issueDraft)) choose(issueDraft.id);
    }}>
      <label>Issue title<input required maxLength={100} value={issueDraft.title} onChange={(event) => setIssueDraft({ ...issueDraft, title: event.target.value })} /></label>
      <label>Problem description<textarea maxLength={1500} rows={3} value={issueDraft.description} onChange={(event) => setIssueDraft({ ...issueDraft, description: event.target.value })} /></label>
      <button className="import-button import-primary" type="submit">Save issue details</button>
      <button className="import-button" type="button" onClick={() => setIssueDraft(null)}>Cancel issue edit</button>
    </form>}
    {current ? <>
      <h3>{current.title}</h3>
      {current.description && <p className="priority-text">{current.description}</p>}
      <p>{evidence.length ? `${evidence.length} supporting reviews` : "No supporting feedback"} · {analysed.size ? `${(evidence.filter(({ id }) => analysed.has(id)).length / analysed.size * 100).toFixed(1)}% of analysed feedback` : "Analysed share unavailable"}</p>
      <p className="priority-text">Sentiment {stats(evidence.map(({ id }) => predicted.get(id)))} · Sources {stats(evidence.map(({ source }) => source))}</p>
      <p className="priority-text">Dates {dates.length ? `${dates[0]} to ${dates.at(-1)}` : "Unavailable"} · Categories {stats(evidence.map(({ category }) => category))}</p>
      <div className="import-actions">
        <button className="import-button" onClick={() => setIssueDraft(current)}>Edit issue details</button>
        <button className="import-button" onClick={() => queue.save({ ...current, review: "Reviewed" })}>Mark as reviewed</button>
        <Link href="/prioritization" className="import-button import-primary" onClick={(event) => { if (current.review === "AI suggested" && !queue.save(current)) { event.preventDefault(); return; } queue.setFocused(current.id); }}>Send to Prioritization</Link>
        <button className="import-button" onClick={() => setConfirmation("delete")}>{current.review === "AI suggested" ? "Reject suggestion" : "Delete issue"}</button>
        <button className="import-button" onClick={() => choose("")}>Return to feedback pools</button>
      </div>
      {confirmation === "delete" && <div className="priority-confirm">
        <p>Remove the issue and return its supporting records to unassigned feedback?</p>
        <button className="import-button import-danger" onClick={() => { if (queue.remove(current.id)) choose(""); }}>Confirm issue deletion</button>
        <button className="import-button" onClick={() => setConfirmation(null)}>Keep issue</button>
      </div>}
    </> : <>
      <h3>Unassigned Feedback</h3>
      <div className="preview-controls priority-fields">
        <label>Feedback pool<select value={view} onChange={(event) => { setView(event.target.value); setPage(1); clearSelection(); }}>
          <option value="analysed">Analysed but unassigned</option><option value="pending">Not yet analysed and unassigned</option><option value="suggested">In AI suggestions</option><option value="assigned">Assigned to an issue</option><option value="excluded">Excluded by you</option>
        </select></label>
        <label>Search feedback pools<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        {sources.length <= 100 ? <label>Filter feedback source<select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
          <option value="">All sources</option>{sources.map((name) => <option key={name}>{name}</option>)}
        </select></label> : <label>Filter feedback source (exact)<input type="search" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} /></label>}
      </div>
    </>}
    <p role="status">{rows.length} matching reviews · {validSelection.length} selected</p>
    <ul className="priority-picker">
      {rows.slice((activePage - 1) * pageSize, activePage * pageSize).map((record) => <li key={record.id}>
        <input type="checkbox" aria-label={`Select CSV row ${record.originalRow}`} checked={selected.includes(record.id)} onChange={() => toggle(selected, record.id, setSelected)} />
        <div><p className="import-note">CSV row {record.originalRow} · {record.source ?? "No source"} · {record.date ?? "No date"} · {record.category ?? "No category"} · {record.rating ?? "No rating"}{record.marketplace && ` · ${record.marketplace.feedbackId} · ${record.marketplace.platform} · ${record.marketplace.segment}`}</p>
          <CellText text={record.text} originalText={record.originalText} />
        </div>
      </li>)}
    </ul>
    <Pagination page={activePage} pages={Math.ceil(rows.length / pageSize)} setPage={setPage} />
    {validSelection.length > 0 && <div className="preview-controls priority-fields">
      {view === "excluded" && !current ? <button className="import-button" onClick={() => { if (queue.edit({ type: "restore", ids: validSelection })) clearSelection(); }}>Restore selected feedback</button> : <>
        <label>Destination issue<select value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="">Choose an issue</option>{queue.candidates.filter(({ id }) => id !== current?.id).map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
        </select></label>
        <button className="import-button" disabled={!destination} onClick={() => {
          if (queue.edit({ type: "assign", ids: validSelection, from: current?.id, target: destination })) clearSelection();
        }}>{current ? "Move selected feedback" : "Assign selected feedback"}</button>
        <label>New issue title<input maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <button className="import-button" disabled={!title.trim()} onClick={() => {
          const id = crypto.randomUUID();
          if (queue.edit({ type: "create", ids: validSelection, from: current?.id, id, title })) choose(id);
        }}>{current ? "Split into new issue" : "Create issue from selected feedback"}</button>
        {current ? <button className="import-button" onClick={() => {
          if (queue.edit({ type: "assign", ids: validSelection, from: current.id, target: null })) clearSelection();
        }}>Return selected feedback to unassigned</button> : <button className="import-button" onClick={() => setAssignmentRequested(true)}>Suggest assignments</button>}
        <button className="import-button" onClick={() => {
          if (queue.edit({ type: "exclude", ids: validSelection })) clearSelection();
        }}>Exclude selected feedback</button>
      </>}
    </div>}
    {assignmentRequested && <div>
      <h4>Suggested assignments</h4>
      {assignments.length === 0 && <p>No sufficiently similar issue was found for the selected feedback.</p>}
      {assignments.map(({ id, issueId }) => <div key={id} className="import-actions">
        <p>CSV row {lookup.get(id)?.originalRow} → {queue.candidates.find((issue) => issue.id === issueId)?.title}</p>
        <button className="import-button" onClick={() => {
          if (queue.edit({ type: "assign", ids: [id], target: issueId })) setSelected((previous) => previous.filter((value) => value !== id));
        }}>Accept assignment</button>
      </div>)}
    </div>}
  </section>;
}
