#!/usr/bin/env node
/**
 * CLI entry point. Thin by design: everything testable lives in the pure
 * modules; this file only wires parsing, the census, renderers and exit
 * codes together.
 */

import { computeDrift, readAllowlists } from "./allowlist.js";
import { takeCensus } from "./census.js";
import { parseArgs, USAGE } from "./cliargs.js";
import { renderEmit, writeEmit, planEmit } from "./emit.js";
import { renderCheckJson, renderCheckText, renderListJson, renderListText } from "./report.js";
import { UsageError } from "./types.js";
import { VERSION } from "./version.js";

export function main(argv: string[]): number {
  let command;
  try {
    command = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`hookcensus: ${(err as Error).message}\n\nRun hookcensus --help for usage.\n`);
    return 2;
  }

  try {
    switch (command.kind) {
      case "help":
        process.stdout.write(USAGE);
        return 0;
      case "version":
        process.stdout.write(`${VERSION}\n`);
        return 0;
      case "list": {
        const census = takeCensus(command.dir);
        process.stdout.write(command.format === "json" ? renderListJson(census) : renderListText(census));
        return 0;
      }
      case "emit": {
        const census = takeCensus(command.dir);
        const options = { includeReview: command.includeReview };
        if (command.write) {
          const result = writeEmit(command.dir, census, command.target, options);
          const plan = planEmit(census, options);
          process.stdout.write(
            `${result.action} ${result.file}: ${plan.allowed.length} allowed, ${plan.denied.length} denied` +
              (plan.excluded.length > 0
                ? `; ${plan.excluded.length} review package(s) left out — decide them or pass --include-review`
                : "") +
              "\n"
          );
        } else {
          process.stdout.write(renderEmit(census, command.target, options));
          const plan = planEmit(census, options);
          if (plan.excluded.length > 0) {
            process.stderr.write(
              `note: ${plan.excluded.length} review package(s) excluded: ${plan.excluded.join(", ")} ` +
                `(pass --include-review after inspecting them)\n`
            );
          }
        }
        return 0;
      }
      case "check": {
        const census = takeCensus(command.dir);
        const config = readAllowlists(command.dir);
        const drift = computeDrift(census, config);
        process.stdout.write(
          command.format === "json" ? renderCheckJson(census, drift) : renderCheckText(census, drift)
        );
        const clean = drift.hasConfig
          ? drift.uncovered.length === 0 && drift.stale.length === 0
          : census.entries.length === 0;
        return clean ? 0 : 1;
      }
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`hookcensus: ${err.message}\n`);
      return 2;
    }
    process.stderr.write(`hookcensus: unexpected error: ${(err as Error).message}\n`);
    return 2;
  }
}

process.exit(main(process.argv.slice(2)));
