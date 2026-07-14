/**
 * Classification engine: decides what a package's install-time scripts do
 * and whether they should be allowed, denied, or reviewed.
 *
 * Precedence (most trustworthy first):
 *   1. curated knowledge base (src/known.ts) — exact package name;
 *   2. command patterns over the declared hook text;
 *   3. binding.gyp with no install script — npm/pnpm synthesize
 *      `node-gyp rebuild`, so the package builds natively even though it
 *      declares nothing;
 *   4. fallback: review, because an unclassified script is exactly the case
 *      a human must look at.
 *
 * Every rule carries a stable, single-sentence reason. Reasons are part of
 * the output contract (tests grep them), so change them deliberately.
 */

import { lookupKnown } from "./known.js";
import type { Classification, HookName } from "./types.js";
import { HOOK_NAMES } from "./types.js";

/** Matchers for the well-known native toolchain entry points. */
const NATIVE_BUILD = new RegExp(
  "(^|[\\s\"'&|;(])(" +
    [
      "node-gyp(-build)?",
      "node-pre-gyp",
      "@mapbox/node-pre-gyp",
      "prebuild-install",
      "prebuildify",
      "cmake-js",
      "node-waf",
      "neon\\s+build",
      "napi\\s+build",
      "cargo\\s+build",
      "go\\s+build",
    ].join("|") +
    ")\\b"
);

const DEV_HOOKS = /(^|[\s"'&|;(])(husky|simple-git-hooks|lefthook|git-hooks-install)\b|core\.hookspath/;

const FUNDING = /opencollective|open\s+collective|patreon|buy\s+me\s+a\s+coffee|\bfunding\b|\bdonat(e|ion|ions)\b/;

const PATCH = /(^|[\s"'&|;(])patch-package\b/;

const NETWORK = /https?:\/\/|(^|[\s"'&|;(-])(download|curl|wget)\b/;

const SCRIPT_FILE = /(^|[\s"'&|;(])(node|node\.exe)\s+(--[\w-]+\s+)*\S+\.(c|m)?js\b|(^|[\s"'&|;(])(sh|bash)\s+\S+\.sh\b/;

/** `echo …`, `exit 0`, `true`, `:` — or a bare `node -e "console.log(…)"`. */
export function isTrivialCommand(command: string): boolean {
  const cmd = command.trim();
  if (cmd === "" || cmd === "true" || cmd === ":" || cmd === "exit 0") return true;
  if (/^echo\b[^|&;<>`$()]*$/.test(cmd)) return true;
  return /^node(\.exe)?\s+(-e|--eval)\s+("|')?\s*console\.log\([^;|&]*\);?\s*("|')?$/.test(cmd);
}

/** First matching JS file the command runs, for review pointers ("inspect install.js"). */
export function scriptFileOf(command: string): string | null {
  const m = /(?:^|[\s"'&|;(])(?:node|node\.exe)\s+(?:--[\w-]+\s+)*(\S+\.(?:c|m)?js)\b/.exec(command);
  if (m && m[1]) return m[1].replace(/^["']|["']$/g, "");
  const sh = /(?:^|[\s"'&|;(])(?:sh|bash)\s+(\S+\.sh)\b/.exec(command);
  return sh && sh[1] ? sh[1].replace(/^["']|["']$/g, "") : null;
}

/**
 * Classify one package. `hooks` are the declared install-time scripts;
 * `hasBindingGyp` marks the implicit `node-gyp rebuild` case.
 */
export function classifyPackage(
  name: string,
  hooks: Partial<Record<HookName, string>>,
  hasBindingGyp: boolean
): Classification {
  const known = lookupKnown(name);
  if (known) {
    return { category: known.category, verdict: known.verdict, reason: known.reason, basis: "known-package" };
  }

  const commands = HOOK_NAMES.map((h) => hooks[h]).filter((c): c is string => typeof c === "string" && c.trim() !== "");

  if (commands.length > 0) {
    const joined = commands.join(" && ").toLowerCase();

    if (NATIVE_BUILD.test(joined)) {
      return {
        category: "native-build",
        verdict: "allow",
        reason: "compiles or fetches a native addon; the package will not load without it",
        basis: "pattern",
      };
    }
    if (DEV_HOOKS.test(joined)) {
      return {
        category: "dev-hooks",
        verdict: "deny",
        reason: "installs git hooks — useful in the package's own repository, not in yours",
        basis: "pattern",
      };
    }
    if (FUNDING.test(joined)) {
      return {
        category: "funding",
        verdict: "deny",
        reason: "prints a funding or donation message; nothing functional happens",
        basis: "pattern",
      };
    }
    if (PATCH.test(joined)) {
      return {
        category: "patch",
        verdict: "review",
        reason: "runs patch-package from inside a dependency; verify what it patches before allowing",
        basis: "pattern",
      };
    }
    if (commands.every(isTrivialCommand)) {
      return {
        category: "trivial",
        verdict: "deny",
        reason: "only echoes or evaluates a bare log statement; safe to block",
        basis: "pattern",
      };
    }
    if (NETWORK.test(joined)) {
      return {
        category: "binary-fetch",
        verdict: "review",
        reason: "reaches for the network at install time; verify what it downloads and from where",
        basis: "pattern",
      };
    }
    const file = commands.map(scriptFileOf).find((f) => f !== null) ?? null;
    if (file !== null) {
      return {
        category: "script-run",
        verdict: "review",
        reason: `runs a bundled script (${file}); read it before allowing`,
        basis: "pattern",
      };
    }
    return {
      category: "unknown",
      verdict: "review",
      reason: "unrecognized command; inspect the package before allowing",
      basis: "fallback",
    };
  }

  if (hasBindingGyp) {
    return {
      category: "native-build",
      verdict: "allow",
      reason: "ships a binding.gyp with no install script — package managers synthesize `node-gyp rebuild`",
      basis: "binding-gyp",
    };
  }

  // Lockfile-only sighting: a lockfile says "has install scripts" but the
  // package is not on disk, so there is no command text to analyze.
  return {
    category: "unknown",
    verdict: "review",
    reason: "flagged by a lockfile but not installed; install it or inspect the published tarball",
    basis: "fallback",
  };
}
