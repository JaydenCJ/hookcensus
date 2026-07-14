// Shared factories for the suite. Everything is deterministic: fixtures are
// built in fresh temp dirs, and no test touches the network or the clock.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fresh temp project directory; the OS cleans tmpdir, tests never reuse one. */
export function tempProject() {
  return mkdtempSync(join(tmpdir(), "hookcensus-test-"));
}

/** Write a file (creating parents), path segments relative to `root`. */
export function writeFile(root, relPath, content) {
  const path = join(root, ...relPath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  return path;
}

/** Drop a package.json (and optional extra files) under node_modules. */
export function addPackage(root, name, manifest, extraFiles = {}) {
  const dir = `node_modules/${name}`;
  writeFile(root, `${dir}/package.json`, { name, version: "1.0.0", ...manifest });
  for (const [rel, content] of Object.entries(extraFiles)) {
    writeFile(root, `${dir}/${rel}`, content);
  }
}

/** A minimal root package.json so takeCensus accepts the directory. */
export function addRoot(root, manifest = {}) {
  writeFile(root, "package.json", { name: "fixture-app", version: "1.0.0", private: true, ...manifest });
}

/** A v3 package-lock with the given `packages` map merged over the root entry. */
export function npmLockV3(packages) {
  return JSON.stringify({
    name: "fixture-app",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "fixture-app", version: "1.0.0" }, ...packages },
  });
}
