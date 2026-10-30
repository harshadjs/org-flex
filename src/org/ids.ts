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
export function timestampId(now: number, taken: ReadonlySet<string>): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  for (let us = Math.floor(now); ; us++) {
    const d = new Date(Math.floor(us / 1000));
    const id = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${String(((us % 1e6) + 1e6) % 1e6).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
}
