// Live preview (§4): heading styles, markup with hidden markers, links that
// show their description, images, block styling and the classes of LP-8.
// Line-local decorations come from a view plugin over the visible lines;
// hiding a block's last line crosses a line break, so that is a state field.

import { EditorState, Range, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { isAudioTarget, isImageTarget, parseHeading, parseInline, InlineNode } from "../org/syntax";
import { docInfo, onTap, orgConfig, orgHost, selectionTouches, structureOf } from "./state";

const hidden = Decoration.replace({});
const marks = new Map<string, Decoration>();
function mark(cls: string): Decoration {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
}
const lineDecos = new Map<string, Decoration>();
function lineClass(cls: string): Decoration {
  let d = lineDecos.get(cls);
  if (!d) lineDecos.set(cls, (d = Decoration.line({ class: cls })));
  return d;
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly target: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "org-image";
    img.src = this.src;
    img.alt = this.target;
    img.setAttribute("data-org-link", this.target);
    return img;
  }
  ignoreEvent() {
    return false;
  }
}

/** LP-11: an audio link as a small player; taps on it stay in the player. */
class AudioWidget extends WidgetType {
  constructor(readonly src: string, readonly target: string) {
    super();
  }
  eq(other: AudioWidget) {
    return other.src === this.src;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "org-audio-player";
    const audio = wrap.appendChild(document.createElement("audio"));
    audio.className = "org-audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = this.src;
    audio.title = this.target;
    // LP-12: play it over and over
    const loop = wrap.appendChild(document.createElement("button"));
    loop.className = "org-audio-loop clickable-icon";
    loop.setAttribute("aria-label", "Loop");
    loop.setAttribute("aria-pressed", "false");
    view.state.facet(orgHost)?.setIcon(loop, "repeat");
    onTap(loop, () => {
      audio.loop = !audio.loop;
      loop.setAttribute("aria-pressed", String(audio.loop));
      loop.classList.toggle("is-active", audio.loop);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

function inlineDecorations(
  state: EditorState,
  text: string,
  base: number,
  nodes: InlineNode[],
  out: Range<Decoration>[],
) {
  const host = state.facet(orgHost);
  for (const node of nodes) {
    const from = base + node.from;
    const to = base + node.to;
    const raw = selectionTouches(state, from, to);
    if (node.type === "link") {
      if (node.style !== "regular") {
        // bare URLs never hide, but open only while the cursor is elsewhere
        out.push(raw
          ? mark("org-link").range(from, to)
          : Decoration.mark({ class: "org-link", attributes: { "data-org-link": node.target } }).range(from, to));
        continue;
      }
      if (raw) {
        out.push(mark("org-link org-link-source").range(from, to));
        continue;
      }
      if (isImageTarget(node.target) && node.description === null) {
        const target = node.target.replace(/^file:/, "");
        const src = host?.imageSrc(target) ?? target;
        out.push(Decoration.replace({ widget: new ImageWidget(src, node.target) }).range(from, to));
        continue;
      }
      if (isAudioTarget(node.target) && node.description === null) {
        const src = host?.imageSrc(node.target) ?? node.target.replace(/^file:/, "");
        out.push(Decoration.replace({ widget: new AudioWidget(src, node.target) }).range(from, to));
        continue;
      }
      out.push(hidden.range(from, base + node.descFrom));
      out.push(Decoration.mark({ class: "org-link", attributes: { "data-org-link": node.target } })
        .range(base + node.descFrom, base + node.descTo));
      out.push(hidden.range(base + node.descTo, to));
      continue;
    }
    out.push(mark(`org-text-${node.type}`).range(from, to));
    if (!raw) {
      out.push(hidden.range(from, from + 1));
      out.push(hidden.range(to - 1, to));
    } else {
      out.push(mark("org-markup-marker").range(from, from + 1));
      out.push(mark("org-markup-marker").range(to - 1, to));
    }
    inlineDecorations(state, text, base, node.children, out);
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const config = state.facet(orgConfig);
  const structure = structureOf(state);
  const fm = state.field(docInfo).frontMatter;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const n = line.number - 1;
      const info = structure.lines[n];
      const text = line.text;
      const inFrontMatter = fm !== null && n <= fm.endLine;
      switch (info?.kind) {
        case "heading": {
          const parts = parseHeading(text, config.keywords)!;
          const level = Math.min(parts.level, 6);
          out.push(lineClass(`HyperMD-header HyperMD-header-${level} cm-org-level-${level}`).range(line.from));
          if (config.hideStars && !selectionTouches(state, line.from, line.from + parts.stars.to)) {
            out.push(hidden.range(line.from, line.from + parts.stars.to));
          } else {
            out.push(mark("org-heading-stars").range(line.from, line.from + parts.stars.to));
          }
          const headingClass = `org-heading org-heading-${level} cm-header cm-header-${level}`;
          if (line.from + parts.stars.to < line.to) out.push(mark(headingClass).range(line.from + parts.stars.to, line.to));
          if (parts.keyword) {
            const cls = parts.keyword.done ? "org-keyword org-keyword-done" : "org-keyword org-keyword-todo";
            out.push(Decoration.mark({ class: cls, attributes: { "data-keyword": parts.keyword.text } })
              .range(line.from + parts.keyword.from, line.from + parts.keyword.to));
          }
          if (parts.priority) out.push(mark("org-priority").range(line.from + parts.priority.from, line.from + parts.priority.to));
          if (parts.tags) out.push(mark("org-tags").range(line.from + parts.tags.from, line.from + parts.tags.to));
          inlineDecorations(state, text, line.from, parseInline(text, parts.title.from, parts.title.to), out);
          break;
        }
        case "planning":
          if (text) out.push(mark("org-planning").range(line.from, line.to));
          // RD-4: each SCHEDULED/DEADLINE date can be tapped in reading mode
          for (const m of text.matchAll(/(SCHEDULED|DEADLINE):[ \t]*<[^>\n]*>/g)) {
            const from = line.from + m.index! + m[0].indexOf("<");
            out.push(Decoration.mark({ class: "org-planning-date", attributes: { "data-org-date": m[1] } })
              .range(from, line.from + m.index! + m[0].length));
          }
          break;
        case "drawer-begin":
        case "drawer-end":
        case "property":
        case "drawer-content":
          if (text) {
            const name = structure.drawers[info.drawer].name;
            out.push(mark(name === "PROPERTIES" ? "org-propertydrawer" : "org-drawer").range(line.from, line.to));
          }
          break;
        case "block-begin": {
          const block = structure.blocks[info.block];
          out.push(lineClass(`org-block org-block-begin org-block-${block.name}`).range(line.from));
          const prefix = /^[ \t]*#\+begin_/i.exec(text)![0].length;
          if (!selectionTouches(state, line.from, line.to)) out.push(hidden.range(line.from, line.from + prefix));
          out.push(mark("org-block-header").range(line.from + prefix, line.to));
          break;
        }
        case "block-content": {
          const block = structure.blocks[info.block];
          out.push(lineClass(`org-block org-block-${block.name}`).range(line.from));
          break;
        }
        case "block-end":
          out.push(lineClass("org-block org-block-end").range(line.from));
          if (text) out.push(mark("org-block-header").range(line.from, line.to));
          break;
        case "keyword":
          if (!inFrontMatter && text) out.push(mark("org-meta-line").range(line.from, line.to));
          break;
        case "comment":
          if (text) out.push(mark("org-comment").range(line.from, line.to));
          break;
        case "text":
          if (text.includes("[") || /[*/_=~+:<]/.test(text)) inlineDecorations(state, text, line.from, parseInline(text), out);
          break;
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged ||
          update.startState.facet(orgConfig) !== update.state.facet(orgConfig)) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** LP-4: the last line of a block is hidden (with its line break) unless the cursor is on it. */
function blockEnds(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const block of structureOf(state).blocks) {
    const end = state.doc.line(block.end + 1);
    if (selectionTouches(state, end.from, end.to)) continue;
    builder.add(state.doc.line(block.end).to, end.to, hidden);
  }
  return builder.finish();
}

const blockEndField = StateField.define<DecorationSet>({
  create: blockEnds,
  update(value, tr) {
    return tr.docChanged || tr.selection ? blockEnds(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Opens a rendered link on tap or click (LINK-1), without placing the cursor in it. */
const linkClicks = (() => {
  let start: { x: number; y: number; el: Element } | null = null;
  const linkAt = (e: Event) => (e.target as HTMLElement | null)?.closest?.("[data-org-link]") ?? null;
  const open = (view: EditorView, el: Element) => {
    const target = el.getAttribute("data-org-link");
    if (target) view.state.facet(orgHost)?.openLink(target, view);
  };
  return EditorView.domEventHandlers({
    touchstart(e) {
      const el = linkAt(e);
      const t = e.touches[0];
      start = el && t ? { x: t.clientX, y: t.clientY, el } : null;
      return false;
    },
    touchend(e, view) {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t || linkAt(e) !== s.el) return false;
      if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) return false;
      e.preventDefault();
      open(view, s.el);
      return true;
    },
    mousedown(e, view) {
      const el = linkAt(e);
      if (!el || e.button !== 0) return false;
      e.preventDefault();
      open(view, el);
      return true;
    },
  });
})();

export function livePreview() {
  return [previewPlugin, blockEndField, linkClicks];
}
