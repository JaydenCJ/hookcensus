/**
 * Reads the allowlist configs a project may already have and computes
 * drift against a fresh census. Sources understood:
 *
 *   - pnpm-workspace.yaml: `onlyBuiltDependencies` (allow),
 *     `ignoredBuiltDependencies` / `neverBuiltDependencies` (deny) —
 *     pnpm 10's preferred location;
 *   - package.json `pnpm.*`: the same three keys, pre-workspace style;
 *   - package.json `lavamoat.allowScripts`: the @lavamoat/allow-scripts
 *     map npm projects use (`true` = allow, `false` = deny; keys may be
 *     paths like `app>keccak` — the last segment is the package name);
 *   - .npmrc `ignore-scripts`: the global switch (informational — it does
 *     not decide per-package).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeByName } from "./census.js";
import { parseYamlite, type YamlMap } from "./yamlite.js";
import type { Census, NameSummary } from "./types.js";

export interface AllowlistConfig {
  /** Basenames of config files that contributed, sorted. */
  files: string[];
  /** Names allowed to run install scripts. */
  allowed: Set<string>;
  /** Names explicitly denied (ignored/never-built, allowScripts: false). */
  denied: Set<string>;
  /** .npmrc ignore-scripts value, or null when unset. */
  ignoreScripts: boolean | null;
}

export interface DriftReport {
  /** True when at least one per-package allow/deny list exists. */
  hasConfig: boolean;
  /** Packages with hooks that no config decides. */
  uncovered: NameSummary[];
  /** Configured names that no longer have hooks in the tree. */
  stale: string[];
  /** Names decided by config and present in the census. */
  covered: string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

/** `app>keccak>secp256k1` → `secp256k1`; plain names pass through. */
export function allowScriptsName(key: string): string {
  const idx = key.lastIndexOf(">");
  return idx === -1 ? key : key.slice(idx + 1);
}

function readWorkspaceYaml(dir: string, config: AllowlistConfig): void {
  const path = join(dir, "pnpm-workspace.yaml");
  if (!existsSync(path)) return;
  let doc: unknown;
  try {
    doc = parseYamlite(readFileSync(path, "utf8"));
  } catch {
    return; // unreadable workspace file: treat as absent, census still works
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return;
  const map = doc as YamlMap;
  const allowed = stringList(map.onlyBuiltDependencies);
  const denied = [...stringList(map.ignoredBuiltDependencies), ...stringList(map.neverBuiltDependencies)];
  if (allowed.length > 0 || denied.length > 0) {
    config.files.push("pnpm-workspace.yaml");
    for (const name of allowed) config.allowed.add(name);
    for (const name of denied) config.denied.add(name);
  }
}

function readPackageJson(dir: string, config: AllowlistConfig): void {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }

  let contributed = false;
  const pnpm = manifest.pnpm;
  if (typeof pnpm === "object" && pnpm !== null && !Array.isArray(pnpm)) {
    const section = pnpm as Record<string, unknown>;
    const allowed = stringList(section.onlyBuiltDependencies);
    const denied = [
      ...stringList(section.ignoredBuiltDependencies),
      ...stringList(section.neverBuiltDependencies),
    ];
    for (const name of allowed) config.allowed.add(name);
    for (const name of denied) config.denied.add(name);
    if (allowed.length > 0 || denied.length > 0) contributed = true;
  }

  const lavamoat = manifest.lavamoat;
  if (typeof lavamoat === "object" && lavamoat !== null && !Array.isArray(lavamoat)) {
    const allowScripts = (lavamoat as Record<string, unknown>).allowScripts;
    if (typeof allowScripts === "object" && allowScripts !== null && !Array.isArray(allowScripts)) {
      for (const [key, value] of Object.entries(allowScripts as Record<string, unknown>)) {
        if (value === true) config.allowed.add(allowScriptsName(key));
        else if (value === false) config.denied.add(allowScriptsName(key));
        contributed = true;
      }
    }
  }

  if (contributed) config.files.push("package.json");
}

function readNpmrc(dir: string, config: AllowlistConfig): void {
  const path = join(dir, ".npmrc");
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#") || line.startsWith(";")) continue;
    const match = /^ignore-scripts\s*=\s*(\S+)/.exec(line);
    if (match !== null) {
      config.ignoreScripts = match[1] === "true";
      if (!config.files.includes(".npmrc")) config.files.push(".npmrc");
    }
  }
}

/** Read every allowlist source present in `dir`. */
export function readAllowlists(dir: string): AllowlistConfig {
  const config: AllowlistConfig = { files: [], allowed: new Set(), denied: new Set(), ignoreScripts: null };
  readWorkspaceYaml(dir, config);
  readPackageJson(dir, config);
  readNpmrc(dir, config);
  config.files.sort();
  return config;
}

/** Compare a census against existing config: what is undecided, what is stale. */
export function computeDrift(census: Census, config: AllowlistConfig): DriftReport {
  const summaries = summarizeByName(census);
  const censusNames = new Set(summaries.map((s) => s.name));
  const decided = new Set([...config.allowed, ...config.denied]);

  const uncovered = summaries.filter((s) => !decided.has(s.name));
  const stale = [...decided].filter((name) => !censusNames.has(name)).sort();
  const covered = [...decided].filter((name) => censusNames.has(name)).sort();
  const hasConfig = config.allowed.size > 0 || config.denied.size > 0 || config.files.length > 0;

  return { hasConfig, uncovered, stale, covered };
}
