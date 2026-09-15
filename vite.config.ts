import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5173 },
  preview: { port: 8785 },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
