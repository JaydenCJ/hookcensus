/**
 * package-lock.json reader (also covers npm-shrinkwrap.json — same format).
 *
 * npm lockfiles v2/v3 record `hasInstallScript: true` on every entry whose
 * published tarball declares preinstall/install/postinstall. That makes the
 * lockfile a script census that works *before* anything is installed — the
 * exact moment you want to decide an allowlist. The command text itself is
 * not in the lockfile, so entries found only here classify as
 * review/unknown until the tree is installed.
 */

import type { LockPackage } from "./types.js";

export interface NpmLockResult {
  lockfileVersion: number;
  /** Only entries flagged `hasInstallScript: true`, sorted by name@version. */
  packages: LockPackage[];
  warnings: string[];
}

/** `node_modules/@scope/name` (possibly nested) → `@scope/name`. */
export function nameFromLockPath(path: string): string | null {
  const marker = "node_modules/";
  const idx = path.lastIndexOf(marker);
  if (idx === -1) return null; // workspace link like "packages/app" — the root's own code
  const name = path.slice(idx + marker.length);
  return name === "" ? null : name;
}

/** Parse the raw text of a package-lock.json / npm-shrinkwrap.json. */
export function parseNpmLock(text: string): NpmLockResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`package-lock.json is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("package-lock.json is not a JSON object");
  }
  const lock = doc as Record<string, unknown>;
  const lockfileVersion = typeof lock.lockfileVersion === "number" ? lock.lockfileVersion : 0;
  const warnings: string[] = [];

  if (lockfileVersion < 2) {
    return {
      lockfileVersion,
      packages: [],
      warnings: [
        `package-lock.json lockfileVersion ${lockfileVersion} predates hasInstallScript flags; ` +
          "run `npm install --lockfile-version 3` to upgrade it",
      ],
    };
  }

  const packages = lock.packages;
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
    return { lockfileVersion, packages: [], warnings: ["package-lock.json has no `packages` map"] };
  }

  const found: LockPackage[] = [];
  for (const [path, rawEntry] of Object.entries(packages as Record<string, unknown>)) {
    if (path === "") continue; // the root project itself
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const entry = rawEntry as Record<string, unknown>;
    if (entry.hasInstallScript !== true) continue;
    const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : nameFromLockPath(path);
    if (name === null) continue;
    const version = typeof entry.version === "string" && entry.version !== "" ? entry.version : "0.0.0";
    found.push({ name, version, source: "package-lock" });
  }

  const seen = new Set<string>();
  const unique = found.filter((p) => {
    const key = `${p.name}@${p.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { lockfileVersion, packages: unique, warnings };
}
