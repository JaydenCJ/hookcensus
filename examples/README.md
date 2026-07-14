# Examples

Two small, fully self-contained example projects whose (fake)
dependency trees are committed as `nm-fixture/` directories — the
repository deliberately contains no directory named `node_modules`.
One offline command materializes them:

```bash
node scripts/setup-examples.mjs   # from the repository root
```

`npm test` and `scripts/smoke.sh` run this automatically and both run
against the examples, so the numbers quoted in the main README are
guaranteed to stay accurate.

## webapp — npm flat layout

An npm project whose tree covers every classification path:

| Package | Hook | Classified as | Why |
|---|---|---|---|
| `esbuild@0.21.5` | postinstall | binary-fetch / **allow** | knowledge base: the binary is load-bearing |
| `better-sqlite3@11.3.0` | install | native-build / **allow** | knowledge base + `prebuild-install \|\| node-gyp` |
| `fsevents@2.3.3` | (binding.gyp) | native-build / **allow** | knowledge base |
| `native-keychain@1.4.2` | (binding.gyp) | native-build / **allow** | implicit `node-gyp rebuild`, no script declared |
| `sharp@0.33.4` | — not installed | binary-fetch / **allow** | flagged by package-lock.json `hasInstallScript` |
| `husky@4.3.8` | postinstall | dev-hooks / **deny** | git hooks are a dev-repo concern |
| `core-js@3.38.1` | postinstall | funding / **deny** | banner only — knowledge base beats the opaque command |
| `tiny-notifier@2.0.1` | postinstall | script-run / **review** | opaque `node scripts/setup.js`, a human must read it |

`left-pad` and `@webapp/tokens` are script-free and only count toward the
"9 scanned" total. The root project also declares its own `postinstall`,
which triggers the informational root-scripts note.

## pnpm-app — pnpm store layout, drifted allowlist

A pnpm project with a `.pnpm` store under `node_modules`, a v6
`pnpm-lock.yaml` whose `requiresBuild` flags include a package that is not
installed (`node-sass`), and a `pnpm-workspace.yaml` allowlist written
months ago: `esbuild` is still correct, `left-pad` is stale, and
`better-sqlite3`/`node-sass` were never decided. `hookcensus check` exits 1
and names all three problems.

## Try it

```bash
# from the repository root, after `npm install && npm run build`
node scripts/setup-examples.mjs                    # materialize node_modules
node dist/cli.js list examples/webapp              # the full census table
node dist/cli.js emit pnpm examples/webapp         # ready-to-commit pnpm config
node dist/cli.js check examples/pnpm-app           # exit 1: 2 undecided, 1 stale
node dist/cli.js check examples/pnpm-app --format json
```

The fake packages contain only a `package.json` (plus a `binding.gyp` or a
stub script where the classification needs one) — nothing in these trees
is executable and `npm install` is never run inside them. The materialized
`node_modules` directories are gitignored; edit the `nm-fixture/` trees and
re-run the setup script to change a fixture.
