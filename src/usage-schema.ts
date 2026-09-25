// The only usage events the site sends and the server accepts. Every field is a
// value from a fixed list, so an event can never carry the text being compared,
// a file name or anything else a person typed. Shared by the browser and the server.

export const COMPARE_KINDS = ["text", "code", "json", "document", "word", "excel", "pdf", "data", "image"] as const;
export const VIEWS = ["split", "unified", "data", "image"] as const;
export const PAGES = ["home", "json-compare", "pdf-compare", "word-compare", "excel-compare", "image-compare", "code-compare", "other"] as const;
export const SIZES = ["<100", "100-1k", "1k-10k", "10k+", "-"] as const;
export const SOURCES = ["typing", "paste", "file", "share", "library"] as const;
export const IMPORT_KINDS = ["text", "word", "excel", "pdf", "image"] as const;
export const FEATURE_EVENTS = ["share", "report_export", "report_print", "file_import", "library_save"] as const;

export type CompareKind = (typeof COMPARE_KINDS)[number];
export type View = (typeof VIEWS)[number];
export type PageSlug = (typeof PAGES)[number];
export type SizeBucket = (typeof SIZES)[number];
export type Source = (typeof SOURCES)[number];
export type ImportKind = (typeof IMPORT_KINDS)[number];

export type UsageEvent =
  | { e: "compare"; kind: CompareKind; view: View; page: PageSlug; size: SizeBucket; source: Source; signedIn: boolean }
  | { e: "file_import"; kind: ImportKind }
  | { e: "share" | "report_export" | "report_print" | "library_save" };

export type EventName = UsageEvent["e"];

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Returns the event if it matches the schema exactly (no extra fields), otherwise null. */
export function parseUsageEvent(input: unknown): UsageEvent | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  switch (o.e) {
    case "compare":
      if (keys !== "e,kind,page,signedIn,size,source,view") return null;
      if (!oneOf(COMPARE_KINDS, o.kind) || !oneOf(VIEWS, o.view) || !oneOf(PAGES, o.page) || !oneOf(SIZES, o.size) || !oneOf(SOURCES, o.source)) return null;
      if (typeof o.signedIn !== "boolean") return null;
      return { e: "compare", kind: o.kind, view: o.view, page: o.page, size: o.size, source: o.source, signedIn: o.signedIn };
    case "file_import":
      if (keys !== "e,kind" || !oneOf(IMPORT_KINDS, o.kind)) return null;
      return { e: "file_import", kind: o.kind };
    case "share":
    case "report_export":
    case "report_print":
    case "library_save":
      return keys === "e" ? { e: o.e } : null;
    default:
      return null;
  }
}
