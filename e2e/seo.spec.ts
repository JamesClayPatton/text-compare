import { expect, test } from "@playwright/test";

const landing = ["", "json-compare/", "pdf-compare/", "word-compare/", "excel-compare/", "image-compare/", "code-compare/"];

for (const path of landing) {
  test(`page /${path} has its own title, heading and a working tool`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto("/" + path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://text.compare/${path}`);
    expect(await page.title()).toContain("text.compare");
    await expect(page.locator(".topbar")).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld["@type"]).toBe("WebApplication");
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
}

test("landing pages start the tool in the right mode", async ({ page }) => {
  await page.goto("/image-compare/");
  await expect(page.locator("#image-panel")).toBeVisible();
  await page.goto("/json-compare/");
  await expect(page.locator("#lang")).toHaveValue("JSON");
  await expect(page.locator("#summary")).toContainText("JSON");
});

test("sitemap and robots.txt list every page", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of landing) expect(sitemap).toContain(`<loc>https://text.compare/${path}</loc>`);
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: https://text.compare/sitemap.xml");
});
