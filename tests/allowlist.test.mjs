// Allowlist readers (pnpm-workspace.yaml, package.json pnpm/lavamoat,
// .npmrc) and the drift computation behind `hookcensus check`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readAllowlists, computeDrift, allowScriptsName, takeCensus } from "../dist/index.js";
import { addPackage, addRoot, tempProject, writeFile } from "./helpers.mjs";

test("pnpm-workspace.yaml only/ignored/neverBuiltDependencies are read", () => {
  const root = tempProject();
  writeFile(root, "pnpm-workspace.yaml", [
    "packages:",
    "  - .",
    "onlyBuiltDependencies:",
    "  - esbuild",
    "ignoredBuiltDependencies:",
    "  - core-js",
    "neverBuiltDependencies:",
    "  - fsevents",
  ].join("\n"));
  const config = readAllowlists(root);
  assert.deepEqual([...config.allowed], ["esbuild"]);
  assert.deepEqual([...config.denied].sort(), ["core-js", "fsevents"]);
  assert.deepEqual(config.files, ["pnpm-workspace.yaml"]);
});

test("package.json pnpm section is read (pre-workspace style)", () => {
  const root = tempProject();
  addRoot(root, { pnpm: { onlyBuiltDependencies: ["bcrypt"], ignoredBuiltDependencies: ["husky"] } });
  const config = readAllowlists(root);
  assert.deepEqual([...config.allowed], ["bcrypt"]);
  assert.deepEqual([...config.denied], ["husky"]);
});

test("lavamoat.allowScripts true/false map to allow/deny; path keys use the last segment", () => {
  const root = tempProject();
  addRoot(root, { lavamoat: { allowScripts: { keccak: true, "app>nested>husky": false } } });
  const config = readAllowlists(root);
  assert.deepEqual([...config.allowed], ["keccak"]);
  assert.deepEqual([...config.denied], ["husky"]);
  assert.equal(allowScriptsName("a>b>@scope/c"), "@scope/c");
  assert.equal(allowScriptsName("keccak"), "keccak");
});

test(".npmrc ignore-scripts is surfaced but decides nothing per-package", () => {
  const root = tempProject();
  writeFile(root, ".npmrc", "# lockfile hygiene\nignore-scripts=true\nsave-exact=true\n");
  const config = readAllowlists(root);
  assert.equal(config.ignoreScripts, true);
  assert.equal(config.allowed.size, 0);
  assert.ok(config.files.includes(".npmrc"));
});

test("configs merge across files; a config-free project yields empty sets", () => {
  const root = tempProject();
  addRoot(root, { lavamoat: { allowScripts: { sharp: true } } });
  writeFile(root, "pnpm-workspace.yaml", "onlyBuiltDependencies:\n  - esbuild\n");
  const config = readAllowlists(root);
  assert.deepEqual([...config.allowed].sort(), ["esbuild", "sharp"]);
  assert.deepEqual(config.files, ["package.json", "pnpm-workspace.yaml"]);

  const bare = tempProject();
  addRoot(bare);
  const empty = readAllowlists(bare);
  assert.equal(empty.allowed.size + empty.denied.size, 0);
  assert.equal(empty.ignoreScripts, null);
  assert.deepEqual(empty.files, []);
});

test("computeDrift: fully covered census is clean", () => {
  const root = tempProject();
  addRoot(root, { pnpm: { onlyBuiltDependencies: ["gypper"], ignoredBuiltDependencies: ["echoer"] } });
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  addPackage(root, "echoer", { scripts: { postinstall: "echo hi" } });
  const drift = computeDrift(takeCensus(root), readAllowlists(root));
  assert.equal(drift.hasConfig, true);
  assert.deepEqual(drift.uncovered, []);
  assert.deepEqual(drift.stale, []);
  assert.deepEqual(drift.covered, ["echoer", "gypper"]);
});

test("computeDrift: undecided packages are uncovered (with suggestion), missing ones are stale", () => {
  const root = tempProject();
  addRoot(root, { pnpm: { onlyBuiltDependencies: ["gypper", "ghost"] } });
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  addPackage(root, "newcomer", { scripts: { postinstall: "node setup.js" } });
  const drift = computeDrift(takeCensus(root), readAllowlists(root));
  assert.equal(drift.uncovered.length, 1);
  assert.equal(drift.uncovered[0].name, "newcomer");
  assert.equal(drift.uncovered[0].verdict, "review");
  assert.deepEqual(drift.stale, ["ghost"]);
});

test("computeDrift: no config and a non-empty census means everything is uncovered", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "hooky", { scripts: { postinstall: "echo hi" } });
  const drift = computeDrift(takeCensus(root), readAllowlists(root));
  assert.equal(drift.hasConfig, false);
  assert.equal(drift.uncovered.length, 1);
});
