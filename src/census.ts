/**
 * Census orchestration: scan node_modules, read whatever lockfiles exist,
 * merge the sightings, classify every package that can run code at install
 * time, and report the root project's own hooks separately (pnpm never
 * gates those; npm's `ignore-scripts=true` blocks them too — worth knowing
 * before you commit that .npmrc).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyPackage } from "./classify.js";
import { parseNpmLock } from "./npmlock.js";
import { parsePnpmLock } from "./pnpmlock.js";
import { extractHooks, scanNodeModules } from "./scan.js";
import type { Census, CensusEntry, LockPackage, NameSummary, RootHooks, Verdict } from "./types.js";
import { UsageError } from "./types.js";

/** Shown as the hook command when binding.gyp implies a build. */
export const IMPLICIT_GYP_COMMAND = "node-gyp rebuild (implicit: binding.gyp, no install script)";

function readRootHooks(dir: string, warnings: string[]): RootHooks | null {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const name = typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : "(unnamed project)";
    return { name, hooks: extractHooks(manifest.scripts) };
  } catch {
    warnings.push("root package.json is unreadable or invalid JSON");
    return null;
  }
}

function readLocks(dir: string, lockfiles: string[], warnings: string[]): LockPackage[] {
  const out: LockPackage[] = [];
  for (const file of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      const result = parseNpmLock(readFileSync(path, "utf8"));
      lockfiles.push(file);
      warnings.push(...result.warnings);
      out.push(...result.packages);
    } catch (err) {
      warnings.push(`${file}: ${(err as Error).message}`);
    }
  }
  const pnpmPath = join(dir, "pnpm-lock.yaml");
  if (existsSync(pnpmPath)) {
    try {
      const result = parsePnpmLock(readFileSync(pnpmPath, "utf8"));
      lockfiles.push("pnpm-lock.yaml");
      warnings.push(...result.warnings);
      out.push(...result.packages);
    } catch (err) {
      warnings.push(`pnpm-lock.yaml: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Take the full census of a project directory. */
export function takeCensus(dir: string): Census {
  if (!existsSync(dir)) throw new UsageError(`no such directory: ${dir}`);
  const hasManifest = existsSync(join(dir, "package.json"));
  const nodeModules = join(dir, "node_modules");
  const hasNodeModules = existsSync(nodeModules);
  if (!hasManifest && !hasNodeModules) {
    throw new UsageError(`${dir} has neither a package.json nor a node_modules directory`);
  }

  const warnings: string[] = [];
  const lockfiles: string[] = [];
  const root = readRootHooks(dir, warnings);

  const entries = new Map<string, CensusEntry>(); // name@version → entry
  let scanned = 0;

  if (hasNodeModules) {
    const result = scanNodeModules(nodeModules);
    scanned = result.scanned;
    warnings.push(...result.warnings);
    for (const pkg of result.packages) {
      const hasExplicitHooks = Object.keys(pkg.hooks).length > 0;
      if (!hasExplicitHooks && !pkg.hasBindingGyp) continue;
      const hooks = { ...pkg.hooks };
      if (!hasExplicitHooks && pkg.hasBindingGyp) hooks.install = IMPLICIT_GYP_COMMAND;
      entries.set(`${pkg.name}@${pkg.version}`, {
        name: pkg.name,
        version: pkg.version,
        hooks,
        hasBindingGyp: pkg.hasBindingGyp,
        installed: true,
        sources: ["node_modules"],
        classification: classifyPackage(pkg.name, pkg.hooks, pkg.hasBindingGyp),
      });
    }
  }

  for (const lockPkg of readLocks(dir, lockfiles, warnings)) {
    const key = `${lockPkg.name}@${lockPkg.version}`;
    const existing = entries.get(key);
    if (existing !== undefined) {
      if (!existing.sources.includes(lockPkg.source)) existing.sources.push(lockPkg.source);
      continue;
    }
    entries.set(key, {
      name: lockPkg.name,
      version: lockPkg.version,
      hooks: {},
      hasBindingGyp: false,
      installed: false,
      sources: [lockPkg.source],
      classification: classifyPackage(lockPkg.name, {}, false),
    });
  }

  const sorted = [...entries.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );
  lockfiles.sort();
  return { dir, scanned, entries: sorted, root, lockfiles, warnings };
}

/**
 * Collapse the census to one row per package name — allowlists are keyed by
 * name, not name@version. Identical verdicts across versions are kept;
 * disagreement (rare: a package changed its script between versions)
 * degrades to "review" so a human resolves it.
 */
export function summarizeByName(census: Census): NameSummary[] {
  const byName = new Map<string, { verdicts: Set<Verdict>; versions: string[] }>();
  for (const entry of census.entries) {
    const bucket = byName.get(entry.name) ?? { verdicts: new Set<Verdict>(), versions: [] };
    bucket.verdicts.add(entry.classification.verdict);
    bucket.versions.push(entry.version);
    byName.set(entry.name, bucket);
  }
  const out: NameSummary[] = [];
  for (const [name, bucket] of byName) {
    const verdict: Verdict = bucket.verdicts.size === 1 ? [...bucket.verdicts][0]! : "review";
    out.push({ name, verdict, versions: bucket.versions.sort() });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
