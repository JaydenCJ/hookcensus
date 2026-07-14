#!/usr/bin/env node
/**
 * Materialize the example projects' `node_modules` trees from the
 * checked-in `nm-fixture/` trees (the repository deliberately commits no
 * directory named `node_modules`). Directory components named
 * `nm-fixture` are written out as `node_modules`, and the pnpm-style
 * top-level symlinks into the `.pnpm` store are recreated.
 *
 * Idempotent, offline, zero dependencies. `npm test` and
 * `scripts/smoke.sh` run this automatically; run it by hand before
 * pointing the CLI at `examples/` yourself.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE = "nm-fixture";

/** Copy a fixture tree, renaming every `nm-fixture` dir to `node_modules`. */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name === FIXTURE ? "node_modules" : entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else copyFileSync(from, to);
  }
}

/** Recreate pnpm's `node_modules/<name>` → `.pnpm/<id>/node_modules/<name>` links. */
function linkPnpmStore(nm) {
  const store = join(nm, ".pnpm");
  if (!existsSync(store)) return;
  for (const id of readdirSync(store)) {
    const inner = join(store, id, "node_modules");
    if (!existsSync(inner)) continue;
    for (const top of readdirSync(inner)) {
      const names = top.startsWith("@")
        ? readdirSync(join(inner, top)).map((n) => `${top}/${n}`)
        : [top];
      for (const name of names) {
        const link = join(nm, name);
        rmSync(link, { recursive: true, force: true });
        mkdirSync(dirname(link), { recursive: true });
        symlinkSync(relative(dirname(link), join(inner, name)), link);
      }
    }
  }
}

for (const app of readdirSync(join(ROOT, "examples"), { withFileTypes: true })) {
  if (!app.isDirectory()) continue;
  const fixture = join(ROOT, "examples", app.name, FIXTURE);
  if (!existsSync(fixture)) continue;
  const nm = join(ROOT, "examples", app.name, "node_modules");
  rmSync(nm, { recursive: true, force: true });
  copyTree(fixture, nm);
  linkPnpmStore(nm);
  console.log(`[setup-examples] materialized examples/${app.name}/node_modules`);
}
