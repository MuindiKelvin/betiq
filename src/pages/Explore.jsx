import { Button, ButtonGroup } from "react-bootstrap";

// One entry point for browsing and analyzing: pick a competition to explore it, or jump straight to a match analysis.
// The two views keep their own pages; this only adds the heading and the switch. The switch is hidden inside a competition's pages (they have their own header and back button).
const MODES = [["browse", "Competitions", "globe2"], ["analyze", "Analyze a match", "lightning-charge-fill"]];

export default function Explore({ mode, onMode, showSwitch, children }) {
  return (
    <div className="d-flex flex-column gap-3">
      {showSwitch && (
        <div className="d-flex align-items-center flex-wrap gap-2">
          <h1 className="h3 mb-0 me-auto">Explore</h1>
          <ButtonGroup aria-label="Explore mode">
            {MODES.map(([k, l, i]) => <Button key={k} variant={mode === k ? "primary" : "outline-secondary"} aria-pressed={mode === k} onClick={() => onMode(k)}><i className={`bi bi-${i} me-1`} />{l}</Button>)}
          </ButtonGroup>
        </div>)}
      {children}
    </div>
  );
}
