/**
 * Config generators — the "ready to commit" half of hookcensus.
 *
 * Four targets:
 *   - `pnpm`            package.json `pnpm.onlyBuiltDependencies` (+ ignored)
 *   - `pnpm-workspace`  the same two lists in pnpm-workspace.yaml (pnpm 10 style)
 *   - `allow-scripts`   package.json `lavamoat.allowScripts` for @lavamoat/allow-scripts
 *   - `npmrc`           `ignore-scripts=true` for plain npm
 *
 * Policy: `allow` verdicts go on the allowlist; `deny` verdicts go on the
 * ignore/deny list (which also silences pnpm's "ignored build scripts"
 * warning); `review` verdicts are EXCLUDED unless --include-review is
 * passed — an allowlist should never contain a package nobody looked at.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeByName } from "./census.js";
import type { Census } from "./types.js";
import { UsageError } from "./types.js";

export const EMIT_TARGETS = ["pnpm", "pnpm-workspace", "allow-scripts", "npmrc"] as const;
export type EmitTarget = (typeof EMIT_TARGETS)[number];

export interface EmitOptions {
  /** Treat review verdicts as allow (you have reviewed them yourself). */
  includeReview?: boolean;
}

export interface EmitPlan {
  allowed: string[];
  denied: string[];
  /** Review-verdict names left out of the config (empty with includeReview). */
  excluded: string[];
}

/** Split the census into allow / deny / excluded name lists. */
export function planEmit(census: Census, options: EmitOptions = {}): EmitPlan {
  const allowed: string[] = [];
  const denied: string[] = [];
  const excluded: string[] = [];
  for (const summary of summarizeByName(census)) {
    if (summary.verdict === "allow") allowed.push(summary.name);
    else if (summary.verdict === "deny") denied.push(summary.name);
    else if (options.includeReview === true) allowed.push(summary.name);
    else excluded.push(summary.name);
  }
  return { allowed: allowed.sort(), denied: denied.sort(), excluded: excluded.sort() };
}

function yamlList(key: string, names: string[]): string {
  return [`${key}:`, ...names.map((n) => `  - ${n}`)].join("\n");
}

/** Render the config text for a target (what --write would put on disk). */
export function renderEmit(census: Census, target: EmitTarget, options: EmitOptions = {}): string {
  const plan = planEmit(census, options);
  switch (target) {
    case "pnpm": {
      const pnpm: Record<string, string[]> = {};
      if (plan.allowed.length > 0) pnpm.onlyBuiltDependencies = plan.allowed;
      if (plan.denied.length > 0) pnpm.ignoredBuiltDependencies = plan.denied;
      return JSON.stringify({ pnpm }, null, 2) + "\n";
    }
    case "pnpm-workspace": {
      const blocks: string[] = [];
      if (plan.allowed.length > 0) blocks.push(yamlList("onlyBuiltDependencies", plan.allowed));
      if (plan.denied.length > 0) blocks.push(yamlList("ignoredBuiltDependencies", plan.denied));
      return blocks.length > 0 ? blocks.join("\n") + "\n" : "";
    }
    case "allow-scripts": {
      const map: Record<string, boolean> = {};
      for (const name of plan.allowed) map[name] = true;
      for (const name of plan.denied) map[name] = false;
      return JSON.stringify({ lavamoat: { allowScripts: map } }, null, 2) + "\n";
    }
    case "npmrc":
      return "ignore-scripts=true\n";
  }
}

export interface WriteResult {
  /** Basename of the file written. */
  file: string;
  action: "created" | "updated";
}

/** Replace (or append) a top-level `key:` list block in a YAML document. */
export function spliceYamlBlock(source: string, key: string, block: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}:`));
  if (start === -1) {
    const body = source.trimEnd();
    return (body === "" ? "" : body + "\n") + block + "\n";
  }
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] as string;
    if (line.trim() === "" || line.startsWith(" ") || line.startsWith("\t") || line.trimStart().startsWith("-")) end++;
    else break;
  }
  // trim trailing blank lines out of the replaced range so spacing stays tidy
  while (end > start + 1 && (lines[end - 1] as string).trim() === "") end--;
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  return [...before, ...block.split("\n"), ...after].join("\n");
}

function writePackageJsonSection(
  dir: string,
  mutate: (manifest: Record<string, unknown>) => void
): WriteResult {
  const path = join(dir, "package.json");
  if (!existsSync(path)) throw new UsageError(`cannot write allowlist: no package.json in ${dir}`);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    throw new UsageError(`cannot write allowlist: ${path} is not valid JSON`);
  }
  mutate(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  return { file: "package.json", action: "updated" };
}

/** Write the config for a target into the project, merging with what exists. */
export function writeEmit(dir: string, census: Census, target: EmitTarget, options: EmitOptions = {}): WriteResult {
  const plan = planEmit(census, options);
  switch (target) {
    case "pnpm":
      return writePackageJsonSection(dir, (manifest) => {
        const existing = manifest.pnpm;
        const section: Record<string, unknown> =
          typeof existing === "object" && existing !== null && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};
        if (plan.allowed.length > 0) section.onlyBuiltDependencies = plan.allowed;
        else delete section.onlyBuiltDependencies;
        if (plan.denied.length > 0) section.ignoredBuiltDependencies = plan.denied;
        else delete section.ignoredBuiltDependencies;
        manifest.pnpm = section;
      });
    case "allow-scripts":
      return writePackageJsonSection(dir, (manifest) => {
        const existing = manifest.lavamoat;
        const section: Record<string, unknown> =
          typeof existing === "object" && existing !== null && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};
        const map: Record<string, boolean> = {};
        for (const name of plan.allowed) map[name] = true;
        for (const name of plan.denied) map[name] = false;
        section.allowScripts = map;
        manifest.lavamoat = section;
      });
    case "pnpm-workspace": {
      const path = join(dir, "pnpm-workspace.yaml");
      const exists = existsSync(path);
      let source = exists ? readFileSync(path, "utf8") : "";
      if (plan.allowed.length > 0) {
        source = spliceYamlBlock(source, "onlyBuiltDependencies", yamlList("onlyBuiltDependencies", plan.allowed));
      }
      if (plan.denied.length > 0) {
        source = spliceYamlBlock(
          source,
          "ignoredBuiltDependencies",
          yamlList("ignoredBuiltDependencies", plan.denied)
        );
      }
      if (!source.endsWith("\n")) source += "\n";
      writeFileSync(path, source);
      return { file: "pnpm-workspace.yaml", action: exists ? "updated" : "created" };
    }
    case "npmrc": {
      const path = join(dir, ".npmrc");
      const exists = existsSync(path);
      const line = "ignore-scripts=true";
      if (!exists) {
        writeFileSync(path, line + "\n");
        return { file: ".npmrc", action: "created" };
      }
      const source = readFileSync(path, "utf8");
      const lines = source.split(/\r?\n/);
      const idx = lines.findIndex((l) => /^ignore-scripts\s*=/.test(l.trim()));
      if (idx === -1) {
        const body = source.trimEnd();
        writeFileSync(path, (body === "" ? "" : body + "\n") + line + "\n");
      } else {
        lines[idx] = line;
        writeFileSync(path, lines.join("\n"));
      }
      return { file: ".npmrc", action: "updated" };
    }
  }
}
