import Papa from "papaparse";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 200;

export type CsvRow = { cells: string[]; originalRow: number };
export type ParsedCsv = { headers: string[]; rows: CsvRow[] };

export function validateFile(file: Pick<File, "name" | "size">) {
  if (!/\.csv$/i.test(file.name)) throw new Error("Choose a file with a .csv extension.");
  if (file.size === 0) throw new Error("The file is empty. Choose a CSV with headers and feedback rows.");
  if (file.size > MAX_FILE_BYTES) throw new Error("The file exceeds 5 MiB. Split it into smaller CSV files.");
}

export async function readCsv(file: File): Promise<ParsedCsv> {
  validateFile(file);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error("This file could not be read as UTF-8. Save it as UTF-8 CSV and try again.");
  }
  return parseCsv(content);
}

function hasUnsupportedControls(content: string) {
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
  }
  return false;
}

export function parseCsv(content: string): ParsedCsv {
  if (!content.trim()) throw new Error("The file is empty. Include a header row and feedback.");
  if (hasUnsupportedControls(content)) {
    throw new Error("The file contains unsupported control characters. Export it as a UTF-8 CSV.");
  }

  const { data, errors, meta } = Papa.parse<string[]>(content, {
    delimitersToGuess: [",", "\t", ";"],
    dynamicTyping: false,
    preview: MAX_ROWS + 2,
  });
  const quoteError = errors.find((error) => error.type === "Quotes");
  if (quoteError) {
    throw new Error(`Malformed CSV near record ${(quoteError.row ?? 0) + 1}. Check that quotes are closed and escaped.`);
  }

  // Papa Parse emits an additional empty record after a final line ending.
  const last = data.at(-1);
  if (/[\r\n]$/.test(content) && last?.length === 1 && last[0] === "" && !meta.truncated) {
    data.pop();
  }
  if (data.length > MAX_ROWS + 1 || meta.truncated) {
    throw new Error("The CSV exceeds 10,000 data rows. Split it into smaller CSV files.");
  }

  checkQuoteSyntax(content.replace(/^\uFEFF/, ""), meta.delimiter);
  const [headers, ...records] = data;
  if (headers.length > MAX_COLUMNS) throw new Error("The CSV exceeds 200 columns. Remove unused columns and try again.");
  if (!headers.some((header) => header.trim())) {
    throw new Error("The first CSV record must contain column headers.");
  }
  if (!records.length) throw new Error("The CSV contains headers but no feedback rows.");

  return {
    headers: headers.map((header) => header.trim()),
    rows: records.map((cells, index) => ({ cells, originalRow: index + 2 })),
  };
}

// Papa tolerates quotes in unquoted cells. Reject those and stray characters after closing quotes.
function checkQuoteSyntax(content: string, delimiter: string) {
  let state: "start" | "unquoted" | "quoted" | "closed" = "start";
  let record = 1;
  const malformed = () => new Error(`Malformed CSV near record ${record}. Quote whole fields and escape quotes by doubling them.`);
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (state === "quoted") {
      if (character === '"') {
        if (content[index + 1] === '"') index += 1;
        else state = "closed";
      }
    } else if (character === delimiter || character === "\r" || character === "\n") {
      if (character !== delimiter) {
        record += 1;
        if (character === "\r" && content[index + 1] === "\n") index += 1;
      }
      state = "start";
    } else if (state === "closed") {
      if (character.trim()) throw malformed();
    } else if (character === '"') {
      if (state !== "start") throw malformed();
      state = "quoted";
    } else {
      state = "unquoted";
    }
  }
  if (state === "quoted") throw malformed();
}
