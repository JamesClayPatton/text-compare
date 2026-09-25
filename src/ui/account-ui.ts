import { Account, CONTACT_TEXT, QUOTA_BYTES, accountsEnabled } from "../account/account";
import { WrongSecretError } from "../account/crypto";
import { type ComparisonBody, type ComparisonMeta, DeviceLibrary, type ItemKind, type Library, type LibraryItem } from "../account/library";
import { downloadText } from "../files";
import { ago, formatBytes, h, modal } from "./dom";
import { toast } from "./toast";

/** What the page gives the account features. */
export interface AppBridge {
  /** The comparison on screen, or null when there is nothing worth keeping. */
  current(): { meta: ComparisonMeta; body: ComparisonBody } | null;
  /** Put a saved comparison back on screen. */
  open(body: ComparisonBody): void;
  historyEnabled(): boolean;
  /** Called after a comparison is saved to the library. */
  saved?(): void;
}

const MIN_PASSPHRASE = 10;
const HISTORY_DELAY = 4000;

const icons = {
  google:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.4v2.8h3.6c2-1.9 3.2-4.7 3.2-8.2Z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.7H2v2.9A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.7 13.9a6.6 6.6 0 0 1 0-4.2V6.8H2a11 11 0 0 0 0 9.9l3.7-2.8Z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2 6.8l3.7 2.9C6.6 7.3 9.1 5.4 12 5.4Z"/></svg>',
};

function passphraseStrength(p: string): { score: number; label: string } {
  let score = 0;
  if (p.length >= MIN_PASSPHRASE) score++;
  if (p.length >= 16) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) score++;
  if (/\s/.test(p.trim()) && p.length >= 20) score++;
  const labels = ["Too short", "Weak", "Okay", "Good", "Strong", "Very strong"];
  return { score, label: p.length < MIN_PASSPHRASE ? `At least ${MIN_PASSPHRASE} characters` : labels[score] };
}

function busy(btn: HTMLButtonElement, text: string): () => void {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
  return () => {
    btn.disabled = false;
    btn.textContent = old;
  };
}

function field(label: string, input: HTMLInputElement, hint?: HTMLElement): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-name" }, label), input, hint ?? null);
}

export class AccountUI {
  private account: Account | null = null;
  private device = new DeviceLibrary();
  private historyId: string | null = null;
  private historyTimer = 0;
  private drawer!: HTMLElement;
  private tab: ItemKind = "saved";
  private query = "";

  constructor(private bridge: AppBridge, private accountBtn: HTMLButtonElement, private libraryBtn: HTMLButtonElement, saveBtn: HTMLButtonElement) {
    this.buildDrawer();
    libraryBtn.addEventListener("click", () => this.toggleDrawer());
    saveBtn.addEventListener("click", () => this.saveCurrent());
    accountBtn.hidden = !accountsEnabled;
    accountBtn.addEventListener("click", () => this.accountClicked());
    this.renderAccountButton();
    if (accountsEnabled) {
      // an OAuth or email-link return must be handled straight away; otherwise wait until the page is idle
      const returning = /[?&](code|error_description)=/.test(location.search);
      const start = () =>
        Account.start()
          .then((a) => {
            this.account = a;
            a?.onChange(() => this.onAccountChange());
            this.onAccountChange(true);
          })
          .catch(() => toast("Couldn't reach the account service. Saving works on this device for now.", "error", 6000));
      if (returning) void start();
      else ("requestIdleCallback" in window ? requestIdleCallback : setTimeout)(() => void start());
      if (/error_description=/.test(location.search)) {
        const msg = new URLSearchParams(location.search).get("error_description");
        toast(`Sign-in didn't finish: ${msg}`, "error", 7000);
      }
    }
  }

  /** Whether someone is signed in (unlocked or not). */
  get signedIn(): boolean {
    return !!this.account && this.account.status !== "signed-out";
  }

  /** Where saves and history go right now. */
  get library(): Library {
    return this.account?.status === "unlocked" && this.account.library ? this.account.library : this.device;
  }

  // ---------------------------------------------------------------- history

  /** Call after edits; the comparison is added to history once things settle. */
  noteChange(): void {
    clearTimeout(this.historyTimer);
    if (!this.bridge.historyEnabled()) return;
    this.historyTimer = window.setTimeout(() => void this.recordHistory(), HISTORY_DELAY);
  }

  /** Start a new history entry next time (after clearing, opening something, and so on). */
  startNewEntry(): void {
    clearTimeout(this.historyTimer);
    this.historyId = null;
  }

  private async recordHistory() {
    const cur = this.bridge.current();
    if (!cur) return;
    if (cur.body.a.length + cur.body.b.length > 8_000_000) return; // too big to keep; still works on screen
    this.historyId ??= crypto.randomUUID();
    try {
      await this.library.put({ id: this.historyId, kind: "history", ...cur });
      if (!this.drawer.hidden && this.tab === "history") void this.renderList();
    } catch {
      /* history is best-effort; saving explicitly reports errors */
    }
  }

  // ---------------------------------------------------------------- save

  async saveCurrent(): Promise<void> {
    const cur = this.bridge.current();
    if (!cur) return toast("Add some text to both sides first, then save.");
    if (this.account && this.account.status !== "unlocked" && this.account.status !== "signed-out") {
      this.accountClicked();
      return;
    }
    const where = this.library.where === "cloud" ? "your account, encrypted" : "this browser";
    const name = h("input", { type: "text", value: cur.meta.title, maxlength: 120, required: true, "aria-label": "Name" });
    modal("Save comparison", (m) => {
      const save = h("button", { type: "submit", class: "btn primary" }, "Save");
      const form = h(
        "form",
        {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const done = busy(save, "Saving…");
            try {
              await this.library.put({ id: crypto.randomUUID(), kind: "saved", meta: { ...cur.meta, title: name.value.trim() || cur.meta.title }, body: cur.body });
              m.close();
              toast(`Saved to ${this.library.where === "cloud" ? "your account" : "this browser"}`, "success");
              this.bridge.saved?.();
              if (!this.drawer.hidden) void this.renderList();
            } catch (err) {
              done();
              toast(err instanceof Error ? err.message : "Couldn't save.", "error", 6000);
            }
          },
        },
        field("Name", name),
        h("p", { class: "fine" }, `Saved to ${where}.`, !this.account || this.account.status === "signed-out" ? (accountsEnabled ? " Sign in to keep your saves on every device." : "") : ""),
        h("div", { class: "dialog-actions" }, save),
      );
      return [form];
    });
    name.select();
  }

  // ---------------------------------------------------------------- library drawer

  private buildDrawer() {
    const search = h("input", { type: "search", placeholder: "Search", "aria-label": "Search saved comparisons", oninput: (e: Event) => { this.query = (e.target as HTMLInputElement).value.toLowerCase(); void this.renderList(); } });
    const tabs = (["saved", "history"] as const).map((k) =>
      h("button", { type: "button", role: "tab", "data-tab": k, onclick: () => { this.tab = k; void this.renderList(); } }, k === "saved" ? "Saved" : "History"),
    );
    this.drawer = h(
      "aside",
      { class: "library", id: "library", hidden: true, "aria-label": "Library" },
      h("div", { class: "library-head" },
        h("h2", {}, "Library"),
        h("button", { type: "button", class: "dialog-x", "aria-label": "Close library", onclick: () => this.toggleDrawer(false) }, "×"),
      ),
      h("div", { class: "library-tabs seg", role: "tablist" }, ...tabs),
      search,
      h("div", { class: "library-note" }),
      h("div", { class: "library-list" }),
      h("div", { class: "library-foot" }),
    );
    this.drawer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.toggleDrawer(false);
    });
    document.body.append(this.drawer);
  }

  toggleDrawer(show: boolean = this.drawer.hidden === true): void {
    this.drawer.hidden = !show;
    this.libraryBtn.setAttribute("aria-expanded", String(show));
    document.body.classList.toggle("library-open", show);
    if (show) {
      void this.renderList();
      this.drawer.querySelector<HTMLInputElement>("input[type=search]")?.focus();
    }
  }

  private async renderList() {
    this.drawer.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === this.tab)));
    const list = this.drawer.querySelector(".library-list")!;
    const note = this.drawer.querySelector(".library-note")!;
    const foot = this.drawer.querySelector(".library-foot")!;
    const lib = this.library;
    const status = this.account?.status ?? "signed-out";

    note.replaceChildren();
    if (lib.where === "cloud") note.append(h("span", { class: "lock-badge" }, "Encrypted"), " Saved in your account. Only you can read these.");
    else if (status === "locked") note.append("Showing this browser only. ", h("button", { type: "button", class: "link", onclick: () => this.accountClicked() }, "Unlock your account"), " to see your saved comparisons.");
    else note.append("Saved in this browser only.", accountsEnabled ? " " : "", accountsEnabled ? h("button", { type: "button", class: "link", onclick: () => this.accountClicked() }, "Sign in") : "", accountsEnabled ? " to keep them on every device, encrypted." : "");

    foot.replaceChildren(
      this.tab === "saved"
        ? h("button", { type: "button", class: "btn primary wide", onclick: () => this.saveCurrent() }, "Save current comparison")
        : h("p", { class: "fine" }, this.bridge.historyEnabled() ? "Comparisons are added here as you work. Turn this off in Options." : "History is off. Turn it on in Options."),
    );

    list.replaceChildren(h("p", { class: "library-empty" }, "Loading…"));
    let items: LibraryItem[];
    try {
      items = await lib.list(this.tab);
    } catch (err) {
      list.replaceChildren(h("p", { class: "library-empty" }, err instanceof Error ? err.message : "Couldn't load your library."));
      return;
    }
    if (lib.where === "cloud") {
      const onDevice = [...(await this.device.list("saved")), ...(await this.device.list("history"))];
      if (onDevice.length) note.append(h("div", { class: "move-banner" }, `${onDevice.length} ${onDevice.length === 1 ? "comparison is" : "comparisons are"} still saved in this browser only. `, h("button", { type: "button", class: "link", onclick: () => this.moveDeviceItems() }, "Move them to your account")));
    }
    const q = this.query;
    const shown = q ? items.filter((i) => `${i.meta.title} ${i.meta.nameA} ${i.meta.nameB} ${i.meta.preview}`.toLowerCase().includes(q)) : items;
    if (!shown.length) {
      list.replaceChildren(h("p", { class: "library-empty" }, q ? "Nothing matches your search." : this.tab === "saved" ? "Nothing saved yet. Save a comparison to find it here later." : "No history yet."));
      return;
    }
    list.replaceChildren(...shown.map((item) => this.renderItem(item)));
  }

  private renderItem(item: LibraryItem): HTMLElement {
    const names = item.meta.nameA || item.meta.nameB ? `${item.meta.nameA || "Original"} and ${item.meta.nameB || "Changed"}, ` : "";
    const open = h(
      "button",
      { type: "button", class: "item-open", onclick: () => this.openItem(item) },
      h("span", { class: "item-title" }, item.meta.title || "Untitled comparison"),
      h("span", { class: "item-sub" }, `${names}${ago(item.updatedAt)}`),
      item.meta.preview ? h("span", { class: "item-preview" }, item.meta.preview) : null,
    );
    const actions = h("div", { class: "item-actions" });
    if (item.kind === "saved") actions.append(h("button", { type: "button", class: "icon-btn", title: "Rename", "aria-label": `Rename ${item.meta.title}`, onclick: () => this.renameItem(item) }, "✎"));
    if (item.kind === "history") actions.append(h("button", { type: "button", class: "icon-btn", title: "Save", "aria-label": `Save ${item.meta.title}`, onclick: () => this.keepHistoryItem(item) }, "★"));
    actions.append(h("button", { type: "button", class: "icon-btn danger", title: "Delete", "aria-label": `Delete ${item.meta.title}`, onclick: () => this.deleteItem(item) }, "✕"));
    return h("div", { class: "item" }, open, actions);
  }

  private async openItem(item: LibraryItem) {
    try {
      const body = await this.library.load(item.id);
      this.startNewEntry();
      if (item.kind === "history") this.historyId = item.id; // keep editing the same history entry
      this.bridge.open(body);
      if (matchMedia("(max-width: 760px)").matches) this.toggleDrawer(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't open that comparison.", "error", 6000);
    }
  }

  private renameItem(item: LibraryItem) {
    const name = h("input", { type: "text", value: item.meta.title, maxlength: 120, "aria-label": "Name" });
    modal("Rename", (m) => [
      h("form", {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            await this.library.rename(item.id, name.value.trim() || item.meta.title);
            m.close();
            void this.renderList();
          } catch (err) {
            toast(err instanceof Error ? err.message : "Couldn't rename.", "error");
          }
        },
      }, field("Name", name), h("div", { class: "dialog-actions" }, h("button", { type: "submit", class: "btn primary" }, "Rename"))),
    ]);
    name.select();
  }

  private async keepHistoryItem(item: LibraryItem) {
    try {
      const body = await this.library.load(item.id);
      await this.library.put({ id: crypto.randomUUID(), kind: "saved", meta: item.meta, body });
      toast("Saved", "success");
      this.bridge.saved?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.", "error");
    }
  }

  private async deleteItem(item: LibraryItem) {
    try {
      await this.library.remove(item.id);
      if (this.historyId === item.id) this.historyId = null;
      void this.renderList();
      toast("Deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete.", "error");
    }
  }

  private async moveDeviceItems() {
    const cloud = this.account?.library;
    if (!cloud) return;
    let moved = 0;
    try {
      for (const kind of ["saved", "history"] as const) {
        for (const item of await this.device.list(kind)) {
          await cloud.put({ id: item.id, kind, meta: item.meta, body: await this.device.load(item.id) });
          await this.device.remove(item.id);
          moved++;
        }
      }
      toast(`Moved ${moved} to your account`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't move everything. Try again.", "error", 6000);
    }
    void this.renderList();
  }

  // ---------------------------------------------------------------- account button and dialogs

  private onAccountChange(first = false) {
    this.renderAccountButton();
    this.startNewEntry();
    if (!this.drawer.hidden) void this.renderList();
    const s = this.account?.status;
    if (first && s === "needs-setup") this.setupDialog();
    if (first && s === "locked" && /[?&]code=/.test(location.search)) this.unlockDialog();
  }

  private renderAccountButton() {
    const s = this.account?.status ?? "signed-out";
    const btn = this.accountBtn;
    btn.classList.toggle("signed-in", s !== "signed-out");
    if (s === "signed-out") {
      btn.textContent = "Sign in";
      btn.title = "Sign in to save comparisons to your account";
    } else {
      const initial = (this.account!.user?.email || "?")[0].toUpperCase();
      btn.replaceChildren(h("span", { class: "avatar" }, initial), s === "unlocked" ? "" : h("span", { class: "lock-dot", title: "Locked" }));
      btn.title = s === "unlocked" ? "Your account" : s === "locked" ? "Unlock your account" : "Finish setting up your account";
    }
    btn.setAttribute("aria-label", btn.title);
  }

  accountClicked(): void {
    if (!accountsEnabled) return;
    if (!this.account) return toast("Still connecting to the account service. Try again in a moment.");
    const s = this.account.status;
    if (s === "signed-out") this.signInDialog();
    else if (s === "needs-setup") this.setupDialog();
    else if (s === "locked") this.unlockDialog();
    else this.accountDialog();
  }

  private signInDialog() {
    const acc = this.account!;
    const email = h("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", required: true, "aria-label": "Email address" });
    modal("Sign in", (m) => {
      const google = h("button", { type: "button", class: "btn provider" });
      google.innerHTML = `${icons.google}<span>Continue with Google</span>`;
      google.addEventListener("click", async () => {
        busy(google, "Opening Google…");
        try {
          await acc.signInWithGoogle();
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't start Google sign-in.", "error", 6000);
          m.close();
        }
      });
      const send = h("button", { type: "submit", class: "btn" }, "Email me a sign-in link");
      const form = h("form", {
        class: "email-form",
        onsubmit: async (e: Event) => {
          e.preventDefault();
          const done = busy(send, "Sending…");
          try {
            await acc.signInWithEmail(email.value.trim());
            form.replaceChildren(h("p", { class: "sent" }, h("b", {}, "Check your email."), ` We sent a sign-in link to ${email.value.trim()}. Open it in this browser to finish signing in.`));
          } catch (err) {
            done();
            toast(err instanceof Error ? err.message : "Couldn't send the link.", "error", 6000);
          }
        },
      }, email, send);
      return [
        h("p", {}, "Save comparisons and come back to them on any device. What you save is encrypted in your browser with a passphrase only you know, so nobody else can read it."),
        google,
        h("div", { class: "or" }, h("span", {}, "or")),
        form,
        h("p", { class: "fine" }, "Your email address is used only to sign you in."),
      ];
    });
  }

  private setupDialog() {
    const acc = this.account!;
    const pass = h("input", { type: "password", autocomplete: "new-password", minlength: MIN_PASSPHRASE, required: true });
    const again = h("input", { type: "password", autocomplete: "new-password", required: true });
    const meter = h("span", { class: "meter" }, h("span", {}), h("em", {}, `At least ${MIN_PASSPHRASE} characters`));
    const keep = h("input", { type: "checkbox", checked: true });
    pass.addEventListener("input", () => {
      const s = passphraseStrength(pass.value);
      meter.dataset.score = String(s.score);
      meter.querySelector("em")!.textContent = s.label;
    });
    modal("Create your passphrase", (m) => {
      const create = h("button", { type: "submit", class: "btn primary" }, "Create passphrase");
      return [
        h("p", {}, "Everything you save is encrypted with this passphrase before it leaves your browser. Nobody else ever sees it, and it can't be reset, so choose something you'll remember. A short sentence works well."),
        h("form", {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            if (pass.value.length < MIN_PASSPHRASE) return toast(`Use at least ${MIN_PASSPHRASE} characters.`, "error");
            if (pass.value !== again.value) return toast("The two passphrases don't match.", "error");
            const done = busy(create, "Creating your key…");
            try {
              const code = await acc.setUp(pass.value, keep.checked);
              m.close();
              this.recoveryCodeDialog(code, true);
            } catch (err) {
              done();
              toast(err instanceof Error ? err.message : "Couldn't set up encryption.", "error", 6000);
            }
          },
        },
          field("Passphrase", pass, meter),
          field("Type it again", again),
          h("label", { class: "check" }, keep, " Stay unlocked on this device"),
          h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => { m.close(); void acc.signOut(); } }, "Sign out"), create),
        ),
      ];
    });
    pass.focus();
  }

  private recoveryCodeDialog(code: string, first: boolean) {
    const ok = h("input", { type: "checkbox" });
    modal("Save your recovery code", (m) => {
      const done = h("button", { type: "button", class: "btn primary", disabled: true, onclick: () => m.close() }, "Done");
      ok.addEventListener("change", () => (done.disabled = !ok.checked));
      return [
        h("p", {}, "If you forget your passphrase, this code is the only way back into your saved comparisons. Keep it somewhere safe, like a password manager. It won't be shown again."),
        h("div", { class: "recovery-code", "aria-label": "Recovery code" }, code),
        h("div", { class: "row" },
          h("button", { type: "button", class: "btn", onclick: async () => { try { await navigator.clipboard.writeText(code); toast("Recovery code copied", "success"); } catch { toast("Copy blocked. Select the code and copy it.", "error"); } } }, "Copy"),
          h("button", { type: "button", class: "btn", onclick: () => downloadText("text-compare-recovery-code.txt", `text.compare recovery code for ${this.account?.user?.email ?? "your account"}\n\n${code}\n\nKeep this somewhere safe. It unlocks your saved comparisons if you forget your passphrase.\n`) }, "Download"),
        ),
        h("label", { class: "check" }, ok, " I've saved my recovery code"),
        h("div", { class: "dialog-actions" }, done),
      ];
    }, { dismissable: false, onClose: () => { if (first) toast("You're all set. Saves now go to your account, encrypted.", "success", 5000); } });
  }

  private unlockDialog() {
    const acc = this.account!;
    let recovery = false;
    const secret = h("input", { type: "password", autocomplete: "current-password", required: true });
    const keep = h("input", { type: "checkbox", checked: true });
    const label = h("span", { class: "field-name" }, "Passphrase");
    modal("Unlock your library", (m) => {
      const unlock = h("button", { type: "submit", class: "btn primary" }, "Unlock");
      const toggle = h("button", { type: "button", class: "link" }, "Use your recovery code instead");
      toggle.addEventListener("click", () => {
        recovery = !recovery;
        label.textContent = recovery ? "Recovery code" : "Passphrase";
        secret.type = recovery ? "text" : "password";
        secret.autocomplete = recovery ? "off" : "current-password";
        toggle.textContent = recovery ? "Use your passphrase instead" : "Use your recovery code instead";
        secret.value = "";
        secret.focus();
      });
      return [
        h("p", {}, `Signed in as ${acc.user?.email}. Enter your passphrase to decrypt your saved comparisons in this browser.`),
        h("form", {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const done = busy(unlock, "Unlocking…");
            try {
              if (recovery) {
                const code = secret.value;
                await acc.unlockWithRecovery(code, keep.checked);
                m.close();
                this.changePassphraseDialog(code);
              } else {
                await acc.unlock(secret.value, keep.checked);
                m.close();
                toast("Unlocked", "success");
              }
            } catch (err) {
              done();
              toast(err instanceof WrongSecretError ? err.message : err instanceof Error ? err.message : "Couldn't unlock.", "error", 5000);
              secret.select();
            }
          },
        },
          h("label", { class: "field" }, label, secret),
          h("label", { class: "check" }, keep, " Stay unlocked on this device"),
          toggle,
          h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => { m.close(); void acc.signOut(); } }, "Sign out"), unlock),
        ),
      ];
    });
    secret.focus();
  }

  private changePassphraseDialog(recoveryCode?: string) {
    const acc = this.account!;
    const current = h("input", { type: "password", autocomplete: "current-password", required: !recoveryCode });
    const next = h("input", { type: "password", autocomplete: "new-password", minlength: MIN_PASSPHRASE, required: true });
    const again = h("input", { type: "password", autocomplete: "new-password", required: true });
    modal(recoveryCode ? "Choose a new passphrase" : "Change passphrase", (m) => {
      const save = h("button", { type: "submit", class: "btn primary" }, "Save passphrase");
      return [
        recoveryCode ? h("p", {}, "You unlocked with your recovery code. Choose a new passphrase for next time. Your recovery code keeps working.") : null,
        h("form", {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            if (next.value.length < MIN_PASSPHRASE) return toast(`Use at least ${MIN_PASSPHRASE} characters.`, "error");
            if (next.value !== again.value) return toast("The two new passphrases don't match.", "error");
            const done = busy(save, "Saving…");
            try {
              await acc.changePassphrase(recoveryCode ?? current.value, next.value, Boolean(recoveryCode));
              m.close();
              toast("Passphrase changed", "success");
            } catch (err) {
              done();
              toast(err instanceof Error ? err.message : "Couldn't change the passphrase.", "error", 5000);
            }
          },
        },
          recoveryCode ? null : field("Current passphrase", current),
          field("New passphrase", next),
          field("Type it again", again),
          h("div", { class: "dialog-actions" }, recoveryCode ? h("button", { type: "button", class: "btn", onclick: () => m.close() }, "Later") : null, save),
        ),
      ];
    });
    (recoveryCode ? next : current).focus();
  }

  private contactToggle(acc: Account): HTMLElement {
    const box = h("input", { type: "checkbox", checked: acc.user?.contactOk === true });
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        await acc.setContactOk(box.checked);
        toast(box.checked ? "You'll hear about new apps now and then" : "No more emails about other apps", "success");
      } catch (err) {
        box.checked = !box.checked;
        toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
      }
      box.disabled = false;
    });
    return h("label", { class: "check contact-check" }, box, ` ${CONTACT_TEXT}`);
  }

  private accountDialog() {
    const acc = this.account!;
    const usage = h("div", { class: "usage" }, "Loading usage…");
    void acc.usage().then(
      (u) => {
        const pct = Math.min(100, (u.bytesUsed / QUOTA_BYTES) * 100);
        usage.replaceChildren(
          h("div", { class: "usage-bar" }, h("span", { style: `width:${pct.toFixed(1)}%` })),
          h("span", {}, `${formatBytes(u.bytesUsed)} of ${formatBytes(QUOTA_BYTES)} used, ${u.savedCount} saved, ${u.historyCount} in history`),
        );
      },
      () => usage.replaceChildren("Couldn't load usage."),
    );
    modal("Your account", (m) => {
      const provider = acc.user?.provider === "google" ? "Google" : "an email link";
      const exportBtn = h("button", { type: "button", class: "btn" }, "Export my data");
      exportBtn.addEventListener("click", async () => {
        const done = busy(exportBtn, "Exporting…");
        try {
          const data = await acc.exportAll();
          downloadText(`text-compare-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), "application/json");
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't export.", "error");
        }
        done();
      });
      return [
        h("p", { class: "who" }, h("b", {}, acc.user?.email ?? ""), h("br"), `Signed in with ${provider}. `, h("span", { class: "lock-badge" }, "Encrypted")),
        usage,
        this.contactToggle(acc),
        h("div", { class: "account-actions" },
          exportBtn,
          h("button", { type: "button", class: "btn", onclick: () => { m.close(); this.changePassphraseDialog(); } }, "Change passphrase"),
          h("button", { type: "button", class: "btn", onclick: () => { m.close(); this.newRecoveryCodeDialog(); } }, "New recovery code"),
          h("button", { type: "button", class: "btn", onclick: async () => { await acc.lock(); m.close(); toast("Locked. Your passphrase is needed to see your saves again."); } }, "Lock now"),
          h("button", { type: "button", class: "btn", onclick: async () => { await acc.signOut(); m.close(); toast("Signed out"); } }, "Sign out"),
        ),
        h("details", { class: "danger-zone" },
          h("summary", {}, "Delete data or account"),
          h("p", {}, "These can't be undone. Export your data first if you might want it later."),
          h("div", { class: "account-actions" },
            h("button", { type: "button", class: "btn danger", onclick: () => { m.close(); this.deleteDataDialog(); } }, "Delete all my saved data"),
            h("button", { type: "button", class: "btn danger", onclick: () => { m.close(); this.deleteAccountDialog(); } }, "Delete my account"),
          ),
        ),
      ];
    });
  }

  private newRecoveryCodeDialog() {
    const acc = this.account!;
    const pass = h("input", { type: "password", autocomplete: "current-password", required: true });
    modal("New recovery code", (m) => {
      const go = h("button", { type: "submit", class: "btn primary" }, "Make a new code");
      return [
        h("p", {}, "Your old recovery code will stop working. Enter your passphrase to continue."),
        h("form", {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const done = busy(go, "Working…");
            try {
              const code = await acc.newRecoveryCode(pass.value);
              m.close();
              this.recoveryCodeDialog(code, false);
            } catch (err) {
              done();
              toast(err instanceof Error ? err.message : "Couldn't make a new code.", "error");
            }
          },
        }, field("Passphrase", pass), h("div", { class: "dialog-actions" }, go)),
      ];
    });
    pass.focus();
  }

  private confirmDialog(title: string, text: string, word: string, action: string, run: () => Promise<void>, extra?: HTMLElement) {
    const typed = h("input", { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": `Type ${word} to confirm` });
    modal(title, (m) => {
      const go = h("button", { type: "submit", class: "btn danger", disabled: true }, action);
      typed.addEventListener("input", () => (go.disabled = typed.value.trim() !== word));
      return [
        h("p", {}, text),
        h("form", {
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const done = busy(go, "Deleting…");
            try {
              await run();
              m.close();
            } catch (err) {
              done();
              toast(err instanceof Error ? err.message : "Couldn't delete.", "error", 6000);
            }
          },
        },
          extra ?? null,
          h("label", { class: "field" }, h("span", { class: "field-name" }, `Type ${word} to confirm`), typed),
          h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", onclick: () => m.close() }, "Cancel"), go),
        ),
      ];
    });
    typed.focus();
  }

  private deleteDataDialog() {
    const acc = this.account!;
    const reset = h("input", { type: "checkbox" });
    this.confirmDialog(
      "Delete all saved data",
      "Every saved comparison and all history in your account will be permanently deleted. You stay signed in.",
      "DELETE",
      "Delete everything",
      async () => {
        await acc.deleteAllData(reset.checked);
        this.startNewEntry();
        if (!this.drawer.hidden) void this.renderList();
        toast("All saved data deleted", "success");
        if (reset.checked) this.setupDialog();
      },
      h("label", { class: "check" }, reset, " Also reset my passphrase and recovery code"),
    );
  }

  private deleteAccountDialog() {
    const acc = this.account!;
    this.confirmDialog(
      "Delete your account",
      "Your account, every saved comparison and all history will be permanently deleted, and you'll be signed out. Comparisons kept in this browser only are not affected.",
      acc.user?.email ?? "DELETE",
      "Delete my account",
      async () => {
        await acc.deleteAccount();
        this.startNewEntry();
        if (!this.drawer.hidden) void this.renderList();
        toast("Your account has been deleted", "success", 5000);
      },
    );
  }
}
