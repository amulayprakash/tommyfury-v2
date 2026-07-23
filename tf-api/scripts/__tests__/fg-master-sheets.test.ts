import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { FG_SHEETS, FG_MMV_COLUMNS, FG_MASTER_DEFAULT_PATH } from "../lib/fg-master-sheets.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");
const XLS = process.env.FG_MASTER_XLS ?? FG_MASTER_DEFAULT_PATH;

describe("FG 'Motor field Master.xls' workbook shape (rebrand-rename guard)", () => {
  it("the new JSON-kit workbook file exists at the default path", () => {
    expect(existsSync(XLS)).toBe(true);
  });

  const wb = existsSync(XLS)
    ? XLSX.readFile(XLS)
    : ({ SheetNames: [] as string[], Sheets: {} } as ReturnType<typeof XLSX.readFile>);

  it("contains every sheet the importer reads", () => {
    const names = new Set(wb.SheetNames);
    const expected = [
      FG_SHEETS.pvtCarMmv, FG_SHEETS.gcvMmv, FG_SHEETS.pcvMmv, FG_SHEETS.rto,
      FG_SHEETS.addOnCovers, FG_SHEETS.occupation, FG_SHEETS.tpInsurer, ...FG_SHEETS.pincode,
    ];
    for (const name of expected) expect(names.has(name), `missing sheet "${name}"`).toBe(true);
  });

  it("every MMV sheet exposes the columns pushMmv() needs", () => {
    for (const sheetName of [FG_SHEETS.pvtCarMmv, FG_SHEETS.gcvMmv, FG_SHEETS.pcvMmv]) {
      // noUncheckedIndexedAccess: Sheets[name] is WorkSheet | undefined — narrow before sheet_to_json.
      const ws = wb.Sheets[sheetName];
      if (!ws) throw new Error(`missing sheet "${sheetName}"`);
      const hdr = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] ?? []) as unknown[];
      const cols = new Set(hdr.map((h) => String(h).trim()));
      for (const c of FG_MMV_COLUMNS) expect(cols.has(c), `${sheetName} missing column "${c}"`).toBe(true);
    }
  });
});
