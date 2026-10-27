import { expect, test } from "vitest";
import { microsecondId } from "../src/org/ids";
import { backlinksTo, fileBacklinksTo, isMediaFile, linkDescription, mentionLink, noteLinkTarget, readNote, titleCompletions, unlinkedMentionsOf, VaultIndex } from "../src/org/vault-index";

const pkm = readNote("topics/pkm.org", [
  ":PROPERTIES:",
  ":ID:       pkm",
  ":END:",
  "#+title: Personal knowledge management",
  "",
  "* Tools",
  ":PROPERTIES:",
  ":ID:       pkm-tools",
  ":END:",
  "See [[writing]].",
].join("\n"));

test("readNote reads IDs, title and links", () => {
  expect(pkm.name).toBe("pkm");
  expect(pkm.title).toBe("Personal knowledge management");
  expect(pkm.ids).toEqual([{ id: "pkm", offset: 0 }, { id: "pkm-tools", offset: pkm.text.indexOf("* Tools"), heading: "Tools" }]);
  expect(pkm.links).toEqual([{ target: "writing", line: 9 }]);
  expect(readNote("people/Chris-Evans.org", ":PROPERTIES:\n:ID: Chris-Evans\n:END:\n").title).toBe("Chris-Evans");
  // an ID is the rest of the line, spaces included; an empty one is no ID
  expect(readNote("a.org", ":PROPERTIES:\n:ID:   My Note  \n:END:\n* H\n:PROPERTIES:\n:ID:\n:END:").ids).toEqual([{ id: "My Note", offset: 0 }]);
});

test("noteLinkTarget keeps note links and drops URLs, files and in-file targets", () => {
  expect(noteLinkTarget("id:pkm")).toBe("pkm");
  expect(noteLinkTarget("pkm")).toBe("pkm");
  expect(noteLinkTarget("pkm.org")).toBe("pkm");
  expect(noteLinkTarget("id:pkm::*Tools")).toBe("pkm");
  expect(noteLinkTarget("Some Note")).toBe("Some Note");
  expect(noteLinkTarget("https://example.com")).toBeNull();
  expect(noteLinkTarget("file:notes.org")).toBeNull();
  expect(noteLinkTarget("*Heading")).toBeNull();
  expect(noteLinkTarget("#custom")).toBeNull();
});

test("backlinksTo matches links by file name and by any ID in the file", () => {
  const a = readNote("notes/a.org", "#+title: Note A\n\nAbout [[pkm][PKM]] and [[id:pkm]].\nAlso [[pkm-tools]].\n");
  const b = readNote("notes/b.org", "Nothing here, just pkm in text.\n");
  const c = readNote("notes/c.org", "[[https://pkm.example]]\n");
  const self = readNote("topics/pkm.org", pkm.text + "\n[[pkm]]\n");
  expect(backlinksTo(pkm, [a, b, c, self])).toEqual([
    { path: "notes/a.org", title: "Note A", lines: [
      { line: 2, text: "About [[pkm][PKM]] and [[id:pkm]]." },
      { line: 3, text: "Also [[pkm-tools]]." },
    ] },
  ]);
});

test("unlinkedMentionsOf finds whole-word mentions outside links", () => {
  const person = readNote("people/Chris-Evans.org", ":PROPERTIES:\n:ID:       Chris-Evans\n:END:\n#+title: Chris-Evans\n");
  const n1 = readNote("notes/n1.org", [
    "#+title: Met chris evans",
    "Lunch with Chris Evans today.",
    "Already linked: [[Chris-Evans][Chris Evans]].",
    "Chris-Evansville is a different word.",
    ":WHO: Chris Evans",
  ].join("\n"));
  const mentions = unlinkedMentionsOf(person, [person, n1]);
  expect(mentions.map((m) => [m.line, m.words])).toEqual([[1, "Chris Evans"]]);
  expect(n1.text.slice(mentions[0].from, mentions[0].to)).toBe("Chris Evans");
});

test("mentionLink links by ID with the mentioned words, or by file name without an ID", () => {
  const uuid = readNote("notes/x.org", ":PROPERTIES:\n:ID:       abc-123\n:END:\n#+title: Topic X\n");
  expect(mentionLink(uuid, "topic x")).toBe("[[id:abc-123][topic x]]");
  const person = readNote("people/Chris-Evans.org", ":PROPERTIES:\n:ID:       Chris-Evans\n:END:\n");
  expect(mentionLink(person, "Chris-Evans")).toBe("[[id:Chris-Evans][Chris-Evans]]");
  const plain = readNote("people/Chris-Evans.org", "Just text.\n");
  expect(mentionLink(plain, "Chris Evans")).toBe("[[Chris-Evans][Chris Evans]]");
  expect(mentionLink(plain, "Chris-Evans")).toBe("[[Chris-Evans]]");
});

test("titleCompletions lists notes and headings by title, never by ID", () => {
  const roam = readNote("notes/roam.org", [
    ":PROPERTIES:",
    ":ID:       5f0c-uuid",
    ":END:",
    "#+title: Org roam",
    "* TODO [#A] Read [[https://x.y][the manual]] :study:",
    ":PROPERTIES:",
    ":ID:       77aa-uuid",
    ":END:",
  ].join("\n"));
  expect(roam.ids[1]).toEqual({ id: "77aa-uuid", offset: roam.text.indexOf("* TODO"), heading: "Read the manual" });
  const top = readNote("top.org", "* First\n:PROPERTIES:\n:ID: f1\n:END:\n");
  expect(titleCompletions([roam, top])).toEqual([
    { label: "Org roam", detail: "notes", id: "5f0c-uuid", target: "id:5f0c-uuid" },
    { label: "Read the manual", detail: "Org roam", id: "77aa-uuid", target: "id:77aa-uuid" },
    // a heading on the first line is still a heading, not the file
    { label: "First", detail: "top", id: "f1", target: "id:f1" },
  ]);
  expect(linkDescription("A [b] title")).toBe("A b title");
});

test("VaultIndex finds IDs and follows file changes", async () => {
  const files: Record<string, string> = { "topics/pkm.org": pkm.text, "notes/a.org": "[[pkm]]\n" };
  const index = new VaultIndex({
    paths: () => Object.keys(files),
    read: async (path) => {
      if (!(path in files)) throw new Error("missing");
      return files[path];
    },
  }, 0);
  let notified = 0;
  index.onChange(() => notified++);
  await index.build();
  expect(index.findId("pkm-tools")).toEqual({ path: "topics/pkm.org", offset: pkm.text.indexOf("* Tools") });
  expect(index.backlinks("topics/pkm.org").map((b) => b.path)).toEqual(["notes/a.org"]);

  files["notes/b.org"] = "[[id:pkm]]\n";
  await index.update("notes/b.org");
  expect(index.backlinks("topics/pkm.org").map((b) => b.path)).toEqual(["notes/a.org", "notes/b.org"]);

  index.remove("notes/a.org");
  files["notes/c.org"] = files["notes/b.org"];
  delete files["notes/b.org"];
  await index.rename("notes/b.org", "notes/c.org");
  expect(index.backlinks("topics/pkm.org").map((b) => b.path)).toEqual(["notes/c.org"]);
  expect(index.findId("nope")).toBeNull();
  await new Promise((r) => setTimeout(r, 5));
  // changes are batched into one notification
  expect(notified).toBe(1);
});

test("a microsecond ID is the time as digits, one more while taken", () => {
  expect(microsecondId(1793101200123456.7, new Set())).toBe("1793101200123456");
  expect(microsecondId(1793101200123456, new Set(["1793101200123456", "1793101200123457"]))).toBe("1793101200123458");
});

test("notes with file links to a media file are its backlinks, one entry per note with each line", () => {
  const day = readNote("journal/2026/10/2026-10-27.org", [
    "* Morning",
    "[[file:../../../attachments/2610-photo.jpg]] and [[file:../../../attachments/2610-photo.jpg][again]]",
    "[[file:../../../attachments/2610-voice-note-01.m4a]]",
  ].join("\n"));
  const note = readNote("notes/2610-trip.org", "#+title: Trip\nSee [[file:../attachments/2610-photo.jpg::12]].\n[[id:2610-photo.jpg]]\n");
  expect(day.fileLinks).toEqual([
    { target: "attachments/2610-photo.jpg", line: 1 }, { target: "attachments/2610-photo.jpg", line: 1 },
    { target: "attachments/2610-voice-note-01.m4a", line: 2 },
  ]);
  // file links aren't note links
  expect(day.links).toEqual([]);
  expect(fileBacklinksTo("attachments/2610-photo.jpg", [note, day])).toEqual([
    { path: day.path, title: "2026-10-27", lines: [{ line: 1, text: day.text.split("\n")[1] }] },
    { path: note.path, title: "Trip", lines: [{ line: 1, text: "See [[file:../attachments/2610-photo.jpg::12]]." }] },
  ]);
  expect(fileBacklinksTo("attachments/none.png", [note, day])).toEqual([]);
  for (const media of ["a/b.JPG", "x.m4a", "x.mp3", "x.mp4", "x.mov", "x.pdf", "x.webp"]) expect(isMediaFile(media), media).toBe(true);
  for (const other of ["x.org", "x.md", "x.canvas", "x.txt", "README", ".jpg"]) expect(isMediaFile(other), other).toBe(false);
});
