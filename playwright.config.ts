import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    // its own output folder, so running the tests never replaces the site served from dist/
    command: "npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    // tests run without analytics so they can check the page makes no outside requests
    // and with placeholder account settings, so they behave the same with or without .env.local
    env: {
      VITE_GA_ID: "",
      VITE_SUPABASE_URL: "https://e2e-placeholder.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-placeholder-key",
      VITE_SUPABASE_ANON_KEY: "",
    },
  },
});
