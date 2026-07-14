/**
 * Public programmatic API. Everything the CLI does is reachable from here:
 *
 *   import { takeCensus, renderEmit, computeDrift } from "hookcensus";
 *
 *   const census = takeCensus("./my-app");
 *   const config = renderEmit(census, "pnpm-workspace");
 */

export { classifyPackage, isTrivialCommand, scriptFileOf } from "./classify.js";
export { KNOWN_PACKAGES, lookupKnown, type KnownPackage } from "./known.js";
export { scanNodeModules, extractHooks, type ScanResult } from "./scan.js";
export { parseNpmLock, nameFromLockPath, type NpmLockResult } from "./npmlock.js";
export { parsePnpmLock, parsePnpmKey, type PnpmLockResult } from "./pnpmlock.js";
export { parseYamlite, YamliteError, type YamlValue, type YamlMap } from "./yamlite.js";
export { takeCensus, summarizeByName, IMPLICIT_GYP_COMMAND } from "./census.js";
export {
  readAllowlists,
  computeDrift,
  allowScriptsName,
  type AllowlistConfig,
  type DriftReport,
} from "./allowlist.js";
export {
  planEmit,
  renderEmit,
  writeEmit,
  spliceYamlBlock,
  EMIT_TARGETS,
  type EmitTarget,
  type EmitOptions,
  type EmitPlan,
  type WriteResult,
} from "./emit.js";
export { renderListText, renderListJson, renderCheckText, renderCheckJson, hookNames } from "./report.js";
export { parseArgs, USAGE, type ParsedCommand, type OutputFormat } from "./cliargs.js";
export { VERSION } from "./version.js";
export type {
  Census,
  CensusEntry,
  Classification,
  ClassificationBasis,
  Category,
  HookName,
  LockPackage,
  NameSummary,
  RootHooks,
  ScannedPackage,
  Verdict,
} from "./types.js";
export { HOOK_NAMES, UsageError } from "./types.js";
