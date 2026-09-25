import { PAGES, type PageSlug, type SizeBucket, type Source } from "./usage-schema";

function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/** A rough size for the comparison, from the longer side. Never the text itself. */
export function sizeBucket(a: string, b: string): SizeBucket {
  const lines = Math.max(lineCount(a), lineCount(b));
  return lines < 100 ? "<100" : lines < 1000 ? "100-1k" : lines < 10_000 ? "1k-10k" : "10k+";
}

/** Which landing page this is, from the address path. */
export function pageSlug(pathname: string): PageSlug {
  const first = pathname.replace(/index\.html$/, "").split("/").filter(Boolean);
  if (first.length === 0) return "home";
  return first.length === 1 && (PAGES as readonly string[]).includes(first[0]) ? (first[0] as PageSlug) : "other";
}

/**
 * Decides when one comparison has happened. The diff updates live as people
 * type, so a comparison counts once when both sides have text and things settle,
 * and again only after new content arrives (a paste, a file, a link, a saved
 * comparison) or a side is emptied and filled again.
 */
export class ComparisonCounter {
  private counted = false;
  private source: Source = "typing";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private send: (source: Source) => void, private settleMs = 1500) {}

  /** New content is on its way from somewhere other than typing. */
  newContent(source: Source): void {
    clearTimeout(this.timer);
    this.counted = false;
    this.source = source;
  }

  /** Treat what's on screen now as already counted (text restored from an earlier visit). */
  alreadyCounted(): void {
    clearTimeout(this.timer);
    this.counted = true;
  }

  /** Call after every change to either side. */
  change(a: string, b: string): void {
    clearTimeout(this.timer);
    if (!a.trim() || !b.trim()) {
      this.counted = false;
      return;
    }
    if (this.counted) return;
    this.timer = setTimeout(() => this.countNow(), this.settleMs);
  }

  /** Count the current pair now, if it hasn't been counted (used for images). */
  countNow(): void {
    clearTimeout(this.timer);
    if (this.counted) return;
    this.counted = true;
    const source = this.source;
    this.source = "typing";
    this.send(source);
  }
}
