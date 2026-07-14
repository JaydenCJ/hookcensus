// Pure argv parsing: command shapes, defaults, and the misuse cases that
// must become exit code 2.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseArgs, UsageError, USAGE } from "../dist/index.js";

test("bare invocation, --help/-h, and --version/-V resolve anywhere in argv", () => {
  assert.deepEqual(parseArgs([]), { kind: "help" });
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" });
  assert.deepEqual(parseArgs(["list", "-h"]), { kind: "help" });
  assert.deepEqual(parseArgs(["--version"]), { kind: "version" });
  assert.deepEqual(parseArgs(["check", "-V"]), { kind: "version" });
});

test("list defaults to cwd and text format, check mirrors it, --format json parses in either spelling", () => {
  assert.deepEqual(parseArgs(["list"]), { kind: "list", dir: ".", format: "text" });
  assert.deepEqual(parseArgs(["check", "app"]), { kind: "check", dir: "app", format: "text" });
  assert.deepEqual(parseArgs(["list", "some/app", "--format", "json"]), {
    kind: "list",
    dir: "some/app",
    format: "json",
  });
  assert.deepEqual(parseArgs(["list", "--format=json", "some/app"]), {
    kind: "list",
    dir: "some/app",
    format: "json",
  });
});

test("emit parses target, dir and both flags, with sane defaults", () => {
  assert.deepEqual(parseArgs(["emit", "pnpm-workspace", "app", "--include-review", "--write"]), {
    kind: "emit",
    dir: "app",
    target: "pnpm-workspace",
    includeReview: true,
    write: true,
  });
  assert.deepEqual(parseArgs(["emit", "npmrc"]), {
    kind: "emit",
    dir: ".",
    target: "npmrc",
    includeReview: false,
    write: false,
  });
});

test("misuse throws UsageError: missing/unknown target, unknown command/option, extra positional, bad format", () => {
  assert.throws(() => parseArgs(["emit"]), (e) => e instanceof UsageError && /pnpm-workspace/.test(e.message));
  assert.throws(() => parseArgs(["emit", "yarn"]), /unknown emit target: yarn/);
  assert.throws(() => parseArgs(["frobnicate"]), /unknown command/);
  assert.throws(() => parseArgs(["list", "--verbose"]), /unknown option/);
  assert.throws(() => parseArgs(["emit", "pnpm", "--force"]), /unknown option/);
  assert.throws(() => parseArgs(["list", "a", "b"]), /unexpected argument: b/);
  assert.throws(() => parseArgs(["list", "--format", "xml"]), /unknown format: xml/);
  assert.throws(() => parseArgs(["list", "--format"]), /--format needs a value/);
});

test("USAGE documents every command, target and flag", () => {
  for (const needle of ["list", "emit", "check", "pnpm-workspace", "allow-scripts", "npmrc", "--include-review", "--write", "--format"]) {
    assert.ok(USAGE.includes(needle), `usage missing ${needle}`);
  }
});
