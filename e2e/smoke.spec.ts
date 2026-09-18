import { expect, test, type Page } from "@playwright/test";

async function fill(page: Page, a: string, b: string) {
  const editors = page.locator(".cm-content");
  await editors.nth(0).click();
  await page.keyboard.insertText(a);
  await editors.nth(1).click();
  await page.keyboard.insertText(b);
}

test("shows differences and stats", async ({ page }) => {
  await page.goto("/");
  await fill(page, "alpha\nbeta\ngamma\n", "alpha\nBETA\ngamma\ndelta\n");
  await expect(page.locator("#summary")).toContainText("+2");
  await expect(page.locator("#summary")).toContainText("1");
  await expect(page.locator(".cm-changedText").first()).toBeVisible();
  await expect(page.locator(".changemap .mark")).toHaveCount(2);
});

test("merge arrow copies a block across", async ({ page }) => {
  await page.goto("/");
  await fill(page, "one\ntwo\nthree", "one\n2\nthree");
  await page.locator(".revert-btn").first().click();
  await expect(page.locator("#summary")).toContainText("identical");
});

test("ignore case option hides case-only changes", async ({ page }) => {
  await page.goto("/");
  await fill(page, "Hello World", "hello world");
  await expect(page.locator("#summary")).not.toContainText("identical");
  await page.click("#options-btn");
  await page.check("#opt-case");
  await expect(page.locator("#summary")).toContainText("identical");
  await expect(page.locator(".cm-changedText")).toHaveCount(0);
});

test("unified view shows removed and added lines", async ({ page }) => {
  await page.goto("/");
  await fill(page, "keep\nold line\nkeep", "keep\nnew line\nkeep");
  await page.click("[data-view=unified]");
  await expect(page.locator(".cm-deletedChunk")).toContainText("old line");
  await expect(page.locator(".cm-content")).toContainText("new line");
});

test("copied link restores both texts", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await fill(page, "left side ✓", "right side 👋");
  await page.click("#share");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("#v1:");

  const fresh = await context.newPage();
  await fresh.goto(url);
  const editors = fresh.locator(".cm-content");
  await expect(editors.nth(0)).toHaveText("left side ✓");
  await expect(editors.nth(1)).toHaveText("right side 👋");
  expect(fresh.url()).not.toContain("#v1:");
});

test("a damaged link shows a message instead of breaking", async ({ page }) => {
  await page.goto("/#v1:!!!garbage");
  await expect(page.locator(".toast")).toContainText("damaged");
  await expect(page.locator(".cm-content")).toHaveCount(2);
});

test("makes no requests to other sites", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname !== "localhost" && u.protocol.startsWith("http")) external.push(r.url());
  });
  await page.goto("/");
  await fill(page, "a", "b");
  await page.waitForTimeout(300);
  expect(external).toEqual([]);
});
