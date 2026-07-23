/** Pure set/field diff between two identically-keyed maps. No I/O — unit-tested. */
export interface KeyedDiff {
  added: string[]; // keys in `wb` but not `db`
  removed: string[]; // keys in `db` but not `wb`
  changed: { key: string; field: string; from: unknown; to: unknown }[];
  unchanged: number;
}

/**
 * Diffs a workbook map (`wb`) against a DB map (`db`). For keys common to both, compares
 * each field in `fields` by stringified value (pre-normalise numerics with numStr before
 * building the maps to avoid format false-positives).
 */
export function diffKeyed<T extends Record<string, unknown>>(
  wb: Map<string, T>,
  db: Map<string, T>,
  fields: (keyof T)[],
): KeyedDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { key: string; field: string; from: unknown; to: unknown }[] = [];
  let unchanged = 0;

  for (const [k, wv] of wb) {
    const dv = db.get(k);
    if (!dv) { added.push(k); continue; }
    let dirty = false;
    for (const f of fields) {
      if (String(wv[f] ?? "") !== String(dv[f] ?? "")) {
        changed.push({ key: k, field: String(f), from: dv[f], to: wv[f] });
        dirty = true;
      }
    }
    if (!dirty) unchanged++;
  }
  for (const k of db.keys()) if (!wb.has(k)) removed.push(k);

  return { added, removed, changed, unchanged };
}
