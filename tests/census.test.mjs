// takeCensus: merging node_modules sightings with lockfile flags, implicit
// binding.gyp hooks, root-script reporting and per-name summaries.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { takeCensus, summarizeByName, IMPLICIT_GYP_COMMAND, UsageError } from "../dist/index.js";
import { addPackage, addRoot, npmLockV3, tempProject, writeFile } from "./helpers.mjs";

test("a package installed AND flagged in the lock merges into one entry with both sources", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "esbuild", { version: "0.21.5", scripts: { postinstall: "node install.js" } });
  writeFile(root, "package-lock.json", npmLockV3({
    "node_modules/esbuild": { version: "0.21.5", hasInstallScript: true },
  }));
  const census = takeCensus(root);
  assert.equal(census.entries.length, 1);
  const entry = census.entries[0];
  assert.equal(entry.installed, true);
  assert.deepEqual(entry.sources, ["node_modules", "package-lock"]);
  assert.equal(entry.classification.basis, "known-package");
});

test("a lock-only package (not installed) appears with review verdict unless known", () => {
  const root = tempProject();
  addRoot(root);
  writeFile(root, "package-lock.json", npmLockV3({
    "node_modules/mystery-dep": { version: "1.0.0", hasInstallScript: true },
    "node_modules/sharp": { version: "0.33.4", hasInstallScript: true },
  }));
  const census = takeCensus(root);
  const mystery = census.entries.find((e) => e.name === "mystery-dep");
  assert.equal(mystery.installed, false);
  assert.equal(mystery.classification.verdict, "review");
  // sharp is in the knowledge base: verdict resolves even before install
  const sharp = census.entries.find((e) => e.name === "sharp");
  assert.equal(sharp.classification.verdict, "allow");
  assert.equal(sharp.classification.basis, "known-package");
});

test("binding.gyp with no install script surfaces an implicit install hook", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "raw-native", {}, { "binding.gyp": "{}" });
  const census = takeCensus(root);
  const entry = census.entries[0];
  assert.equal(entry.hooks.install, IMPLICIT_GYP_COMMAND);
  assert.equal(entry.classification.basis, "binding-gyp");
});

test("hook-less packages never enter the census; the root's own hooks are reported separately", () => {
  const root = tempProject();
  addRoot(root, { scripts: { postinstall: "node scripts/setup.js" } });
  addPackage(root, "plain", {});
  addPackage(root, "hooky", { scripts: { postinstall: "echo hi" } });
  const census = takeCensus(root);
  assert.equal(census.scanned, 2);
  assert.deepEqual(census.entries.map((e) => e.name), ["hooky"]);
  assert.equal(census.root.name, "fixture-app");
  assert.equal(census.root.hooks.postinstall, "node scripts/setup.js");
});

test("pnpm-lock requiresBuild seeds the census for uninstalled trees", () => {
  const root = tempProject();
  addRoot(root);
  writeFile(root, "pnpm-lock.yaml", [
    "lockfileVersion: '6.0'",
    "packages:",
    "  /bcrypt@5.1.1:",
    "    requiresBuild: true",
  ].join("\n"));
  const census = takeCensus(root);
  assert.deepEqual(census.lockfiles, ["pnpm-lock.yaml"]);
  assert.equal(census.entries[0].name, "bcrypt");
  assert.equal(census.entries[0].installed, false);
});

test("a directory with neither package.json nor node_modules is a usage error", () => {
  const root = tempProject();
  assert.throws(() => takeCensus(root), UsageError);
  assert.throws(() => takeCensus(root + "/does-not-exist"), UsageError);
});

test("entries are sorted by name then version; two versions stay separate rows", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "zeta", { scripts: { postinstall: "echo z" } });
  addPackage(root, "alpha", { version: "2.0.0", scripts: { postinstall: "echo a2" } });
  writeFile(root, "node_modules/zeta/node_modules/alpha/package.json", {
    name: "alpha",
    version: "1.0.0",
    scripts: { postinstall: "echo a1" },
  });
  const census = takeCensus(root);
  assert.deepEqual(
    census.entries.map((e) => `${e.name}@${e.version}`),
    ["alpha@1.0.0", "alpha@2.0.0", "zeta@1.0.0"]
  );
});

test("an unreadable lockfile degrades to a warning, not a crash", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "hooky", { scripts: { postinstall: "echo hi" } });
  writeFile(root, "package-lock.json", "{ nope");
  const census = takeCensus(root);
  assert.equal(census.entries.length, 1);
  assert.ok(census.warnings.some((w) => w.includes("package-lock.json")));
});

test("summarizeByName keeps agreeing verdicts and degrades disagreements to review", () => {
  const root = tempProject();
  addRoot(root);
  // two versions of gyp-a, both allow
  addPackage(root, "gyp-a", { scripts: { install: "node-gyp rebuild" } });
  writeFile(root, "node_modules/gyp-a/node_modules/inner/package.json", {
    name: "gyp-a",
    version: "2.0.0",
    scripts: { install: "node-gyp rebuild" },
  });
  // two versions of shifty: one deny (echo), one allow (node-gyp)
  addPackage(root, "shifty", { scripts: { postinstall: "echo hi" } });
  writeFile(root, "node_modules/shifty/node_modules/inner/package.json", {
    name: "shifty",
    version: "2.0.0",
    scripts: { install: "node-gyp rebuild" },
  });
  const summaries = summarizeByName(takeCensus(root));
  const gypA = summaries.find((s) => s.name === "gyp-a");
  assert.equal(gypA.verdict, "allow");
  assert.deepEqual(gypA.versions, ["1.0.0", "2.0.0"]);
  const shifty = summaries.find((s) => s.name === "shifty");
  assert.equal(shifty.verdict, "review");
});
