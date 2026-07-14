// Renderers: the text table contract and the stable JSON shapes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  renderListText,
  renderListJson,
  renderCheckText,
  renderCheckJson,
  computeDrift,
  readAllowlists,
  takeCensus,
  hookNames,
} from "../dist/index.js";
import { addPackage, addRoot, npmLockV3, tempProject, writeFile } from "./helpers.mjs";

function project() {
  const root = tempProject();
  addRoot(root, { scripts: { postinstall: "node scripts/setup.js" } });
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  addPackage(root, "echoer", { scripts: { postinstall: "echo hi" } });
  writeFile(root, "package-lock.json", npmLockV3({
    "node_modules/echoer": { version: "1.0.0", hasInstallScript: true },
    "node_modules/gypper": { version: "1.0.0", hasInstallScript: true },
    "node_modules/phantom": { version: "9.9.9", hasInstallScript: true },
  }));
  return root;
}

test("list text: header counts, verdict rows, summary line and root note", () => {
  const out = renderListText(takeCensus(project()));
  assert.match(out, /3 package\(s\) with lifecycle scripts out of 2 scanned/);
  assert.match(out, /lockfiles read: package-lock\.json/);
  assert.match(out, /ALLOW\s+gypper@1\.0\.0\s+install\s+native-build/);
  assert.match(out, /DENY\s+echoer@1\.0\.0\s+postinstall\s+trivial/);
  assert.match(out, /REVIEW\s+phantom@9\.9\.9\s+\(lockfile\)/);
  assert.match(out, /\(not installed\)/);
  assert.match(out, /allow 1 · deny 1 · review 1/);
  assert.match(out, /note: the root project \(fixture-app\) declares postinstall/);
});

test("list text: an empty census says so explicitly", () => {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "plain", {});
  const out = renderListText(takeCensus(root));
  assert.match(out, /No dependency in this tree declares an install-time lifecycle script\./);
});

test("list json: stable keys and one object per census entry", () => {
  const parsed = JSON.parse(renderListJson(takeCensus(project())));
  assert.equal(parsed.scanned, 2);
  assert.equal(parsed.packages.length, 3);
  const gypper = parsed.packages.find((p) => p.name === "gypper");
  assert.deepEqual(Object.keys(gypper), [
    "name", "version", "hooks", "installed", "sources", "bindingGyp", "category", "verdict", "reason", "basis",
  ]);
  assert.equal(gypper.verdict, "allow");
  assert.deepEqual(parsed.summary, { allow: 1, deny: 1, review: 1 });
});

test("check text: clean runs report OK; a missing config points at emit", () => {
  const covered = project();
  addRoot(covered, { pnpm: { onlyBuiltDependencies: ["gypper", "phantom"], ignoredBuiltDependencies: ["echoer"] } });
  const cleanCensus = takeCensus(covered);
  const ok = renderCheckText(cleanCensus, computeDrift(cleanCensus, readAllowlists(covered)));
  assert.match(ok, /hookcensus check: OK — 3 package\(s\) with lifecycle scripts, all decided by config\./);

  const bare = project();
  const bareCensus = takeCensus(bare);
  const fail = renderCheckText(bareCensus, computeDrift(bareCensus, readAllowlists(bare)));
  assert.match(fail, /FAIL — 3 package\(s\) can run install scripts but no allowlist config exists/);
  assert.match(fail, /hookcensus emit pnpm/);
});

test("check text: drift lists undecided (with suggested verdict) and stale sections", () => {
  const root = project();
  addRoot(root, { pnpm: { onlyBuiltDependencies: ["gypper", "ghost"] } });
  const census = takeCensus(root);
  const out = renderCheckText(census, computeDrift(census, readAllowlists(root)));
  assert.match(out, /undecided \(2\)/);
  assert.match(out, /echoer \(1\.0\.0\) — suggested verdict: deny/);
  assert.match(out, /stale \(1\)/);
  assert.match(out, /^ {2}ghost$/m);
});

test("check json: ok flag and covered/uncovered/stale arrays; hookNames formats hooks", () => {
  const root = project();
  addRoot(root, { pnpm: { onlyBuiltDependencies: ["gypper", "ghost"] } });
  const census = takeCensus(root);
  const parsed = JSON.parse(renderCheckJson(census, computeDrift(census, readAllowlists(root))));
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.covered, ["gypper"]);
  assert.deepEqual(parsed.stale, ["ghost"]);
  assert.deepEqual(parsed.uncovered.map((u) => u.name), ["echoer", "phantom"]);
  assert.equal(parsed.uncovered[0].suggested, "deny");

  assert.equal(hookNames({ hooks: { postinstall: "b", preinstall: "a" } }), "preinstall,postinstall");
  assert.equal(hookNames({ hooks: {} }), "(lockfile)");
});
