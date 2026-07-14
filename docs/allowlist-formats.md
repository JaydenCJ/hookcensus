# Allowlist formats hookcensus reads and writes

Four mechanisms exist in the wild for deciding which dependencies may run
install scripts. `hookcensus emit` generates each of them; `hookcensus
check` reads all of them (merged) when computing drift.

## pnpm ≥ 10: `onlyBuiltDependencies`

pnpm 10 skips dependency build scripts by default and warns about them.
The allowlist lives either in **pnpm-workspace.yaml** (preferred, also
used by single-package projects for config):

```yaml
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
ignoredBuiltDependencies:
  - core-js
  - husky
```

…or under **`pnpm`** in package.json (`emit pnpm` target). Names on
`ignoredBuiltDependencies` (and the older `neverBuiltDependencies`, which
hookcensus also reads) are deliberate denials: they silence pnpm's
"ignored build scripts" warning, which is why `emit` writes deny verdicts
there instead of just omitting them.

## npm: `.npmrc` + @lavamoat/allow-scripts

npm has no built-in per-package allowlist, so the established pattern is
two files. First the global switch (`emit npmrc` target):

```ini
ignore-scripts=true
```

Note the asymmetry with pnpm: this also disables **your own project's**
scripts on `npm install`, including the root `postinstall` — hookcensus
prints a note when your root manifest declares one. Then
[@lavamoat/allow-scripts](https://github.com/LavaMoat/LavaMoat) re-runs
exactly the approved set from package.json (`emit allow-scripts` target):

```json
{
  "lavamoat": {
    "allowScripts": {
      "better-sqlite3": true,
      "husky": false
    }
  }
}
```

When reading existing config, path-style keys (`app>keccak`) are matched
by their final segment.

## What `check` considers covered

A package name is *decided* when it appears on any allow **or** deny list
above. `check` fails (exit 1) on:

- **undecided** — a package with lifecycle scripts that no config
  mentions (new dependency, or a dependency that grew a script in an
  update — the exact shape of a worm-style compromise);
- **stale** — a configured name with no scripts left in the tree (removed
  dependency, or a script dropped upstream): dead entries are latent
  allowances and belong deleted.

An `ignore-scripts=true` alone blocks everything but decides nothing
per-package, so undecided packages still fail the check — by design: the
point is a reviewed decision for every name, not a global off switch you
forgot the contents of.
