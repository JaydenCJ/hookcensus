// Classification engine: every rule, the precedence between rules, and the
// stable reasons the CLI output contract depends on.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyPackage, isTrivialCommand, scriptFileOf } from "../dist/index.js";

function classify(hooks, { name = "some-pkg", bindingGyp = false } = {}) {
  return classifyPackage(name, hooks, bindingGyp);
}

test("native toolchains classify as native-build / allow (node-gyp, prebuild-install, node-gyp-build, cargo, go)", () => {
  for (const install of [
    "node-gyp rebuild",
    "prebuild-install || node-gyp rebuild --release",
    "node-gyp-build",
    "cargo build --release",
    "go build ./...",
  ]) {
    const c = classify({ install });
    assert.equal(c.category, "native-build", install);
    assert.equal(c.verdict, "allow", install);
    assert.equal(c.basis, "pattern", install);
  }
});

test("git-hook installers classify as dev-hooks / deny, including raw core.hooksPath", () => {
  for (const postinstall of ["husky install", "simple-git-hooks", "git config core.hooksPath .hooks"]) {
    const c = classify({ postinstall });
    assert.equal(c.category, "dev-hooks", postinstall);
    assert.equal(c.verdict, "deny", postinstall);
  }
});

test("funding banners classify as funding / deny", () => {
  const c = classify({ postinstall: "opencollective-postinstall || true" });
  assert.equal(c.category, "funding");
  assert.equal(c.verdict, "deny");
});

test("patch-package inside a dependency is review, not blind allow", () => {
  const c = classify({ postinstall: "patch-package" });
  assert.equal(c.category, "patch");
  assert.equal(c.verdict, "review");
});

test("trivial hooks (echo, bare node -e console.log) are deny; anything chained is not trivial", () => {
  assert.equal(classify({ postinstall: "echo thanks for installing" }).category, "trivial");
  assert.equal(classify({ postinstall: 'node -e "console.log(1)"' }).category, "trivial");
  assert.equal(classify({ postinstall: "echo hi" }).verdict, "deny");
  // console.log followed by something else must not launder the rest:
  assert.notEqual(classify({ postinstall: 'node -e "console.log(1)" && node steal.js' }).category, "trivial");
  // one trivial + one opaque hook: the pair is not trivial
  assert.notEqual(classify({ preinstall: "echo hi", postinstall: "node setup.js" }).category, "trivial");
});

test("network reach (https URL, curl, wget) flags binary-fetch / review", () => {
  const url = classify({ postinstall: "node get.js https://example.test/blob.tar.gz" });
  assert.equal(url.category, "binary-fetch");
  assert.equal(url.verdict, "review");
  const curl = classify({ install: "curl -o bin.tar.gz $BINARY_HOST && tar xzf bin.tar.gz" });
  assert.equal(curl.category, "binary-fetch");
});

test("node <file>.js falls to script-run / review naming the file; anything else is unknown / review", () => {
  const scripted = classify({ postinstall: "node scripts/setup.js" });
  assert.equal(scripted.category, "script-run");
  assert.equal(scripted.verdict, "review");
  assert.ok(scripted.reason.includes("scripts/setup.js"), scripted.reason);
  const opaque = classify({ postinstall: "frobnicate --now" });
  assert.equal(opaque.category, "unknown");
  assert.equal(opaque.verdict, "review");
  assert.equal(opaque.basis, "fallback");
});

test("known-package table beats command patterns in both directions", () => {
  // core-js's real command would classify as trivial/script-run; the
  // knowledge base knows it is a funding banner.
  const corejs = classify(
    { postinstall: "node -e \"try{require('./postinstall')}catch(e){}\"" },
    { name: "core-js" }
  );
  assert.equal(corejs.category, "funding");
  assert.equal(corejs.basis, "known-package");
  // esbuild's `node install.js` would be script-run/review; the table
  // knows the binary fetch is load-bearing.
  const esbuild = classify({ postinstall: "node install.js" }, { name: "esbuild" });
  assert.equal(esbuild.category, "binary-fetch");
  assert.equal(esbuild.verdict, "allow");
  assert.equal(esbuild.basis, "known-package");
});

test("binding.gyp with no scripts is native-build via the implicit rule; explicit hooks win over it", () => {
  const implicit = classify({}, { bindingGyp: true });
  assert.equal(implicit.category, "native-build");
  assert.equal(implicit.verdict, "allow");
  assert.equal(implicit.basis, "binding-gyp");
  const explicit = classify({ postinstall: "husky install" }, { bindingGyp: true });
  assert.equal(explicit.category, "dev-hooks");
  assert.equal(explicit.basis, "pattern");
});

test("lockfile-only sightings are review with an install hint; matching is case-insensitive", () => {
  const lockOnly = classify({});
  assert.equal(lockOnly.verdict, "review");
  assert.ok(lockOnly.reason.includes("lockfile"), lockOnly.reason);
  assert.equal(classify({ install: "Node-Gyp rebuild" }).category, "native-build");
});

test("isTrivialCommand accepts exit 0/true/:/bare echo and rejects redirection, chaining, backticks", () => {
  for (const cmd of ["exit 0", "true", ":", "echo installed", "  echo ok  "]) {
    assert.equal(isTrivialCommand(cmd), true, cmd);
  }
  for (const cmd of ["echo x > /tmp/f", "echo x && rm -rf /", "echo `whoami`"]) {
    assert.equal(isTrivialCommand(cmd), false, cmd);
  }
});

test("scriptFileOf extracts node and shell script paths, else null", () => {
  assert.equal(scriptFileOf("node install.js"), "install.js");
  assert.equal(scriptFileOf("node --experimental-vm-modules lib/postinstall.mjs"), "lib/postinstall.mjs");
  assert.equal(scriptFileOf("sh scripts/build.sh"), "scripts/build.sh");
  assert.equal(scriptFileOf("make all"), null);
});
