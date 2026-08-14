/**
 * CSV for spreadsheets that will be opened in Thai Excel.
 *
 * Two details matter more than they look. Every field is quoted and inner quotes doubled, so
 * an item name containing a comma cannot shift every later column — silent column drift is
 * the failure mode that makes an export worse than no export. And the file leads with a UTF-8
 * BOM, without which Excel on Windows renders Thai as mojibake and the recipient concludes
 * the data is broken.
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

const BOM = "﻿";

function escape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  return toCsvTable(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => column.value(row))),
  );
}

/** The same file from an already-flattened table, so CSV and Sheets share one set of rows. */
export function toCsvTable(
  headers: readonly (string | number | null | undefined)[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(escape).join(",")];

  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }

  // CRLF: the line ending Excel expects, and harmless everywhere else.
  return BOM + lines.join("\r\n") + "\r\n";
}

/** A filename that sorts chronologically and cannot break a Content-Disposition header. */
export function csvFilename(prefix: string, fromDate: string, toDate: string): string {
  const safe = prefix.replaceAll(/[^a-zA-Z0-9_-]/g, "");
  return `${safe}_${fromDate}_${toDate}.csv`;
}
