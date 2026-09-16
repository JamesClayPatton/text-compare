import { Change, diff } from "@codemirror/merge";
import { diffLineArrays } from "./diff-core";
import { type CompareOptions, type LineInfo, splitLines } from "./normalize";

/**
 * A diff function for CodeMirror's merge views that honours the comparison
 * options: lines are matched on their normalized form, and only lines that
 * still differ get character-level changes.
 */
export function makeDiffOverride(opts: CompareOptions): (a: string, b: string) => readonly Change[] {
  return (a, b) => {
    const la = splitLines(a), lb = splitLines(b);
    const ops = diffLineArrays(la.map((l) => l.text), lb.map((l) => l.text), opts);
    const out: Change[] = [];
    for (const op of ops) {
      if (op.type !== "change") continue;
      if (op.a0 === op.a1) {
        const [pos, from, to] = pureRange(la, op.a0, lb, op.b0, op.b1, b.length, a.length);
        out.push(new Change(pos, pos, from, to));
      } else if (op.b0 === op.b1) {
        const [pos, from, to] = pureRange(lb, op.b0, la, op.a0, op.a1, a.length, b.length);
        out.push(new Change(from, to, pos, pos));
      } else {
        const fromA = la[op.a0].start, toA = la[op.a1 - 1].end;
        const fromB = lb[op.b0].start, toB = lb[op.b1 - 1].end;
        for (const c of diff(a.slice(fromA, toA), b.slice(fromB, toB), { scanLimit: 500 }))
          out.push(new Change(c.fromA + fromA, c.toA + fromA, c.fromB + fromB, c.toB + fromB));
      }
    }
    return out;
  };
}

/**
 * Lines [s0, s1) of `src` exist only on that side and go in before line
 * `at` of `dst`. Returns [position in dst, from, to in src], with the range
 * covering the line breaks that belong to the inserted lines.
 */
function pureRange(
  dst: LineInfo[], at: number, src: LineInfo[], s0: number, s1: number, srcLen: number, dstLen: number,
): [number, number, number] {
  if (at < dst.length && s1 < src.length) return [dst[at].start, src[s0].start, src[s1].start];
  // appended after the last line: take the preceding line break instead
  return [dstLen, s0 > 0 ? src[s0 - 1].end : 0, srcLen];
}
