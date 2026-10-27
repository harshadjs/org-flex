// New org IDs (ACT-10, NOTE-5, JRN-2, CAP-4): the flavour's `orgId` makes
// them; these are the two kinds a flavour can choose from.

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
