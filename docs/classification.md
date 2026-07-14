# How hookcensus classifies a lifecycle script

Every census entry gets three things: a **category** (what the script
appears to do), a **verdict** (what hookcensus recommends), and a
one-sentence **reason**. The reason strings are stable output contract —
tests pin them, scripts may grep them.

## Scope: which hooks count

Only the three hooks that run when a *dependency* is installed from a
registry — the ones `ignore-scripts` and pnpm's build allowlists gate:

| Hook | Runs |
|---|---|
| `preinstall` | before the package's dependencies are installed |
| `install` | after the package is placed; synthesized as `node-gyp rebuild` when a `binding.gyp` exists and no install script is declared |
| `postinstall` | after install completes |

`prepare`, `prepack` and friends never run for registry dependencies, so
they are deliberately out of scope. The **root project's own** hooks are
reported as a note, never as census rows: pnpm's allowlist does not gate
them, while npm's `ignore-scripts=true` blocks them too — a difference
worth knowing before committing an `.npmrc`.

## Rule precedence

1. **Knowledge base** (`src/known.ts`) — 25 widely-used packages whose
   script behavior is stable and documented. A table hit beats every
   pattern, in both directions: esbuild's opaque `node install.js` is
   *allow* because the binary is load-bearing; core-js's opaque `node -e`
   is *deny* because it only prints a banner.
2. **Command patterns** over the declared hook text (case-insensitive):

   | Category | Verdict | Triggered by |
   |---|---|---|
   | `native-build` | allow | `node-gyp`, `node-gyp-build`, `node-pre-gyp`, `prebuild-install`, `prebuildify`, `cmake-js`, `node-waf`, `neon build`, `napi build`, `cargo build`, `go build` |
   | `dev-hooks` | deny | `husky`, `simple-git-hooks`, `lefthook`, `git config core.hooksPath` |
   | `funding` | deny | `opencollective`, `patreon`, donation/funding wording |
   | `patch` | review | `patch-package` (verify what a *dependency* patches) |
   | `trivial` | deny | every hook is `echo …`, `exit 0`, `true`, `:` or a bare `node -e "console.log(…)"` |
   | `binary-fetch` | review | an `http(s)://` URL, `curl`, `wget`, or `download` in the command |
   | `script-run` | review | `node <file>.js` / `sh <file>.sh` — the reason names the file to read |
   | `unknown` | review | nothing recognizable |

3. **binding.gyp, no install script** — `native-build` / allow, because
   npm and pnpm synthesize `node-gyp rebuild` for it; the census shows the
   implicit command explicitly.
4. **Lockfile-only sighting** — the lockfile says "has install scripts"
   but the package is not on disk, so there is no command to analyze:
   `unknown` / review, unless the knowledge base already knows the name.

## The one deliberate bias

hookcensus never guesses in the allow direction. Patterns only produce
`allow` for native build toolchains, where blocking the script is
guaranteed breakage; everything uncertain is `review`, and review packages
stay **out** of emitted allowlists unless you pass `--include-review` —
an allowlist should never contain a package nobody looked at.

When two installed versions of the same package disagree (a maintainer
added or removed a script between releases), the per-name verdict used by
`emit` and `check` degrades to `review` so a human resolves it.
