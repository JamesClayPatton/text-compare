import { describe, expect, it, vi } from "vitest";
import { ComparisonCounter, pageSlug, sizeBucket } from "../src/usage-core";
import { parseUsageEvent } from "../src/usage-schema";

const compare = { e: "compare", kind: "text", view: "split", page: "home", size: "<100", source: "paste", signedIn: false };

describe("parseUsageEvent", () => {
  it("accepts every well-formed event", () => {
    expect(parseUsageEvent(compare)).toEqual(compare);
    expect(parseUsageEvent({ e: "file_import", kind: "pdf" })).toEqual({ e: "file_import", kind: "pdf" });
    for (const e of ["share", "report_export", "report_print", "library_save"]) expect(parseUsageEvent({ e })).toEqual({ e });
  });

  it("rejects extra fields, so nothing else can ride along", () => {
    expect(parseUsageEvent({ ...compare, text: "secret" })).toBeNull();
    expect(parseUsageEvent({ e: "share", url: "https://text.compare/#v1abc" })).toBeNull();
    expect(parseUsageEvent({ e: "file_import", kind: "pdf", name: "contract.pdf" })).toBeNull();
  });

  it("rejects values that aren't on the list", () => {
    expect(parseUsageEvent({ ...compare, kind: "my secret doc" })).toBeNull();
    expect(parseUsageEvent({ ...compare, signedIn: "yes" })).toBeNull();
    expect(parseUsageEvent({ ...compare, page: "../etc" })).toBeNull();
    expect(parseUsageEvent({ e: "nope" })).toBeNull();
    expect(parseUsageEvent(null)).toBeNull();
    expect(parseUsageEvent([compare])).toBeNull();
    expect(parseUsageEvent("compare")).toBeNull();
  });
});

describe("sizeBucket", () => {
  it("buckets by the longer side's line count", () => {
    expect(sizeBucket("a", "b")).toBe("<100");
    expect(sizeBucket("x\n".repeat(99), "")).toBe("100-1k");
    expect(sizeBucket("", "x\n".repeat(999))).toBe("1k-10k");
    expect(sizeBucket("x\n".repeat(10_000), "a")).toBe("10k+");
  });
});

describe("pageSlug", () => {
  it("maps paths to known landing pages", () => {
    expect(pageSlug("/")).toBe("home");
    expect(pageSlug("/index.html")).toBe("home");
    expect(pageSlug("/word-compare/")).toBe("word-compare");
    expect(pageSlug("/word-compare/index.html")).toBe("word-compare");
    expect(pageSlug("/something/else/")).toBe("other");
  });
});

describe("ComparisonCounter", () => {
  const setup = () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const counter = new ComparisonCounter((source) => sent.push(source), 1500);
    return { sent, counter };
  };

  it("counts once when both sides have text and things settle", () => {
    const { sent, counter } = setup();
    counter.change("a", "");
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    counter.change("a", "b");
    vi.advanceTimersByTime(1000);
    counter.change("a", "bc");
    vi.advanceTimersByTime(1499);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["typing"]);
  });

  it("does not count again while the same pair is edited", () => {
    const { sent, counter } = setup();
    counter.change("a", "b");
    vi.advanceTimersByTime(2000);
    counter.change("a", "bb");
    counter.change("aa", "bb");
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual(["typing"]);
  });

  it("counts again after new content arrives, using its source", () => {
    const { sent, counter } = setup();
    counter.change("a", "b");
    vi.advanceTimersByTime(2000);
    counter.newContent("file");
    counter.change("a", "file text");
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(["typing", "file"]);
  });

  it("keeps the source until a pair is complete", () => {
    const { sent, counter } = setup();
    counter.newContent("file");
    counter.change("left file", "");
    vi.advanceTimersByTime(5000);
    counter.change("left file", "typed");
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(["file"]);
  });

  it("counts again after a side is emptied and refilled", () => {
    const { sent, counter } = setup();
    counter.change("a", "b");
    vi.advanceTimersByTime(2000);
    counter.change("a", "");
    counter.change("a", "c");
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(["typing", "typing"]);
  });

  it("ignores whitespace-only sides", () => {
    const { sent, counter } = setup();
    counter.change("a", "  \n ");
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
  });

  it("does not count restored text, but counts the next new pair", () => {
    const { sent, counter } = setup();
    counter.alreadyCounted();
    counter.change("restored a", "restored b");
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    counter.newContent("paste");
    counter.change("restored a", "pasted");
    vi.advanceTimersByTime(2000);
    expect(sent).toEqual(["paste"]);
  });

  it("can count a pair right away (images)", () => {
    const { sent, counter } = setup();
    counter.newContent("file");
    counter.countNow();
    counter.countNow();
    expect(sent).toEqual(["file"]);
  });
});
