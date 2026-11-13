// Football background photos from a free source (Unsplash License: free for commercial use, no attribution needed).
// Each id is a photo page id on unsplash.com. The page tries them in order and silently keeps the built-in
// ball pattern if none loads. Override with VITE_BG_URLS in .env (comma-separated image URLs).
const IDS = ["ZBZStqTOXFU", "3afOUO8gxgQ", "IwDTKKFmWAc", "0QeATQZs6bs", "6SDYxef3kYw"];
const fromEnv = (import.meta.env.VITE_BG_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const BG_URLS = fromEnv.length ? fromEnv : IDS.map((id) => `https://unsplash.com/photos/${id}/download?force=true&w=1600`);

// Rotate which photo is tried first, by day, so the app feels fresh without any storage.
export function orderedBackgrounds() {
  const k = Math.floor(Date.now() / 864e5) % BG_URLS.length;
  return [...BG_URLS.slice(k), ...BG_URLS.slice(0, k)];
}
