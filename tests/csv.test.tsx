import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, MAX_ROWS, parseCsv, readCsv, validateFile } from "@/features/feedback/csv";
import { MAX_TEXT_LENGTH, mappingError, suggestMapping, validateRows } from "@/features/feedback/validation";

describe("CSV parsing", () => {
  it("reads ordinary CSV with both CRLF and LF files", () => {
    for (const newline of ["\r\n", "\n"]) {
      expect(parseCsv(["review,rating", "Great!,5", ""].join(newline))).toEqual({
        headers: ["review", "rating"], rows: [{ cells: ["Great!", "5"], originalRow: 2 }],
      });
    }
  });

  it("preserves quoted commas, escaped quotes and multiline feedback", () => {
    const csv = parseCsv('review,date\r\n"He said ""yes"", then\r\nleft",2024-02-29\r\nDone,');
    expect(csv.rows).toEqual([
      { originalRow: 2, cells: ['He said "yes", then\r\nleft', "2024-02-29"] },
      { originalRow: 3, cells: ["Done", ""] },
    ]);
  });

  it("supports a UTF-8 BOM and preserves Unicode and leading zeros", () => {
    expect(parseCsv("\uFEFFreview,source\ncafé,001").rows[0].cells).toEqual(["café", "001"]);
  });

  it("supports auto-detected semicolons and tabs and single-column CSVs", () => {
    expect(parseCsv("review;stars\nNice;5").headers).toEqual(["review", "stars"]);
    expect(parseCsv("review\tstars\nNice\t5").headers).toEqual(["review", "stars"]);
    expect(parseCsv('review\n"Fine, thanks"').rows[0].cells).toEqual(["Fine, thanks"]);
  });

  it("rejects empty and header-only files", () => {
    expect(() => parseCsv("\uFEFF  \n")).toThrow(/empty/i);
    expect(() => parseCsv("review,date\n")).toThrow(/headers but no feedback/i);
  });

  it.each(['review,date\n"Unclosed,2024-02-29', 'review,date\nA"b,2024-02-29', 'review,date\n"A"x,2024-02-29'])(
    "rejects malformed quoting in %s",
    (content) => expect(() => parseCsv(content)).toThrow(/malformed CSV/i),
  );

  it("enforces file limits without rejecting an exact 5 MiB file", () => {
    expect(() => validateFile({ name: "file.csv", size: MAX_FILE_BYTES + 1 })).toThrow(/5 MiB/);
    expect(() => validateFile({ name: "file.CSV", size: MAX_FILE_BYTES })).not.toThrow();
    expect(() => validateFile({ name: "file.txt", size: 5 })).toThrow(/extension/);
    expect(() => validateFile({ name: "file.csv", size: 0 })).toThrow(/empty/);
  });

  it("rejects invalid UTF-8 and binary control characters", async () => {
    const file = new File([Uint8Array.of(0xff, 0xff)], "broken.csv");
    await expect(readCsv(file)).rejects.toThrow(/UTF-8/);
    expect(() => parseCsv("review\n\u0000")).toThrow(/control characters/);
  });

  it("accepts 10,000 rows with a final newline and rejects excess rows", () => {
    const withinLimit = "review\n" + "item\n".repeat(MAX_ROWS);
    expect(parseCsv(withinLimit).rows).toHaveLength(MAX_ROWS);
    expect(() => parseCsv(withinLimit + "one extra\n")).toThrow(/10,000/);
  });
});

describe("column mapping", () => {
  it("auto-detects unambiguous aliases regardless of case or word separator", () => {
    expect(suggestMapping(["Ticket description", "CREATED-AT", "channel", "Stars", "issue_type"])).toEqual({
      text: 0, date: 1, source: 2, rating: 3, category: 4,
    });
  });

  it("requires manual selection for unusual or ambiguous headers", () => {
    const csv = parseCsv("💬 Verbatim,review,message\nUse this,Other,Ignored");
    const mapping = suggestMapping(csv.headers);
    expect(mapping.text).toBeNull();
    expect(mappingError(mapping, csv.headers.length)).toMatch(/choose a column/i);
    expect(validateRows(csv, { ...mapping, text: 0 }).accepted[0].text).toBe("Use this");
  });

  it("rejects duplicate and out-of-range mapping indices", () => {
    const mapping = suggestMapping(["review", "rating"]);
    expect(mappingError({ ...mapping, rating: 0 }, 2)).toMatch(/only one field/);
    expect(mappingError({ ...mapping, rating: 12 }, 2)).toMatch(/detected headers/);
  });

  it("uses column indices to distinguish repeated and blank headers", () => {
    const csv = parseCsv("review,review,\nWrong,Correct,Portal");
    const mapping = suggestMapping(csv.headers);
    expect(mapping.text).toBeNull();
    expect(validateRows(csv, { ...mapping, text: 1, source: 2 }).accepted[0]).toMatchObject({ text: "Correct", source: "Portal" });
  });
});

describe("row validation", () => {
  it("normalizes text and metadata while preserving raw feedback, stable IDs and logical CSV rows", () => {
    const csv = parseCsv('review,date,source,rating,category\n"  Line 1\nLine 2  ",2024-02-29,  Support ,4.5, Payment\nLater,,,,');
    const mapping = suggestMapping(csv.headers);
    const report = validateRows(csv, mapping);
    expect(report.accepted).toEqual([
      { id: "feedback-row-2", text: "Line 1\nLine 2", originalText: "  Line 1\nLine 2  ", originalRow: 2, date: "2024-02-29", source: "Support", rating: 4.5, category: "Payment" },
      { id: "feedback-row-3", text: "Later", originalText: "Later", originalRow: 3, date: null, source: null, rating: null, category: null },
    ]);
    expect(validateRows(csv, mapping).accepted).toEqual(report.accepted);
  });

  it("excludes missing, duplicate, oversized and malformed-width rows and reconciles counts", () => {
    const csv = parseCsv(`review,source\nGood app,store\n" GOOD   APP ",store\nGood app,other\n"  ",store\n${"x".repeat(MAX_TEXT_LENGTH + 1)},store\nwrong shape\nSimilar but different,store`);
    const report = validateRows(csv, suggestMapping(csv.headers));
    expect(report.accepted.map((record) => record.originalRow)).toEqual([2, 8]);
    expect(report.counts).toEqual({ total: 7, rejected: 5, duplicates: 2, missingText: 1, invalidDate: 0, invalidRating: 0 });
    expect(report.counts.total).toBe(report.accepted.length + report.counts.rejected);
    expect(report.issues.map((issue) => issue.reasons[0])).toEqual([
      expect.stringContaining("Duplicate of row 2"), expect.stringContaining("Duplicate of row 2"),
      expect.stringContaining("missing"), expect.stringContaining("10,000"), expect.stringContaining("does not match"),
    ]);
  });

  it("preserves accepted rows and flags invalid optional values without inventing replacements", () => {
    const csv = parseCsv("review,date,rating\nA,02/03/2026,6\nB,2025-02-29,0x3\nC,2024-02-29,1\nD,2026-11-01,5\nE,,");
    const report = validateRows(csv, suggestMapping(csv.headers));
    expect(report.counts).toMatchObject({ rejected: 0, invalidDate: 2, invalidRating: 2 });
    expect(report.accepted.map(({ date, rating }) => [date, rating])).toEqual([
      [null, null], [null, null], ["2024-02-29", 1], ["2026-11-01", 5], [null, null],
    ]);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0]).toMatchObject({ originalRow: 2, disposition: "Accepted with warning" });
  });

  it("retains explicit blank records as missing feedback and accepts the exact text limit", () => {
    const csv = parseCsv(`review\n""\n\n${"x".repeat(MAX_TEXT_LENGTH)}\n`);
    const report = validateRows(csv, suggestMapping(csv.headers));
    expect(report.counts).toMatchObject({ total: 3, rejected: 2, missingText: 2 });
    expect(report.accepted[0].text).toHaveLength(MAX_TEXT_LENGTH);
  });
});
