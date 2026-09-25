// The admin panel: sign in with the server's ADMIN_PASSWORD, then see usage
// counts and accounts. It only ever gets counts and account details from the
// server, never anything anyone compared or saved.

import "./admin.css";
import { ago, formatBytes, h } from "../ui/dom";

interface AdminUser {
  email: string;
  provider: string;
  createdAt: string;
  lastSignInAt: string | null;
  contactOk: boolean;
  contactConsentAt: string | null;
  saved: number;
  history: number;
  bytes: number;
  lastActivity: string | null;
}

interface Stats {
  generatedAt: string;
  today: string;
  days: number;
  usage: {
    totals: { today: number; d7: number; d30: number; all: number };
    daily: { day: string; compares: number }[];
    breakdown: Record<"kind" | "view" | "page" | "size" | "source" | "signed_in", Record<string, number>>;
    features: { range: Record<string, number>; all: Record<string, number> };
    imports: Record<string, number>;
  };
  accounts: {
    total: number;
    new7: number;
    new30: number;
    active30: number;
    contactOk: number;
    withLibrary: number;
    signupsByDay: Record<string, number>;
  } | null;
  users: AdminUser[] | null;
  accountsError: string | null;
}

const root = document.getElementById("admin")!;
const RANGE_KEY = "text-compare:admin-days";
let days = (() => {
  try {
    return Number(localStorage.getItem(RANGE_KEY)) || 30;
  } catch {
    return 30;
  }
})();

const fmt = (n: number) => n.toLocaleString();
const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
const dateLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const LABELS: Record<string, Record<string, string>> = {
  kind: { text: "Plain text", code: "Code", json: "JSON", document: "Document (prose)", word: "Word files", excel: "Excel files", pdf: "PDF files", data: "Data (CSV/JSON rows)", image: "Images" },
  view: { split: "Side by side", unified: "Unified", data: "Data table", image: "Image" },
  page: { home: "Home page" },
  size: { "<100": "Under 100 lines", "100-1k": "100 – 1,000 lines", "1k-10k": "1,000 – 10,000 lines", "10k+": "Over 10,000 lines", "-": "Images (no lines)" },
  source: { typing: "Typed", paste: "Pasted", file: "Opened files", share: "Share link", library: "From library" },
  signed_in: { yes: "Signed in", no: "Not signed in" },
  feature: { share: "Share links copied", report_export: "Reports downloaded", report_print: "Reports printed", file_import: "Files opened", library_save: "Saved to library" },
  import: { text: "Text files", word: "Word", excel: "Excel", pdf: "PDF", image: "Images" },
  provider: { google: "Google", email: "Email link" },
};
const label = (group: string, key: string) => LABELS[group]?.[key] ?? key;

// ---------------------------------------------------------------- server calls

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/admin/${path}`, { credentials: "same-origin", cache: "no-store", ...init });
}

async function load() {
  root.replaceChildren(h("p", { class: "muted" }, "Loading…"));
  let res: Response;
  try {
    res = await api(`stats?days=${days}`);
  } catch {
    return showMessage("Couldn't reach the admin server. Is it running?");
  }
  if (res.status === 401) return showLogin();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return showMessage(body.error ?? `The server answered ${res.status}.`);
  }
  render((await res.json()) as Stats);
}

function showMessage(text: string) {
  root.replaceChildren(h("div", { class: "login" }, h("h1", {}, "text.compare admin"), h("p", {}, text), h("button", { type: "button", class: "btn", onclick: () => void load() }, "Try again")));
}

function showLogin() {
  const password = h("input", { type: "password", autocomplete: "current-password", required: true, "aria-label": "Password", placeholder: "Password" });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn primary" }, "Sign in");
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const res = await api("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: password.value }) });
          if (res.ok) return void load();
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          error.textContent = body.error ?? "Couldn't sign in.";
        } catch {
          error.textContent = "Couldn't reach the admin server.";
        }
        submit.disabled = false;
        password.select();
      },
    },
    password,
    submit,
    error,
  );
  root.replaceChildren(h("div", { class: "login" }, h("h1", {}, "text.compare admin"), h("p", { class: "muted" }, "Usage counts and accounts. Nobody's text is ever shown here."), form));
  password.focus();
}

// ---------------------------------------------------------------- pieces

function tile(labelText: string, value: string, title?: string): HTMLElement {
  return h("div", { class: "tile", title }, h("div", { class: "label" }, labelText), h("div", { class: "value num" }, value));
}

/** A nice round top for the y axis. */
function niceMax(n: number): number {
  if (n <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** Column chart of one series per day, with a hover/focus tooltip and a table view. */
function columnChart(title: string, series: { day: string; value: number }[], unit: string): HTMLElement {
  const card = h("section", { class: "card wide" }, h("h2", {}, title));
  const total = series.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    card.append(h("p", { class: "empty" }, `No ${unit} in this period yet.`));
    return card;
  }
  const max = niceMax(Math.max(...series.map((d) => d.value)));
  const tip = h("div", { class: "tip", hidden: true });
  const cols = h("div", { class: "cols" });
  const plot = h("div", { class: "plot" });
  for (const f of [1, 0.5]) {
    plot.append(h("div", { class: "gl", style: `top:${(1 - f) * 100}%` }), h("div", { class: "yl num", style: `top:${(1 - f) * 100}%` }, fmt(max * f)));
  }
  plot.append(h("div", { class: "yl num", style: "top:100%" }, "0"), cols);
  const chart = h("div", { class: "chart" }, plot, h("div", { class: "xl" }, h("span", {}, dateLabel(series[0].day)), h("span", {}, dateLabel(series.at(-1)!.day))), tip);
  const show = (el: HTMLElement, d: { day: string; value: number }) => {
    tip.textContent = `${dateLabel(d.day)}: ${fmt(d.value)} ${unit}`;
    const r = el.getBoundingClientRect();
    const c = chart.getBoundingClientRect();
    tip.style.left = `${r.left - c.left + r.width / 2}px`;
    tip.style.top = `${Math.max(0, r.top - c.top + (1 - d.value / max) * r.height)}px`;
    tip.hidden = false;
  };
  for (const d of series) {
    const col = h("div", { class: "c", tabindex: 0, "aria-label": `${dateLabel(d.day)}: ${fmt(d.value)} ${unit}` }, h("span", { style: `height:${(d.value / max) * 100}%` }));
    col.addEventListener("mouseenter", () => show(col, d));
    col.addEventListener("focus", () => show(col, d));
    col.addEventListener("mouseleave", () => (tip.hidden = true));
    col.addEventListener("blur", () => (tip.hidden = true));
    cols.append(col);
  }
  const rows = [...series].reverse().map((d) => h("tr", {}, h("td", {}, d.day), h("td", { class: "r num" }, fmt(d.value))));
  card.append(
    chart,
    h("details", {}, h("summary", {}, "Show as a table"), h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Day"), h("th", { class: "r" }, unit))), h("tbody", {}, ...rows)))),
  );
  return card;
}

/** Horizontal bars for a breakdown, largest first. */
function barList(title: string, group: string, counts: Record<string, number>): HTMLElement {
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const max = entries[0]?.[1] ?? 0;
  const list = h("ul", { class: "bars" });
  for (const [k, n] of entries) {
    list.append(
      h("li", { title: `${label(group, k)}: ${fmt(n)} (${pct(n, total)})` },
        h("span", {}, label(group, k)),
        h("span", { class: "track" }, h("span", { class: "fill", style: `width:${(n / max) * 100}%` })),
        h("span", { class: "val num" }, `${fmt(n)} · ${pct(n, total)}`),
      ),
    );
  }
  return h("section", { class: "card" }, h("h2", {}, title), entries.length ? list : h("p", { class: "empty" }, "Nothing yet."));
}

function featuresCard(s: Stats): HTMLElement {
  const names = ["share", "report_export", "report_print", "file_import", "library_save"];
  const rows = names.map((n) =>
    h("tr", {}, h("td", {}, label("feature", n)), h("td", { class: "r num" }, fmt(s.usage.features.range[n] ?? 0)), h("td", { class: "r num" }, fmt(s.usage.features.all[n] ?? 0))),
  );
  return h("section", { class: "card" }, h("h2", {}, "Features used"),
    h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", { class: "r" }, `Last ${s.days} days`), h("th", { class: "r" }, "All time"))), h("tbody", {}, ...rows)),
  );
}

type SortKey = "email" | "provider" | "createdAt" | "lastSignInAt" | "saved" | "history" | "bytes" | "lastActivity" | "contactOk";

function usersCard(users: AdminUser[]): HTMLElement {
  let sort: SortKey = "createdAt";
  let desc = true;
  let query = "";
  const tbody = h("tbody");
  const count = h("span", { class: "muted" });
  const cols: [SortKey, string, boolean][] = [
    ["email", "Email", false], ["provider", "Sign-in", false], ["createdAt", "Joined", false], ["lastSignInAt", "Last sign-in", false],
    ["saved", "Saved", true], ["history", "History", true], ["bytes", "Storage", true], ["lastActivity", "Last save", false], ["contactOk", "OK to email", false],
  ];
  const head = h("tr");
  const paint = () => {
    const q = query.toLowerCase();
    const list = users.filter((u) => u.email.toLowerCase().includes(q));
    const val = (u: AdminUser) => {
      const v = u[sort];
      return typeof v === "string" ? v.toLowerCase() : typeof v === "boolean" ? Number(v) : v ?? "";
    };
    list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (desc ? -1 : 1));
    tbody.replaceChildren(
      ...list.map((u) =>
        h("tr", {},
          h("td", {}, u.email),
          h("td", {}, label("provider", u.provider)),
          h("td", { title: u.createdAt }, ago(u.createdAt)),
          h("td", { title: u.lastSignInAt ?? "" }, u.lastSignInAt ? ago(u.lastSignInAt) : "never"),
          h("td", { class: "r num" }, fmt(u.saved)),
          h("td", { class: "r num" }, fmt(u.history)),
          h("td", { class: "r num" }, formatBytes(u.bytes)),
          h("td", { title: u.lastActivity ?? "" }, u.lastActivity ? ago(u.lastActivity) : "none"),
          h("td", { class: u.contactOk ? "yes" : "no", title: u.contactConsentAt ? `Chosen ${u.contactConsentAt}` : "Not chosen" }, u.contactOk ? "Yes" : "No"),
        ),
      ),
    );
    count.textContent = list.length === users.length ? `${fmt(users.length)} accounts` : `${fmt(list.length)} of ${fmt(users.length)}`;
    head.replaceChildren(
      ...cols.map(([key, text, right]) =>
        h("th", { class: right ? "r" : undefined, "aria-sort": key === sort ? (desc ? "descending" : "ascending") : undefined },
          h("button", { type: "button", onclick: () => { desc = key === sort ? !desc : key !== "email" && key !== "provider"; sort = key; paint(); } }, text + (key === sort ? (desc ? " ↓" : " ↑") : "")),
        ),
      ),
    );
  };
  const search = h("input", { type: "search", placeholder: "Find an email", "aria-label": "Find an email", oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; paint(); } });
  const copy = h("button", { type: "button", class: "btn" }, "Copy emails of people OK to email");
  copy.addEventListener("click", async () => {
    const list = users.filter((u) => u.contactOk).map((u) => u.email).join(", ");
    try {
      await navigator.clipboard.writeText(list);
      copy.textContent = `Copied ${users.filter((u) => u.contactOk).length}`;
    } catch {
      prompt("Copy these addresses:", list);
    }
  });
  paint();
  return h("section", { class: "card wide" }, h("h2", {}, "Accounts"),
    h("div", { class: "users-tools" }, search, count, copy),
    h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, head), tbody)),
  );
}

// ---------------------------------------------------------------- the page

function render(s: Stats) {
  const range = h("select", { "aria-label": "Period" });
  for (const d of [7, 30, 90, 365]) range.append(new Option(d === 365 ? "Last year" : `Last ${d} days`, String(d), false, d === s.days));
  range.addEventListener("change", () => {
    days = Number(range.value);
    try {
      localStorage.setItem(RANGE_KEY, String(days));
    } catch {
      /* fine */
    }
    void load();
  });
  const logout = h("button", { type: "button", class: "btn" }, "Sign out");
  logout.addEventListener("click", async () => {
    await api("logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  const t = s.usage.totals;
  const a = s.accounts;
  const tiles = h("div", { class: "tiles" },
    tile("Today", fmt(t.today), "Comparisons today (UTC)"),
    tile("Last 7 days", fmt(t.d7), "Comparisons"),
    tile("Last 30 days", fmt(t.d30)),
    tile("All time", fmt(t.all)),
    ...(a
      ? [
          tile("Accounts", fmt(a.total)),
          tile("New in 7 days", fmt(a.new7)),
          tile("Active in 30 days", fmt(a.active30), "Signed in or saved something in the last 30 days"),
          tile("OK to email", `${fmt(a.contactOk)} (${pct(a.contactOk, a.total)})`),
        ]
      : []),
  );

  const b = s.usage.breakdown;
  const page: HTMLElement[] = [
    h("header", { class: "top" },
      h("h1", {}, "text.compare admin"),
      range,
      h("button", { type: "button", class: "btn", onclick: () => void load() }, "Refresh"),
      logout,
      h("span", { class: "stamp" }, `Updated ${new Date(s.generatedAt).toLocaleString()}. Counts are anonymous: what kind of comparison, never what was compared.`),
    ),
  ];
  if (s.accountsError) page.push(h("div", { class: "banner" }, s.accountsError));
  page.push(
    tiles,
    columnChart("Comparisons per day", s.usage.daily.map((d) => ({ day: d.day, value: d.compares })), "comparisons"),
  );
  if (a) {
    page.push(columnChart("Sign-ups per day", s.usage.daily.map((d) => ({ day: d.day, value: a.signupsByDay[d.day] ?? 0 })), "sign-ups"));
  }
  page.push(
    h("div", { class: "grid" },
      barList("What people compare", "kind", b.kind),
      barList("How big", "size", b.size),
      barList("Where the text came from", "source", b.source),
      barList("View", "view", b.view),
      barList("Landing page", "page", b.page),
      barList("Signed in?", "signed_in", b.signed_in),
      featuresCard(s),
      barList("Files opened, by type", "import", s.usage.imports),
    ),
  );
  if (s.users) page.push(usersCard(s.users));
  root.replaceChildren(...page);
}

void load();
