import { expect, test } from "@playwright/test";

const stats = {
  generatedAt: "2026-09-24T12:00:00Z",
  today: "2026-09-24",
  days: 30,
  usage: {
    totals: { today: 12, d7: 80, d30: 300, all: 1234 },
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.UTC(2026, 7, 26 + i)).toISOString().slice(0, 10), compares: i })),
    breakdown: {
      kind: { text: 200, word: 60, pdf: 40 },
      view: { split: 250, unified: 50 },
      page: { home: 280, "word-compare": 20 },
      size: { "<100": 250, "100-1k": 50 },
      source: { paste: 200, typing: 100 },
      signed_in: { yes: 30, no: 270 },
    },
    features: { range: { share: 9, report_export: 3 }, all: { share: 40, report_export: 10 } },
    imports: { word: 60, pdf: 40 },
  },
  accounts: { total: 2, new7: 1, new30: 2, active30: 1, contactOk: 1, withLibrary: 1, signupsByDay: { "2026-09-20": 1 } },
  users: [
    { email: "fan@example.com", provider: "google", createdAt: "2026-09-20T10:00:00Z", lastSignInAt: "2026-09-23T10:00:00Z", contactOk: true, contactConsentAt: "2026-09-20T10:00:00Z", saved: 4, history: 10, bytes: 20480, lastActivity: "2026-09-24T09:00:00Z" },
    { email: "<img src=x onerror=alert(1)>@example.com", provider: "email", createdAt: "2026-09-01T10:00:00Z", lastSignInAt: null, contactOk: false, contactConsentAt: null, saved: 0, history: 0, bytes: 0, lastActivity: null },
  ],
  accountsError: null,
};

test("asks for the password, then shows usage and accounts", async ({ page }) => {
  let signedIn = false;
  let sentPassword = "";
  await page.route("**/api/admin/stats**", (route) =>
    signedIn ? route.fulfill({ json: stats }) : route.fulfill({ status: 401, json: { error: "Signed out" } }),
  );
  await page.route("**/api/admin/login", async (route) => {
    sentPassword = JSON.parse(route.request().postData() ?? "{}").password;
    if (sentPassword === "right") {
      signedIn = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 401, json: { error: "Wrong password" } });
  });
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  await page.goto("/admin/");
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
  const password = page.getByLabel("Password");
  await password.fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");

  await password.fill("right");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".tile").first()).toContainText("12");
  await expect(page.getByText("1,234")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparisons per day" })).toBeVisible();
  await expect(page.getByText("Word files")).toBeVisible();
  await expect(page.getByRole("cell", { name: "fan@example.com" })).toBeVisible();
  // emails are shown as text, never as HTML
  await expect(page.getByRole("cell", { name: "<img src=x onerror=alert(1)>@example.com" })).toBeVisible();
  expect(dialogs).toEqual([]);

  await page.getByPlaceholder("Find an email").fill("fan");
  const accounts = page.locator("section", { has: page.getByRole("heading", { name: "Accounts" }) });
  await expect(accounts.locator("tbody tr")).toHaveCount(1);
});

test("explains when the admin server is off", async ({ page }) => {
  await page.route("**/api/admin/stats**", (route) => route.fulfill({ status: 503, json: { error: "The admin panel is off: set ADMIN_PASSWORD in server/.env." } }));
  await page.goto("/admin/");
  await expect(page.getByText("ADMIN_PASSWORD")).toBeVisible();
});
