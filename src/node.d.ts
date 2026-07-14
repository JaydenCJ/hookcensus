/**
 * Minimal ambient declarations for the Node.js built-ins this project
 * uses. Declaring them in-repo keeps `typescript` the only devDependency
 * (no `@types/node`); the surface is restricted to exactly what `src/`
 * calls, so a typo against a real Node API still fails to compile.
 */

declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
  }
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): Stats;
  export function realpathSync(path: string): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...parts: string[]): string;
}

declare var process: {
  argv: string[];
  cwd(): string;
  exitCode: number | undefined;
  exit(code?: number): never;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  env: Record<string, string | undefined>;
};
