// Usage counts, kept as one counter per day and combination of fields. There is
// no row per event and no time of day, so the counts can't be traced back to a
// visit or a person.

import { DatabaseSync } from "node:sqlite";
import type { UsageEvent } from "../src/usage-schema.ts";

const DIMENSIONS = ["kind", "view", "page", "size", "source", "signed_in"] as const;
type Dimension = (typeof DIMENSIONS)[number];

export interface UsageStats {
  totals: { today: number; d7: number; d30: number; all: number };
  daily: { day: string; compares: number }[];
  breakdown: Record<Dimension, Record<string, number>>;
  features: { range: Record<string, number>; all: Record<string, number> };
  imports: Record<string, number>;
}

/** YYYY-MM-DD in UTC. */
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (today: string, n: number) => dayOf(new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000));

export class UsageStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists counts (
        day       text    not null,
        event     text    not null,
        kind      text    not null default '',
        view      text    not null default '',
        page      text    not null default '',
        size      text    not null default '',
        source    text    not null default '',
        signed_in integer not null default 0,
        n         integer not null,
        primary key (day, event, kind, view, page, size, source, signed_in)
      ) without rowid;
    `);
  }

  add(event: UsageEvent, day: string): void {
    const f = event.e === "compare"
      ? { kind: event.kind, view: event.view, page: event.page, size: event.size, source: event.source, signed_in: event.signedIn ? 1 : 0 }
      : { kind: event.e === "file_import" ? event.kind : "", view: "", page: "", size: "", source: "", signed_in: 0 };
    this.db
      .prepare(
        `insert into counts (day, event, kind, view, page, size, source, signed_in, n) values (?, ?, ?, ?, ?, ?, ?, ?, 1)
         on conflict do update set n = n + 1`,
      )
      .run(day, event.e, f.kind, f.view, f.page, f.size, f.source, f.signed_in);
  }

  stats(today: string, days: number): UsageStats {
    const from = daysAgo(today, days - 1);
    const sum = (where: string, ...args: string[]) =>
      Number((this.db.prepare(`select coalesce(sum(n), 0) as n from counts where event = 'compare' ${where}`).get(...args) as { n: number }).n);
    const grouped = (sql: string, ...args: string[]) => {
      const out: Record<string, number> = {};
      for (const r of this.db.prepare(sql).all(...args) as { k: string | number; n: number }[]) out[String(r.k)] = Number(r.n);
      return out;
    };

    const perDay = grouped(`select day as k, sum(n) as n from counts where event = 'compare' and day >= ? group by day`, from);
    const daily = Array.from({ length: days }, (_, i) => {
      const day = daysAgo(today, days - 1 - i);
      return { day, compares: perDay[day] ?? 0 };
    });

    const breakdown = {} as UsageStats["breakdown"];
    for (const d of DIMENSIONS) {
      breakdown[d] = grouped(`select ${d} as k, sum(n) as n from counts where event = 'compare' and day >= ? group by ${d} order by n desc`, from);
    }
    breakdown.signed_in = { yes: breakdown.signed_in["1"] ?? 0, no: breakdown.signed_in["0"] ?? 0 };

    return {
      totals: {
        today: sum("and day = ?", today),
        d7: sum("and day >= ?", daysAgo(today, 6)),
        d30: sum("and day >= ?", daysAgo(today, 29)),
        all: sum(""),
      },
      daily,
      breakdown,
      features: {
        range: grouped(`select event as k, sum(n) as n from counts where event != 'compare' and day >= ? group by event`, from),
        all: grouped(`select event as k, sum(n) as n from counts where event != 'compare' group by event`),
      },
      imports: grouped(`select kind as k, sum(n) as n from counts where event = 'file_import' and day >= ? group by kind order by n desc`, from),
    };
  }

  close(): void {
    this.db.close();
  }
}
