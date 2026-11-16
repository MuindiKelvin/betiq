import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// Firestore documents are written by the data sync (scripts/sync.mjs). Everything is loaded lazily per competition and cached for the session:
// opening the app reads 2 documents (catalog + team index); a competition adds ~3 plus one per season.
const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) { const p = fn(); p.catch(() => cache.delete(key)); cache.set(key, p); } return cache.get(key); };
const read = async (c, id) => { const d = await getDoc(doc(db, c, String(id))); return d.exists() ? d.data() : null; };
const one = (c, id) => memo(`${c}/${id}`, () => read(c, id));
export const fresh = (c, id) => read(c, id);                          // never cached: data that can change when a request is fulfilled
export const invalidate = (c, id) => cache.delete(`${c}/${id}`);

export const loadCatalog = () => one("catalog", "main");
export const loadTeamIndex = () => one("index", "teams");
export const loadStandings = (code) => one("standings", code);
export const loadLeaders = (code) => one("leaders", code);
export const loadTransfers = (code) => one("transfers", code);
export const loadSquad = (id) => one("squads", id);
export const loadMatchStats = (code) => one("mstats", code).then((d) => d?.m ?? {});
export const loadGoals = (code) => one("goals", code).then((d) => d?.m ?? {});     // { [matchId]: { g: [goals with names], ok, n } }
export const loadInfo = (code) => one("info", code).then((d) => d?.m ?? {});       // { [matchId]: { rf: referee, vn: venue, hc/ac: managers } }
export const loadManagers = (code) => one("managers", code);
export const loadReferees = (code) => one("referees", code);

// meta + teams + fixtures of one competition
export const loadComp = (code) => memo(`comp/${code}`, async () => {
  const [meta, teams, fixtures] = await Promise.all([one("meta", code), one("teams", code), one("fixtures", code)]);
  if (!meta) throw new Error("This competition has not been synced yet.");
  return { code, meta, teams: teams?.list ?? [], fixtures: fixtures?.list ?? [] };
});

// All loaded seasons of a competition, merged, newest first. s = 0 is the current season, 1 the one before, and so on.
export const loadResults = (code) => memo(`results/${code}`, async () => {
  const meta = await one("meta", code);
  if (!meta) throw new Error("This competition has not been synced yet.");
  const seasons = meta.seasons ?? [];
  const lists = await Promise.all(seasons.map((s, i) => one("seasons", `${code}_${s.id}`).then((d) => (d?.results ?? []).map((r) => ({ ...r, s: i })))));
  return { results: lists.flat().sort((a, b) => b.t - a.t), seasons };
});

function useAsync(fn, deps) {
  const [st, setSt] = useState({});
  useEffect(() => {
    let on = true;
    setSt({});
    Promise.resolve().then(fn).then((data) => on && setSt({ data }), (e) => on && setSt({ err: e.message }));
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}
export const useComp = (code) => useAsync(() => (code ? loadComp(code) : null), [code]);
export const useLeague = (code) => useAsync(() => (code ? loadResults(code) : null), [code]);   // { data: { results, seasons } }
export const useDoc = (loader, key) => useAsync(loader, [key]);
