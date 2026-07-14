/**
 * Renderers for `list` and `check`. Text output is a fixed-width table
 * meant for terminals and code review; JSON output is a stable shape meant
 * for scripts (keys are append-only across releases).
 */

import type { DriftReport } from "./allowlist.js";
import type { Census, CensusEntry, Verdict } from "./types.js";
import { HOOK_NAMES } from "./types.js";

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** `preinstall,postinstall` — execution order, comma-joined. */
export function hookNames(entry: CensusEntry): string {
  const names = HOOK_NAMES.filter((h) => entry.hooks[h] !== undefined);
  return names.length > 0 ? names.join(",") : "(lockfile)";
}

function verdictCounts(census: Census): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { allow: 0, deny: 0, review: 0 };
  for (const entry of census.entries) counts[entry.classification.verdict]++;
  return counts;
}

/** Human-readable census listing. */
export function renderListText(census: Census): string {
  const lines: string[] = [];
  const total = census.entries.length;
  lines.push(
    `hookcensus: ${total} package(s) with lifecycle scripts out of ${census.scanned} scanned`
  );
  if (census.lockfiles.length > 0) lines.push(`lockfiles read: ${census.lockfiles.join(", ")}`);
  lines.push("");

  if (total === 0) {
    lines.push("No dependency in this tree declares an install-time lifecycle script.");
  } else {
    const nameWidth = Math.max(...census.entries.map((e) => `${e.name}@${e.version}`.length));
    const hooksWidth = Math.max(...census.entries.map((e) => hookNames(e).length), "hooks".length);
    const catWidth = Math.max(...census.entries.map((e) => e.classification.category.length));
    for (const entry of census.entries) {
      const verdict = entry.classification.verdict.toUpperCase();
      const id = `${entry.name}@${entry.version}`;
      const suffix = entry.installed ? "" : " (not installed)";
      lines.push(
        `${pad(verdict, 6)}  ${pad(id, nameWidth)}  ${pad(hookNames(entry), hooksWidth)}  ` +
          `${pad(entry.classification.category, catWidth)}  ${entry.classification.reason}${suffix}`
      );
    }
    const counts = verdictCounts(census);
    lines.push("");
    lines.push(`allow ${counts.allow} · deny ${counts.deny} · review ${counts.review}`);
  }

  if (census.root !== null && Object.keys(census.root.hooks).length > 0) {
    const names = HOOK_NAMES.filter((h) => census.root!.hooks[h] !== undefined).join(",");
    lines.push("");
    lines.push(
      `note: the root project (${census.root.name}) declares ${names} — pnpm's allowlist never` +
        ` gates root scripts, but npm's ignore-scripts=true blocks them too.`
    );
  }
  for (const warning of census.warnings) {
    lines.push("");
    lines.push(`warning: ${warning}`);
  }
  return lines.join("\n") + "\n";
}

/** Stable JSON shape for `list --format json`. */
export function renderListJson(census: Census): string {
  const counts = verdictCounts(census);
  return (
    JSON.stringify(
      {
        scanned: census.scanned,
        lockfiles: census.lockfiles,
        packages: census.entries.map((entry) => ({
          name: entry.name,
          version: entry.version,
          hooks: entry.hooks,
          installed: entry.installed,
          sources: entry.sources,
          bindingGyp: entry.hasBindingGyp,
          category: entry.classification.category,
          verdict: entry.classification.verdict,
          reason: entry.classification.reason,
          basis: entry.classification.basis,
        })),
        root: census.root,
        summary: counts,
        warnings: census.warnings,
      },
      null,
      2
    ) + "\n"
  );
}

/** Human-readable drift report; the caller turns `clean` into an exit code. */
export function renderCheckText(census: Census, drift: DriftReport): string {
  const lines: string[] = [];
  const total = census.entries.length;
  if (!drift.hasConfig && total > 0) {
    lines.push(`hookcensus check: FAIL — ${total} package(s) can run install scripts but no allowlist config exists.`);
    lines.push("Generate one: hookcensus emit pnpm | pnpm-workspace | allow-scripts | npmrc");
  } else if (drift.uncovered.length === 0 && drift.stale.length === 0) {
    lines.push(
      `hookcensus check: OK — ${drift.covered.length} package(s) with lifecycle scripts, all decided by config.`
    );
  } else {
    lines.push(`hookcensus check: FAIL — allowlist config has drifted.`);
  }
  if (drift.uncovered.length > 0) {
    lines.push("");
    lines.push(`undecided (${drift.uncovered.length}) — in the tree, not in any allowlist:`);
    for (const summary of drift.uncovered) {
      lines.push(`  ${summary.name} (${summary.versions.join(", ")}) — suggested verdict: ${summary.verdict}`);
    }
  }
  if (drift.stale.length > 0) {
    lines.push("");
    lines.push(`stale (${drift.stale.length}) — configured, but no longer has scripts in this tree:`);
    for (const name of drift.stale) lines.push(`  ${name}`);
  }
  for (const warning of census.warnings) {
    lines.push("");
    lines.push(`warning: ${warning}`);
  }
  return lines.join("\n") + "\n";
}

/** Stable JSON shape for `check --format json`. */
export function renderCheckJson(census: Census, drift: DriftReport): string {
  return (
    JSON.stringify(
      {
        ok: drift.hasConfig && drift.uncovered.length === 0 && drift.stale.length === 0,
        hasConfig: drift.hasConfig,
        covered: drift.covered,
        uncovered: drift.uncovered.map((s) => ({ name: s.name, versions: s.versions, suggested: s.verdict })),
        stale: drift.stale,
        warnings: census.warnings,
      },
      null,
      2
    ) + "\n"
  );
}
