import { describe, expect, it } from "vitest";
import { csvFilename, toCsv } from "../csv";

type Row = { name: string; qty: number; note: string | null };

const columns = [
  { header: "ชื่อ", value: (row: Row) => row.name },
  { header: "จำนวน", value: (row: Row) => row.qty },
  { header: "หมายเหตุ", value: (row: Row) => row.note },
];

describe("csv", () => {
  it("keeps a comma inside a field from shifting the columns", () => {
    const csv = toCsv([{ name: "ไก่บด, ไม่ติดมัน", qty: 3, note: null }], columns);
    const dataLine = csv.split("\r\n")[1];

    expect(dataLine).toBe('"ไก่บด, ไม่ติดมัน","3",""');
  });

  it("doubles a quote inside a field rather than ending it early", () => {
    const csv = toCsv([{ name: 'ขนาด 5" ', qty: 1, note: null }], columns);

    expect(csv).toContain('"ขนาด 5"" "');
  });

  it("leads with a BOM so Excel reads Thai correctly", () => {
    expect(toCsv([], columns).codePointAt(0)).toBe(0xfeff);
  });

  it("writes a header row even with no data", () => {
    const csv = toCsv([], columns);

    expect(csv).toBe('﻿"ชื่อ","จำนวน","หมายเหตุ"\r\n');
  });

  it("writes an empty field for null and undefined rather than the word null", () => {
    const csv = toCsv([{ name: "x", qty: 0, note: null }], columns);

    expect(csv).not.toContain("null");
    expect(csv.split("\r\n")[1]).toBe('"x","0",""');
  });

  it("separates rows with CRLF", () => {
    const csv = toCsv(
      [
        { name: "a", qty: 1, note: null },
        { name: "b", qty: 2, note: null },
      ],
      columns,
    );

    expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing
  });

  it("strips anything unsafe from a filename", () => {
    expect(csvFilename('stock"; rm -rf /', "2026-01-01", "2026-01-31")).toBe(
      "stockrm-rf_2026-01-01_2026-01-31.csv",
    );
  });
});
