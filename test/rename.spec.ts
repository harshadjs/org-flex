import { describe, expect, test } from "vitest";
import { addMove, retargetLinks } from "../src/org/rename";

const files = (...paths: string[]) => (p: string) => paths.includes(p);

describe("links follow renames", () => {
  test("a batch of renames maps each file from where it started to where it ended", () => {
    const moves = new Map<string, string>();
    addMove(moves, "a.jpg", "b.jpg");
    addMove(moves, "b.jpg", "img/c.jpg");
    addMove(moves, "x.org", "y.org");
    expect([...moves]).toEqual([["a.jpg", "img/c.jpg"], ["x.org", "y.org"]]);
    addMove(moves, "y.org", "x.org");
    expect([...moves]).toEqual([["a.jpg", "img/c.jpg"]]);
  });

  test("links to a moved file point to its new place, relative to each note", () => {
    const moves = new Map([["attachments/a.jpg", "media/photos/a b.jpg"]]);
    const now = files("media/photos/a b.jpg");
    expect(retargetLinks("see [[file:../attachments/a.jpg][the photo]] here", "notes/n.org", "notes/n.org", moves, now))
      .toBe("see [[file:../media/photos/a b.jpg][the photo]] here");
    expect(retargetLinks("[[file:attachments/a.jpg]] and [[file:attachments/a.jpg::3]]", "top.org", "top.org", moves, now))
      .toBe("[[file:media/photos/a b.jpg]] and [[file:media/photos/a b.jpg::3]]");
    expect(retargetLinks("[[file:a.jpg]]", "attachments/n.org", "attachments/n.org", moves, now))
      .toBe("[[file:../media/photos/a b.jpg]]");
  });

  test("plain links follow when they found the file by path or by name", () => {
    const moves = new Map([["notes/unicorn.org", "notes/horse.org"], ["attachments/a.jpg", "attachments/b.jpg"]]);
    const now = files("notes/horse.org", "attachments/b.jpg");
    // relative to the note, with .org left out
    expect(retargetLinks("[[unicorn][U]]", "notes/n.org", "notes/n.org", moves, now)).toBe("[[file:horse.org][U]]");
    // from the vault root
    expect(retargetLinks("[[attachments/a.jpg]]", "notes/n.org", "notes/n.org", moves, now)).toBe("[[file:../attachments/b.jpg]]");
    // by file name, as Obsidian finds it
    expect(retargetLinks("[[a.jpg]] [[unicorn.org]]", "journal/d.org", "journal/d.org", moves, now))
      .toBe("[[file:../attachments/b.jpg]] [[file:../notes/horse.org]]");
    // two moved files with that name: no guess
    const twice = new Map([["x/a.jpg", "x/b.jpg"], ["y/a.jpg", "y/b.jpg"]]);
    expect(retargetLinks("[[a.jpg]]", "n.org", "n.org", twice, files("x/b.jpg", "y/b.jpg"))).toBeNull();
  });

  test("id links, urls, absolute paths and links inside the file are left alone", () => {
    const moves = new Map([["a.jpg", "b.jpg"]]);
    const text = "[[id:a.jpg]] [[https://x.org/a.jpg]] [[file:/home/me/a.jpg]] [[~/a.jpg]] [[*a.jpg]] [[#a.jpg]] [[attachment:a.jpg]]";
    expect(retargetLinks(text, "n.org", "n.org", moves, files("b.jpg"))).toBeNull();
    // and so is a note moving with them
    expect(retargetLinks(text, "n.org", "sub/n.org", moves, files("b.jpg"))).toBeNull();
  });

  test("a moved note keeps its relative links pointing at the same files", () => {
    const now = files("attachments/a.jpg", "notes/other.org", "pic.png");
    const moves = new Map([["notes/n.org", "archive/2026/n.org"]]);
    const text = "[[file:../attachments/a.jpg]] [[other][O]] [[pic.png]] [[file:../missing.pdf]]";
    expect(retargetLinks(text, "notes/n.org", "archive/2026/n.org", moves, now))
      .toBe("[[file:../../attachments/a.jpg]] [[file:../../notes/other.org][O]] [[pic.png]] [[file:../../missing.pdf]]");
  });

  test("notes and attachments moved together keep their links", () => {
    const moves = new Map([["trip/n.org", "travel/trip/n.org"], ["trip/img/a.jpg", "travel/trip/img/a.jpg"]]);
    const now = files("travel/trip/n.org", "travel/trip/img/a.jpg");
    expect(retargetLinks("[[file:img/a.jpg]]", "trip/n.org", "travel/trip/n.org", moves, now)).toBeNull();
    expect(retargetLinks("[[file:trip/img/a.jpg]]", "index.org", "index.org", moves, now)).toBe("[[file:travel/trip/img/a.jpg]]");
  });

  test("nothing changes when no link points at a moved file", () => {
    const moves = new Map([["a.jpg", "b.jpg"]]);
    expect(retargetLinks("no links here", "n.org", "n.org", moves, files("b.jpg"))).toBeNull();
    expect(retargetLinks("[[file:c.jpg]] [[other]]", "n.org", "n.org", moves, files("b.jpg", "c.jpg"))).toBeNull();
  });
});
