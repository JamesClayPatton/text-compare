import { describe, expect, it } from "vitest";
import { analyticsTags } from "../site/analytics";

describe("analyticsTags", () => {
  it("is empty when no measurement id is configured", () => {
    expect(analyticsTags("")).toBe("");
    expect(analyticsTags(undefined)).toBe("");
  });

  it("rejects ids that don't look like a GA4 measurement id", () => {
    expect(analyticsTags('G-1"><script>')).toBe("");
  });

  it("loads gtag with the id and never reports the URL fragment", () => {
    const html = analyticsTags("G-ABC123");
    expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"');
    expect(html).toContain("gtag('config', 'G-ABC123'");
    // share links keep the compared text after "#", sign-in codes arrive in the query: send neither
    expect(html).toContain("page_location: location.origin + location.pathname,");
    expect(html).not.toContain("location.search");
    expect(html).toContain("allow_google_signals: false");
  });

  it("defaults to no analytics storage in the EEA, UK and Switzerland", () => {
    const html = analyticsTags("G-ABC123");
    expect(html).toMatch(/analytics_storage: 'denied'[\s\S]*region: \[[^\]]*'DE'[^\]]*'GB'[^\]]*'CH'/);
  });
});
