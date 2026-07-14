// package-lock.json reader: hasInstallScript extraction across path shapes,
// version support, and loud failure on garbage.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseNpmLock, nameFromLockPath } from "../dist/index.js";
import { npmLockV3 } from "./helpers.mjs";

test("extracts only entries flagged hasInstallScript; hoisted+nested duplicates collapse", () => {
  const result = parseNpmLock(
    npmLockV3({
      "node_modules/esbuild": { version: "0.21.5", hasInstallScript: true },
      "node_modules/left-pad": { version: "1.3.0" },
      "node_modules/husky": { version: "4.3.8", hasInstallScript: true, dev: true },
      "node_modules/x/node_modules/esbuild": { version: "0.21.5", hasInstallScript: true },
    })
  );
  assert.deepEqual(
    result.packages.map((p) => `${p.name}@${p.version}`),
    ["esbuild@0.21.5", "husky@4.3.8"]
  );
  assert.ok(result.packages.every((p) => p.source === "package-lock"));
});

test("scoped and nested paths resolve; an explicit `name` field (aliased install) wins", () => {
  const result = parseNpmLock(
    npmLockV3({
      "node_modules/@scope/native": { version: "2.0.0", hasInstallScript: true },
      "node_modules/a/node_modules/@scope/c": { version: "3.0.0", hasInstallScript: true },
      "node_modules/my-alias": { name: "real-package", version: "1.0.0", hasInstallScript: true },
    })
  );
  assert.deepEqual(
    result.packages.map((p) => p.name),
    ["@scope/c", "@scope/native", "real-package"]
  );
});

test("the root entry and workspace links are never reported, even with the flag set", () => {
  const result = parseNpmLock(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app", version: "1.0.0", hasInstallScript: true },
        "packages/app": { version: "1.0.0", hasInstallScript: true },
        "node_modules/dep": { version: "1.0.0", hasInstallScript: true },
      },
    })
  );
  assert.deepEqual(result.packages.map((p) => p.name), ["dep"]);
});

test("lockfileVersion 1 yields no packages plus an upgrade warning", () => {
  const result = parseNpmLock(JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
  assert.equal(result.packages.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("lockfile-version 3"), result.warnings[0]);
});

test("invalid JSON throws with a pointed message", () => {
  assert.throws(() => parseNpmLock("{ nope"), /not valid JSON/);
  assert.throws(() => parseNpmLock('"a string"'), /not a JSON object/);
});

test("nameFromLockPath handles plain, scoped, nested and workspace paths", () => {
  assert.equal(nameFromLockPath("node_modules/foo"), "foo");
  assert.equal(nameFromLockPath("node_modules/@s/foo"), "@s/foo");
  assert.equal(nameFromLockPath("node_modules/a/node_modules/@s/b"), "@s/b");
  assert.equal(nameFromLockPath("packages/app"), null);
  assert.equal(nameFromLockPath("node_modules/"), null);
});
