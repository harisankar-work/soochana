import type { ParsedCsv } from "./csv";

export const MAX_TEXT_LENGTH = 10_000;

export const fields = [
  { key: "text", label: "Feedback text", aliases: ["review", "review_text", "feedback", "feedback_text", "text", "comment", "message", "ticket_description", "description"] },
  { key: "date", label: "Date", aliases: ["date", "created_at", "timestamp", "submitted_at"] },
  { key: "source", label: "Source", aliases: ["source", "channel", "platform"] },
  { key: "rating", label: "Rating", aliases: ["rating", "stars", "score"] },
  { key: "category", label: "Category", aliases: ["category", "topic", "issue_type"] },
] as const;

type Field = (typeof fields)[number]["key"];
export type ColumnMapping = Record<Field, number | null>;

export type FeedbackRecord = {
  id: string;
  text: string;
  originalText: string;
  date: string | null;
  source: string | null;
  rating: number | null;
  category: string | null;
  originalRow: number;
};

export type RowIssue = {
  originalRow: number;
  disposition: "Excluded" | "Accepted with warning";
  reasons: string[];
};

export type ImportReport = {
  accepted: FeedbackRecord[];
  issues: RowIssue[];
  counts: {
    total: number;
    rejected: number;
    duplicates: number;
    missingText: number;
    invalidRating: number;
    invalidDate: number;
  };
};

export function suggestMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const mapping: ColumnMapping = { text: null, date: null, source: null, rating: null, category: null };
  for (const { key, aliases } of fields) {
    const matches = normalized.flatMap((header, index) => aliases.some((alias) => alias === header) ? [index] : []);
    if (matches.length === 1) mapping[key] = matches[0];
  }
  return mapping;
}

export function mappingError(mapping: ColumnMapping, columnCount: number): string | null {
  if (mapping.text === null) return "Choose a column for Feedback text.";
  const chosen = Object.values(mapping).filter((index) => index !== null);
  if (chosen.some((index) => !Number.isInteger(index) || index < 0 || index >= columnCount)) {
    return "Choose columns from the detected headers.";
  }
  if (new Set(chosen).size !== chosen.length) return "Use each CSV column for only one field.";
  return null;
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function parseRating(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const rating = Number(value);
  return rating >= 1 && rating <= 5 ? rating : null;
}

export function validateRows(csv: ParsedCsv, mapping: ColumnMapping): ImportReport {
  const error = mappingError(mapping, csv.headers.length);
  if (error) throw new Error(error);

  const counts = { total: csv.rows.length, rejected: 0, duplicates: 0, missingText: 0, invalidRating: 0, invalidDate: 0 };
  const accepted: FeedbackRecord[] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>();

  for (const { cells, originalRow } of csv.rows) {
    const cell = (field: Field) => cells[mapping[field] ?? -1] ?? "";
    const originalText = cell("text");
    const text = originalText.trim();
    const normalized = text.replace(/\s+/gu, " ").toLowerCase();
    const firstRow = seen.get(normalized);

    let rejection: string | undefined;
    if (cells.length !== csv.headers.length && !(cells.length === 1 && cells[0].trim() === "")) {
      rejection = "The number of fields does not match the header.";
    } else if (!text) {
      counts.missingText += 1;
      rejection = "Feedback text is missing.";
    } else if (originalText.length > MAX_TEXT_LENGTH) {
      rejection = "Feedback exceeds 10,000 characters.";
    } else if (firstRow !== undefined) {
      counts.duplicates += 1;
      rejection = `Duplicate of row ${firstRow} after case and whitespace normalization.`;
    }
    if (rejection) {
      counts.rejected += 1;
      issues.push({ originalRow, disposition: "Excluded", reasons: [rejection] });
      continue;
    }

    const dateValue = cell("date").trim();
    const ratingValue = cell("rating").trim();
    const date = parseDate(dateValue);
    const rating = parseRating(ratingValue);
    const reasons: string[] = [];
    if (dateValue && date === null) {
      counts.invalidDate += 1;
      reasons.push("Date must be a valid calendar date in YYYY-MM-DD format.");
    }
    if (ratingValue && rating === null) {
      counts.invalidRating += 1;
      reasons.push("Rating must be a number from 1 to 5.");
    }
    if (reasons.length) issues.push({ originalRow, disposition: "Accepted with warning", reasons });

    seen.set(normalized, originalRow);
    accepted.push({
      id: `feedback-row-${originalRow}`, originalRow, text, originalText, date, rating,
      source: cell("source").trim() || null, category: cell("category").trim() || null,
    });
  }

  return { accepted, issues, counts };
}
