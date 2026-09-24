import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { Analyzer } from "./analysis-client";
import type { AnalysisResult } from "./analysis";
import { unifiedPatch } from "./diff-core";
import { openAnyFile } from "./documents";
import { DiffEditor, type EditorSettings } from "./editor";
import { downloadText } from "./files";
import { formatJson } from "./format";
import { allLanguageNames, commonLanguages, detectLanguage } from "./lang";
import { detectMoves } from "./moves";
import { compilePatterns, hasActiveOptions, ignorePresets, splitLines } from "./normalize";
import { type Prefs, type ThemePref, loadDocs, loadPrefs, saveDocs, savePrefs } from "./prefs";
import { buildReport } from "./report";
import { decodeShare, encodeShare } from "./share";
import { renderChangeMap } from "./ui/changemap";
import { renderDataPanel } from "./ui/datapanel";
import { type ImageMode, ImagePanel } from "./ui/imagepanel";
import { popover } from "./ui/popover";
import { toast } from "./ui/toast";
import { AccountUI } from "./ui/account-ui";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

const LONG_LINK = 32 * 1024;
const MAX_LINK = 2 * 1024 * 1024;
const LARGE_FILE = 5 * 1024 * 1024;

type Side = "a" | "b";
type Mode = "text" | "data" | "image";

// ---------------------------------------------------------------- state

const prefs: Prefs = loadPrefs();

// Landing pages (e.g. /json-compare/) set a hint and how the tool starts.
interface PageConfig {
  hint?: string;
  start?: { lang?: string; data?: boolean; image?: boolean; prose?: boolean };
}
const pageConfig: PageConfig = (() => {
  try {
    return JSON.parse(document.getElementById("page-config")?.textContent || "{}");
  } catch {
    return {};
  }
})();
const start = pageConfig.start ?? {};
if (start.lang && !prefs.lang) prefs.lang = start.lang;
if (start.prose) prefs.prose = true;
if (start.data) prefs.data = true;
let initial = { a: "", b: "", nameA: "", nameB: "" };

declare global {
  interface Window {
    __shareHash?: string;
  }
}
const takeShareHash = () => {
  const h = window.__shareHash ?? location.hash;
  window.__shareHash = undefined;
  return h;
};
const incomingHash = takeShareHash();
const shared = decodeShare(incomingHash);
if (shared) {
  initial = { a: shared.l, b: shared.r, nameA: shared.ln ?? "", nameB: shared.rn ?? "" };
  if (shared.o) prefs.options = shared.o;
  if (shared.view) prefs.view = shared.view;
  if (shared.lang !== undefined) prefs.lang = shared.lang;
  prefs.data = false;
} else {
  if (incomingHash.startsWith("#v")) {
    queueMicrotask(() => toast("This link is damaged or was made by a newer version, so it couldn't be opened.", "error", 6000));
  }
  const saved = prefs.remember ? loadDocs() : null;
  if (saved) initial = saved;
}

const nameA = $<HTMLInputElement>("#name-a");
const nameB = $<HTMLInputElement>("#name-b");
nameA.value = initial.nameA;
nameB.value = initial.nameB;
const encodings: Record<Side, string> = { a: "", b: "" };

const narrow = matchMedia("(max-width: 760px)");
const textView = () => (narrow.matches ? "unified" : prefs.view);

const resolveLang = (a: string, b: string): string | null => {
  if (prefs.prose || prefs.lang === "none") return null;
  if (prefs.lang) return prefs.lang;
  return detectLanguage(nameB.value || nameA.value || undefined, b || a);
};

const editorSettings = (a: string, b: string): EditorSettings => ({
  view: textView(),
  options: prefs.options,
  collapse: prefs.collapse,
  wrap: prefs.wrap || prefs.prose,
  revert: prefs.revert,
  granularity: prefs.granularity,
  lang: resolveLang(a, b),
});

// ---------------------------------------------------------------- editor and analysis

let uiFrame = 0;
let editTimer = 0;
let saveTimer = 0;
let editor: DiffEditor;
let mode: Mode = "text";
let lastResult: AnalysisResult | null = null;
let movedCount = 0;
let accountUI: AccountUI | null = null;

const analyzer = new Analyzer((r) => {
  lastResult = r;
  renderSummary();
});

/** Moved blocks come from the editor's own change blocks, so they always match what is highlighted. */
function refreshMoves(a: string, b: string) {
  const lines = (t: string) => splitLines(t).map((l) => l.text);
  const moves = prefs.moves && (a || b) ? detectMoves(lines(a), lines(b), editor.lineOps(), prefs.options) : [];
  movedCount = moves.length;
  editor.setMoves(moves);
  cancelAnimationFrame(uiFrame);
  uiFrame = requestAnimationFrame(refreshNav);
}

function onEditorUpdate(kind: "doc" | "selection") {
  cancelAnimationFrame(uiFrame);
  uiFrame = requestAnimationFrame(refreshNav);
  if (kind === "doc" && editor) {
    clearTimeout(editTimer);
    editTimer = window.setTimeout(refreshAfterEdit, 120);
  }
}

function refreshAfterEdit() {
  const a = editor.a, b = editor.b;
  renderMeta("a", a);
  renderMeta("b", b);
  if (!prefs.lang && !prefs.prose) {
    const lang = resolveLang(a, b);
    if (lang !== editor.settingsSnapshot.lang) editor.update({ lang });
    refreshLangLabel(lang);
  }
  refreshMoves(a, b);
  if (!a && !b) {
    lastResult = null;
    renderSummary();
  } else analyzer.request({ a, b, options: prefs.options });
  if (mode === "data") renderDataPanel($("#data-panel"), a, b);
  accountUI?.noteChange();
  if (prefs.remember) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistDocs, 400);
  }
}

function persistDocs() {
  saveDocs({ a: editor.a, b: editor.b, nameA: nameA.value, nameB: nameB.value });
}

function refreshNav() {
  const { marks, count, current } = editor.chunkInfo();
  $("#position").textContent = count === 0 ? "No changes" : current >= 0 ? `${current + 1} of ${count}` : `${count} ${count === 1 ? "change" : "changes"}`;
  $<HTMLButtonElement>("#prev").disabled = count === 0;
  $<HTMLButtonElement>("#next").disabled = count === 0;
  renderChangeMap($("#changemap"), marks, current, (i) => editor.gotoChunk(i));
}

function renderSummary() {
  const el = $("#summary");
  const s = lastResult?.stats;
  if (mode === "image") {
    el.innerHTML = `<span class="hint">Comparing images. Switch views with the buttons above the pictures.</span>`;
    return;
  }
  if (!s) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = pageConfig.hint || "Paste or drop text on both sides to compare. Word, Excel, PDF and image files work too. Nothing leaves your browser.";
    el.replaceChildren(hint);
    return;
  }
  const filtered = hasActiveOptions(prefs.options) ? `<span class="muted">with your ignore options</span>` : "";
  if (s.identical) {
    el.innerHTML = `<span class="same">The two sides are identical</span> ${filtered}`;
    return;
  }
  const pct = Math.round(s.similarity * 100);
  const sim = pct === 100 ? ">99%" : `${pct}%`;
  const moved = movedCount;
  el.innerHTML =
    `<span class="stat add" title="Lines only in the changed text">+${s.added.toLocaleString()}</span>` +
    `<span class="stat del" title="Lines only in the original text">&minus;${s.removed.toLocaleString()}</span>` +
    `<span class="stat">${s.blocks.toLocaleString()} ${s.blocks === 1 ? "block" : "blocks"} changed</span>` +
    (moved ? `<span class="stat move" title="Blocks that were moved, not rewritten">${moved} moved</span>` : "") +
    `<span class="simbar" title="${sim} of lines are unchanged"><span style="width:${(s.similarity * 100).toFixed(1)}%"></span></span>` +
    `<span class="stat">${sim} the same</span> ${filtered}`;
}

function renderMeta(side: Side, text: string) {
  const lines = text === "" ? 0 : text.split("\n").length;
  const parts = [`${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`];
  if (encodings[side]) parts.push(encodings[side]);
  $(`#meta-${side}`).textContent = parts.join(", ");
}

// ---------------------------------------------------------------- modes: text, data, image

const imagePanel = new ImagePanel($("#img-stage"), $("#img-info"));

function setMode(next: Mode) {
  mode = next;
  document.body.dataset.mode = next;
  $("#data-panel").hidden = next !== "data";
  $("#image-panel").hidden = next !== "image";
  $("#editor-row").hidden = next !== "text";
  if (next === "data") renderDataPanel($("#data-panel"), editor.a, editor.b);
  if (next === "text") requestAnimationFrame(refreshNav);
  syncControls();
  renderSummary();
}

let imageMode: ImageMode = "side";
function setImageMode(m: ImageMode) {
  imageMode = m;
  imagePanel.setMode(m);
  $$<HTMLButtonElement>("[data-img-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.imgMode === m)));
  $("#opacity-wrap").hidden = m !== "onion";
}
$$<HTMLButtonElement>("[data-img-mode]").forEach((b) => b.addEventListener("click", () => setImageMode(b.dataset.imgMode as ImageMode)));
$<HTMLInputElement>("#img-opacity").addEventListener("input", (e) => imagePanel.setOpacity(Number((e.target as HTMLInputElement).value) / 100));
$("#img-close").addEventListener("click", () => {
  imagePanel.clear();
  setMode(prefs.data ? "data" : "text");
});

// ---------------------------------------------------------------- toolbar: view, language, options

function applyPrefs(next: Partial<Prefs>) {
  Object.assign(prefs, next);
  savePrefs(prefs);
  editor.update(editorSettings(editor.a, editor.b));
  document.body.classList.toggle("prose", prefs.prose);
  if (mode !== "image") setMode(prefs.data ? "data" : "text");
  syncControls();
  refreshAfterEdit();
}

function syncControls() {
  const view = textView();
  $$<HTMLButtonElement>("[data-view]").forEach((b) => {
    const pressed = mode === "image" ? false : b.dataset.view === "data" ? mode === "data" : mode === "text" && b.dataset.view === view;
    b.setAttribute("aria-pressed", String(pressed));
  });
  document.body.dataset.view = view;
  document.body.classList.toggle("prose", prefs.prose);
  $<HTMLInputElement>("#opt-case").checked = prefs.options.ignoreCase;
  $<HTMLInputElement>("#opt-blank").checked = prefs.options.ignoreBlankLines;
  $$<HTMLInputElement>("input[name=ws]").forEach((r) => (r.checked = r.value === prefs.options.whitespace));
  $$<HTMLInputElement>("input[name=gran]").forEach((r) => (r.checked = r.value === prefs.granularity));
  $<HTMLInputElement>("#opt-moves").checked = prefs.moves;
  $<HTMLInputElement>("#opt-prose").checked = prefs.prose;
  $<HTMLInputElement>("#opt-collapse").checked = prefs.collapse;
  $<HTMLInputElement>("#opt-wrap").checked = prefs.wrap;
  $<HTMLInputElement>("#opt-revert").checked = prefs.revert === "b-to-a";
  $<HTMLInputElement>("#opt-remember").checked = prefs.remember;
  $<HTMLInputElement>("#opt-history").checked = prefs.history;
  const presetPatterns = Object.values(ignorePresets).map((p) => p.pattern as string);
  $$<HTMLInputElement>("[data-preset]").forEach((c) => (c.checked = prefs.options.ignorePatterns.includes(c.value)));
  const custom = $<HTMLTextAreaElement>("#opt-patterns");
  if (document.activeElement !== custom) custom.value = prefs.options.ignorePatterns.filter((p) => !presetPatterns.includes(p)).join("\n");
  const errors = compilePatterns(prefs.options.ignorePatterns).errors;
  const errEl = $("#patterns-error");
  errEl.hidden = errors.length === 0;
  errEl.textContent = errors.length ? `Not a valid pattern, so it's skipped: ${errors.join(", ")}` : "";
  const o = prefs.options;
  const active = [o.ignoreCase, o.ignoreBlankLines, o.whitespace !== "none", o.ignorePatterns.length > 0].filter(Boolean).length;
  const badge = $("#options-badge");
  badge.hidden = active === 0;
  badge.textContent = String(active);
  $<HTMLSelectElement>("#lang").value = prefs.lang;
  $<HTMLSelectElement>("#lang").disabled = prefs.prose;
}

$$<HTMLButtonElement>("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    const v = b.dataset.view!;
    if (mode === "image") imagePanel.clear();
    if (v === "data") return applyPrefs({ data: true });
    if (narrow.matches && v === "split") toast("Side by side needs a wider screen.");
    applyPrefs({ data: false, view: v as Prefs["view"] });
  }),
);
narrow.addEventListener("change", () => applyPrefs({}));

const langSelect = $<HTMLSelectElement>("#lang");
{
  const opt = (value: string, label: string) => new Option(label, value);
  langSelect.append(opt("", "Auto-detect"), opt("none", "Plain text"));
  const common = document.createElement("optgroup");
  common.label = "Common";
  commonLanguages.forEach((n) => common.append(opt(n, n)));
  const all = document.createElement("optgroup");
  all.label = "All languages";
  allLanguageNames().filter((n) => !commonLanguages.includes(n)).forEach((n) => all.append(opt(n, n)));
  langSelect.append(common, all);
}
function refreshLangLabel(detected: string | null) {
  langSelect.options[0].textContent = detected ? `Auto (${detected})` : "Auto-detect";
}
langSelect.addEventListener("change", () => applyPrefs({ lang: langSelect.value }));

{
  const list = $("#preset-list");
  for (const preset of Object.values(ignorePresets)) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.preset = "";
    box.value = preset.pattern;
    label.append(box, ` ${preset.label}`);
    list.append(label);
  }
}

function patternsFromControls(): string[] {
  const presets = $$<HTMLInputElement>("[data-preset]").filter((c) => c.checked).map((c) => c.value);
  const custom = $<HTMLTextAreaElement>("#opt-patterns").value.split("\n").map((l) => l.trim()).filter(Boolean);
  return [...presets, ...custom];
}

popover($<HTMLButtonElement>("#options-btn"), $("#options-panel"));
const toolsMenu = popover($<HTMLButtonElement>("#tools-btn"), $("#tools-panel"));
const exportMenu = popover($<HTMLButtonElement>("#export-btn"), $("#export-panel"));

const checked = (id: string) => $<HTMLInputElement>(`#${id}`).checked;
const optionInputs: Record<string, () => void> = {
  "opt-case": () => applyPrefs({ options: { ...prefs.options, ignoreCase: checked("opt-case") } }),
  "opt-blank": () => applyPrefs({ options: { ...prefs.options, ignoreBlankLines: checked("opt-blank") } }),
  "opt-moves": () => applyPrefs({ moves: checked("opt-moves") }),
  "opt-prose": () => applyPrefs({ prose: checked("opt-prose") }),
  "opt-collapse": () => applyPrefs({ collapse: checked("opt-collapse") }),
  "opt-history": () => applyPrefs({ history: checked("opt-history") }),
  "opt-wrap": () => applyPrefs({ wrap: checked("opt-wrap") }),
  "opt-revert": () => applyPrefs({ revert: checked("opt-revert") ? "b-to-a" : "a-to-b" }),
  "opt-remember": () => {
    const on = checked("opt-remember");
    applyPrefs({ remember: on });
    if (on) {
      persistDocs();
      toast("Your text will be kept in this browser until you turn this off.");
    } else {
      saveDocs(null);
      toast("Saved text removed from this browser.");
    }
  },
};
for (const [id, fn] of Object.entries(optionInputs)) $(`#${id}`).addEventListener("change", fn);
$$<HTMLInputElement>("input[name=ws]").forEach((r) =>
  r.addEventListener("change", () => applyPrefs({ options: { ...prefs.options, whitespace: r.value as Prefs["options"]["whitespace"] } })),
);
$$<HTMLInputElement>("input[name=gran]").forEach((r) => r.addEventListener("change", () => applyPrefs({ granularity: r.value as Prefs["granularity"] })));
$("#preset-list").addEventListener("change", () => applyPrefs({ options: { ...prefs.options, ignorePatterns: patternsFromControls() } }));
let patternTimer = 0;
$("#opt-patterns").addEventListener("input", () => {
  clearTimeout(patternTimer);
  patternTimer = window.setTimeout(() => applyPrefs({ options: { ...prefs.options, ignorePatterns: patternsFromControls() } }), 500);
});

$("#prev").addEventListener("click", () => editor.prev());
$("#next").addEventListener("click", () => editor.next());

// ---------------------------------------------------------------- tools and export

const baseName = (name: string, fallback: string) => (name.trim() || fallback).replace(/[\\/:*?"<>|]+/g, "_");
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

function setSide(side: Side, text: string, name?: string) {
  if (text.length > LARGE_FILE) toast("That's a large text, so comparing may take a moment.", "info", 5000);
  if (name !== undefined) (side === "a" ? nameA : nameB).value = name;
  editor.setDocs(side === "a" ? { a: text } : { b: text });
}

function report(): string | null {
  if (!editor.a && !editor.b) {
    toast("Add some text first.");
    return null;
  }
  return buildReport({
    a: editor.a, b: editor.b,
    nameA: nameA.value || "Original", nameB: nameB.value || "Changed",
    options: prefs.options, granularity: prefs.granularity, date: new Date(),
  });
}

const actions: Record<string, () => void | Promise<void>> = {
  swap: () => {
    const a = editor.a, b = editor.b;
    [nameA.value, nameB.value] = [nameB.value, nameA.value];
    [encodings.a, encodings.b] = [encodings.b, encodings.a];
    editor.setDocs({ a: b, b: a });
    if (mode === "image") imagePanel.swap();
    toast("Sides swapped");
  },
  "format-json": () => {
    const out: { a?: string; b?: string } = {};
    const failed: string[] = [];
    for (const side of ["a", "b"] as const) {
      const text = side === "a" ? editor.a : editor.b;
      if (!text.trim()) continue;
      try {
        out[side] = formatJson(text);
      } catch {
        failed.push(side === "a" ? "original" : "changed");
      }
    }
    if (failed.length) {
      toast(`The ${failed.join(" and ")} text isn't valid JSON, so nothing was formatted.`, "error", 5000);
      return;
    }
    editor.setDocs(out);
    toast("JSON formatted with sorted keys");
  },
  trim: () => {
    const trim = (s: string) => s.replace(/[ \t]+$/gm, "");
    editor.setDocs({ a: trim(editor.a), b: trim(editor.b) });
    toast("Removed spaces at line ends");
  },
  "sort-lines": () => {
    const sort = (s: string) => s.split("\n").sort((x, y) => x.localeCompare(y)).join("\n");
    editor.setDocs({ a: sort(editor.a), b: sort(editor.b) });
    toast("Sorted lines on both sides");
  },
  clear: () => {
    accountUI?.startNewEntry();
    nameA.value = nameB.value = "";
    encodings.a = encodings.b = "";
    editor.setDocs({ a: "", b: "" });
    if (mode === "image") {
      imagePanel.clear();
      setMode(prefs.data ? "data" : "text");
    }
    editor.focus();
  },
  report: () => {
    const html = report();
    if (html) downloadText(`${stem(baseName(nameB.value || nameA.value, "comparison"))}-comparison.html`, html, "text/html");
  },
  print: () => {
    const html = report();
    if (!html) return;
    const frame = document.createElement("iframe");
    frame.className = "print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.append(frame);
  },
  "copy-diff": async () => {
    const patch = unifiedPatch(editor.a, editor.b, baseName(nameA.value, "original"), baseName(nameB.value, "changed"));
    if (!patch) return toast("Nothing to copy: the two sides are identical.");
    await copyText(patch, "Diff copied");
  },
  "download-patch": () => {
    const patch = unifiedPatch(editor.a, editor.b, baseName(nameA.value, "original"), baseName(nameB.value, "changed"));
    if (!patch) return toast("Nothing to download: the two sides are identical.");
    downloadText(`${stem(baseName(nameB.value, "changes"))}.patch`, patch, "text/x-diff");
  },
  "download-a": () => downloadText(baseName(nameA.value, "original.txt"), editor.a),
  "download-b": () => downloadText(baseName(nameB.value, "changed.txt"), editor.b),
};

document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (!btn) return;
  toolsMenu.close();
  exportMenu.close();
  void actions[btn.dataset.action!]?.();
});

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, "success");
  } catch {
    const ta = $<HTMLTextAreaElement>("#copy-text");
    ta.value = text;
    $<HTMLDialogElement>("#copy-dialog").showModal();
    ta.select();
  }
}

$("#share").addEventListener("click", async () => {
  if (mode === "image") return toast("Images can't go in a link. Links carry text only.");
  const a = editor.a, b = editor.b;
  if (!a && !b) return toast("Add some text first, then copy a link to it.");
  const hash = encodeShare({
    l: a, r: b,
    ln: nameA.value || undefined, rn: nameB.value || undefined,
    lang: prefs.lang || undefined,
    o: hasActiveOptions(prefs.options) ? prefs.options : undefined,
    view: prefs.view,
  });
  const url = `${location.origin}${location.pathname}#${hash}`;
  if (url.length > MAX_LINK) return toast("This text is too large to fit in a link. Download a report or .patch instead.", "error", 6000);
  await copyText(url, url.length > LONG_LINK
    ? `Link copied (${Math.round(url.length / 1024)} KB). Some apps cut off links this long.`
    : "Link copied. The text travels inside the link; nothing is stored on a server.");
});

// ---------------------------------------------------------------- files: open, paste, drop

async function openFile(side: Side, file: File) {
  const busy = file.size > 200_000 ? window.setTimeout(() => toast(`Reading ${file.name}…`), 150) : 0;
  const opened = await openAnyFile(file);
  clearTimeout(busy);
  if (opened.kind === "error") return toast(opened.message, "error", 6000);
  if (opened.kind === "image") {
    try {
      await imagePanel.set(side, file);
      (side === "a" ? nameA : nameB).value = file.name;
      if (mode !== "image") {
        setMode("image");
        setImageMode(imageMode);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "That image couldn't be opened.", "error", 5000);
    }
    return;
  }
  if (mode === "image") {
    imagePanel.clear();
    setMode(prefs.data ? "data" : "text");
  }
  encodings[side] = opened.encoding;
  setSide(side, opened.text, file.name);
  if (opened.document && !prefs.prose) {
    applyPrefs({ prose: true });
    toast("Document mode is on, so paragraphs wrap and changes show by word.");
  }
}

for (const side of ["a", "b"] as const) {
  const input = $<HTMLInputElement>(`#file-${side}`);
  input.addEventListener("change", () => {
    if (input.files?.[0]) void openFile(side, input.files[0]);
    input.value = "";
  });
}

$$<HTMLButtonElement>("[data-open]").forEach((b) => b.addEventListener("click", () => $(`#file-${b.dataset.open}`).click()));
$$<HTMLButtonElement>("[data-clear]").forEach((b) =>
  b.addEventListener("click", () => {
    const side = b.dataset.clear as Side;
    encodings[side] = "";
    setSide(side, "", "");
  }),
);
$$<HTMLButtonElement>("[data-paste]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      setSide(b.dataset.paste as Side, await navigator.clipboard.readText());
    } catch {
      toast("Your browser blocked reading the clipboard. Click in the side and press Ctrl+V instead.", "error", 5000);
    }
  }),
);
[nameA, nameB].forEach((el) => el.addEventListener("input", () => refreshAfterEdit()));

const workspace = $("#workspace");
const overlay = $("#drop-overlay");
let dragDepth = 0;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
const sideAt = (x: number): Side => {
  const r = workspace.getBoundingClientRect();
  return x < r.left + r.width / 2 ? "a" : "b";
};
workspace.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  overlay.hidden = false;
});
workspace.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    overlay.hidden = true;
  }
});
workspace.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const side = sideAt(e.clientX);
  $$(".drop-half").forEach((h) => h.classList.toggle("hot", h.dataset.side === side));
});
workspace.addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  dragDepth = 0;
  overlay.hidden = true;
  const files = Array.from(e.dataTransfer!.files);
  if (files.length >= 2) {
    await openFile("a", files[0]);
    await openFile("b", files[1]);
    if (files.length > 2) toast("Only the first two files were opened.");
  } else if (files[0]) await openFile(sideAt(e.clientX), files[0]);
}, true);

// ---------------------------------------------------------------- theme, help, keyboard

const themeOrder: ThemePref[] = ["system", "light", "dark"];
function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  const label = { system: "Theme: follows your system", light: "Theme: light", dark: "Theme: dark" }[prefs.theme];
  $("#theme").title = label;
  $("#theme").setAttribute("aria-label", label);
}
$("#theme").addEventListener("click", () => {
  prefs.theme = themeOrder[(themeOrder.indexOf(prefs.theme) + 1) % themeOrder.length];
  savePrefs(prefs);
  applyTheme();
  toast({ system: "Following your system theme", light: "Light theme", dark: "Dark theme" }[prefs.theme]);
});

const helpDialog = $<HTMLDialogElement>("#help-dialog");
$("#help").addEventListener("click", () => helpDialog.showModal());

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const typing = target.closest(".cm-editor, input, select, textarea");
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void accountUI?.saveCurrent();
  } else if (e.key === "?" && !typing && !helpDialog.open) {
    e.preventDefault();
    helpDialog.showModal();
  } else if (!typing && mode === "text" && (e.key === "F7" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")))) {
    e.preventDefault();
    if (e.shiftKey || e.key === "ArrowUp") editor.prev();
    else editor.next();
  }
});

// a share link opened while the page is already showing
window.addEventListener("sharelink", () => {
  const s = decodeShare(takeShareHash());
  if (!s) return toast("This link is damaged or was made by a newer version, so it couldn't be opened.", "error", 6000);
  nameA.value = s.ln ?? "";
  nameB.value = s.rn ?? "";
  encodings.a = encodings.b = "";
  if (mode === "image") imagePanel.clear();
  applyPrefs({ data: false, ...(s.o ? { options: s.o } : {}), ...(s.view ? { view: s.view } : {}), ...(s.lang !== undefined ? { lang: s.lang } : {}) });
  accountUI?.startNewEntry();
  editor.setDocs({ a: s.l, b: s.r });
  toast("Opened the shared comparison");
});

// saved comparisons, history and (optional) accounts
const firstLine = (t: string) => (t.split("\n").find((l) => l.trim()) ?? "").trim();
accountUI = new AccountUI(
  {
    current: () => {
      if (mode === "image") return null;
      const a = editor.a, b = editor.b;
      if (!a.trim() || !b.trim()) return null;
      const title = nameA.value && nameB.value ? `${nameA.value} vs ${nameB.value}` : firstLine(b).slice(0, 80) || firstLine(a).slice(0, 80) || "Untitled comparison";
      const count = (t: string) => t.split("\n").length;
      return {
        meta: { title, nameA: nameA.value, nameB: nameB.value, linesA: count(a), linesB: count(b), preview: firstLine(b).slice(0, 140) },
        body: { a, b, nameA: nameA.value, nameB: nameB.value, options: prefs.options, lang: prefs.lang || undefined },
      };
    },
    open: (body) => {
      if (mode === "image") imagePanel.clear();
      nameA.value = body.nameA;
      nameB.value = body.nameB;
      encodings.a = encodings.b = "";
      applyPrefs({ data: false, ...(body.options ? { options: body.options } : {}), ...(body.lang !== undefined ? { lang: body.lang } : {}) });
      editor.setDocs({ a: body.a, b: body.b });
    },
    historyEnabled: () => prefs.history,
  },
  $<HTMLButtonElement>("#account-btn"),
  $<HTMLButtonElement>("#library-btn"),
  $<HTMLButtonElement>("#save-btn"),
);

// everything is wired up; create the editor last
editor = new DiffEditor($("#editor"), editorSettings(initial.a, initial.b), { a: initial.a, b: initial.b }, onEditorUpdate);
applyTheme();
setMode(start.image && !shared ? "image" : prefs.data ? "data" : "text");
if (start.image && !shared) imagePanel.render();
refreshAfterEdit();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch(() => {}));
}
