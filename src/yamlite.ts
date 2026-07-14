/**
 * yamlite: the tiny YAML subset hookcensus needs to read pnpm files
 * (`pnpm-lock.yaml`, `pnpm-workspace.yaml`) without a dependency.
 *
 * Supported:
 *   - nested block maps (`key: value`, `key:` + indented block);
 *   - block lists of scalars (`- item`);
 *   - single/double-quoted keys and values (pnpm quotes keys like
 *     `'@scope/pkg@1.0.0':`);
 *   - full-line and trailing `#` comments (outside quotes);
 *   - flow collections as opaque scalars: `{integrity: sha512-…}` is kept
 *     as its raw text — hookcensus never looks inside them;
 *   - `true`/`false`/`null` are converted; everything else stays a string.
 *
 * Rejected loudly (with a line number): anchors/aliases, tags, block
 *  scalars (`|`, `>`), multi-document streams, lists of maps. pnpm emits
 * none of these in the sections we read; failing loud beats guessing.
 */

export type YamlValue = string | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

export class YamliteError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`yamlite: ${message} (line ${line})`);
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string; // content with indentation stripped, comments removed
  no: number; // 1-based line number in the source
}

/** Strip a trailing ` # comment` that is not inside quotes. */
function stripTrailingComment(text: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || text[i - 1] === " " || text[i - 1] === "\t")) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

function toLines(source: string): Line[] {
  const lines: Line[] = [];
  const raw = source.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const rawLine = raw[i] ?? "";
    if (rawLine.includes("\t")) throw new YamliteError("tabs are not allowed in indentation or content", i + 1);
    const trimmed = stripTrailingComment(rawLine);
    if (trimmed.trim() === "") continue; // blank or comment-only
    if (trimmed.trim() === "---" || trimmed.trim() === "...") {
      if (lines.length > 0) throw new YamliteError("multi-document streams are not supported", i + 1);
      continue; // a single leading `---` is tolerated
    }
    const indent = rawLine.length - rawLine.trimStart().length;
    lines.push({ indent, text: trimmed.trim(), no: i + 1 });
  }
  return lines;
}

/** Unquote a scalar and convert the YAML core booleans/null. */
function scalar(text: string, no: number): YamlValue {
  const t = text.trim();
  if (t.startsWith("'") || t.startsWith('"')) {
    const quote = t[0] as string;
    if (!t.endsWith(quote) || t.length < 2) throw new YamliteError("unterminated quoted scalar", no);
    const body = t.slice(1, -1);
    return quote === "'" ? body.replace(/''/g, "'") : body.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (t.startsWith("&") || t.startsWith("*")) throw new YamliteError("anchors and aliases are not supported", no);
  if (t.startsWith("!")) throw new YamliteError("tags are not supported", no);
  if (t === "|" || t === ">" || t.startsWith("| ") || t.startsWith("> "))
    throw new YamliteError("block scalars are not supported", no);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  return t; // numbers, versions, flow collections — kept as raw strings
}

/** Split `key: value` at the first unquoted `: ` (or trailing `:`). */
function splitKey(text: string, no: number): { key: string; rest: string } | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ":" && !inSingle && !inDouble) {
      const next = text[i + 1];
      if (next === undefined || next === " ") {
        const rawKey = text.slice(0, i).trim();
        const key = typeof scalar(rawKey, no) === "string" ? (scalar(rawKey, no) as string) : rawKey;
        return { key, rest: text.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function parseBlock(lines: Line[], start: number, indent: number): { value: YamlValue; next: number } {
  const first = lines[start];
  if (first === undefined || first.indent < indent) return { value: {}, next: start };

  if (first.text.startsWith("- ") || first.text === "-") {
    const items: YamlValue[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i] as Line;
      if (line.indent < indent) break;
      if (line.indent > indent) throw new YamliteError("unexpected indentation inside a list", line.no);
      if (!line.text.startsWith("- ") && line.text !== "-")
        throw new YamliteError("expected a `- ` list item", line.no);
      const body = line.text === "-" ? "" : line.text.slice(2).trim();
      if (body === "") throw new YamliteError("empty list items are not supported", line.no);
      if (splitKey(body, line.no) !== null)
        throw new YamliteError("lists of maps are not supported", line.no);
      items.push(scalar(body, line.no));
      i++;
    }
    return { value: items, next: i };
  }

  const map: YamlMap = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamliteError("unexpected indentation", line.no);
    const split = splitKey(line.text, line.no);
    if (split === null) throw new YamliteError("expected a `key: value` mapping", line.no);
    if (split.rest === "") {
      const child = lines[i + 1];
      if (child !== undefined && child.indent > indent) {
        const parsed = parseBlock(lines, i + 1, child.indent);
        map[split.key] = parsed.value;
        i = parsed.next;
      } else {
        map[split.key] = null; // `key:` with nothing under it
        i++;
      }
    } else {
      map[split.key] = scalar(split.rest, line.no);
      i++;
    }
  }
  return { value: map, next: i };
}

/** Parse a yamlite document into plain objects/arrays/scalars. */
export function parseYamlite(source: string): YamlValue {
  const lines = toLines(source);
  if (lines.length === 0) return {};
  const firstIndent = (lines[0] as Line).indent;
  const { value, next } = parseBlock(lines, 0, firstIndent);
  if (next < lines.length) {
    throw new YamliteError("content after the top-level block", (lines[next] as Line).no);
  }
  return value;
}
