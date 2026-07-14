#!/usr/bin/env bash
# Smoke test for hookcensus: exercises the real CLI end to end against the
# bundled example projects and a freshly built temp project. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent) and materialize the examples' node_modules trees
#    from the committed nm-fixture trees.
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
node "$ROOT/scripts/setup-examples.mjs" >/dev/null || fail "example setup failed"
echo "[smoke] build ok, examples materialized"

# 2. --version matches package.json; --help documents commands and targets.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in list emit check pnpm-workspace allow-scripts npmrc --include-review --write; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from check's drift exit 1).
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI list "$WORKDIR/missing" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing dir should exit 2"; }
$CLI emit yarn >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown target should exit 2"; }
set -e
echo "[smoke] usage errors ok (exit 2)"

# 4. The bundled webapp census matches its documented numbers.
LIST_OUT="$($CLI list examples/webapp)" || fail "list webapp failed"
echo "$LIST_OUT" | grep -q '8 package(s) with lifecycle scripts out of 9 scanned' || fail "webapp census counts wrong"
echo "$LIST_OUT" | grep -q 'allow 5 · deny 2 · review 1' || fail "webapp verdict summary wrong"
echo "$LIST_OUT" | grep -Eq 'ALLOW +native-keychain@1\.4\.2 +install +native-build' || fail "implicit binding.gyp row missing"
echo "$LIST_OUT" | grep -q '(not installed)' || fail "lock-only sharp marker missing"
echo "$LIST_OUT" | grep -q 'note: the root project (webapp)' || fail "root-script note missing"
echo "[smoke] webapp census ok (8 of 9, 5/2/1)"

# 5. JSON output is valid and consistent with the text run.
$CLI list examples/webapp --format json | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const doc = JSON.parse(s);
    if (doc.packages.length !== 8) throw new Error("expected 8 packages");
    if (doc.summary.allow !== 5) throw new Error("expected 5 allows");
  });
' || fail "list --format json invalid or inconsistent"
echo "[smoke] JSON output ok"

# 6. The pnpm example: .pnpm layout + v6 lockfile + drifted workspace allowlist.
set +e
CHECK_OUT="$($CLI check examples/pnpm-app)"; CHECK_CODE=$?
set -e
[ "$CHECK_CODE" -eq 1 ] || fail "pnpm-app check should exit 1, got $CHECK_CODE"
echo "$CHECK_OUT" | grep -q 'undecided (2)' || fail "pnpm-app should have 2 undecided"
echo "$CHECK_OUT" | grep -q 'better-sqlite3 (11.3.0) — suggested verdict: allow' || fail "missing better-sqlite3 suggestion"
echo "$CHECK_OUT" | grep -q 'stale (1)' || fail "pnpm-app should have 1 stale entry"
echo "$CHECK_OUT" | grep -q 'left-pad' || fail "stale left-pad not named"
echo "[smoke] pnpm drift detection ok (2 undecided, 1 stale)"

# 7. emit renders ready-to-commit configs with review packages excluded.
EMIT_OUT="$($CLI emit pnpm examples/webapp 2>/dev/null)"
echo "$EMIT_OUT" | grep -q '"onlyBuiltDependencies"' || fail "emit pnpm missing allowlist"
echo "$EMIT_OUT" | grep -q '"esbuild"' || fail "emit pnpm missing esbuild"
echo "$EMIT_OUT" | grep -q '"husky"' || fail "emit pnpm missing husky denial"
echo "$EMIT_OUT" | grep -q 'tiny-notifier' && fail "review package leaked into the allowlist"
$CLI emit pnpm examples/webapp --include-review 2>/dev/null | grep -q 'tiny-notifier' \
  || fail "--include-review should include tiny-notifier"
echo "[smoke] emit policy ok (review excluded by default)"

# 8. Full loop in a temp project: census → emit --write → check goes green.
mkdir -p "$WORKDIR/app/node_modules/sqlite-native" "$WORKDIR/app/node_modules/banner"
cat > "$WORKDIR/app/package.json" <<'EOF'
{ "name": "app", "version": "1.0.0", "private": true }
EOF
cat > "$WORKDIR/app/node_modules/sqlite-native/package.json" <<'EOF'
{ "name": "sqlite-native", "version": "1.0.0", "scripts": { "install": "node-gyp rebuild" } }
EOF
cat > "$WORKDIR/app/node_modules/banner/package.json" <<'EOF'
{ "name": "banner", "version": "1.0.0", "scripts": { "postinstall": "echo thanks" } }
EOF
set +e
$CLI check "$WORKDIR/app" >/dev/null; PRE_CODE=$?
set -e
[ "$PRE_CODE" -eq 1 ] || fail "unconfigured app should exit 1, got $PRE_CODE"
$CLI emit pnpm-workspace "$WORKDIR/app" --write >/dev/null || fail "emit --write failed"
grep -q 'onlyBuiltDependencies:' "$WORKDIR/app/pnpm-workspace.yaml" || fail "workspace yaml not written"
$CLI check "$WORKDIR/app" >/dev/null || fail "check should pass after emit --write"
echo "[smoke] emit --write closes the loop (check exits 0)"

# 9. npmrc target creates the global switch idempotently.
$CLI emit npmrc "$WORKDIR/app" --write >/dev/null || fail "emit npmrc --write failed"
$CLI emit npmrc "$WORKDIR/app" --write >/dev/null || fail "second emit npmrc --write failed"
[ "$(grep -c '^ignore-scripts=true$' "$WORKDIR/app/.npmrc")" -eq 1 ] || fail ".npmrc not idempotent"
echo "[smoke] npmrc target ok"

# 10. Determinism: two census runs over the same tree are byte-identical.
$CLI list examples/webapp > "$WORKDIR/run1.txt"
$CLI list examples/webapp > "$WORKDIR/run2.txt"
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
