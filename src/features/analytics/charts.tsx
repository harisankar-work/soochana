import type { Bucket, Row } from "./calculations";
import { CellText, Pagination } from "../feedback/preview";

export function percent(count: number, total: number) {
  return total ? `${((count / total) * 100).toFixed(1)}%` : "—";
}

type ChartProps = { title: string; buckets: Bucket[]; choose: (bucket: Bucket) => void; selected?: string };

export function BarChart({ title, buckets, choose, selected, denominator }: ChartProps & { denominator?: number }) {
  const maximum = Math.max(1, ...buckets.map(({ rows }) => rows.length));
  return <ul className="analytics-bars" aria-label={title}>
    {buckets.map((bucket) => (
      <li key={bucket.key}>
        <button type="button" className="analytics-bar-button" aria-pressed={selected === bucket.key} disabled={!bucket.rows.length} onClick={() => choose(bucket)}>
          <span>{bucket.label}</span>{" "}
          <strong>{bucket.rows.length}{denominator ? ` · ${percent(bucket.rows.length, denominator)}` : ""}</strong>
          <span className="analytics-bar-track" aria-hidden="true"><span style={{ width: `${bucket.rows.length / maximum * 100}%` }} /></span>
        </button>
      </li>
    ))}
  </ul>;
}

export function TrendChart({ title, buckets, choose, selected }: ChartProps) {
  const maximum = Math.max(1, ...buckets.map(({ rows }) => rows.length));
  return <div className="analytics-trend-scroll" role="region" aria-label={title} tabIndex={0}>
    <ol className="analytics-trend">
      {buckets.map((bucket) => <li key={bucket.key}>
        <button type="button" aria-pressed={selected === bucket.key} onClick={() => choose(bucket)}>
          <span className="analytics-trend-plot" aria-hidden="true">
            <span className="analytics-trend-bar" style={{ height: `${bucket.rows.length / maximum * 100}%` }}>
              <span className="analytics-trend-count">{bucket.rows.length}</span>
            </span>
          </span>
          <span>{bucket.label}</span><span className="sr-only"> · {bucket.rows.length} {bucket.rows.length === 1 ? "review" : "reviews"}</span>
        </button>
      </li>)}
    </ol>
  </div>;
}

const PAGE_SIZE = 20;

export function ReviewTable({ rows, page, onPage }: { rows: Row[]; page: number; onPage: (page: number) => void }) {
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const current = Math.max(1, Math.min(page, pages));
  if (!rows.length) return <p className="import-note">No reviews match this view.</p>;
  return <>
    <p>{rows.length} supporting {rows.length === 1 ? "review" : "reviews"}</p>
    <div className="import-table-scroll" role="region" aria-label="Scrollable review table" tabIndex={0}>
      <table className="import-table feedback-table">
        <caption className="sr-only">Original feedback evidence</caption>
        <thead><tr>{["Feedback", "CSV row", "Source", "Date", "Rating", "Sentiment"].map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(({ record, date, rating, sentiment }) => (
          <tr key={record.id}>
            <td><CellText text={record.text} originalText={record.originalText} /></td>
            <td>{record.originalRow}</td><td>{record.source ?? "—"}</td><td>{date ?? "—"}</td>
            <td>{rating ?? "—"}</td><td>{sentiment ?? "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <Pagination page={current} pages={pages} setPage={onPage} />
  </>;
}
