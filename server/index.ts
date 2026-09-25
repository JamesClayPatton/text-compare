// Optional server for anonymous usage counts and the admin panel.
// Run with Node 24 or newer:  node server/index.ts
// Settings come from server/.env (see server/.env.example) or the environment.

import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { AdminAuth } from "./auth.ts";
import { UsageStore } from "./store.ts";
import { SupabaseAdmin } from "./supabase.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** KEY=value lines; values already in the environment win. */
function loadEnv(file: string) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadEnv(resolve(here, ".env"));
const env = process.env;

const dbPath = resolve(here, env.USAGE_DB ?? "data/usage.db");
mkdirSync(dirname(dbPath), { recursive: true });

const store = new UsageStore(dbPath);
const auth = env.ADMIN_PASSWORD ? new AdminAuth(env.ADMIN_PASSWORD, env.SESSION_SECRET || undefined) : null;
const supabase = env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? new SupabaseAdmin(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY) : null;

const port = Number(env.PORT ?? 8786);
const host = env.HOST ?? "127.0.0.1";
createServer(createApp({ store, auth, supabase })).listen(port, host, () => {
  console.log(`text.compare api on http://${host}:${port} (admin ${auth ? "on" : "off: no ADMIN_PASSWORD"}, accounts ${supabase ? "on" : "off"})`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
}
