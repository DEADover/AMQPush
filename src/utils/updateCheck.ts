/**
 * Lightweight "is there a newer version?" check against GitHub Releases.
 * No code-signing, no auto-installer — we just notify the user when a newer
 * tagged release exists and let them open the GitHub page to download.
 *
 * This keeps the implementation simple (no `tauri-plugin-updater`, no signing
 * keys to manage) at the cost of needing one manual action per release.
 */

import { getVersion } from "@tauri-apps/api/app";

const REPO_API = "https://api.github.com/repos/DEADover/AMQPush/releases/latest";
const DISMISSED_KEY = "amqpush.dismissedUpdateVersion";

export interface UpdateInfo {
  /** Currently-running app version (no `v` prefix), e.g. "1.1.0". */
  current: string;
  /** Tag of the latest GitHub release with `v` stripped, e.g. "1.2.0". */
  latest: string;
  /** Markdown release notes from GitHub. */
  body: string;
  /** Browser URL of the release page. */
  url: string;
}

/**
 * Compare two semver-ish version strings ("1.2.3" or "v1.2.3"). Returns true
 * iff `a` is strictly newer than `b` per simple component-wise comparison.
 * Handles missing minor/patch (treats as 0).
 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(s => parseInt(s, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const xa = pa[i] ?? 0;
    const xb = pb[i] ?? 0;
    if (xa > xb) return true;
    if (xa < xb) return false;
  }
  return false;
}

/**
 * Fetch the latest GitHub Release for the project. Returns an `UpdateInfo`
 * only when:
 *   - the GitHub call succeeds (network / rate-limit failures fall through silently)
 *   - the latest tag is strictly newer than the running version
 *   - the user hasn't already dismissed THIS specific version
 *
 * Returns `null` otherwise — caller treats that as "nothing to show".
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const current = await getVersion();
    const dismissed = localStorage.getItem(DISMISSED_KEY);

    const res = await fetch(REPO_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latestTag: string = data.tag_name ?? "";
    const latest = latestTag.replace(/^v/, "");

    if (!latest || !isNewerVersion(latest, current)) return null;
    if (dismissed === latest) return null; // user said "don't show this again"

    return {
      current,
      latest,
      body: typeof data.body === "string" ? data.body : "",
      url:  typeof data.html_url === "string" ? data.html_url : "",
    };
  } catch {
    return null;
  }
}

/** Persist that the user has acknowledged the given version. */
export function dismissUpdate(version: string) {
  try { localStorage.setItem(DISMISSED_KEY, version); } catch {}
}
