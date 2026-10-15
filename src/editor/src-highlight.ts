// PARSE-4: syntax highlighting inside #+begin_src blocks. Each visible block
// is parsed with its language's Lezer parser and coloured with token classes
// that styles.css maps onto Obsidian's --code-* colours.

import { Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Language } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { xml } from "@codemirror/lang-xml";
import { structureOf } from "./state";

const factories: Record<string, () => Language> = {
  c: () => cpp().language,
  "c++": () => cpp().language,
  cpp: () => cpp().language,
  css: () => css().language,
  html: () => html().language,
  java: () => java().language,
  javascript: () => javascript().language,
  js: () => javascript().language,
  typescript: () => javascript({ typescript: true }).language,
  ts: () => javascript({ typescript: true }).language,
  json: () => json().language,
  php: () => php({ plain: true }).language,
  python: () => python().language,
  py: () => python().language,
  rust: () => rust().language,
  sass: () => sass({ indented: true }).language,
  scss: () => sass().language,
  xml: () => xml().language,
};

export const SRC_LANGUAGES = Object.keys(factories);

const languages = new Map<string, Language>();
function languageFor(name: string): Language | null {
  const make = factories[name];
  if (!make) return null;
  let lang = languages.get(name);
  if (!lang) languages.set(name, (lang = make()));
  return lang;
}

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], class: "org-tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: "org-tok-string" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "org-tok-comment" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], class: "org-tok-value" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], class: "org-tok-function" },
  { tag: [t.typeName, t.className, t.namespace], class: "org-tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "org-tok-property" },
  { tag: [t.tagName, t.angleBracket], class: "org-tok-tag" },
  { tag: [t.operator, t.derefOperator], class: "org-tok-operator" },
  { tag: [t.meta, t.processingInstruction, t.annotation], class: "org-tok-meta" },
  { tag: [t.punctuation, t.bracket, t.separator], class: "org-tok-punctuation" },
  { tag: [t.definition(t.variableName)], class: "org-tok-definition" },
]);

// recently highlighted block texts, so typing elsewhere doesn't re-parse them
const cache = new Map<string, [number, number, string][]>();
function tokens(language: Language, code: string): [number, number, string][] {
  const key = `${language.name}\0${code}`;
  let result = cache.get(key);
  if (result) return result;
  result = [];
  const out = result;
  highlightTree(language.parser.parse(code), highlighter, (from, to, cls) => out.push([from, to, cls]));
  cache.set(key, result);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return result;
}

function build(view: EditorView): DecorationSet {
  const state = view.state;
  const out: Range<Decoration>[] = [];
  const { from: vFrom, to: vTo } = view.viewport;
  for (const block of structureOf(state).blocks) {
    if (block.name !== "src" || block.end - block.begin < 2) continue;
    const from = state.doc.line(block.begin + 2).from;
    const to = state.doc.line(block.end).to;
    if (to < vFrom || from > vTo) continue;
    const language = languageFor(block.language);
    if (!language) continue;
    for (const [a, b, cls] of tokens(language, state.sliceDoc(from, to))) {
      out.push(Decoration.mark({ class: cls }).range(from + a, from + b));
    }
  }
  return Decoration.set(out, true);
}

export const srcHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);
