import { useEffect, useState } from "react";
import { orderedBackgrounds } from "../lib/backgrounds";

// Fixed full-screen layers: gradient + (optional) football photo + dark shade + ball pattern.
// The photo is loaded in the background; if no source answers, the pattern and gradient stay.
export default function Backdrop({ strong = false }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let dead = false;
    const probe = (u) => new Promise((res) => {
      const im = new Image(), timer = setTimeout(() => res(false), 7000);
      im.referrerPolicy = "no-referrer";
      im.onload = () => { clearTimeout(timer); res(true); }; im.onerror = () => { clearTimeout(timer); res(false); };
      im.src = u;
    });
    (async () => { for (const u of orderedBackgrounds().slice(0, 3)) { if (dead) return; if (await probe(u)) { if (!dead) setSrc(u); return; } } })();
    return () => { dead = true; };
  }, []);
  return (
    <div className="backdrop" aria-hidden="true">
      <div className={"backdrop-photo" + (src ? " on" : "")} style={src ? { backgroundImage: `url("${src}")` } : undefined} />
      <div className={"backdrop-shade" + (strong ? " strong" : "")} />
      <div className="backdrop-balls" />
    </div>
  );
}
