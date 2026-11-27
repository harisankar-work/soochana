"use client";

import { useRef, useState } from "react";
import type { Row } from "../analytics/calculations";
import type { Candidate } from "./candidates";
import { needsReassessment } from "./candidates";

export function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^\s*[=+\-@\t\r\n＝＋－＠]/u.test(text) || /^[\t\r\n]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadFile(filename, new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
}

function downloadFile(filename: string, file: Blob) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type ExportEntry = { candidate: Candidate; observed: { evidence: Row[] }; score?: number };

export function exportIssues(entries: ExportEntry[]) {
  downloadCsv("soochana-prioritized-issues.csv", [
    ["Issue ID", "Title", "Description", "Origin", "Review", "Evidence count", "Severity", "Business impact", "Evidence confidence", "Urgency", "Effort", "Score", "Reassessment", "Illustrative demo assessments", "Rationale"],
    ...entries.map(({ candidate: c, observed, score }) => [c.id, c.title, c.description, c.origin ? "AI" : "Manual", c.review ?? "Needs review", observed.evidence.length,
      c.severity, c.impact, c.confidence, c.urgency, c.effort, score?.toFixed(2), needsReassessment(c) ? "Required" : "", c.illustrative ? "Yes" : "", c.notes]),
  ]);
}

export function exportEvidence(entries: ExportEntry[]) {
  downloadCsv("soochana-issue-evidence.csv", [
    ["Issue ID", "Issue", "CSV row", "Feedback ID", "Source", "Date", "Category", "Platform", "Customer segment", "Rating", "Sentiment", "Original feedback", "Severity", "Business impact", "Evidence confidence", "Urgency", "Effort", "Reassessment"],
    ...entries.flatMap(({ candidate: c, observed }) => (observed.evidence.length ? observed.evidence : [null]).map((row) => [
      c.id, c.title, row?.record.originalRow, row?.record.marketplace?.feedbackId, row?.record.source, row?.date, row?.record.category, row?.record.marketplace?.platform, row?.record.marketplace?.segment, row?.rating, row?.sentiment, row?.record.originalText,
      c.severity, c.impact, c.confidence, c.urgency, c.effort, needsReassessment(c) ? "Required" : "",
    ])),
  ]);
}

export function JiraDraft({ candidate, evidence }: { candidate: Candidate; evidence: Row[] }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [priority, setPriority] = useState("");
  const draftField = useRef<HTMLTextAreaElement>(null);
  function generate() {
    const categories = [...new Set(evidence.flatMap(({ record }) => record.category ? [record.category] : []))];
    setDraft([
      `Summary: ${candidate.title}`,
      `Problem: ${candidate.description || "Describe the observed product problem."}`,
      `Affected area: ${categories.join(", ") || "Unspecified"}`,
      `Observed frequency: ${evidence.length} supporting feedback records`,
      `User-confirmed priority: ${priority || "Unconfirmed"}`,
      `Labels: customer-feedback${candidate.origin ? ", ai-suggested" : ""}`,
      "Supporting feedback:",
      ...evidence.map(({ record }) => `- CSV row ${record.originalRow}${record.marketplace ? ` / ${record.marketplace.feedbackId}` : ""} (${record.source ?? "source unavailable"}): ${record.originalText}`),
      "Acceptance criteria draft (review before use):",
      "- Define a reproducible customer scenario and a measurable expected outcome.",
    ].join("\n"));
    setNotice("");
  }

  return <div className="preview-controls priority-fields">
    <p className="import-note sm:col-span-2">Create an issue in Jira and paste this draft into its description.</p>
    <label>Jira priority to confirm <select value={priority} onChange={(event) => setPriority(event.target.value)}>
      <option value="">Unconfirmed</option>{["Highest", "High", "Medium", "Low", "Lowest"].map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <button className="import-button" onClick={generate}>Generate Jira-ready draft</button>
    {draft !== null && <>
      <p className="import-note sm:col-span-2">Review this draft and its feedback before sharing outside this session.</p>
      <label className="sm:col-span-2">Jira-ready description<textarea ref={draftField} rows={10} value={draft} onChange={(event) => {
        setDraft(event.target.value);
        setNotice("");
      }} /></label>
      <button className="import-button" onClick={async () => {
        try { await navigator.clipboard.writeText(draft); setNotice("Jira-ready description copied."); }
        catch {
          draftField.current?.focus();
          draftField.current?.select();
          setNotice("Clipboard unavailable. Draft text selected. Copy it manually or download the draft.");
        }
      }}>Copy Jira-ready description</button>
      <button className="import-button" onClick={() => downloadFile("soochana-jira-draft.txt", new Blob([draft], { type: "text/plain;charset=utf-8" }))}>Download draft (.txt)</button>
      <p className="sm:col-span-2" role="status">{notice}</p>
    </>}
  </div>;
}
