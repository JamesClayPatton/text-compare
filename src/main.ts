import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { diffStats, unifiedPatch } from "./diff-core";
import { DiffEditor, type EditorSettings } from "./editor";
import { downloadText, readTextFile } from "./files";
import { formatJson } from "./format";
import { allLanguageNames, commonLanguages, detectLanguage } from "./lang";
import { hasActiveOptions } from "./normalize";
import { type Prefs, type ThemePref, loadDocs, loadPrefs, saveDocs, savePrefs } from "./prefs";
import { decodeShare, encodeShare } from "./share";
import { renderChangeMap } from "./ui/changemap";
import { popover } from "./ui/popover";
import { toast } from "./ui/toast";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

const LONG_LINK = 32 * 1024;
const MAX_LINK = 2 * 1024 * 1024;
const LARGE_FILE = 5 * 1024 * 1024;

type Side = "a" | "b";

// ---------------------------------------------------------------- state

const prefs: Prefs = loadPrefs();
let initial = { a: "", b: "", nameA: "", nameB: "" };

const shared = decodeShare(location.hash);
if (shared) {
  initial = { a: shared.l, b: shared.r, nameA: shared.ln ?? "", nameB: shared.rn ?? "" };
  if (shared.o) prefs.options = shared.o;
  if (shared.view) prefs.view = shared.view;
  if (shared.lang !== undefined) prefs.lang = shared.lang;
  history.replaceState(null, "", location.pathname + location.search);
} else {
  if (location.hash.startsWith("#v")) {
    queueMicrotask(() => toast("This link is damaged or was made by a newer version, so it couldn't be opened.", "error", 6000));
    history.replaceState(null, "", location.pathname + location.search);
  }
  const saved = prefs.remember ? loadDocs() : null;
  if (saved) initial = saved;
}

const nameA = $<HTMLInputElement>("#name-a");
const nameB = $<HTMLInputElement>("#name-b");
nameA.value = initial.nameA;
nameB.value = initial.nameB;
const encodings: Record<Side, string> = { a: "", b: "" };

const resolveLang = (a: string, b: string): string | null => {
  if (prefs.lang === "none") return null;
  if (prefs.lang) return prefs.lang;
  return detectLanguage(nameB.value || nameA.value || undefined, b || a);
};

const settingsFromPrefs = (a: string, b: string): EditorSettings => ({
  view: effectiveView(),
  options: prefs.options,
  collapse: prefs.collapse,
  wrap: prefs.wrap,
  revert: prefs.revert,
  lang: resolveLang(a, b),
});

const narrow = matchMedia("(max-width: 760px)");
function effectiveView() {
  return narrow.matches ? "unified" : prefs.view;
}

// ---------------------------------------------------------------- editor

let uiFrame = 0;
let statsTimer = 0;
let saveTimer = 0;
let editor: DiffEditor;

function onEditorUpdate(kind: "doc" | "selection") {
  cancelAnimationFrame(uiFrame);
  uiFrame = requestAnimationFrame(refreshNav);
  if (kind === "doc" && editor) {
    clearTimeout(statsTimer);
    statsTimer = window.setTimeout(refreshAfterEdit, 120);
  }
}


function refreshAfterEdit() {
  const a = editor.a, b = editor.b;
  renderSummary(a, b);
  renderMeta("a", a);
  renderMeta("b", b);
  if (!prefs.lang) {
    const lang = resolveLang(a, b);
    if (lang !== editor.settingsSnapshot.lang) editor.update({ lang });
    refreshLangLabel(lang);
  }
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

function renderSummary(a: string, b: string) {
  const el = $("#summary");
  if (!a && !b) {
    el.innerHTML = `<span class="hint">Paste or drop text on both sides to compare. Nothing you enter leaves your browser.</span>`;
    return;
  }
  const s = diffStats(a, b, prefs.options);
  const filtered = hasActiveOptions(prefs.options) ? `<span class="muted">with your options</span>` : "";
  if (s.identical) {
    el.innerHTML = `<span class="same">The two sides are identical</span> ${filtered}`;
    return;
  }
  const pct = Math.round(s.similarity * 100);
  const sim = pct === 100 ? ">99%" : `${pct}%`;
  el.innerHTML =
    `<span class="stat add" title="Lines only in the changed text">+${s.added.toLocaleString()}</span>` +
    `<span class="stat del" title="Lines only in the original text">&minus;${s.removed.toLocaleString()}</span>` +
    `<span class="stat">${s.blocks.toLocaleString()} ${s.blocks === 1 ? "block" : "blocks"} changed</span>` +
    `<span class="simbar" title="${sim} of lines are unchanged"><span style="width:${(s.similarity * 100).toFixed(1)}%"></span></span>` +
    `<span class="stat">${sim} the same</span> ${filtered}`;
}

function renderMeta(side: Side, text: string) {
  const lines = text === "" ? 0 : text.split("\n").length;
  const parts = [`${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`];
  if (encodings[side]) parts.push(encodings[side]);
  $(`#meta-${side}`).textContent = parts.join(", ");
}

// ---------------------------------------------------------------- toolbar: view, language, options

function applyPrefs(next: Partial<Prefs>) {
  Object.assign(prefs, next);
  savePrefs(prefs);
  editor.update({
    view: effectiveView(),
    options: prefs.options,
    collapse: prefs.collapse,
    wrap: prefs.wrap,
    revert: prefs.revert,
    lang: resolveLang(editor.a, editor.b),
  });
  syncControls();
  refreshAfterEdit();
}

function syncControls() {
  const view = effectiveView();
  $$<HTMLButtonElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  document.body.dataset.view = view;
  $<HTMLInputElement>("#opt-case").checked = prefs.options.ignoreCase;
  $<HTMLInputElement>("#opt-blank").checked = prefs.options.ignoreBlankLines;
  $$<HTMLInputElement>("input[name=ws]").forEach((r) => (r.checked = r.value === prefs.options.whitespace));
  $<HTMLInputElement>("#opt-collapse").checked = prefs.collapse;
  $<HTMLInputElement>("#opt-wrap").checked = prefs.wrap;
  $<HTMLInputElement>("#opt-revert").checked = prefs.revert === "b-to-a";
  $<HTMLInputElement>("#opt-remember").checked = prefs.remember;
  const active = [prefs.options.ignoreCase, prefs.options.ignoreBlankLines, prefs.options.whitespace !== "none"].filter(Boolean).length;
  const badge = $("#options-badge");
  badge.hidden = active === 0;
  badge.textContent = String(active);
  $<HTMLSelectElement>("#lang").value = prefs.lang;
}

$$<HTMLButtonElement>("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    if (narrow.matches && b.dataset.view === "split") toast("Side by side needs a wider screen.");
    applyPrefs({ view: b.dataset.view as Prefs["view"] });
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

popover($<HTMLButtonElement>("#options-btn"), $("#options-panel"));
const toolsMenu = popover($<HTMLButtonElement>("#tools-btn"), $("#tools-panel"));
const exportMenu = popover($<HTMLButtonElement>("#export-btn"), $("#export-panel"));

const optionInputs: Record<string, () => void> = {
  "opt-case": () => applyPrefs({ options: { ...prefs.options, ignoreCase: $<HTMLInputElement>("#opt-case").checked } }),
  "opt-blank": () => applyPrefs({ options: { ...prefs.options, ignoreBlankLines: $<HTMLInputElement>("#opt-blank").checked } }),
  "opt-collapse": () => applyPrefs({ collapse: $<HTMLInputElement>("#opt-collapse").checked }),
  "opt-wrap": () => applyPrefs({ wrap: $<HTMLInputElement>("#opt-wrap").checked }),
  "opt-revert": () => applyPrefs({ revert: $<HTMLInputElement>("#opt-revert").checked ? "b-to-a" : "a-to-b" }),
  "opt-remember": () => {
    const on = $<HTMLInputElement>("#opt-remember").checked;
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

$("#prev").addEventListener("click", () => editor.prev());
$("#next").addEventListener("click", () => editor.next());

// ---------------------------------------------------------------- tools and export

const baseName = (name: string, fallback: string) => (name.trim() || fallback).replace(/[\\/:*?"<>|]+/g, "_");

function setSide(side: Side, text: string, name?: string) {
  if (text.length > LARGE_FILE) toast("That's a large text, so comparing may be slow.", "info", 5000);
  if (name !== undefined) (side === "a" ? nameA : nameB).value = name;
  editor.setDocs(side === "a" ? { a: text } : { b: text });
}

const actions: Record<string, () => void | Promise<void>> = {
  swap: () => {
    const a = editor.a, b = editor.b;
    [nameA.value, nameB.value] = [nameB.value, nameA.value];
    [encodings.a, encodings.b] = [encodings.b, encodings.a];
    editor.setDocs({ a: b, b: a });
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
    if (!prefs.lang) applyPrefs({ lang: "" });
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
    nameA.value = nameB.value = "";
    encodings.a = encodings.b = "";
    editor.setDocs({ a: "", b: "" });
    editor.focus();
  },
  "copy-diff": async () => {
    const patch = unifiedPatch(editor.a, editor.b, baseName(nameA.value, "original"), baseName(nameB.value, "changed"));
    if (!patch) return toast("Nothing to copy: the two sides are identical.");
    await copyText(patch, "Diff copied");
  },
  "download-patch": () => {
    const patch = unifiedPatch(editor.a, editor.b, baseName(nameA.value, "original"), baseName(nameB.value, "changed"));
    if (!patch) return toast("Nothing to download: the two sides are identical.");
    downloadText(`${baseName(nameB.value, "changes").replace(/\.[^.]+$/, "")}.patch`, patch, "text/x-diff");
  },
  "download-a": () => downloadText(baseName(nameA.value, "original.txt"), editor.a),
  "download-b": () => downloadText(baseName(nameB.value, "changed.txt"), editor.b),
  print: () => window.print(),
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
  if (url.length > MAX_LINK) return toast("This text is too large to fit in a link. Download a .patch instead.", "error", 6000);
  await copyText(url, url.length > LONG_LINK
    ? `Link copied (${Math.round(url.length / 1024)} KB). Some apps cut off links this long.`
    : "Link copied. The text travels inside the link; nothing is stored on a server.");
});

// ---------------------------------------------------------------- files: open, paste, drop

async function openFile(side: Side, file: File) {
  const decoded = await readTextFile(file);
  if (!decoded) return toast(`${file.name} looks like a binary file, not text.`, "error", 5000);
  encodings[side] = decoded.encoding === "UTF-8" ? "" : decoded.encoding;
  setSide(side, decoded.text, file.name);
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
  if (e.key === "?" && !typing && !helpDialog.open) {
    e.preventDefault();
    helpDialog.showModal();
  } else if (!typing && (e.key === "F7" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")))) {
    e.preventDefault();
    if (e.shiftKey || e.key === "ArrowUp") editor.prev();
    else editor.next();
  }
});

// everything is wired up; create the editor last
editor = new DiffEditor($("#editor"), settingsFromPrefs(initial.a, initial.b), { a: initial.a, b: initial.b }, onEditorUpdate);
refreshAfterEdit();
applyTheme();
syncControls();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
