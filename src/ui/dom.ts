type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

/** Create an element: h("button", { class: "btn", onclick: fn }, "Label"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface Modal {
  dialog: HTMLDialogElement;
  body: HTMLElement;
  close: () => void;
}

/** Open a modal dialog with a title; it removes itself when closed. */
export function modal(title: string, build: (m: Modal) => Child[], opts: { onClose?: () => void; dismissable?: boolean } = {}): Modal {
  const body = h("div", { class: "dialog-body" });
  const dialog = h("dialog", { class: "account-dialog", "aria-label": title });
  const m: Modal = { dialog, body, close: () => dialog.close() };
  const closeBtn = opts.dismissable === false ? null : h("button", { type: "button", class: "dialog-x", "aria-label": "Close", onclick: () => m.close() }, "×");
  body.append(h("div", { class: "dialog-head" }, h("h2", {}, title), closeBtn), ...(build(m).filter(Boolean) as (Node | string)[]));
  dialog.append(body);
  if (opts.dismissable === false) dialog.addEventListener("cancel", (e) => e.preventDefault());
  dialog.addEventListener("close", () => {
    opts.onClose?.();
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  return m;
}

/** Relative time like "3 min ago" or a short date. */
export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
