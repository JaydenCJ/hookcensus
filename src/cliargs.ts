/**
 * Argument parsing, kept pure (argv in, structured command out) so it is
 * unit-testable without spawning anything. All misuse throws UsageError,
 * which the CLI maps to exit code 2 — distinct from exit 1 (drift found).
 */

import { EMIT_TARGETS, type EmitTarget } from "./emit.js";
import { UsageError } from "./types.js";

export type OutputFormat = "text" | "json";

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "list"; dir: string; format: OutputFormat }
  | { kind: "emit"; dir: string; target: EmitTarget; includeReview: boolean; write: boolean }
  | { kind: "check"; dir: string; format: OutputFormat };

export const USAGE = `hookcensus — census of install-time lifecycle scripts, with allowlist configs to match

Usage:
  hookcensus list  [dir] [--format text|json]
  hookcensus emit  <target> [dir] [--include-review] [--write]
  hookcensus check [dir] [--format text|json]

Commands:
  list    Show every package in the dependency tree that can run code at
          install time (preinstall/install/postinstall or binding.gyp),
          classified with a verdict: allow, deny, or review.
  emit    Generate an allowlist config from the census. Targets:
            pnpm            package.json "pnpm.onlyBuiltDependencies" (+ ignored)
            pnpm-workspace  the same lists in pnpm-workspace.yaml (pnpm 10)
            allow-scripts   package.json "lavamoat.allowScripts" for npm
            npmrc           ignore-scripts=true for .npmrc
          Prints to stdout by default; --write merges into the project file.
  check   CI gate: exit 1 if any package with lifecycle scripts is missing
          from the allowlist config, or if the config lists stale packages.

Options:
  --format text|json   Output format for list/check (default: text)
  --include-review     emit: treat review verdicts as allow (you reviewed them)
  --write              emit: write/merge the config into the project
  -h, --help           Show this help
  -V, --version        Show the version

Exit codes: 0 ok · 1 drift found (check) · 2 usage or I/O error
`;

function takeFormat(value: string | undefined): OutputFormat {
  if (value === undefined) throw new UsageError("--format needs a value: text or json");
  if (value !== "text" && value !== "json") throw new UsageError(`unknown format: ${value} (expected text or json)`);
  return value;
}

/** Parse argv (already stripped of `node script.js`). */
export function parseArgs(argv: string[]): ParsedCommand {
  if (argv.includes("-h") || argv.includes("--help")) return { kind: "help" };
  if (argv.includes("-V") || argv.includes("--version")) return { kind: "version" };
  const [command, ...rest] = argv;
  if (command === undefined) return { kind: "help" };

  switch (command) {
    case "list":
    case "check": {
      let dir = ".";
      let dirSet = false;
      let format: OutputFormat = "text";
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i] as string;
        if (arg === "--format") {
          format = takeFormat(rest[++i]);
        } else if (arg.startsWith("--format=")) {
          format = takeFormat(arg.slice("--format=".length));
        } else if (arg.startsWith("-")) {
          throw new UsageError(`unknown option for ${command}: ${arg}`);
        } else if (!dirSet) {
          dir = arg;
          dirSet = true;
        } else {
          throw new UsageError(`unexpected argument: ${arg}`);
        }
      }
      return command === "list" ? { kind: "list", dir, format } : { kind: "check", dir, format };
    }
    case "emit": {
      let target: EmitTarget | null = null;
      let dir = ".";
      let dirSet = false;
      let includeReview = false;
      let write = false;
      for (const arg of rest) {
        if (arg === "--include-review") includeReview = true;
        else if (arg === "--write") write = true;
        else if (arg.startsWith("-")) throw new UsageError(`unknown option for emit: ${arg}`);
        else if (target === null) {
          if (!(EMIT_TARGETS as readonly string[]).includes(arg)) {
            throw new UsageError(`unknown emit target: ${arg} (expected ${EMIT_TARGETS.join(", ")})`);
          }
          target = arg as EmitTarget;
        } else if (!dirSet) {
          dir = arg;
          dirSet = true;
        } else {
          throw new UsageError(`unexpected argument: ${arg}`);
        }
      }
      if (target === null) throw new UsageError(`emit needs a target: ${EMIT_TARGETS.join(", ")}`);
      return { kind: "emit", dir, target, includeReview, write };
    }
    default:
      throw new UsageError(`unknown command: ${command} (expected list, emit, or check)`);
  }
}
