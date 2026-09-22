import { type DataChange, type TableDiff, csvDiff, jsonDiff, structureOf } from "../structure";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MAX_ROWS = 2000;

function show(v: unknown): string {
  if (v === undefined) return "";
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v, null, 1);
  return esc(s.length > 400 ? s.slice(0, 400) + "…" : s);
}

function plural(n: number, one: string, many = one + "s") {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function renderJson(changes: DataChange[]): string {
  if (!changes.length) return `<p class="data-empty">Same data. Only formatting or key order differs, if anything.</p>`;
  const counts = { added: 0, removed: 0, changed: 0 };
  changes.forEach((c) => counts[c.kind]++);
  const rows = changes.slice(0, MAX_ROWS).map((c) => {
    const before = c.kind === "added" ? "" : show(c.before);
    const after = c.kind === "removed" ? "" : show(c.after);
    return `<tr class="dk-${c.kind}"><td class="kind">${c.kind}</td><td class="path"><code>${esc(c.path)}</code></td><td class="val"><code>${before}</code></td><td class="val"><code>${after}</code></td></tr>`;
  });
  return `<p class="data-summary">JSON compared by structure: <b class="c-add">${plural(counts.added, "addition")}</b>, <b class="c-del">${plural(counts.removed, "removal")}</b>, <b class="c-mod">${plural(counts.changed, "changed value")}</b>. Key order is ignored, and lists of objects are matched by their id.</p>
<div class="data-scroll"><table class="data-table"><thead><tr><th>Change</th><th>Path</th><th>Original</th><th>Changed</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
${changes.length > MAX_ROWS ? `<p class="data-note">Showing the first ${MAX_ROWS.toLocaleString()} of ${changes.length.toLocaleString()} differences.</p>` : ""}`;
}

function renderTable(d: TableDiff): string {
  const counts = { added: 0, removed: 0, changed: 0 };
  d.rows.forEach((r) => counts[r.kind]++);
  const cols = d.columns;
  const notes: string[] = [];
  if (d.keyColumn) notes.push(`Rows matched by <b>${esc(d.keyColumn)}</b>.`);
  else notes.push("No unique first column, so rows are matched by order.");
  if (d.columnsAdded.length) notes.push(`New columns: <b class="c-add">${d.columnsAdded.map(esc).join(", ")}</b>.`);
  if (d.columnsRemoved.length) notes.push(`Removed columns: <b class="c-del">${d.columnsRemoved.map(esc).join(", ")}</b>.`);

  const body = d.rows.slice(0, MAX_ROWS).map((r) => {
    if (r.kind === "changed") {
      const cells = cols.map((_, i) => {
        if (!r.changedColumns.includes(i)) return `<td>${esc(r.after[i] ?? "")}</td>`;
        const name = cols[i];
        const before = beforeValue(d, r.before, name);
        return `<td class="cell-changed"><del>${esc(before)}</del><ins>${esc(r.after[i] ?? "")}</ins></td>`;
      });
      return `<tr class="dk-changed"><td class="kind">changed</td><td class="key">${esc(r.key)}</td>${cells.join("")}</tr>`;
    }
    const values = r.kind === "added" ? r.after : r.before;
    const cells = cols.map((name, i) => `<td>${esc((r.kind === "added" ? values[i] : beforeValue(d, values, name)) ?? "")}</td>`);
    return `<tr class="dk-${r.kind}"><td class="kind">${r.kind}</td><td class="key">${esc(r.key)}</td>${cells.join("")}</tr>`;
  });

  return `<p class="data-summary">Table compared by rows: <b class="c-add">${plural(counts.added, "row")} added</b>, <b class="c-del">${plural(counts.removed, "row")} removed</b>, <b class="c-mod">${plural(counts.changed, "row")} changed</b> (${d.rowCountA.toLocaleString()} rows before, ${d.rowCountB.toLocaleString()} after). ${notes.join(" ")}</p>
${d.rows.length ? `<div class="data-scroll"><table class="data-table"><thead><tr><th>Change</th><th>Row</th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body.join("")}</tbody></table></div>` : `<p class="data-empty">Every row matches.</p>`}
${d.rows.length > MAX_ROWS ? `<p class="data-note">Showing the first ${MAX_ROWS.toLocaleString()} of ${d.rows.length.toLocaleString()} changed rows.</p>` : ""}`;
}

/** Look up a value in an original-table row by column name. */
function beforeValue(d: TableDiff, row: string[], name: string): string {
  const i = d.columnsBefore.indexOf(name);
  return i >= 0 ? row[i] ?? "" : "";
}

export function renderDataPanel(el: HTMLElement, a: string, b: string): void {
  if (!a.trim() || !b.trim()) {
    el.innerHTML = `<p class="data-empty">Add JSON, CSV or TSV to both sides to compare them as data.</p>`;
    return;
  }
  const sa = structureOf(a), sb = structureOf(b);
  if (sa?.kind === "json" && sb?.kind === "json") {
    el.innerHTML = renderJson(jsonDiff(sa.value, sb.value));
    return;
  }
  if (sa?.kind === "table" && sb?.kind === "table") {
    el.innerHTML = renderTable(csvDiff(a, b));
    return;
  }
  const what = (s: typeof sa) => (s ? (s.kind === "json" ? "JSON" : "a table") : "plain text");
  el.innerHTML = `<p class="data-empty">The Data view compares JSON with JSON, or CSV/TSV tables with each other. The original is ${what(sa)} and the changed side is ${what(sb)}.</p>`;
}

/** Whether both sides hold the same kind of structured data. */
export function dataAvailable(a: string, b: string): boolean {
  const sa = structureOf(a), sb = structureOf(b);
  return !!sa && !!sb && sa.kind === sb.kind;
}
