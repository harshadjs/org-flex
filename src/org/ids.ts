// New org IDs (ACT-10, NOTE-5, JRN-2, CAP-4): the flavour's `orgId` makes
// them; these are the kinds a flavour can choose from.

/** a random UUID, lowercase, as org-roam makes them (`org-id-method` `uuid`) */
export function uuidId(): string {
  return crypto.randomUUID();
}

/**
 * microseconds since the Unix epoch, as digits (`1793101200000000`), one
 * more while that one is taken, so two IDs made at once never clash.
 */
export function microsecondId(now: number, taken: ReadonlySet<string>): string {
  for (let us = Math.floor(now); ; us++) {
    const id = String(us);
    if (!taken.has(id)) return id;
  }
}

/**
 * the local time to the microsecond, as Org's `org-id-method` `ts` writes it
 * (`org-id-ts-format` `%Y%m%dT%H%M%S.%6N`: `20261029T143012.123456`), one
 * microsecond later while that one is taken.
 */
export function tsId(now: number, taken: ReadonlySet<string>): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  for (let us = Math.floor(now); ; us++) {
    const d = new Date(Math.floor(us / 1000));
    const id = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${String(((us % 1e6) + 1e6) % 1e6).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * IDX-4: `date` as a `:CREATED:` value, an inactive Org timestamp to the
 * minute in local time, as the Emacs config writes it: `[2026-11-22 Sun 14:05]`.
 */
export function createdStamp(date: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `[${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())} ${WEEKDAYS[date.getDay()]} ${p2(date.getHours())}:${p2(date.getMinutes())}]`;
}

/** TL-2: the moment a `:CREATED:` value names (`[2026-11-22 Sun 14:05]`, active or inactive, time optional), or null. */
export function parseCreated(value: string | undefined): Date | null {
  if (!value) return null;
  const m = /^[[<](\d{4})-(\d{2})-(\d{2})(?:[ \t]+[^\d\]>\s]+)?(?:[ \t]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?[^\]>]*[\]>]$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0, s ? +s : 0);
}
