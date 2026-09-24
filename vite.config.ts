import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Plugin, defineConfig, loadEnv } from "vite";
import { analyticsTags } from "./site/analytics";
import { type Page, pageUrl, pages, renderAbout, renderHead } from "./site/pages";

// Public address of the site, used for canonical links, the sitemap and share
// previews. Set SITE_URL when building your own copy.
const SITE_URL = (process.env.SITE_URL || "https://text.compare").replace(/\/$/, "");

// Optional Google Analytics id, e.g. VITE_GA_ID=G-XXXXXXX in .env.local (not committed).
const GA_ID = loadEnv(process.env.NODE_ENV === "production" ? "production" : "development", process.cwd(), "VITE_").VITE_GA_ID;

function renderPage(html: string, page: Page, prefix: string): string {
  const config = JSON.stringify({ hint: page.hint, start: page.start ?? {} }).replace(/</g, "\\u003c");
  return html
    .replace(/<!--analytics-->/, analyticsTags(GA_ID))
    .replace(/<!--seo:head-->[\s\S]*?<!--\/seo:head-->/, `<!--seo:head-->\n    ${renderHead(page, SITE_URL)}\n    <!--/seo:head-->`)
    .replace(/<!--seo:config-->[\s\S]*?<!--\/seo:config-->/, `<!--seo:config--><script type="application/json" id="page-config">${config}</script><!--/seo:config-->`)
    .replace(/<!--seo:about-->[\s\S]*?<!--\/seo:about-->/, `<!--seo:about-->\n    ${renderAbout(page, pages, prefix)}\n    <!--/seo:about-->`);
}

/** Renders the home page content, then writes one page per landing page plus sitemap.xml and robots.txt. */
function seoPages(): Plugin {
  let outDir = "dist";
  return {
    name: "seo-pages",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => renderPage(html, pages[0], "./"),
    },
    closeBundle() {
      const home = readFileSync(join(outDir, "index.html"), "utf8");
      for (const page of pages.slice(1)) {
        const html = renderPage(home, page, "../").replace(/(href|src|content)="\.\//g, '$1="../');
        mkdirSync(join(outDir, page.slug), { recursive: true });
        writeFileSync(join(outDir, page.slug, "index.html"), html);
      }
      const today = new Date().toISOString().slice(0, 10);
      writeFileSync(
        join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          pages.map((p) => `  <url><loc>${pageUrl(SITE_URL, p)}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
          `\n</urlset>\n`,
      );
      writeFileSync(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [seoPages()],
  server: { port: 5173 },
  preview: { port: 8785 },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/**/*.test.ts"] },
} as any);
