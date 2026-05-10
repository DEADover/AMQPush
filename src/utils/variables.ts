export interface UserVariable {
  id: number;
  enabled: boolean;
  key: string;
  value: string;
  description: string;
}

/**
 * Result of running a Pre-script. `vars` is the dict of names→values the
 * script set via `ctx.set(name, value)`; `logs` is whatever it sent to
 * `ctx.log(...args)` (we surface those in the Logs view); `error` is set
 * when the script threw — the calling code decides whether to abort the
 * send or continue with whatever vars were collected before the throw.
 */
export interface PreScriptResult {
  vars: Record<string, string>;
  logs: string[];
  error?: string;
}

/**
 * Run a Pre-script in a sandboxed Function. The script body has access to:
 *
 *   - `ctx.set(name, value)` — register a variable for `{{name}}` substitution
 *   - `ctx.get(name)`        — read previously-set / user-defined value
 *   - `ctx.log(...args)`     — push a string to the AMQPush log
 *   - `ctx.now`              — Date.now() snapshot at start of run
 *   - `ctx.uuid()`           — crypto.randomUUID()
 *   - Built-ins: Date, Math, JSON, crypto
 *
 * The script does NOT have access to: `window`, `document`, `fetch`,
 * Tauri APIs, `eval`, dynamic imports, the rest of the React tree, or
 * anything else not explicitly passed in. (`Function` constructed code
 * still runs in the global JS context, so a determined user CAN reach
 * `globalThis` — this is a usability sandbox, not a security boundary.
 * Don't import templates from untrusted sources.)
 */
export function runPreScript(
  script: string,
  existingVars: UserVariable[]
): PreScriptResult {
  const vars: Record<string, string> = {};
  const logs: string[] = [];

  if (!script.trim()) return { vars, logs };

  const ctx = {
    set(name: string, value: unknown) {
      if (typeof name !== "string" || !name.trim()) return;
      vars[name] = value === null || value === undefined ? "" : String(value);
    },
    get(name: string): string | undefined {
      if (name in vars) return vars[name];
      const u = existingVars.find(v => v.enabled && v.key === name);
      return u?.value;
    },
    log(...args: unknown[]) {
      logs.push(args.map(a => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(" "));
    },
    now: Date.now(),
    uuid() { return crypto.randomUUID(); },
  };

  try {
    // `new Function` keeps the script in its own scope; we only expose what
    // we hand in via parameters. `"use strict"` to keep behaviour predictable.
    const fn = new Function("ctx", "Date", "Math", "JSON", "crypto",
      `"use strict";\n${script}`);
    fn(ctx, Date, Math, JSON, crypto);
    return { vars, logs };
  } catch (e) {
    return { vars, logs, error: (e as Error).message };
  }
}

/** Persistent counter — increments on every `{{counter}}` substitution. Resets
 *  on app restart. Useful when running batch sends to give each message a
 *  monotonic sequence number. */
let counterValue = 0;

/** Build N random characters from the given charset. */
function randomString(n: number, charset: "alnum" | "alpha" | "hex"): string {
  const chars =
    charset === "hex"   ? "0123456789abcdef" :
    charset === "alpha" ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" :
                          "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Replaces `{{variable}}` tokens in a string before sending. User-defined
 * tokens are applied first so they can override built-ins; the built-ins
 * cover identifiers, randomness, dates / times and a process-local counter.
 *
 * Token reference (also surfaced in the Variables tab "Built-in presets"):
 *
 *   Identifiers      uuid, counter
 *   Randomness       random_int, random_int(min,max), random_float, random_bool,
 *                    random_string, random_string(N), random_hex, random_hex(N),
 *                    random_alpha(N), random_choice(a|b|c), random_email
 *   Dates / times    timestamp, timestamp_ms, timestamp_s,
 *                    date, date_local, time, time_local,
 *                    year, month, day, hour, minute, second
 *
 * The counter is shared per-render — a single `applyVariables(...)` call that
 * contains `{{counter}}` twice gets two consecutive values, not the same one.
 */
export function applyVariables(text: string, userVars: UserVariable[] = []): string {
  // 1. User-defined variables first (can override built-ins by name).
  let result = text;
  for (const v of userVars) {
    if (!v.enabled || !v.key.trim()) continue;
    const safe = v.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{\\{\\s*${safe}\\s*\\}\\}`, "g"), v.value);
  }

  // 2. Built-in tokens. Snapshot `now` once per call so all date/time tokens
  //    that fire in the same render see the same instant.
  const now = new Date();

  return result
    // ── Identifiers ──────────────────────────────────────────────────────
    .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())
    .replace(/\{\{counter\}\}/g, () => (++counterValue).toString())

    // ── Random numbers ───────────────────────────────────────────────────
    .replace(/\{\{random_int\((\d+),\s*(\d+)\)\}\}/g, (_, min, max) => {
      const lo = parseInt(min, 10);
      const hi = parseInt(max, 10);
      return Math.floor(Math.random() * (hi - lo + 1) + lo).toString();
    })
    .replace(/\{\{random_int\}\}/g, () => Math.floor(Math.random() * 1_000_000).toString())
    .replace(/\{\{random_float\}\}/g, () => Math.random().toFixed(6))
    .replace(/\{\{random_bool\}\}/g, () => Math.random() < 0.5 ? "true" : "false")

    // ── Random strings ───────────────────────────────────────────────────
    .replace(/\{\{random_string\((\d+)\)\}\}/g, (_, n) => randomString(parseInt(n, 10), "alnum"))
    .replace(/\{\{random_string\}\}/g, () => randomString(10, "alnum"))
    .replace(/\{\{random_hex\((\d+)\)\}\}/g, (_, n) => randomString(parseInt(n, 10), "hex"))
    .replace(/\{\{random_hex\}\}/g, () => randomString(16, "hex"))
    .replace(/\{\{random_alpha\((\d+)\)\}\}/g, (_, n) => randomString(parseInt(n, 10), "alpha"))

    // random_choice(a|b|c) — pick one of the pipe-separated alternatives.
    // Whitespace around each choice is trimmed so `{{random_choice(red | green | blue)}}`
    // does the natural thing.
    .replace(/\{\{random_choice\(([^)]+)\)\}\}/g, (_, opts: string) => {
      const choices = opts.split("|").map(s => s.trim()).filter(Boolean);
      return choices.length === 0 ? "" : choices[Math.floor(Math.random() * choices.length)];
    })

    // Synthetic email — useful when a downstream consumer expects a unique
    // user identifier per request and you don't want to hand-roll one.
    .replace(/\{\{random_email\}\}/g, () => `${randomString(8, "alnum").toLowerCase()}@example.com`)

    // ── Dates / times ────────────────────────────────────────────────────
    .replace(/\{\{timestamp\}\}/g,    () => now.toISOString())
    .replace(/\{\{timestamp_ms\}\}/g, () => now.getTime().toString())
    .replace(/\{\{timestamp_s\}\}/g,  () => Math.floor(now.getTime() / 1000).toString())
    .replace(/\{\{date\}\}/g,         () => now.toISOString().slice(0, 10))
    .replace(/\{\{date_local\}\}/g,   () => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    .replace(/\{\{time\}\}/g,         () => now.toISOString().slice(11, 19))
    .replace(/\{\{time_local\}\}/g,   () => `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`)
    .replace(/\{\{year\}\}/g,         () => String(now.getFullYear()))
    .replace(/\{\{month\}\}/g,        () => pad(now.getMonth() + 1))
    .replace(/\{\{day\}\}/g,          () => pad(now.getDate()))
    .replace(/\{\{hour\}\}/g,         () => pad(now.getHours()))
    .replace(/\{\{minute\}\}/g,       () => pad(now.getMinutes()))
    .replace(/\{\{second\}\}/g,       () => pad(now.getSeconds()));
}

/**
 * Catalogue used by the Variables tab "Built-in presets" dropdown. Order
 * matches the substitution order in `applyVariables` so users see related
 * tokens grouped together.
 */
export const VARIABLE_HINTS: { token: string; description: string }[] = [
  // Identifiers
  { token: "{{uuid}}",                 description: "Random UUID v4" },
  { token: "{{counter}}",              description: "Auto-incrementing sequence (resets on restart)" },

  // Randomness
  { token: "{{random_int}}",           description: "Random integer 0–999999" },
  { token: "{{random_int(1,100)}}",    description: "Random integer in range [min,max]" },
  { token: "{{random_float}}",         description: "Random float 0.0–1.0" },
  { token: "{{random_bool}}",          description: "Random true / false" },
  { token: "{{random_string}}",        description: "10 random alphanumeric chars" },
  { token: "{{random_string(N)}}",     description: "N random alphanumeric chars" },
  { token: "{{random_hex}}",           description: "16 random hex chars" },
  { token: "{{random_hex(N)}}",        description: "N random hex chars" },
  { token: "{{random_alpha(N)}}",      description: "N random letters (no digits)" },
  { token: "{{random_choice(a|b|c)}}", description: "Pick one of the alternatives" },
  { token: "{{random_email}}",         description: "Synthetic user@example.com address" },

  // Dates / times
  { token: "{{timestamp}}",            description: "ISO-8601 UTC datetime" },
  { token: "{{timestamp_ms}}",         description: "Unix epoch (milliseconds)" },
  { token: "{{timestamp_s}}",          description: "Unix epoch (seconds)" },
  { token: "{{date}}",                 description: "YYYY-MM-DD (UTC)" },
  { token: "{{date_local}}",           description: "YYYY-MM-DD (local timezone)" },
  { token: "{{time}}",                 description: "HH:MM:SS (UTC)" },
  { token: "{{time_local}}",           description: "HH:MM:SS (local timezone)" },
  { token: "{{year}}",                 description: "Current year (4-digit)" },
  { token: "{{month}}",                description: "Current month (01–12)" },
  { token: "{{day}}",                  description: "Current day of month (01–31)" },
  { token: "{{hour}}",                 description: "Current hour (00–23, local)" },
  { token: "{{minute}}",               description: "Current minute (00–59, local)" },
  { token: "{{second}}",               description: "Current second (00–59, local)" },
];
