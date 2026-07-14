// Config generators: every target's rendered shape, the review-exclusion
// policy, and --write merge behavior against existing files.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planEmit, renderEmit, writeEmit, spliceYamlBlock, takeCensus, parseYamlite } from "../dist/index.js";
import { addPackage, addRoot, tempProject, writeFile } from "./helpers.mjs";

/** A project with one allow (native), one deny (echo), one review (opaque script). */
function mixedProject() {
  const root = tempProject();
  addRoot(root);
  addPackage(root, "gypper", { scripts: { install: "node-gyp rebuild" } });
  addPackage(root, "echoer", { scripts: { postinstall: "echo hi" } });
  addPackage(root, "opaque", { scripts: { postinstall: "node setup.js" } });
  return root;
}

test("planEmit splits allow/deny and excludes review unless --include-review", () => {
  const census = takeCensus(mixedProject());
  const plan = planEmit(census);
  assert.deepEqual(plan.allowed, ["gypper"]);
  assert.deepEqual(plan.denied, ["echoer"]);
  assert.deepEqual(plan.excluded, ["opaque"]);
  const promoted = planEmit(census, { includeReview: true });
  assert.deepEqual(promoted.allowed, ["gypper", "opaque"]);
  assert.deepEqual(promoted.excluded, []);
});

test("renderEmit pnpm produces a mergeable package.json fragment and omits empty lists", () => {
  const out = renderEmit(takeCensus(mixedProject()), "pnpm");
  assert.deepEqual(JSON.parse(out), {
    pnpm: { onlyBuiltDependencies: ["gypper"], ignoredBuiltDependencies: ["echoer"] },
  });
  assert.ok(out.endsWith("\n"));

  const denyOnly = tempProject();
  addRoot(denyOnly);
  addPackage(denyOnly, "echoer", { scripts: { postinstall: "echo hi" } });
  assert.deepEqual(JSON.parse(renderEmit(takeCensus(denyOnly), "pnpm")), {
    pnpm: { ignoredBuiltDependencies: ["echoer"] },
  });
});

test("renderEmit pnpm-workspace produces the two YAML lists (round-trips through yamlite)", () => {
  const out = renderEmit(takeCensus(mixedProject()), "pnpm-workspace");
  assert.equal(out, "onlyBuiltDependencies:\n  - gypper\nignoredBuiltDependencies:\n  - echoer\n");
  assert.deepEqual(parseYamlite(out).onlyBuiltDependencies, ["gypper"]);
});

test("renderEmit allow-scripts maps allow→true / deny→false; npmrc is the global switch", () => {
  const census = takeCensus(mixedProject());
  assert.deepEqual(JSON.parse(renderEmit(census, "allow-scripts")), {
    lavamoat: { allowScripts: { gypper: true, echoer: false } },
  });
  assert.equal(renderEmit(census, "npmrc"), "ignore-scripts=true\n");
});

test("writeEmit pnpm merges into package.json preserving unrelated fields", () => {
  const root = mixedProject();
  addRoot(root, { description: "keep me", pnpm: { overrides: { lodash: "4.17.21" } } });
  const result = writeEmit(root, takeCensus(root), "pnpm");
  assert.equal(result.file, "package.json");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.description, "keep me");
  assert.deepEqual(manifest.pnpm.overrides, { lodash: "4.17.21" });
  assert.deepEqual(manifest.pnpm.onlyBuiltDependencies, ["gypper"]);
  assert.deepEqual(manifest.pnpm.ignoredBuiltDependencies, ["echoer"]);
});

test("writeEmit allow-scripts replaces the allowScripts map wholesale", () => {
  const root = mixedProject();
  addRoot(root, { lavamoat: { allowScripts: { stale: true } } });
  writeEmit(root, takeCensus(root), "allow-scripts");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.lavamoat.allowScripts, { gypper: true, echoer: false });
});

test("writeEmit pnpm-workspace creates the file when absent, replaces blocks and keeps other keys", () => {
  const fresh = mixedProject();
  const created = writeEmit(fresh, takeCensus(fresh), "pnpm-workspace");
  assert.equal(created.action, "created");
  const freshDoc = parseYamlite(readFileSync(join(fresh, "pnpm-workspace.yaml"), "utf8"));
  assert.deepEqual(freshDoc.onlyBuiltDependencies, ["gypper"]);
  assert.deepEqual(freshDoc.ignoredBuiltDependencies, ["echoer"]);

  const existing = mixedProject();
  writeFile(existing, "pnpm-workspace.yaml", [
    "packages:",
    "  - apps/*",
    "onlyBuiltDependencies:",
    "  - stale-entry",
    "  - another-stale",
    "linkWorkspacePackages: true",
  ].join("\n"));
  const updated = writeEmit(existing, takeCensus(existing), "pnpm-workspace");
  assert.equal(updated.action, "updated");
  const doc = parseYamlite(readFileSync(join(existing, "pnpm-workspace.yaml"), "utf8"));
  assert.deepEqual(doc.packages, ["apps/*"]);
  assert.equal(doc.linkWorkspacePackages, true);
  assert.deepEqual(doc.onlyBuiltDependencies, ["gypper"]);
});

test("writeEmit npmrc creates, replaces an existing ignore-scripts line, and is idempotent", () => {
  const root = mixedProject();
  const created = writeEmit(root, takeCensus(root), "npmrc");
  assert.equal(created.action, "created");
  assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), "ignore-scripts=true\n");

  writeFile(root, ".npmrc", "save-exact=true\nignore-scripts=false\n");
  writeEmit(root, takeCensus(root), "npmrc");
  const updated = readFileSync(join(root, ".npmrc"), "utf8");
  assert.ok(updated.includes("save-exact=true"));
  assert.ok(updated.includes("ignore-scripts=true"));
  assert.ok(!updated.includes("ignore-scripts=false"));

  writeEmit(root, takeCensus(root), "npmrc");
  assert.equal(readFileSync(join(root, ".npmrc"), "utf8"), updated);
});

test("spliceYamlBlock appends when the key is missing and replaces in place otherwise", () => {
  const appended = spliceYamlBlock("packages:\n  - .\n", "onlyBuiltDependencies", "onlyBuiltDependencies:\n  - a");
  assert.equal(appended, "packages:\n  - .\nonlyBuiltDependencies:\n  - a\n");
  const replaced = spliceYamlBlock(
    "onlyBuiltDependencies:\n  - old\nother: 1",
    "onlyBuiltDependencies",
    "onlyBuiltDependencies:\n  - new"
  );
  assert.equal(replaced, "onlyBuiltDependencies:\n  - new\nother: 1");
});

test("writeEmit pnpm without a package.json is a usage error", () => {
  const root = tempProject();
  writeFile(root, "node_modules/hooky/package.json", {
    name: "hooky",
    version: "1.0.0",
    scripts: { postinstall: "echo hi" },
  });
  const census = takeCensus(root);
  assert.throws(() => writeEmit(root, census, "pnpm"), /no package\.json/);
});
