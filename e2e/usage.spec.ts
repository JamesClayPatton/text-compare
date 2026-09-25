import { expect, test, type Page } from "@playwright/test";

// The test build has VITE_USAGE=on; there is no server behind /api here, so the
// events are caught in the browser and answered with 204.

async function captureEvents(page: Page) {
  const events: Record<string, unknown>[] = [];
  const raw: string[] = [];
  await page.route("**/api/event", async (route) => {
    const body = route.request().postData() ?? "";
    raw.push(body);
    events.push(JSON.parse(body));
    await route.fulfill({ status: 204 });
  });
  return { events, raw };
}

async function fill(page: Page, a: string, b: string) {
  const editors = page.locator(".cm-content");
  await editors.nth(0).click();
  await page.keyboard.insertText(a);
  await editors.nth(1).click();
  await page.keyboard.insertText(b);
}

test("counts one comparison per new pair, with no text in it", async ({ page }) => {
  const { events, raw } = await captureEvents(page);
  await page.goto("/");
  await fill(page, "Top secret line one\nline two\n", "Top secret line ONE\nline two\n");
  await expect.poll(() => events.length, { timeout: 5000 }).toBe(1);
  expect(events[0]).toEqual({ e: "compare", kind: "text", view: "split", page: "home", size: "<100", source: "typing", signedIn: false });

  // editing the same pair doesn't count again
  await page.keyboard.insertText(" more");
  await page.waitForTimeout(2500);
  expect(events.filter((e) => e.e === "compare")).toHaveLength(1);

  for (const body of raw) {
    expect(body).not.toMatch(/secret|line two|ONE/i);
  }
});

test("counts features and landing pages", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { events } = await captureEvents(page);
  await page.goto("/json-compare/");
  await fill(page, '{"a":1}', '{"a":2}');
  await expect.poll(() => events.find((e) => e.e === "compare"), { timeout: 5000 }).toMatchObject({ kind: "json", page: "json-compare" });
  await page.click("#share");
  await expect.poll(() => events.some((e) => e.e === "share")).toBe(true);
  expect(JSON.stringify(events)).not.toContain('"a"');
});

test("counts opened files by type and the comparison as coming from a file", async ({ page }) => {
  const { events } = await captureEvents(page);
  await page.goto("/");
  await page.locator("#file-a").setInputFiles({ name: "old.txt", mimeType: "text/plain", buffer: Buffer.from("one\ntwo\n") });
  await page.locator("#file-b").setInputFiles({ name: "new.txt", mimeType: "text/plain", buffer: Buffer.from("one\n2\n") });
  await expect.poll(() => events.find((e) => e.e === "compare"), { timeout: 5000 }).toMatchObject({ source: "file" });
  expect(events.filter((e) => e.e === "file_import")).toEqual([
    { e: "file_import", kind: "text" },
    { e: "file_import", kind: "text" },
  ]);
  expect(JSON.stringify(events)).not.toContain("old.txt");
});
