/**
 * node_modules walker. Understands both installer layouts:
 *
 *   - flat / hoisted (npm, yarn classic): `node_modules/<name>` with
 *     arbitrarily nested `node_modules` for conflicting versions;
 *   - pnpm: `node_modules/.pnpm/<id>/node_modules/<name>` plus symlinks
 *     from the root — realpath dedup collapses both views of a package
 *     into one census row.
 *
 * The walk is fully offline, read-only, and deterministic: directory
 * entries are sorted before visiting and symlink cycles are cut by
 * tracking visited real paths.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HOOK_NAMES, type HookName, type ScannedPackage } from "./types.js";

export interface ScanResult {
  packages: ScannedPackage[];
  /** Distinct packages with a readable package.json, hooks or not. */
  scanned: number;
  warnings: string[];
}

/** Pull the three install-time hooks out of a package.json `scripts` map. */
export function extractHooks(scripts: unknown): Partial<Record<HookName, string>> {
  const hooks: Partial<Record<HookName, string>> = {};
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return hooks;
  const map = scripts as Record<string, unknown>;
  for (const hook of HOOK_NAMES) {
    const value = map[hook];
    if (typeof value === "string" && value.trim() !== "") hooks[hook] = value;
  }
  return hooks;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory(); // follows symlinks — pnpm links packages
  } catch {
    return false;
  }
}

/** Scan every package under `nodeModulesDir` (absolute or cwd-relative). */
export function scanNodeModules(nodeModulesDir: string): ScanResult {
  const packages = new Map<string, ScannedPackage>(); // name@version → row
  const visited = new Set<string>(); // realpaths of package dirs
  const warnings: string[] = [];
  let scanned = 0;

  const root = nodeModulesDir;

  function visitPackage(dir: string): void {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return; // dangling symlink
    }
    if (visited.has(real)) return;
    visited.add(real);

    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) {
      // still descend: some layouts nest a node_modules inside a bare dir
      descend(join(dir, "node_modules"));
      return;
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      warnings.push(`unparseable package.json skipped: ${relative(root, manifestPath) || manifestPath}`);
      return;
    }

    const name = typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : null;
    if (name === null) return; // not a package (e.g. a fixtures dir)
    const version = typeof manifest.version === "string" && manifest.version !== "" ? manifest.version : "0.0.0";
    scanned++;

    const hooks = extractHooks(manifest.scripts);
    const hasBindingGyp = existsSync(join(dir, "binding.gyp"));
    const key = `${name}@${version}`;
    const existing = packages.get(key);
    if (existing !== undefined) {
      existing.occurrences++;
    } else {
      packages.set(key, {
        name,
        version,
        hooks,
        hasBindingGyp,
        path: relative(root, dir) || ".",
        occurrences: 1,
      });
    }

    descend(join(dir, "node_modules"));
  }

  function descend(nmDir: string): void {
    if (!isDirectory(nmDir)) return;
    let entries: string[];
    try {
      entries = readdirSync(nmDir).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".pnpm") {
        descendPnpmStore(join(nmDir, entry));
        continue;
      }
      if (entry.startsWith(".")) continue; // .bin, .cache, .modules.yaml, …
      const path = join(nmDir, entry);
      if (!isDirectory(path)) continue;
      if (entry.startsWith("@")) {
        let scoped: string[];
        try {
          scoped = readdirSync(path).sort();
        } catch {
          continue;
        }
        for (const sub of scoped) {
          const subPath = join(path, sub);
          if (isDirectory(subPath)) visitPackage(subPath);
        }
      } else {
        visitPackage(path);
      }
    }
  }

  function descendPnpmStore(storeDir: string): void {
    let ids: string[];
    try {
      ids = readdirSync(storeDir).sort();
    } catch {
      return;
    }
    for (const id of ids) {
      // `.pnpm/node_modules` holds hoisted symlinks; every other entry is
      // `<escaped-id>/node_modules/<name>`. Both are plain nm dirs to us.
      const nested = id === "node_modules" ? join(storeDir, id) : join(storeDir, id, "node_modules");
      descend(nested);
    }
  }

  descend(root);

  const sorted = [...packages.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );
  return { packages: sorted, scanned, warnings };
}
