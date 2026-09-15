export type WhitespaceMode = "none" | "trailing" | "all";

export interface CompareOptions {
  ignoreCase: boolean;
  whitespace: WhitespaceMode;
  ignoreBlankLines: boolean;
}

export const defaultOptions: CompareOptions = Object.freeze({
  ignoreCase: false,
  whitespace: "none",
  ignoreBlankLines: false,
}) as CompareOptions;

export interface LineInfo {
  /** Line content without the line break (and without a trailing \r). */
  text: string;
  /** Offset of the first character of the line. */
  start: number;
  /** Offset just past the line content (before \r\n or \n). */
  end: number;
}

export function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    const stop = nl === -1 ? text.length : nl;
    const end = stop > start && text.charCodeAt(stop - 1) === 13 ? stop - 1 : stop;
    lines.push({ text: text.slice(start, end), start, end });
    if (nl === -1) return lines;
    start = nl + 1;
  }
}

export function normalizeLine(line: string, opts: CompareOptions): string {
  let s = line;
  if (opts.whitespace === "all") s = s.replace(/\s+/g, "");
  else if (opts.whitespace === "trailing") s = s.replace(/\s+$/, "");
  if (opts.ignoreCase) s = s.toLowerCase();
  return s;
}

export function isBlank(line: string): boolean {
  return line.trim() === "";
}

export function hasActiveOptions(opts: CompareOptions): boolean {
  return opts.ignoreCase || opts.whitespace !== "none" || opts.ignoreBlankLines;
}

export function sanitizeOptions(value: unknown): CompareOptions {
  const v = (value ?? {}) as Partial<CompareOptions>;
  return {
    ignoreCase: v.ignoreCase === true,
    whitespace: v.whitespace === "trailing" || v.whitespace === "all" ? v.whitespace : "none",
    ignoreBlankLines: v.ignoreBlankLines === true,
  };
}
