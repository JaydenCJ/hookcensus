// node_modules walker: flat and pnpm layouts, scopes, nesting, dedup,
// binding.gyp detection and tolerance for broken manifests.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanNodeModules, extractHooks } from "../dist/index.js";
import { addPackage, tempProject, writeFile } from "./helpers.mjs";

function nm(root) {
  return join(root, "node_modules");
}

test("flat layout: hooks are captured, script-free packages are scanned but hook-less", () => {
  const root = tempProject();
  addPackage(root, "with-hook", { scripts: { postinstall: "node setup.js" } });
  addPackage(root, "plain", {});
  const result = scanNodeModules(nm(root));
  assert.equal(result.scanned, 2);
  assert.equal(result.packages.length, 2);
  const withHook = result.packages.find((p) => p.name === "with-hook");
  assert.equal(withHook.hooks.postinstall, "node setup.js");
  const plain = result.packages.find((p) => p.name === "plain");
  assert.deepEqual(plain.hooks, {});
});

test("scoped packages and nested node_modules (conflicting versions) are walked", () => {
  const root = tempProject();
  addPackage(root, "@scope/tool", { scripts: { preinstall: "node check.js" } });
  addPackage(root, "outer", { version: "2.0.0" });
  writeFile(root, "node_modules/outer/node_modules/inner/package.json", {
    name: "inner",
    version: "1.0.0",
    scripts: { install: "node-gyp rebuild" },
  });
  const result = scanNodeModules(nm(root));
  const scoped = result.packages.find((p) => p.name === "@scope/tool");
  assert.equal(scoped.hooks.preinstall, "node check.js");
  const inner = result.packages.find((p) => p.name === "inner");
  assert.equal(inner.hooks.install, "node-gyp rebuild");
});

test("pnpm layout: .pnpm store is walked and root symlinks dedup via realpath", () => {
  const root = tempProject();
  const storePkg = join(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild");
  writeFile(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/package.json", {
    name: "esbuild",
    version: "0.21.5",
    scripts: { postinstall: "node install.js" },
  });
  writeFile(root, "node_modules/.pnpm/lock.yaml", "ignored: true\n");
  symlinkSync(storePkg, join(nm(root), "esbuild"), "dir");
  const result = scanNodeModules(nm(root));
  assert.equal(result.packages.length, 1);
  assert.equal(result.scanned, 1);
  assert.equal(result.packages[0].name, "esbuild");
});

test("distinct copies of the same name@version count occurrences, not extra rows", () => {
  const root = tempProject();
  addPackage(root, "host-a", {});
  addPackage(root, "host-b", {});
  for (const host of ["host-a", "host-b"]) {
    writeFile(root, `node_modules/${host}/node_modules/twice/package.json`, {
      name: "twice",
      version: "3.1.4",
      scripts: { postinstall: "echo hi" },
    });
  }
  const result = scanNodeModules(nm(root));
  const twice = result.packages.find((p) => p.name === "twice");
  assert.equal(twice.occurrences, 2);
  assert.equal(result.packages.filter((p) => p.name === "twice").length, 1);
});

test("dot-directories like .bin and .cache are skipped", () => {
  const root = tempProject();
  writeFile(root, "node_modules/.bin/tool", "#!/bin/sh\n");
  writeFile(root, "node_modules/.cache/junk/package.json", { name: "junk", version: "0.0.1" });
  addPackage(root, "real", {});
  const result = scanNodeModules(nm(root));
  assert.equal(result.scanned, 1);
  assert.equal(result.packages[0].name, "real");
});

test("binding.gyp is detected even with no scripts at all", () => {
  const root = tempProject();
  addPackage(root, "native-thing", {}, { "binding.gyp": "{}" });
  const result = scanNodeModules(nm(root));
  assert.equal(result.packages[0].hasBindingGyp, true);
  assert.deepEqual(result.packages[0].hooks, {});
});

test("broken manifests warn instead of crash; bare dirs still have nested node_modules walked", () => {
  const root = tempProject();
  writeFile(root, "node_modules/broken/package.json", "{ not json");
  addPackage(root, "fine", {});
  mkdirSync(join(nm(root), "bare"), { recursive: true });
  writeFile(root, "node_modules/bare/node_modules/hidden/package.json", {
    name: "hidden",
    version: "1.0.0",
    scripts: { install: "make" },
  });
  const result = scanNodeModules(nm(root));
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("broken"));
  assert.ok(result.packages.find((p) => p.name === "hidden"));
});

test("output is sorted by name then version; extractHooks keeps only the three install hooks", () => {
  const root = tempProject();
  addPackage(root, "zeta", {});
  addPackage(root, "alpha", { version: "2.0.0" });
  writeFile(root, "node_modules/old/node_modules/alpha/package.json", { name: "alpha", version: "1.0.0" });
  const ids = scanNodeModules(nm(root)).packages.map((p) => `${p.name}@${p.version}`);
  assert.deepEqual(ids, ["alpha@1.0.0", "alpha@2.0.0", "zeta@1.0.0"]);

  const hooks = extractHooks({
    preinstall: "a",
    install: "b",
    postinstall: "c",
    prepare: "never for registry deps",
    test: "node --test",
    build: "",
  });
  assert.deepEqual(hooks, { preinstall: "a", install: "b", postinstall: "c" });
  assert.deepEqual(extractHooks(null), {});
  assert.deepEqual(extractHooks({ postinstall: "   " }), {});
});
