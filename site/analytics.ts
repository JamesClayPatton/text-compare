// Optional Google Analytics. Set VITE_GA_ID (for example in .env.local, which
// git ignores) to a GA4 measurement id; without it no analytics code is added.

// EEA, UK and Switzerland: analytics cookies stay off by default (Consent Mode),
// so Google only receives cookieless pings from visitors there.
const CONSENT_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LI",
  "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH",
];

export function analyticsTags(id: string | undefined): string {
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return "";
  const regions = CONSENT_REGIONS.map((r) => `'${r}'`).join(", ");
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', region: [${regions}] });
      gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
      gtag('js', new Date());
      // Only the page address is reported: never the "#" part (share links carry the compared
      // text there) and never the query string (sign-in returns carry a one-time code there).
      gtag('config', '${id}', {
        page_location: location.origin + location.pathname,
        allow_google_signals: false,
        allow_ad_personalization_signals: false
      });
    </script>`;
}
