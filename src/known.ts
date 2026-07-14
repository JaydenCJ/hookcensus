/**
 * Curated knowledge base for widely-used packages whose lifecycle scripts
 * are well understood. A table hit beats every pattern rule: the reason can
 * then say *why* the package needs (or does not need) its script, not just
 * what the command looks like.
 *
 * Ground rules for entries:
 *   - only packages whose install-script behavior is stable and documented;
 *   - reasons state what the script does for THIS package, in one sentence;
 *   - when a maintainer removes the script in a later major, the entry is
 *     harmless — classification only applies to packages that actually
 *     declare hooks (or ship a binding.gyp).
 */

import type { Category, Verdict } from "./types.js";

export interface KnownPackage {
  category: Category;
  verdict: Verdict;
  reason: string;
}

export const KNOWN_PACKAGES: Readonly<Record<string, KnownPackage>> = {
  // ---- native addons: broken without their build/fetch step -------------
  "better-sqlite3": {
    category: "native-build",
    verdict: "allow",
    reason: "fetches or compiles the SQLite native addon; the module cannot load without it",
  },
  bcrypt: {
    category: "native-build",
    verdict: "allow",
    reason: "builds the bcrypt native addon via node-pre-gyp; required to hash anything",
  },
  sqlite3: {
    category: "native-build",
    verdict: "allow",
    reason: "downloads a prebuilt SQLite binding or compiles one; required at require() time",
  },
  canvas: {
    category: "native-build",
    verdict: "allow",
    reason: "installs the Cairo-backed native addon; the package is a binding and does nothing without it",
  },
  argon2: {
    category: "native-build",
    verdict: "allow",
    reason: "builds the argon2 native addon; password hashing fails without it",
  },
  bufferutil: {
    category: "native-build",
    verdict: "allow",
    reason: "optional ws speedup addon; harmless to allow, ws falls back to JS if the build fails",
  },
  "utf-8-validate": {
    category: "native-build",
    verdict: "allow",
    reason: "optional ws speedup addon; harmless to allow, ws falls back to JS if the build fails",
  },
  fsevents: {
    category: "native-build",
    verdict: "allow",
    reason: "macOS file-watching addon (binding.gyp); watch tooling degrades to polling without it",
  },
  re2: {
    category: "native-build",
    verdict: "allow",
    reason: "builds the RE2 regex engine binding; the package is unusable without it",
  },
  "cpu-features": {
    category: "native-build",
    verdict: "allow",
    reason: "optional native probe used by ssh2; failure is tolerated at runtime",
  },
  "node-sass": {
    category: "native-build",
    verdict: "allow",
    reason: "downloads or builds the libsass binding; deprecated upstream — consider migrating to sass",
  },
  "@swc/core": {
    category: "native-build",
    verdict: "allow",
    reason: "verifies and, if missing, obtains the platform-specific SWC binding",
  },
  "dtrace-provider": {
    category: "native-build",
    verdict: "allow",
    reason: "optional tracing addon; its build is wrapped so failure never breaks the install",
  },

  // ---- binary/engine downloads: the package is a shim around them -------
  esbuild: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "puts the platform esbuild binary in place; the JS API shells out to it for every build",
  },
  sharp: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "fetches the prebuilt libvips binary (or builds from source); image ops need it",
  },
  prisma: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "downloads the Prisma engines the CLI and client call into",
  },
  "@prisma/engines": {
    category: "binary-fetch",
    verdict: "allow",
    reason: "downloads the query and migration engine binaries used by @prisma/client",
  },
  "sass-embedded": {
    category: "binary-fetch",
    verdict: "allow",
    reason: "installs the embedded Dart Sass host binary the JS API talks to",
  },
  playwright: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "downloads the browsers it drives; opt out via PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD if you manage them",
  },
  puppeteer: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "downloads the pinned Chrome build it automates; opt out via PUPPETEER_SKIP_DOWNLOAD",
  },
  cypress: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "installs the Cypress app binary into its cache; the test runner is that binary",
  },
  electron: {
    category: "binary-fetch",
    verdict: "allow",
    reason: "downloads the Electron runtime for this platform; the npm package is only a wrapper",
  },

  // ---- scripts that do nothing for consumers -----------------------------
  husky: {
    category: "dev-hooks",
    verdict: "deny",
    reason: "installs git hooks — meaningful only inside husky's own checkout, never as your dependency",
  },
  "core-js": {
    category: "funding",
    verdict: "deny",
    reason: "the postinstall only prints a funding banner; polyfills work identically without it",
  },
  "core-js-pure": {
    category: "funding",
    verdict: "deny",
    reason: "the postinstall only prints a funding banner; polyfills work identically without it",
  },
};

/** Look up a package by exact name. */
export function lookupKnown(name: string): KnownPackage | undefined {
  return Object.prototype.hasOwnProperty.call(KNOWN_PACKAGES, name)
    ? KNOWN_PACKAGES[name]
    : undefined;
}
