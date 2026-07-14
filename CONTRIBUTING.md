# Contributing to hookcensus

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what a
lifecycle script does before it tells you to allow it.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/hookcensus.git
cd hookcensus
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (list, emit, check, exit codes,
--write round-trips, both installer layouts, determinism) against the
bundled example projects and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (classification, lockfile parsing, drift and emit all take
   values, not file handles — only the CLI and walkers touch the
   filesystem).
5. Knowledge-base additions (`src/known.ts`) need a one-sentence reason
   stating what the script does for that package, and a test.

## Ground rules

- **No runtime dependencies.** A tool you run before deciding what may
  execute on your machine must not widen your attack surface itself;
  adding a dependency needs justification in the PR and will usually be
  declined.
- No network calls, ever — hookcensus reads local files and prints. That
  is the whole I/O surface.
- Never guess in the allow direction: when classification is uncertain the
  verdict is `review`, and review packages stay out of emitted allowlists
  by default.
- Verdict reasons are part of the output contract; change them
  deliberately and update the tests that pin them.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `hookcensus --version` output, the exact command line, and
the smallest tree that reproduces the problem — one package.json under a
throwaway `node_modules/` (or a lockfile fragment) is usually enough. If a
classification is wrong, say what the script actually does so the fix can
land in the knowledge base with an accurate reason.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
