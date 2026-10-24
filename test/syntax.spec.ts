import { describe, expect, test } from "vitest";
import { analyze, classifyLink, findLinks, isImageTarget, parseHeading, parseInline, walkInline, isAudioTarget, resolveRelative, relativeLinkPath } from "../src/org/syntax";

const kw = { todo: ["TODO", "DOING"], done: ["DONE"] };

describe("headings", () => {
  test("headings are stars at column 0 followed by whitespace or the end", () => {
    expect(parseHeading("* Title", kw)?.level).toBe(1);
    expect(parseHeading("*** Deep", kw)?.level).toBe(3);
    expect(parseHeading("*", kw)?.level).toBe(1);
    expect(parseHeading("*bold*", kw)).toBeNull();
    expect(parseHeading(" * indented", kw)).toBeNull();
  });

  test("heading keyword, priority, title and tags", () => {
    const text = "** DOING [#A] Write the report :work:urgent:";
    const h = parseHeading(text, kw)!;
    expect(h.keyword?.text).toBe("DOING");
    expect(h.keyword?.done).toBe(false);
    expect(h.priority?.value).toBe("A");
    expect(text.slice(h.title.from, h.title.to)).toBe("Write the report");
    expect(h.tags?.tags).toEqual(["work", "urgent"]);
  });

  test("a keyword is only recognised at the start of the title, as configured", () => {
    expect(parseHeading("* Something TODO", kw)?.keyword).toBeNull();
    expect(parseHeading("* todo lowercase", kw)?.keyword).toBeNull();
    expect(parseHeading("* TODOS plural", kw)?.keyword).toBeNull();
    expect(parseHeading("* DONE", kw)?.keyword?.done).toBe(true);
  });
});

describe("line classification", () => {
  test("planning only directly after a heading, drawers and blocks need their end line", () => {
    const s = analyze([
      "#+title: T",          // 0
      "* H",                 // 1
      "SCHEDULED: <2024-01-01 Mon>",
      ":PROPERTIES:",        // 3
      ":ID: x",
      ":END:",
      "SCHEDULED: <2024-01-01 Mon>", // 6: not after a heading
      "#+begin_src python",  // 7
      "* not a heading?",    // 8: headings win, so the block is unterminated
      "# comment",           // 9
      "#+BEGIN_QUOTE",       // 10
      "quoted",
      "#+END_QUOTE",         // 12
      "",
    ]);
    expect(s.lines.map((l) => l.kind)).toEqual([
      "keyword", "heading", "planning", "drawer-begin", "property", "drawer-end", "text",
      "text", "heading", "comment", "block-begin", "block-content", "block-end", "blank",
    ]);
    expect(s.blocks).toEqual([{ begin: 10, end: 12, name: "quote", language: "" }]);
    expect(s.headings).toEqual([1, 8]);
  });

  test("source blocks record their language", () => {
    const s = analyze(["#+begin_src Python :results output", "print(1)", "#+end_src"]);
    expect(s.blocks[0]).toMatchObject({ name: "src", language: "python" });
  });
});

describe("inline syntax", () => {
  const types = (text: string) => Array.from(walkInline(parseInline(text))).map((n) => [n.type, text.slice(n.from, n.to)]);

  test("text markup, nested", () => {
    expect(types("a *bold /and italic/* _u_ =v= ~c~ +s+")).toEqual([
      ["bold", "*bold /and italic/*"],
      ["italic", "/and italic/"],
      ["underline", "_u_"],
      ["verbatim", "=v="],
      ["code", "~c~"],
      ["strikethrough", "+s+"],
    ]);
  });

  test("markup criss-cross becomes a tree, unlike Emacs", () => {
    expect(types("*one _two three* four_")).toEqual([["bold", "*one _two three*"]]);
  });

  test("markers need a valid border", () => {
    expect(types("a*b*c 2*3*4 * not bold *")).toEqual([]);
    expect(types("(*bold*), x")).toEqual([["bold", "*bold*"]]);
  });

  test("verbatim and code contents are not parsed", () => {
    expect(types("=*not bold*=")).toEqual([["verbatim", "=*not bold*="]]);
  });

  test("links: regular, with description, angle and plain", () => {
    const links = findLinks("see [[pkm][PKM notes]] and [[id:abc]] <https://a.b/c> or https://x.y/z.");
    expect(links.map((l) => [l.style, l.target, l.description])).toEqual([
      ["regular", "pkm", "PKM notes"],
      ["regular", "id:abc", null],
      ["angle", "https://a.b/c", null],
      ["plain", "https://x.y/z", null],
    ]);
  });

  test("markup and links combined; markup never ends inside a link", () => {
    expect(types("*see [[a*b][x]]* ok")).toEqual([["bold", "*see [[a*b][x]]*"], ["link", "[[a*b][x]]"]]);
    expect(types("[[pkm][pkm]]")).toEqual([["link", "[[pkm][pkm]]"]]);
  });

  test("the parser never hangs", () => {
    const junk = ["*", "/", "[[", "]]", "_", "=", "~", "+", "<", ">", "[", "]", " ", "a", "\\", ":", "https://"];
    let seed = 7;
    for (let i = 0; i < 2000; i++) {
      let s = "";
      for (let j = 0; j < 30; j++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        s += junk[seed % junk.length];
      }
      parseInline(s);
      analyze(s.split("["));
    }
  });
});

test("link classification and images", () => {
  expect(classifyLink("https://example.com")).toEqual({ kind: "external", url: "https://example.com" });
  expect(classifyLink("file:notes.org")).toEqual({ kind: "file", path: "notes.org" });
  expect(classifyLink("file:../attachments/a b.jpg")).toEqual({ kind: "file", path: "../attachments/a b.jpg" });
  expect(classifyLink("file:///home/me/x.pdf")).toEqual({ kind: "external", url: "file:///home/me/x.pdf" });
  expect(classifyLink("id:My Note")).toEqual({ kind: "id", id: "My Note" });
  expect(classifyLink("unicorn")).toEqual({ kind: "file", path: "unicorn" });
  expect(isImageTarget("pics/cat.PNG")).toBe(true);
  expect(isImageTarget("https://x.y/a.webp?size=2")).toBe(true);
  expect(isImageTarget("notes.org")).toBe(false);
  expect(isAudioTarget("file:memo.M4A")).toBe(true);
  expect(isAudioTarget("Recording 1.webm")).toBe(true);
  expect(isAudioTarget("cat.png")).toBe(false);
});

test("relative links resolve from the note's folder, and attachments are linked relative to it", () => {
  expect(resolveRelative("journal/2026/10/day.org", "file:../../../attachments/a.jpg")).toBe("attachments/a.jpg");
  expect(resolveRelative("notes/n.org", "./pic.png")).toBe("notes/pic.png");
  expect(resolveRelative("n.org", "file:pic.png::*Heading")).toBe("pic.png");
  expect(resolveRelative("n.org", "../x.png")).toBeNull();
  expect(resolveRelative("n.org", "/abs.png")).toBeNull();
  expect(relativeLinkPath("journal/2026/10/day.org", "attachments/a.jpg")).toBe("../../../attachments/a.jpg");
  expect(relativeLinkPath("notes/n.org", "notes/media/a.jpg")).toBe("media/a.jpg");
  expect(relativeLinkPath("n.org", "attachments/a.jpg")).toBe("attachments/a.jpg");
  expect(relativeLinkPath("a/b/n.org", "a/c.png")).toBe("../c.png");
});
