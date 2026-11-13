import { Table } from "react-bootstrap";
import { fmtVal, humanize } from "../lib/util";
import { Pager, usePaged } from "./ui";

// Generic table for records whose field names are not fixed (squads, player history, transfers).
// pref: groups of candidate keys, in display order; the first key that exists wins. Other scalar columns fill up to `max`.
export function pickCols(rows, pref = [], max = 7) {
  const have = new Set(); for (const r of rows.slice(0, 25)) for (const k of Object.keys(r)) have.add(k);
  const cols = [];
  for (const group of pref) { const k = [].concat(group).find((x) => have.has(x)); if (k && !cols.includes(k)) cols.push(k); }
  for (const k of have) { if (cols.length >= max) break; if (!cols.includes(k) && !/(^id$|_id$|^updated|^created)/i.test(k)) cols.push(k); }
  return cols.slice(0, Math.max(max, pref.length));
}

export default function DataTable({ rows, pref, max = 7, pageSize = 15, onRow, nameKeys = [], empty = "No data." }) {
  const cols = pickCols(rows, pref, max), pg = usePaged(rows, pageSize, rows.length);
  if (!rows.length) return <p className="text-body-secondary mb-0">{empty}</p>;
  return (
    <>
      <div className="table-responsive"><Table hover={!!onRow} size="sm" className="align-middle mb-2">
        <thead><tr>{cols.map((c) => <th key={c} className="text-nowrap">{humanize(c)}</th>)}</tr></thead>
        <tbody>{pg.slice.map((r, i) => (
          <tr key={i} role={onRow ? "button" : undefined} onClick={onRow ? () => onRow(r) : undefined}>
            {cols.map((c) => <td key={c} className={nameKeys.includes(c) ? "fw-medium" : undefined}>{fmtVal(c, r[c])}</td>)}
          </tr>))}</tbody>
      </Table></div>
      <Pager page={pg.page} pages={pg.pages} onChange={pg.setPage} />
    </>
  );
}
