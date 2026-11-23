"use client";

import { Target } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { makeRows } from "../analytics/calculations";
import { useFeedbackSession } from "../feedback/session";
import { CandidateEditor } from "./candidate-editor";
import { attachGroup, newCandidate, statuses, type Candidate, type Grouping } from "./candidates";
import { PriorityDetail } from "./priority-detail";
import { defaults, evidenceFor, factorLabels, factors, rank, sensitivity, validWeights, type Weights } from "./scoring";
import { defaultWeightInputs } from "./use-prioritization";

type Session = ReturnType<typeof useFeedbackSession>;
type Entry = { candidate: Candidate; observed: ReturnType<typeof evidenceFor> };
type Ranked = ReturnType<typeof rank>[number];
type Sort = "score" | "evidence" | "severity" | "impact";

function QueueTable({ entries, ranked, open, title }: { entries: Entry[]; ranked: Map<string, Ranked>; open: (id: string) => void; title: string }) {
  if (!entries.length) return <p>No {title.toLowerCase()} match this view.</p>;
  return <div className="import-table-scroll" role="region" aria-label={`${title} table`} tabIndex={0}>
    <table className="import-table priority-queue">
      <caption className="sr-only">{title}</caption>
      <thead><tr>{["Rank", "Issue", "Type", "Evidence", "Severity", "Business impact", "Confidence", "Score", "Investigation status"].map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{entries.map(({ candidate, observed }) => {
        const scored = ranked.get(candidate.id);
        return <tr key={candidate.id}>
          <td>{scored?.rank ?? "—"}</td>
          <th scope="row"><button className="priority-title-button" onClick={() => open(candidate.id)} aria-label={`View ${candidate.title}`}>{candidate.title}</button></th>
          <td>{candidate.origin ? "Discovered" : "Manual"}</td><td>{observed.evidence.length}</td>
          <td>{candidate.severity ?? "—"}</td><td>{candidate.impact ?? "—"}</td><td>{candidate.confidence ?? "—"}</td>
          <td>{scored?.result.total.toFixed(2) ?? "Unscored"}</td><td>{candidate.status}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function Comparison({ active, baseline, entries }: { active: Ranked[]; baseline: Map<string, Ranked>; entries: Map<string, Entry> }) {
  if (!active.length) return <p>Score an issue with valid weights to compare scenarios.</p>;
  const moved = active.filter(({ id, rank }) => baseline.get(id)?.rank !== rank).length;
  return <>
    <p role="status">{moved ? `${moved} ranked issues changed position against defaults.` : "Rank positions match the default weights."}</p>
    <p className="import-note">Each driver is the largest absolute change in weighted contribution. Rank movement also depends on changes to other issues.</p>
    <div className="import-table-scroll" role="region" aria-label="Sensitivity comparison table" tabIndex={0}>
      <table className="import-table priority-comparison">
        <caption className="sr-only">Default and current weight sensitivity</caption>
        <thead><tr>{["Issue", "Default rank", "Current rank", "Movement", "Default score", "Current score", "Largest contribution change"].map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{active.map((current) => {
          const original = baseline.get(current.id);
          if (!original) return null;
          const driver = sensitivity(current.result, original.result);
          const movement = original.rank - current.rank;
          return <tr key={current.id}>
            <th scope="row">{entries.get(current.id)?.candidate.title}</th><td>{original.rank}</td><td>{current.rank}</td>
            <td>{movement === 0 ? "Unchanged" : movement > 0 ? `Up ${movement}` : `Down ${-movement}`}</td>
            <td>{original.result.total.toFixed(2)}</td><td>{current.result.total.toFixed(2)}</td>
            <td>{Math.abs(driver.delta) < 1e-9 ? "No change" : `${factorLabels[driver.factor]} ${driver.delta > 0 ? "+" : ""}${driver.delta.toFixed(2)}`}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}

export function PrioritizationWorkspace() {
  const session = useFeedbackSession();
  return session.dataset ? <Workspace key={session.datasetVersion} dataset={session.dataset} session={session} /> :
    <EmptyState icon={Target} title="Import feedback to prioritize issues">
      <p>Curate supporting reviews, record your assessments, and compare investigation priorities.</p>
      <Link className="import-button import-primary mt-3" href="/feedback">Go to Feedback Analysis</Link>
    </EmptyState>;
}

function Workspace({ dataset, session }: { dataset: NonNullable<Session["dataset"]>; session: Session }) {
  const { prioritization, issues, sentiment } = session;
  const { candidates, draft, setDraft, save, remove, weightInputs, setWeightInputs } = prioritization;
  const [openId, setOpenId] = useState<string | null>(null);
  const [groupPicker, setGroupPicker] = useState<{ reconcileId: string | null } | null>(null);
  const [groupId, setGroupId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const rows = useMemo(() => makeRows(dataset.records, sentiment.analysis.predictions), [dataset.records, sentiment.analysis.predictions]);
  const lookup = useMemo(() => new Map(rows.map((row) => [row.record.id, row])), [rows]);
  const metadata = useMemo(() => {
    const dates = rows.flatMap(({ date }) => date ? [date] : []).sort();
    const sources = [...new Set(rows.flatMap(({ record }) => record.source ? [record.source] : []))].sort((a, b) => a.localeCompare(b));
    return { first: dates[0] ?? null, latest: dates.at(-1) ?? null, sources };
  }, [rows]);
  const grouping: Grouping | null = issues.result ? {
    groups: issues.result.groups, method: issues.result.algorithm, threshold: issues.result.threshold,
    populationIds: issues.analysis.embeddings.map(({ id }) => id),
  } : null;
  const weights = Object.fromEntries(factors.map((factor) => [factor, weightInputs[factor].trim() ? Number(weightInputs[factor]) : NaN])) as Weights;
  const valid = validWeights(weights);
  const entries = candidates.map((candidate) => ({ candidate, observed: evidenceFor(candidate, lookup, metadata.latest, metadata.first) }));
  const input = entries.map(({ candidate, observed }) => ({ candidate, count: observed.evidence.length, missing: observed.missing }));
  const active = rank(input, weights);
  const ranked = new Map(active.map((result) => [result.id, result]));
  const baseline = new Map(rank(input, defaults).map((result) => [result.id, result]));
  const entryMap = new Map(entries.map((entry) => [entry.candidate.id, entry]));
  const matches = entries.filter(({ candidate }) => (!type || type === (candidate.origin ? "group" : "manual")) && (!status || candidate.status === status));
  const sorted = [...matches].sort((a, b) => {
    const priority = (ranked.get(a.candidate.id)?.rank ?? Infinity) - (ranked.get(b.candidate.id)?.rank ?? Infinity);
    const difference = sort === "evidence" ? b.observed.evidence.length - a.observed.evidence.length :
      sort === "severity" || sort === "impact" ? (b.candidate[sort] ?? -1) - (a.candidate[sort] ?? -1) : 0;
    return difference || priority || (a.candidate.id < b.candidate.id ? -1 : 1);
  });
  const open = openId ? entryMap.get(openId) : undefined;
  const distinctEvidence = new Set(entries.flatMap(({ observed }) => observed.evidence.map(({ record }) => record.id))).size;
  const chosenGroup = grouping?.groups.find((group) => group.id === groupId);
  const locked = Boolean(draft || groupPicker);

  function pickGroup(reconcileId: string | null = null) {
    setGroupId("");
    setGroupPicker({ reconcileId });
  }

  function beginGroupDraft() {
    if (!chosenGroup || !grouping || !groupPicker) return;
    const previous = groupPicker.reconcileId ? entryMap.get(groupPicker.reconcileId)?.candidate : undefined;
    if (groupPicker.reconcileId && !previous) return;
    const label = lookup.get(chosenGroup.representativeId)?.record.text ?? "Discovered feedback theme";
    const initial = previous ?? { ...newCandidate(crypto.randomUUID()), title: label.slice(0, 100).trim() };
    setDraft(attachGroup(initial, chosenGroup, grouping));
    setGroupPicker(null);
  }

  return <div className="feedback-import priority-workspace">
    <section className="panel import-panel" aria-labelledby="priority-overview">
      <h2 id="priority-overview">Investigation queue</h2>
      <p className="file-info"><strong>{dataset.name}</strong> · {rows.length} imported reviews</p>
      <p role="status">{candidates.length} candidates · {active.length} scored · {candidates.length - active.length} unscored · {distinctEvidence} distinct supporting reviews</p>
      <p className="import-note">A review may support more than one issue. The distinct count includes each review once. Saved issues, drafts, and weights stay in this browser session and clear on refresh, tab close, or dataset replacement.</p>
      <div className="import-actions">
        <button className="import-button import-primary" disabled={locked} onClick={() => setDraft(newCandidate(crypto.randomUUID()))}>Add Manual Issue</button>
        {!!grouping?.groups.length && <button className="import-button" disabled={locked} onClick={() => pickGroup()}>Add Discovered Group</button>}
      </div>
      {!grouping?.groups.length && <p className="import-note">Manual curation is available now. <Link className="underline" href="/issues">Explore automatic groups</Link> when you want model-assisted suggestions.</p>}
    </section>

    {groupPicker && <section className="panel import-panel" aria-labelledby="group-picker">
      <h2 id="group-picker">{groupPicker.reconcileId ? "Review grouping snapshot" : "Choose a discovered group"}</h2>
      <p className="import-note">{groupPicker.reconcileId ? "Choose a current group to review in a draft. Saving the draft replaces the snapshot and its evidence while keeping your assessments." : "Choose a group and inspect its actual supporting reviews before saving the candidate."}</p>
      {grouping?.groups.length ? <label className="priority-fields">Current group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
        <option value="">Choose a group</option>
        {grouping.groups.map((group) => <option key={group.id} value={group.id}>{lookup.get(group.representativeId)?.record.text.slice(0, 88)} · {group.feedbackIds.length} reviews</option>)}
      </select></label> : <p>No current recurring groups are available. You can keep the saved evidence and revisit after another discovery run.</p>}
      <div className="import-actions">
        <button className="import-button import-primary" disabled={!chosenGroup} onClick={beginGroupDraft}>Review selected group</button>
        <button className="import-button" onClick={() => setGroupPicker(null)}>Close group review</button>
      </div>
    </section>}

    {draft && <CandidateEditor key={draft.id} draft={draft} rows={rows} sources={metadata.sources} update={setDraft}
      save={(candidate) => { save(candidate); setOpenId(candidate.id); }} close={() => setDraft(null)} />}

    <section className="panel import-panel" aria-labelledby="priority-weights">
      <h2 id="priority-weights">Priority weights</h2>
      <p className="import-note">Weights must total 100%. They reflect investigation preferences. Manual and discovered evidence counts come from different selection processes, and the ranking can reflect selection bias. Use the candidate type filter to compare within one provenance.</p>
      <div className="preview-controls priority-fields">
        {factors.map((factor) => <label key={factor}>{factorLabels[factor]} weight (%)<input type="number" min="0" max="100" step="any" value={weightInputs[factor]}
          aria-invalid={!valid || undefined} onChange={(event) => setWeightInputs({ ...weightInputs, [factor]: event.target.value })} /></label>)}
      </div>
      {!valid && <p role="alert" className="import-error">Enter four weights from 0 to 100 that total 100%. Rankings are hidden until the weights are valid.</p>}
      <div className="import-actions"><button className="import-button" onClick={() => setWeightInputs(defaultWeightInputs)}>Reset to Defaults</button></div>
    </section>

    {candidates.length ? <>
      <section className="panel import-panel" aria-labelledby="priority-ranking">
        <h2 id="priority-ranking">Ranked issues</h2>
        <p className="import-note">Rank reflects the full queue at the current weights, including when you filter this table.</p>
        <div className="preview-controls">
          <label>Candidate type<select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option value="manual">Manual issues</option><option value="group">Discovered groups</option></select></label>
          <label>Filter by status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Sort issues<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="score">Priority score</option><option value="evidence">Evidence count</option><option value="severity">Severity</option><option value="impact">Business impact</option></select></label>
        </div>
        <QueueTable title="Scored issues" entries={sorted.filter(({ candidate }) => ranked.has(candidate.id))} ranked={ranked} open={setOpenId} />
        <h3>Unscored issues</h3>
        <QueueTable title="Unscored issues" entries={sorted.filter(({ candidate }) => !ranked.has(candidate.id))} ranked={ranked} open={setOpenId} />
      </section>
      {open && <PriorityDetail key={open.candidate.id} entry={open} grouping={grouping} imported={rows.length} scored={ranked.get(open.candidate.id)}
        weights={weights} locked={locked} edit={() => setDraft(open.candidate)} reconcile={() => pickGroup(open.candidate.id)}
        remove={() => { remove(open.candidate.id); setOpenId(null); }} />}
      <section className="panel import-panel" aria-labelledby="priority-sensitivity">
        <h2 id="priority-sensitivity">Weight sensitivity</h2>
        <p className="import-note">Default weights are 30% frequency, 30% severity, 25% business impact, and 15% evidence confidence. Comparison uses the full scored queue.</p>
        <Comparison active={active} baseline={baseline} entries={entryMap} />
      </section>
    </> : <p>No issues in the queue. Add a manual issue to start reviewing feedback.</p>}
  </div>;
}
