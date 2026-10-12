import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report";
import { defaultOptions } from "../src/normalize";

const base = { nameA: "old.txt", nameB: "new.txt", options: defaultOptions, granularity: "word" as const, layout: "unified" as const, prose: false, context: "changes" as const, date: new Date("2026-09-24T12:00:00Z") };

describe("buildReport", () => {
  it("produces a standalone HTML page with word-level redlines", () => {
    const html = buildReport({ ...base, a: "keep\nthe quick fox\nkeep", b: "keep\nthe slow fox\nkeep" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<del>quick</del>");
    expect(html).toContain("<ins>slow</ins>");
    expect(html).toContain("old.txt");
    expect(html).not.toMatch(/<script|<link|https?:\/\//);
  });

  it("escapes HTML in the compared text", () => {
    const html = buildReport({ ...base, a: "<b>x</b>", b: "<i>x</i>" });
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>x</i>");
  });

  it("collapses long unchanged stretches", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const html = buildReport({ ...base, a: lines.join("\n"), b: lines.map((l, i) => (i === 20 ? "changed" : l)).join("\n") });
    expect(html).toMatch(/17 unchanged lines/);
    expect(html).not.toContain(">line 5<");
  });

  it("says when the texts are identical", () => {
    expect(buildReport({ ...base, a: "same", b: "same" })).toContain("No differences");
  });
});

/** The <tr> rows of the report body, as strings. */
const rows = (html: string) => html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];

describe("buildReport side by side", () => {
  const split = { ...base, layout: "split" as const };

  it("puts a removed line and its replacement in the same row", () => {
    const html = buildReport({ ...split, a: "keep\nthe quick fox\nkeep", b: "keep\nthe slow fox\nkeep" });
    const changed = rows(html).filter((r) => r.includes("<del>") || r.includes("<ins>"));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("<del>quick</del>");
    expect(changed[0]).toContain("<ins>slow</ins>");
  });

  it("pads the shorter side of an uneven block", () => {
    const html = buildReport({ ...split, a: "keep\none\ntwo\nkeep", b: "keep\nuno\nkeep" });
    const changed = rows(html).filter((r) => r.includes("<del>") || r.includes("<ins>"));
    expect(changed).toHaveLength(2);
    expect(changed[0]).toContain("<del>one</del>");
    expect(changed[0]).toContain("<ins>uno</ins>");
    expect(changed[1]).toContain("<del>two</del>");
    expect(changed[1]).not.toContain("<ins>");
  });

  it("shows unchanged lines once, with both line numbers", () => {
    const html = buildReport({ ...split, a: "same\nx", b: "same\ny" });
    const same = rows(html).filter((r) => r.includes(">same<"));
    expect(same).toHaveLength(1);
    expect(same[0].match(/<td class="n">1<\/td>/g)).toHaveLength(2);
  });

  it("escapes HTML in both columns", () => {
    const html = buildReport({ ...split, a: "<b>x</b>", b: "<i>x</i>" });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>x</i>");
  });

  it("still collapses unchanged stretches for code", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const html = buildReport({ ...split, a: lines.join("\n"), b: lines.map((l, i) => (i === 20 ? "changed" : l)).join("\n") });
    expect(html).toMatch(/17 unchanged lines/);
  });
});

describe("buildReport in document mode", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `paragraph ${i}`);
  const docs = { a: lines.join("\n"), b: lines.map((l, i) => (i === 20 ? "changed" : l)).join("\n") };

  it("shows the whole document, side by side", () => {
    const html = buildReport({ ...base, ...docs, layout: "split", prose: true, context: "all" });
    expect(html).not.toMatch(/unchanged lines/);
    expect(html).toContain(">paragraph 5<");
    expect(html).toMatch(/<body class="[^"]*\bprose\b/);
  });

  it("shows the whole document, unified", () => {
    const html = buildReport({ ...base, ...docs, layout: "unified", prose: true, context: "all" });
    expect(html).not.toMatch(/unchanged lines/);
    expect(html).toContain(">paragraph 5<");
  });
});

describe("buildReport unchanged text", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const docs = { a: lines.join("\n"), b: lines.map((l, i) => (i === 20 ? "changed" : l)).join("\n") };

  it("shows everything for code when asked", () => {
    const html = buildReport({ ...base, ...docs, layout: "split", context: "all" });
    expect(html).not.toMatch(/unchanged lines/);
    expect(html).toContain(">line 5<");
  });

  it("collapses prose to context when asked", () => {
    const html = buildReport({ ...base, ...docs, layout: "unified", prose: true, context: "changes" });
    expect(html).toMatch(/17 unchanged lines/);
    expect(html).not.toContain(">line 5<");
  });
});
