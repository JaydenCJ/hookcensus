/**
 * pnpm-lock.yaml reader.
 *
 * Lockfile v5/v6 (pnpm 7/8) records `requiresBuild: true` on packages with
 * install scripts, so — like npm's `hasInstallScript` — the lockfile alone
 * can seed the census. Lockfile v9 (pnpm 9/10) moved that flag out of the
 * lockfile; for those trees the node_modules scan is the source of truth
 * and this reader contributes nothing (by design, not by accident — a
 * warning says so).
 *
 * Package keys across versions:
 *   v5:  /name/1.2.3          /@scope/name/1.2.3_peer@4.5.6
 *   v6:  /name@1.2.3          /@scope/name@1.2.3(peer@4.5.6)
 *   v9:  name@1.2.3           '@scope/name@1.2.3'
 */

import { parseYamlite, type YamlMap } from "./yamlite.js";
import type { LockPackage } from "./types.js";

export interface PnpmLockResult {
  lockfileVersion: string;
  /** Only entries flagged `requiresBuild: true`, sorted by name@version. */
  packages: LockPackage[];
  warnings: string[];
}

/** Parse a pnpm lockfile package key into name + version. */
export function parsePnpmKey(key: string): { name: string; version: string } | null {
  let k = key.trim();
  if (k === "") return null;
  const slashForm = k.startsWith("/");
  if (slashForm) k = k.slice(1);
  // strip peer-dependency suffixes: `(react@18.2.0)` (v6+) or `_react@18.2.0` (v5)
  const paren = k.indexOf("(");
  if (paren !== -1) k = k.slice(0, paren);
  const underscore = k.indexOf("_", k.lastIndexOf("/") + 1);
  if (underscore !== -1 && slashForm) k = k.slice(0, underscore);

  // v5 slash-separated: name/1.2.3 or @scope/name/1.2.3
  const lastSlash = k.lastIndexOf("/");
  if (slashForm && lastSlash > 0 && !k.includes("@", k.startsWith("@") ? 1 : 0)) {
    const name = k.slice(0, lastSlash);
    const version = k.slice(lastSlash + 1);
    return name === "" || version === "" ? null : { name, version };
  }

  // @-separated: name@1.2.3 or @scope/name@1.2.3
  const at = k.lastIndexOf("@");
  if (at <= 0) {
    // no version separator; tolerate v5 keys whose version segment held an underscore
    if (slashForm && lastSlash > 0) {
      const name = k.slice(0, lastSlash);
      const version = k.slice(lastSlash + 1);
      return name === "" || version === "" ? null : { name, version };
    }
    return null;
  }
  const name = k.slice(0, at);
  const version = k.slice(at + 1);
  return name === "" || version === "" ? null : { name, version };
}

/** Parse the raw text of a pnpm-lock.yaml. */
export function parsePnpmLock(text: string): PnpmLockResult {
  const doc = parseYamlite(text);
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("pnpm-lock.yaml is not a mapping at the top level");
  }
  const lock = doc as YamlMap;
  const lockfileVersion = typeof lock.lockfileVersion === "string" ? lock.lockfileVersion : "0";
  const warnings: string[] = [];

  const packages = lock.packages;
  const found: LockPackage[] = [];
  let sawRequiresBuild = false;

  if (typeof packages === "object" && packages !== null && !Array.isArray(packages)) {
    for (const [key, rawEntry] of Object.entries(packages)) {
      if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) continue;
      const entry = rawEntry as YamlMap;
      if (entry.requiresBuild !== true) continue;
      sawRequiresBuild = true;
      const parsed = parsePnpmKey(key);
      if (parsed === null) continue;
      found.push({ name: parsed.name, version: parsed.version, source: "pnpm-lock" });
    }
  }

  const major = parseInt(lockfileVersion, 10);
  if (!sawRequiresBuild && major >= 9) {
    warnings.push(
      `pnpm-lock.yaml v${lockfileVersion} no longer records requiresBuild; ` +
        "the installed node_modules scan is the source of truth for this tree"
    );
  }

  found.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { lockfileVersion, packages: found, warnings };
}
