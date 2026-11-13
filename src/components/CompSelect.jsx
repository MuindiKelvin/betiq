import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "react-bootstrap";
import { LeagueLogo, SearchBox, hit } from "./ui";

// Searchable competition picker, grouped by country. entries: catalog entries that have been synced.
export default function CompSelect({ entries, value, onChange, label = "Competition" }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), box = useRef(null);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const cur = entries.find((e) => e.code === value);
  const groups = useMemo(() => {
    const g = new Map();
    for (const e of entries.filter((x) => !q.trim() || hit(q, `${x.name} ${x.country}`))) (g.get(e.country || "Other") ?? g.set(e.country || "Other", []).get(e.country || "Other")).push(e);
    return [...g].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries, q]);
  return (
    <div className="comp-select position-relative" ref={box}>
      <div className="tiny text-uppercase text-body-secondary mb-1 ls">{label}</div>
      <button type="button" className="form-select text-start d-flex align-items-center gap-2" aria-label={label} onClick={() => { setOpen(!open); setQ(""); }}>
        {cur ? <><LeagueLogo lg={cur} size={22} /><span className="text-truncate">{cur.name}</span><span className="tiny text-body-secondary ms-1">{cur.country}</span></> : <span className="text-body-secondary">Choose a competition</span>}
      </button>
      {open && (
        <div className="team-menu card shadow-lg" style={{ minWidth: 300 }}>
          <div className="p-2"><SearchBox value={q} onChange={setQ} placeholder={`Search ${entries.length} competitions…`} /></div>
          <div className="team-menu-list" style={{ maxHeight: 340 }}>
            {groups.map(([country, list]) => (
              <div key={country}>
                <div className="px-3 pt-2 pb-1 tiny text-uppercase text-body-secondary ls">{country}</div>
                {list.map((e) => (
                  <button type="button" key={e.code} className={"dropdown-item d-flex align-items-center gap-2 py-2" + (e.code === value ? " active-item" : "")} onClick={() => { onChange(e.code); setOpen(false); }}>
                    <LeagueLogo lg={e} size={22} /><span className="flex-fill text-truncate">{e.name}</span>{e.kind === "comp" && <Badge bg="dark" className="border">cup</Badge>}
                  </button>))}
              </div>))}
            {!groups.length && <div className="px-3 py-2 text-body-secondary small">No competition found</div>}
          </div>
        </div>)}
    </div>
  );
}
