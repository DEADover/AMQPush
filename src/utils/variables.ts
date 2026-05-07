export interface UserVariable {
  id: number;
  enabled: boolean;
  key: string;
  value: string;
  description: string;
}

/**
 * Replaces {{variable}} tokens in a string before sending.
 *
 * Built-in tokens:
 *   {{uuid}}, {{timestamp}}, {{timestamp_ms}}, {{timestamp_s}},
 *   {{random_int}}, {{random_int(min,max)}}, {{random_float}}
 *
 * User-defined tokens take precedence over built-ins when names collide.
 */
export function applyVariables(text: string, userVars: UserVariable[] = []): string {
  // 1. User-defined variables first (so they can override built-ins)
  let result = text;
  for (const v of userVars) {
    if (!v.enabled || !v.key.trim()) continue;
    const safe = v.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\{\\{\\s*${safe}\\s*\\}\\}`, "g"), v.value);
  }
  // 2. Built-in tokens
  return result
    .replace(/\{\{uuid\}\}/g, () => crypto.randomUUID())
    .replace(/\{\{timestamp\}\}/g, () => new Date().toISOString())
    .replace(/\{\{timestamp_ms\}\}/g, () => Date.now().toString())
    .replace(/\{\{timestamp_s\}\}/g, () => Math.floor(Date.now() / 1000).toString())
    .replace(/\{\{random_int\((\d+),\s*(\d+)\)\}\}/g, (_, min, max) => {
      const lo = parseInt(min, 10);
      const hi = parseInt(max, 10);
      return Math.floor(Math.random() * (hi - lo + 1) + lo).toString();
    })
    .replace(/\{\{random_int\}\}/g, () => Math.floor(Math.random() * 1_000_000).toString())
    .replace(/\{\{random_float\}\}/g, () => Math.random().toFixed(6));
}

export const VARIABLE_HINTS: { token: string; description: string }[] = [
  { token: "{{uuid}}",              description: "Random UUID v4" },
  { token: "{{timestamp}}",         description: "ISO-8601 UTC datetime" },
  { token: "{{timestamp_ms}}",      description: "Unix ms epoch" },
  { token: "{{timestamp_s}}",       description: "Unix s epoch" },
  { token: "{{random_int}}",        description: "Random 0–999999" },
  { token: "{{random_int(1,100)}}", description: "Random in range" },
  { token: "{{random_float}}",      description: "Random 0.0–1.0" },
];
