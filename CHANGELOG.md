# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `hookcensus list`: a census of every package in the dependency tree that
  can run code at install time — explicit `preinstall`/`install`/
  `postinstall` scripts plus the implicit `node-gyp rebuild` that package
  managers synthesize for a `binding.gyp` with no install script.
- Dual-layout `node_modules` walker: flat/hoisted (npm, yarn classic) and
  pnpm's `.pnpm` store, with realpath-based symlink dedup, nested-version
  recursion and per-copy occurrence counting.
- Lockfile readers that work before anything is installed:
  `package-lock.json` / `npm-shrinkwrap.json` v2/v3 (`hasInstallScript`)
  and `pnpm-lock.yaml` v5/v6 (`requiresBuild`), including a loud
  explanation for v9 lockfiles, which no longer carry the flag.
- Classification engine: every script gets a category (native-build,
  binary-fetch, dev-hooks, funding, patch, trivial, script-run, unknown),
  a verdict (allow / deny / review) and a one-sentence reason; a curated
  knowledge base of 25 widely-used packages overrides command patterns in
  both directions.
- `hookcensus emit`: ready-to-commit configs for four targets —
  `pnpm.onlyBuiltDependencies`/`ignoredBuiltDependencies` in package.json,
  the same lists in pnpm-workspace.yaml (pnpm 10 style),
  `lavamoat.allowScripts` for @lavamoat/allow-scripts on npm, and
  `.npmrc` `ignore-scripts=true` — with `--write` merging into existing
  files and review verdicts excluded unless `--include-review`.
- `hookcensus check`: a CI gate that exits 1 when packages with lifecycle
  scripts are missing from the allowlist config or when configured names
  have gone stale, with `--format json` for scripting.
- Dependency-free YAML subset reader (yamlite) covering exactly what pnpm
  emits, rejecting anchors, tags, block scalars and multi-document streams
  loudly with line numbers.
- Public programmatic API (`takeCensus`, `classifyPackage`, `planEmit`,
  `renderEmit`, `writeEmit`, `computeDrift`, parsers and renderers) with
  type declarations.
- Two bundled example projects (npm flat layout and pnpm store layout,
  one with a deliberately drifted allowlist) used by the README, the test
  suite and the smoke script alike.
- Test suite: 90 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/hookcensus/releases/tag/v0.1.0
