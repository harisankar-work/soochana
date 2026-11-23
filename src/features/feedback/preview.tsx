"use client";

import { useMemo, useState } from "react";
import type { FeedbackRecord, ImportReport } from "./validation";

const PAGE_SIZE = 20;
const sortOptions = {
  row: "Original row order",
  newest: "Date, newest first",
  oldest: "Date, oldest first",
  highest: "Rating, highest first",
  lowest: "Rating, lowest first",
} as const;
type Sort = keyof typeof sortOptions;

function compare(a: FeedbackRecord, b: FeedbackRecord, sort: Sort) {
  if (sort === "row") return a.originalRow - b.originalRow;
  const byDate = sort === "newest" || sort === "oldest";
  const left = byDate ? a.date : a.rating;
  const right = byDate ? b.date : b.rating;
  if (left === right) return a.originalRow - b.originalRow;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left < right ? -1 : 1) * (sort === "newest" || sort === "highest" ? -1 : 1);
}

export function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="import-actions" aria-label="Pagination" role="group">
      <button type="button" className="import-button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span role="status">Page {page} of {pages}</span>
      <button type="button" className="import-button" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}

export function CellText({ text, originalText = text }: { text: string; originalText?: string }) {
  const characters = Array.from(text);
  if (characters.length <= 240 && text === originalText) return <span className="cell-text">{text}</span>;
  const excerpt = characters.length > 240 ? `${characters.slice(0, 240).join("")}…` : text;
  return (
    <details className="cell-text">
      <summary>{excerpt || "Feedback"} <span className="details-label">· Full text</span></summary>
      <div>{originalText}</div>
    </details>
  );
}

export function FeedbackPreview({ records }: { records: FeedbackRecord[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("row");
  const [page, setPage] = useState(1);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter(({ text }) => text.toLowerCase().includes(query)).sort((a, b) => compare(a, b, sort));
  }, [records, search, sort]);
  const pages = Math.ceil(results.length / PAGE_SIZE);

  return (
    <>
      <div className="preview-controls">
        <label>Search feedback
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </label>
        <label>Sort by
          <select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setPage(1); }}>
            {Object.entries(sortOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <p role="status">{results.length} matching · {records.length} accepted records</p>
      {results.length === 0 ? (
        <p className="import-note">{records.length ? "No records match your search. Try a different term." : "No records passed validation. Review the column mapping or choose another file."}</p>
      ) : (
        <>
          <div className="import-table-scroll" role="region" aria-label="Feedback table" tabIndex={0}>
            <table className="import-table feedback-table">
              <caption className="sr-only">Accepted feedback</caption>
              <thead><tr>{["Feedback", "Date", "Source", "Rating", "Category", "Original row"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>
                {results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((record) => (
                  <tr key={record.id}>
                    <td><CellText text={record.text} originalText={record.originalText} /></td>
                    <td>{record.date ?? "—"}</td>
                    <td>{record.source ? <CellText text={record.source} /> : "—"}</td>
                    <td>{record.rating ?? "—"}</td>
                    <td>{record.category ? <CellText text={record.category} /> : "—"}</td>
                    <td>{record.originalRow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} setPage={setPage} />
        </>
      )}
    </>
  );
}

export function QualityReport({ report }: { report: ImportReport }) {
  const [page, setPage] = useState(1);
  const { counts, issues, accepted } = report;
  const statistics = [
    ["Total parsed rows", counts.total], ["Accepted records", accepted.length], ["Rejected records", counts.rejected],
    ["Duplicate records", counts.duplicates], ["Missing feedback", counts.missingText],
    ["Invalid ratings", counts.invalidRating], ["Invalid dates", counts.invalidDate],
  ] as const;
  return (
    <>
      <dl className="quality-stats">
        {statistics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <p className="import-note">Rows with missing or oversized feedback, mismatched fields, or duplicate text are excluded. The first eligible copy is kept after ignoring case and repeated whitespace. Invalid dates and ratings are counted on accepted rows and left blank. Duplicate and missing counts are included in rejected records.</p>
      {issues.length > 0 && (
        <details className="quality-details">
          <summary>Inspect row issues ({issues.length})</summary>
          <div className="import-table-scroll" role="region" aria-label="Row issues table" tabIndex={0}>
            <table className="import-table row-issues-table">
              <caption className="sr-only">Validation issues by original CSV row</caption>
              <thead><tr><th scope="col">Original row</th><th scope="col">Result</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {issues.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ originalRow, disposition, reasons }) => (
                  <tr key={originalRow}><td>{originalRow}</td><td>{disposition}</td><td>{reasons.join(" ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={Math.ceil(issues.length / PAGE_SIZE)} setPage={setPage} />
        </details>
      )}
    </>
  );
}
