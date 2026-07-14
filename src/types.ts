/**
 * Core types shared across hookcensus.
 *
 * A "hook" here is one of the three npm/pnpm lifecycle scripts that run at
 * dependency install time — the ones `ignore-scripts` and pnpm's
 * `onlyBuiltDependencies` gate. `prepare`/`prepack` never run for registry
 * dependencies, so they are deliberately out of scope for the census.
 */

/** The install-time lifecycle hooks gated by allowlists. */
export type HookName = "preinstall" | "install" | "postinstall";

/** Execution order at install time. */
export const HOOK_NAMES: readonly HookName[] = ["preinstall", "install", "postinstall"];

/** What kind of work a lifecycle script appears to do. */
export type Category =
  | "native-build" // compiles or fetches a native addon (node-gyp, prebuild-install, …)
  | "binary-fetch" // downloads a platform binary or engine the package needs
  | "dev-hooks" // installs git hooks (husky, simple-git-hooks) — dev-repo only
  | "funding" // prints a funding/donation banner, nothing functional
  | "patch" // applies patches (patch-package) — workspace-root concern
  | "trivial" // echo / exit 0 / a bare console.log
  | "script-run" // runs a bundled script file that needs human inspection
  | "unknown"; // nothing recognizable — includes lockfile-only sightings

/** What hookcensus recommends doing with the package's scripts. */
export type Verdict = "allow" | "deny" | "review";

/** Where a classification came from, most specific first. */
export type ClassificationBasis = "known-package" | "pattern" | "binding-gyp" | "fallback";

export interface Classification {
  category: Category;
  verdict: Verdict;
  /** One human sentence explaining the verdict. Stable per rule. */
  reason: string;
  basis: ClassificationBasis;
}

/** A package found on disk under some node_modules directory. */
export interface ScannedPackage {
  name: string;
  version: string;
  hooks: Partial<Record<HookName, string>>;
  /** binding.gyp present — npm/pnpm synthesize `node-gyp rebuild` when no install script exists. */
  hasBindingGyp: boolean;
  /** Path of the first occurrence, relative to the scan root. */
  path: string;
  /** Distinct on-disk copies (nested duplicates, pnpm hardlinks resolve to one). */
  occurrences: number;
}

/** A package a lockfile flags as having install scripts. */
export interface LockPackage {
  name: string;
  version: string;
  source: "package-lock" | "pnpm-lock";
}

/** One row of the census: a package that can run code at install time. */
export interface CensusEntry {
  name: string;
  version: string;
  hooks: Partial<Record<HookName, string>>;
  hasBindingGyp: boolean;
  /** False when only a lockfile mentions it (not present under node_modules). */
  installed: boolean;
  /** Where the sighting came from: "node_modules", "package-lock", "pnpm-lock". */
  sources: string[];
  classification: Classification;
}

/** The root project's own hooks — reported, never gated by pnpm's allowlist. */
export interface RootHooks {
  name: string;
  hooks: Partial<Record<HookName, string>>;
}

/** Full result of `takeCensus`. */
export interface Census {
  /** Directory the census ran against, as given by the caller. */
  dir: string;
  /** Distinct packages seen under node_modules (with or without hooks). */
  scanned: number;
  /** Sorted by name, then version. */
  entries: CensusEntry[];
  root: RootHooks | null;
  /** Basenames of lockfiles that were read, sorted. */
  lockfiles: string[];
  /** Non-fatal problems (unparseable package.json, unsupported lockfile, …). */
  warnings: string[];
}

/** Aggregated per-name view used by emit and drift checks (allowlists are name-keyed). */
export interface NameSummary {
  name: string;
  /** Resolved across versions: identical verdicts keep it; mixed verdicts become "review". */
  verdict: Verdict;
  versions: string[];
}

/** Error for bad CLI usage / unreadable inputs — maps to exit code 2. */
export class UsageError extends Error {}
