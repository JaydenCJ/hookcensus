// pnpm-lock.yaml reader: key formats across lockfile v5/v6/v9 and the
// requiresBuild extraction the census relies on.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parsePnpmLock, parsePnpmKey } from "../dist/index.js";

test("parsePnpmKey handles v5, v6 and v9 keys, plain and scoped, with peer suffixes", () => {
  // v6: /name@version, peer suffix in parentheses
  assert.deepEqual(parsePnpmKey("/esbuild@0.21.5"), { name: "esbuild", version: "0.21.5" });
  assert.deepEqual(parsePnpmKey("/@scope/name@1.2.3"), { name: "@scope/name", version: "1.2.3" });
  assert.deepEqual(parsePnpmKey("/styled@6.1.0(react@18.2.0)"), { name: "styled", version: "6.1.0" });
  // v5: /name/version, peer suffix after an underscore
  assert.deepEqual(parsePnpmKey("/esbuild/0.21.5"), { name: "esbuild", version: "0.21.5" });
  assert.deepEqual(parsePnpmKey("/@scope/name/1.2.3"), { name: "@scope/name", version: "1.2.3" });
  assert.deepEqual(parsePnpmKey("/styled/6.1.0_react@18.2.0"), { name: "styled", version: "6.1.0" });
  // v9: no leading slash
  assert.deepEqual(parsePnpmKey("esbuild@0.21.5"), { name: "esbuild", version: "0.21.5" });
  assert.deepEqual(parsePnpmKey("@scope/name@1.2.3"), { name: "@scope/name", version: "1.2.3" });
});

test("parsePnpmKey returns null on garbage instead of a bogus split", () => {
  assert.equal(parsePnpmKey(""), null);
  assert.equal(parsePnpmKey("no-version"), null);
  assert.equal(parsePnpmKey("@scope/only"), null);
});

test("a v6 lockfile yields exactly the requiresBuild packages, sorted by name", () => {
  const lock = [
    "lockfileVersion: '6.0'",
    "packages:",
    "",
    "  /zzz-native@1.0.0:",
    "    resolution: {integrity: sha512-aaa}",
    "    requiresBuild: true",
    "    dev: false",
    "",
    "  /left-pad@1.3.0:",
    "    resolution: {integrity: sha512-bbb}",
    "    dev: false",
    "",
    "  /bcrypt@5.1.1:",
    "    resolution: {integrity: sha512-ccc}",
    "    requiresBuild: true",
    "",
  ].join("\n");
  const result = parsePnpmLock(lock);
  assert.equal(result.lockfileVersion, "6.0");
  assert.deepEqual(
    result.packages.map((p) => `${p.name}@${p.version}`),
    ["bcrypt@5.1.1", "zzz-native@1.0.0"]
  );
  assert.ok(result.packages.every((p) => p.source === "pnpm-lock"));
  assert.equal(result.warnings.length, 0);
});

test("requiresBuild: false and a missing packages section contribute nothing", () => {
  const explicit = "lockfileVersion: '6.0'\npackages:\n  /a@1.0.0:\n    requiresBuild: false\n";
  assert.equal(parsePnpmLock(explicit).packages.length, 0);
  const missing = "lockfileVersion: '6.0'\nsettings:\n  autoInstallPeers: true\n";
  assert.equal(parsePnpmLock(missing).packages.length, 0);
});

test("a v9 lockfile without requiresBuild warns that node_modules is the source of truth", () => {
  const lock = [
    "lockfileVersion: '9.0'",
    "packages:",
    "  esbuild@0.21.5:",
    "    resolution: {integrity: sha512-aaa}",
  ].join("\n");
  const result = parsePnpmLock(lock);
  assert.equal(result.packages.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("v9.0"), result.warnings[0]);
});

test("quoted scoped keys with requiresBuild survive the YAML layer", () => {
  const lock = [
    "lockfileVersion: '6.0'",
    "packages:",
    "  '/@scope/native@2.0.0':",
    "    requiresBuild: true",
  ].join("\n");
  const result = parsePnpmLock(lock);
  assert.deepEqual(result.packages, [{ name: "@scope/native", version: "2.0.0", source: "pnpm-lock" }]);
});
