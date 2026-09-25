// Optional anonymous usage counts, sent to this site's own /api/event. Only on
// when the site was built with VITE_USAGE=on; self-hosted copies send nothing
// unless they run the server in server/ and turn it on too.
//
// Events carry only values from the fixed lists in usage-schema.ts: what kind
// of comparison, never what is in it. See parseUsageEvent.

import type { UsageEvent } from "./usage-schema";

export const usageEnabled = import.meta.env.VITE_USAGE === "on";

const ENDPOINT = "/api/event";

export function track(event: UsageEvent): void {
  if (!usageEnabled) return;
  const body = JSON.stringify(event);
  try {
    // a string body goes as text/plain, so no preflight; the server parses it as JSON
    if (navigator.sendBeacon?.(ENDPOINT, body)) return;
  } catch {
    /* fall through */
  }
  void fetch(ENDPOINT, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(() => {});
}
