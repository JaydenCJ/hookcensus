// End-to-end CLI runs against the compiled dist/cli.js: exit codes, output
// formats, --write side effects, and the bundled example projects (which
// the README quotes, so these tests keep its captured output honest).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { addPackage, addRoot, tempProject, writeFile } from "./helpers.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const WEBAPP = join(ROOT, "examples", "webapp");
const PNPM_APP = join(ROOT, "examples", "pnpm-app");

function run(...args) {
  const result = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("--version matches package.json; --help documents the exit-code contract", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = run("--version");
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = run("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Exit codes: 0 ok · 1 drift found \(check\) · 2 usage or I\/O error/);
});

test("unknown commands and unknown flags exit 2 with a pointer to --help", () => {
  const bad = run("frobnicate");
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unknown command/);
  assert.match(bad.stderr, /--help/);
  assert.equal(run("list", "--verbose").code, 2);
});

test("a nonexistent directory exits 2, distinct from drift's exit 1", () => {
  const { code, stderr } = run("list", "/nonexistent/path/for/hookcensus");
  assert.equal(code, 2);
  assert.match(stderr, /no such directory/);
});

test("list on the bundled webapp example matches the documented census, deterministically", () => {
  const { code, stdout } = run("list", WEBAPP);
  assert.equal(code, 0);
  assert.match(stdout, /8 package\(s\) with lifecycle scripts out of 9 scanned/);
  assert.match(stdout, /ALLOW\s+esbuild@0\.21\.5/);
  assert.match(stdout, /DENY\s+husky@4\.3\.8/);
  assert.match(stdout, /REVIEW\s+tiny-notifier@2\.0\.1/);
  assert.match(stdout, /sharp@0\.33\.4.*\(not installed\)/);
  assert.match(stdout, /allow 5 · deny 2 · review 1/);
  assert.equal(run("list", WEBAPP).stdout, stdout); // byte-identical repeat run
});

test("list --format json on the webapp example is valid JSON with the same content", () => {
  const { code, stdout } = run("list", WEBAPP, "--format", "json");
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.packages.length, 8);
  assert.equal(parsed.summary.allow, 5);
  const keychain = parsed.packages.find((p) => p.name === "native-keychain");
  assert.equal(keychain.bindingGyp, true);
  assert.equal(keychain.basis, "binding-gyp");
});

test("check on the webapp example (no config) exits 1 and suggests emit", () => {
  const { code, stdout } = run("check", WEBAPP);
  assert.equal(code, 1);
  assert.match(stdout, /no allowlist config exists/);
});

test("check on the pnpm example exits 1 with undecided and stale sections, in JSON too", () => {
  const { code, stdout } = run("check", PNPM_APP);
  assert.equal(code, 1);
  assert.match(stdout, /undecided \(2\)/);
  assert.match(stdout, /better-sqlite3 \(11\.3\.0\) — suggested verdict: allow/);
  assert.match(stdout, /node-sass \(9\.0\.0\) — suggested verdict: allow/);
  assert.match(stdout, /stale \(1\)/);
  assert.match(stdout, /^ {2}left-pad$/m);

  const json = run("check", PNPM_APP, "--format", "json");
  assert.equal(json.code, 1);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.stale, ["left-pad"]);
});

test("emit pnpm prints the fragment and notes excluded review packages on stderr", () => {
  const { code, stdout, stderr } = run("emit", "pnpm", WEBAPP);
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed.pnpm.onlyBuiltDependencies, [
    "better-sqlite3",
    "esbuild",
    "fsevents",
    "native-keychain",
    "sharp",
  ]);
  assert.deepEqual(parsed.pnpm.ignoredBuiltDependencies, ["core-js", "husky"]);
  assert.match(stderr, /1 review package\(s\) excluded: tiny-notifier/);
});

test("emit --include-review moves the review package into the allowlist", () => {
  const { stdout, stderr } = run("emit", "pnpm", WEBAPP, "--include-review");
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.pnpm.onlyBuiltDependencies.includes("tiny-notifier"));
  assert.equal(stderr, "");
});

test("emit pnpm-workspace --write creates a config that makes check pass", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  addPackage(root, "echoer", { scripts: { postinstall: "echo hi" } });

  assert.equal(run("check", root).code, 1); // no config yet

  const emit = run("emit", "pnpm-workspace", root, "--write");
  assert.equal(emit.code, 0);
  assert.match(emit.stdout, /created pnpm-workspace\.yaml: 1 allowed, 1 denied/);
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(yaml, /onlyBuiltDependencies:\n {2}- gypper/);

  const check = run("check", root);
  assert.equal(check.code, 0);
  assert.match(check.stdout, /hookcensus check: OK/);
});

test("emit npmrc --write blocks everything but check still reports per-package drift", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  const emit = run("emit", "npmrc", root, "--write");
  assert.equal(emit.code, 0);
  assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), "ignore-scripts=true\n");
  const check = run("check", root);
  assert.equal(check.code, 1);
  assert.match(check.stdout, /undecided \(1\)/);
});

test("edge trees: a script-free project checks OK without config; a lockfile-only project lists fine", () => {
  const clean = tempProject();
  addRoot(clean);
  addPackage(clean, "plain", {});
  const okRun = run("check", clean);
  assert.equal(okRun.code, 0);
  assert.match(okRun.stdout, /hookcensus check: OK/);

  const lockOnly = tempProject();
  addRoot(lockOnly);
  writeFile(lockOnly, "package-lock.json", JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture-app", version: "1.0.0" },
      "node_modules/bcrypt": { version: "5.1.1", hasInstallScript: true },
    },
  }));
  const list = run("list", lockOnly);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /1 package\(s\) with lifecycle scripts out of 0 scanned/);
  assert.match(list.stdout, /bcrypt@5\.1\.1\s+\(lockfile\)/);
});
