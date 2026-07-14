// yamlite: the YAML subset used for pnpm files. Tests pin down both what it
// accepts (everything pnpm emits in the sections we read) and what it
// rejects loudly (YAML features that would otherwise be silently mangled).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseYamlite, YamliteError } from "../dist/index.js";

test("flat and nested block maps by indentation", () => {
  assert.deepEqual(parseYamlite("a: 1\nb: two\n"), { a: "1", b: "two" });
  const doc = parseYamlite("settings:\n  autoInstallPeers: true\n  depth: 2\ntop: yes\n");
  assert.deepEqual(doc, { settings: { autoInstallPeers: true, depth: "2" }, top: "yes" });
});

test("block lists of scalars and quoted keys (pnpm quotes keys containing @)", () => {
  const list = parseYamlite("onlyBuiltDependencies:\n  - esbuild\n  - '@scope/pkg'\n");
  assert.deepEqual(list, { onlyBuiltDependencies: ["esbuild", "@scope/pkg"] });
  const quoted = parseYamlite("'@scope/name@1.2.3':\n  requiresBuild: true\n");
  assert.deepEqual(quoted, { "@scope/name@1.2.3": { requiresBuild: true } });
});

test("scalar conversion: booleans and null convert, version strings stay strings, '' escapes", () => {
  const doc = parseYamlite("a: true\nb: false\nc: null\nd: ~\ne: 6.0\n");
  assert.deepEqual(doc, { a: true, b: false, c: null, d: null, e: "6.0" });
  assert.deepEqual(parseYamlite("k: 'it''s'\n"), { k: "it's" });
});

test("comments: full-line and trailing stripped, # inside quotes preserved", () => {
  const doc = parseYamlite("# header\na: 1 # trailing\nb: 'kept # inside'\n");
  assert.deepEqual(doc, { a: "1", b: "kept # inside" });
});

test("flow collections stay opaque strings; empty values are null; leading --- tolerated", () => {
  assert.deepEqual(parseYamlite("resolution: {integrity: sha512-abc}\n"), {
    resolution: "{integrity: sha512-abc}",
  });
  assert.deepEqual(parseYamlite("packages:\n\ntop: 1\n"), { packages: null, top: "1" });
  assert.deepEqual(parseYamlite("---\na: 1\n"), { a: "1" });
});

test("anchors, aliases and tags are rejected with a line number", () => {
  assert.throws(() => parseYamlite("a: &anchor 1\n"), YamliteError);
  assert.throws(() => parseYamlite("a: *ref\n"), YamliteError);
  assert.throws(() => parseYamlite("a: !!str 1\n"), (err) => err instanceof YamliteError && err.line === 1);
});

test("block scalars, multi-document streams, lists of maps and tabs are rejected", () => {
  assert.throws(() => parseYamlite("a: |\n  text\n"), YamliteError);
  assert.throws(() => parseYamlite("a: 1\n---\nb: 2\n"), /multi-document/);
  assert.throws(() => parseYamlite("items:\n  - key: value\n"), /lists of maps/);
  assert.throws(() => parseYamlite("a:\n\tb: 1\n"), /tabs/);
});

test("empty or comment-only input parses to an empty map", () => {
  assert.deepEqual(parseYamlite(""), {});
  assert.deepEqual(parseYamlite("# only comments\n\n"), {});
});
