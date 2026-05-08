/**
 * Display-formatting helpers shared by all views — sizes, durations, CSV
 * escaping. Putting them in one place avoids per-view drift in number rounding
 * and unit thresholds.
 */

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${s}s`;
}

/** Quote a CSV field — doubles internal quotes, strips line breaks. */
export function csvEscape(s: string): string {
  return `"${s.replace(/"/g, '""').replace(/\n/g, " ").replace(/\r/g, "")}"`;
}
