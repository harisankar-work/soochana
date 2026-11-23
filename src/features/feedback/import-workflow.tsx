"use client";

import { Check, FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SentimentPanel } from "../sentiment/sentiment-panel";
import { readCsv, type ParsedCsv } from "./csv";
import { FeedbackPreview, QualityReport } from "./preview";
import { useFeedbackSession } from "./session";
import { fields, mappingError, suggestMapping, validateRows, type ColumnMapping, type ImportReport } from "./validation";

const steps = ["Upload", "Map Columns", "Review Quality", "Preview", "Confirm"] as const;
type Step = (typeof steps)[number];
type Draft = { file: { name: string; size: number }; csv: ParsedCsv; mapping: ColumnMapping };
type FileInfo = Draft["file"];

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function UploadArea({ busy, onFile }: { busy: boolean; onFile: (files: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="csv-drop" onDragOver={(event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = busy ? "none" : "copy";
    }} onDrop={(event) => {
      event.preventDefault();
      if (!busy && event.dataTransfer.files.length) onFile(event.dataTransfer.files);
    }}>
      <span className="icon-tile"><FileUp aria-hidden="true" size={20} /></span>
      <p>Drop a CSV here or browse for a file.</p>
      <p id="csv-limits" className="import-note">UTF-8 CSV · up to 5 MiB and 10,000 data rows</p>
      <input ref={input} hidden type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(event) => {
        if (event.target.files?.length) onFile(event.target.files);
        event.target.value = "";
      }} />
      <button type="button" className="import-button import-primary" aria-describedby="csv-limits" disabled={busy} onClick={() => input.current?.click()}>Browse CSV</button>
    </div>
  );
}

export function ImportWorkflow() {
  const { dataset, setDataset } = useFeedbackSession();
  const [step, setStep] = useState<Step>("Upload");
  const [mode, setMode] = useState<"Import" | "Summary" | "View" | "Remove">(() => dataset ? "Summary" : "Import");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<FileInfo | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingRead = useRef(false);
  const stageTitle = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef(false);

  useEffect(() => {
    if (focusNext.current) {
      stageTitle.current?.focus();
      focusNext.current = false;
    }
  }, [step, mode]);

  function goTo(next: Step) {
    focusNext.current = true;
    setStep(next);
    setError("");
  }

  function show(next: typeof mode) {
    focusNext.current = true;
    setMode(next);
    setNotice("");
  }

  function resetDraft() {
    setDraft(null);
    setSelected(null);
    setReport(null);
    goTo("Upload");
  }

  async function selectFile(files: FileList) {
    if (pendingRead.current) return;
    setError("");
    setNotice("");
    if (files.length !== 1) {
      setError("Choose one CSV file at a time.");
      return;
    }
    const file = files[0];
    const info = { name: file.name, size: file.size };
    setSelected(info);
    pendingRead.current = true;
    setBusy(true);
    try {
      const csv = await readCsv(file);
      setDraft({ file: info, csv, mapping: suggestMapping(csv.headers) });
      goTo("Map Columns");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to read the CSV. Choose another file.");
    } finally {
      pendingRead.current = false;
      setBusy(false);
    }
  }

  function reviewMapping() {
    if (!draft) return;
    const problem = mappingError(draft.mapping, draft.csv.headers.length);
    if (problem) {
      setError(problem);
      return;
    }
    setReport(validateRows(draft.csv, draft.mapping));
    goTo("Review Quality");
  }

  function confirmImport() {
    if (!draft || !report?.accepted.length) return;
    setDataset({ ...draft.file, records: report.accepted });
    resetDraft();
    show("Summary");
    setNotice(dataset ? "Replacement dataset imported." : "Feedback imported.");
  }

  return (
    <div className="feedback-import">
      <p className="import-privacy">CSV files are processed in this browser, with no upload to a server. Refreshing or closing the page clears the imported dataset.</p>
      <p className="import-note" role="status">{notice}</p>
      {mode !== "Import" && dataset ? (
        <section className="panel import-panel" aria-labelledby="import-stage">
          <h2 id="import-stage" tabIndex={-1} ref={stageTitle}>{mode === "Remove" ? "Remove imported dataset?" : mode === "View" ? "Imported feedback" : "Imported dataset"}</h2>
          <p className="file-info"><strong>{dataset.name}</strong> · {fileSize(dataset.size)} · {dataset.records.length} records</p>
          {mode === "Remove" ? (
            <>
              <p>This removes the dataset, its model results, and its prioritization issues and drafts from this browser session.</p>
              <div className="import-actions">
                <button className="import-button" onClick={() => show("Summary")}>Keep dataset</button>
                <button className="import-button import-danger" onClick={() => {
                  setDataset(null);
                  show("Import");
                  setNotice("Dataset removed.");
                }}>Confirm removal</button>
              </div>
            </>
          ) : (
            <>
              {mode === "View" && <FeedbackPreview records={dataset.records} />}
              <div className="import-actions">
                <button className="import-button import-primary" onClick={() => show(mode === "View" ? "Summary" : "View")}>{mode === "View" ? "Back to summary" : "View imported feedback"}</button>
                <button className="import-button" onClick={() => show("Import")}>Replace dataset</button>
                <button className="import-button" onClick={() => show("Remove")}>Remove dataset</button>
              </div>
            </>
          )}
        </section>
      ) : (
        <>
          <ol className="import-steps" aria-label="Import steps">
            {steps.map((label, index) => <li key={label} aria-current={step === label ? "step" : undefined}>
              <span aria-hidden="true">{steps.indexOf(step) > index ? <Check size={15} /> : index + 1}</span>{label}
            </li>)}
          </ol>
          <section className="panel import-panel" aria-labelledby="import-stage">
            <h2 id="import-stage" ref={stageTitle} tabIndex={-1}>{step === "Upload" ? "Upload feedback" : step}</h2>
            {selected && <p className="file-info"><strong>{selected.name}</strong> · {fileSize(selected.size)}</p>}
            {error && <p className="import-error" role="alert">{error}</p>}
            {step === "Upload" && (
              <>
                <UploadArea busy={busy} onFile={(files) => { void selectFile(files); }} />
                {busy && <p role="status">Reading CSV…</p>}
              </>
            )}
            {step === "Map Columns" && draft && (
              <form onSubmit={(event) => { event.preventDefault(); reviewMapping(); }}>
                <p>Match the detected headers to feedback fields. Only feedback text is required.</p>
                <div className="mapping-fields">
                  {fields.map(({ key, label }) => (
                    <label key={key}>{label} <span className="import-note">({key === "text" ? "required" : "optional"})</span>
                      <select value={draft.mapping[key] ?? ""} onChange={(event) => {
                        const value = event.target.value;
                        setDraft({ ...draft, mapping: { ...draft.mapping, [key]: value === "" ? null : Number(value) } });
                        setError("");
                      }}>
                        <option value="">Choose a column</option>
                        {draft.csv.headers.map((header, index) => (
                          <option key={index} value={index}>{header || "Unnamed column"} (column {index + 1})</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="import-actions">
                  <button type="button" className="import-button" onClick={resetDraft}>Choose another file</button>
                  <button type="submit" className="import-button import-primary">Review quality</button>
                </div>
              </form>
            )}
            {step === "Review Quality" && report && (
              <>
                <QualityReport report={report} />
                <div className="import-actions">
                  <button className="import-button" onClick={() => goTo("Map Columns")}>Edit column mapping</button>
                  <button className="import-button import-primary" onClick={() => goTo("Preview")}>Preview accepted records</button>
                </div>
              </>
            )}
            {step === "Preview" && report && (
              <>
                <FeedbackPreview records={report.accepted} />
                <div className="import-actions">
                  <button className="import-button" onClick={() => goTo("Map Columns")}>Edit column mapping</button>
                  <button className="import-button" onClick={() => goTo("Review Quality")}>Back to quality review</button>
                  <button className="import-button import-primary" disabled={!report.accepted.length} onClick={() => goTo("Confirm")}>Continue to confirmation</button>
                </div>
              </>
            )}
            {step === "Confirm" && report && (
              <>
                <p>{report.accepted.length} accepted · {report.counts.rejected} excluded</p>
                {dataset && <p>This replaces <strong className="file-info">{dataset.name}</strong> and clears its records, model results, and prioritization issues and drafts from this session.</p>}
                <div className="import-actions">
                  <button className="import-button" onClick={() => goTo("Preview")}>Back to preview</button>
                  <button className="import-button import-primary" onClick={confirmImport}>{dataset ? "Replace dataset and import" : "Import"} {report.accepted.length} feedback {report.accepted.length === 1 ? "record" : "records"}</button>
                </div>
              </>
            )}
            {dataset && <div className="import-actions"><button className="import-button" disabled={busy} onClick={() => { resetDraft(); show("Summary"); }}>Cancel replacement</button></div>}
          </section>
        </>
      )}
      {dataset && mode !== "Import" && mode !== "Remove" && <SentimentPanel />}
    </div>
  );
}
