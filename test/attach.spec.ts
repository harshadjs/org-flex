import { describe, expect, test } from "vitest";
import { attachDirFor, attachOwner, attachmentName, freeAttachmentPath, resolveAttachment, withAttachTag } from "../src/org/attach";
import { readNote } from "../src/org/vault-index";
import { buildTimeline } from "../src/org/timeline";

const U = "5b1b1187-bce2-4048-96c6-123108fc7645";
const doc = [
  ":PROPERTIES:", ":ID:       file-id", ":END:", "#+title: Day", "[[attachment:top.png]]",
  "* 09:00 walk", "[[attachment:walk.m4a]]",
  "* Trip", "SCHEDULED: <2026-11-23 Mon>", ":PROPERTIES:", `:ID:       ${U}`, ":END:",
  "** Day one", "[[attachment:beach.jpg]]",
  "* Later", "text",
];
const line = (n: number) => doc[n];
const at = (text: string) => doc.findIndex((l) => l.includes(text));

describe("org attachments", () => {
  test("a node's attach folder is org-attach's UUID layout under the attach dir", () => {
    expect(attachDirFor("attachments", U)).toBe("attachments/5b/1b1187-bce2-4048-96c6-123108fc7645");
    expect(attachDirFor("/data/", "C09130DE-X")).toBe("data/C0/9130DE-X");
  });

  test("the owner is the nearest heading or ancestor with an ID, else the file's", () => {
    expect(attachOwner(line, doc.length, at("top.png"))).toEqual({ id: "file-id", heading: null });
    expect(attachOwner(line, doc.length, at("walk.m4a"))).toEqual({ id: "file-id", heading: null });
    expect(attachOwner(line, doc.length, at("beach.jpg"))).toEqual({ id: U, heading: 7 });
    expect(attachOwner(line, doc.length, at("text"))).toEqual({ id: "file-id", heading: null });
    const bare = ["* a", "x"];
    expect(attachOwner((n) => bare[n], 2, 1)).toBeNull();
  });

  test("an attachment link resolves to the file in its owner's folder", () => {
    expect(attachmentName("attachment:a b.png::x")).toBe("a b.png");
    expect(attachmentName("file:a.png")).toBeNull();
    expect(resolveAttachment("attachment:beach.jpg", "attachments", line, doc.length, at("beach.jpg"))).toBe(`attachments/5b/1b1187-bce2-4048-96c6-123108fc7645/beach.jpg`);
    expect(resolveAttachment("attachment:x.png", "attachments", (n) => ["* h", "x"][n], 2, 1)).toBeNull();
  });

  test("a heading owning files gets the ATTACH tag once", () => {
    expect(withAttachTag("* Trip")).toBe("* Trip :ATTACH:");
    expect(withAttachTag("* Trip   :travel:")).toBe("* Trip   :travel:ATTACH:");
    expect(withAttachTag("* Trip :travel:ATTACH:")).toBe("* Trip :travel:ATTACH:");
  });

  test("a name already taken in the folder is numbered", () => {
    const taken = new Set(["d/a.png", "d/a-2.png"]);
    expect(freeAttachmentPath("d", "a.png", (p) => taken.has(p))).toBe("d/a-3.png");
    expect(freeAttachmentPath("d", "b.png", (p) => taken.has(p))).toBe("d/b.png");
  });

  test("the index and timeline put attachment links under the node that owns them", () => {
    const note = readNote("journal/2026/11/2026-11-23.org", doc.join("\n"), undefined, "attachments");
    expect(note.fileLinks.map((l) => l.target)).toEqual([
      "attachments/fi/le-id/top.png", "attachments/fi/le-id/walk.m4a", `attachments/5b/1b1187-bce2-4048-96c6-123108fc7645/beach.jpg`,
    ]);
    const { days } = buildTimeline([note], [], () => new Date(2026, 10, 23));
    const trip = days.flatMap((d) => d.entries).find((e) => e.id === U)!;
    expect(trip.attachments).toEqual([`attachments/5b/1b1187-bce2-4048-96c6-123108fc7645/beach.jpg`]);
  });
});
