// Dialogs: the date picker for SCHEDULED/DEADLINE, the journal list, the
// journal calendar, the new note dialog, the capture dialog and the voice
// recorder.

import { App, FuzzySuggestModal, Modal, Platform, prepareFuzzySearch, setIcon, SuggestModal } from "obsidian";
import { findNodes, NodeChoice } from "../org/node-find";
import { TitleCompletion } from "../org/vault-index";
import { addDays, dateFieldValue, parseDateField } from "../org/capture";
import { calendarMonth, journalDateString, JournalEntry, journalEntryLabel, localeWeekStart } from "../org/journal";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ACT-4: pick a date; on mobile a pick applies at once, on desktop Set or Enter does. */
export class DatePickerModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private initial: Date | null,
    private onPick: (date: Date | null) => void,
    private onDone: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText(this.heading);
    contentEl.addClass("org-date-picker");
    const date = this.initial ?? new Date();
    const input = contentEl.createEl("input", { type: "date", cls: "org-date-input" });
    input.value = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const read = (): Date | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.value);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    };
    const apply = (value: Date | null) => {
      this.onPick(value);
      this.close();
    };
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    if (this.initial) {
      buttons.createEl("button", { text: "Remove", cls: "mod-warning" }).addEventListener("click", () => apply(null));
    }
    if (Platform.isMobile) {
      // the native picker reports only complete dates
      input.addEventListener("change", () => {
        const value = read();
        if (value) apply(value);
      });
    } else {
      // desktop date fields report half-typed dates: wait for Set or Enter
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const value = read();
          if (value) apply(value);
        }
      });
      buttons.createEl("button", { text: "Set", cls: "mod-cta" }).addEventListener("click", () => {
        const value = read();
        if (value) apply(value);
      });
      window.setTimeout(() => input.focus(), 0);
    }
    if (Platform.isMobile) {
      window.setTimeout(() => {
        try {
          input.showPicker?.();
        } catch {
          // needs a user gesture on some systems; the field is still there to tap
        }
      }, 50);
    }
  }

  onClose() {
    this.contentEl.empty();
    this.onDone();
  }
}

/** JRN-3: every journal entry, newest first, searchable by date, weekday or month. */
export class JournalPickerModal extends FuzzySuggestModal<JournalEntry> {
  constructor(app: App, private entries: JournalEntry[], private onChoose: (entry: JournalEntry) => void) {
    super(app);
    this.setPlaceholder("Search journal entries by date, weekday or month");
  }
  getItems() {
    return this.entries;
  }
  getItemText(entry: JournalEntry) {
    return journalEntryLabel(entry.date);
  }
  onChooseItem(entry: JournalEntry) {
    this.onChoose(entry);
  }
}

/** JRN-4: a month grid; days with an entry have a dot, today is highlighted. */
export class JournalCalendarModal extends Modal {
  private year: number;
  private month: number;

  constructor(app: App, private hasEntry: (day: string) => boolean, private onChoose: (date: Date) => void) {
    super(app);
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  }

  onOpen() {
    this.modalEl.addClass("org-calendar-modal");
    this.render();
  }

  private shift(months: number) {
    const d = new Date(this.year, this.month + months, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText("Journal");
    const nav = contentEl.createDiv({ cls: "org-calendar-nav" });
    const prev = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Previous month" } });
    setIcon(prev, "chevron-left");
    prev.addEventListener("click", () => this.shift(-1));
    nav.createDiv({
      cls: "org-calendar-month",
      text: new Date(this.year, this.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    });
    const next = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Next month" } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.shift(1));
    const todayButton = nav.createEl("button", { text: "Today", cls: "org-calendar-today-button" });
    todayButton.addEventListener("click", () => {
      const now = new Date();
      this.year = now.getFullYear();
      this.month = now.getMonth();
      this.render();
    });

    const start = localeWeekStart();
    const grid = contentEl.createDiv({ cls: "org-calendar-grid" });
    for (let i = 0; i < 7; i++) {
      // 2024-01-07 was a Sunday
      const name = new Date(2024, 0, 7 + ((start + i) % 7)).toLocaleDateString(undefined, { weekday: "short" });
      grid.createDiv({ cls: "org-calendar-weekday", text: name });
    }
    const today = journalDateString(new Date());
    for (const week of calendarMonth(this.year, this.month, start)) {
      for (const cell of week) {
        const el = grid.createEl("button", { cls: "org-calendar-day", text: String(cell.day) });
        if (!cell.inMonth) el.addClass("is-outside");
        if (cell.date === today) el.addClass("is-today");
        if (this.hasEntry(cell.date)) {
          el.addClass("has-entry");
          el.createSpan({ cls: "org-calendar-dot" });
        }
        el.setAttribute("aria-label", cell.date);
        el.addEventListener("click", () => {
          const [y, m, d] = cell.date.split("-").map(Number);
          this.close();
          this.onChoose(new Date(y, m - 1, d));
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** NOTE-1..4: ask for a title; `create` returns a reason when it refuses. */
export class NewNoteModal extends Modal {
  constructor(app: App, private folder: string, private create: (title: string) => Promise<string | null>) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("New org note");
    contentEl.createDiv({ cls: "org-new-note-folder", text: `In ${this.folder || "the vault root"}` });
    const input = contentEl.createEl("input", { type: "text", cls: "org-new-note-title", attr: { placeholder: "Title" } });
    const error = contentEl.createDiv({ cls: "org-new-note-error" });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = async () => {
      const problem = await this.create(input.value);
      if (problem) error.setText(problem);
      else this.close();
    };
    buttons.createEl("button", { text: "Create", cls: "mod-cta" }).addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        void submit();
      }
    });
    input.addEventListener("input", () => error.setText(""));
    window.setTimeout(() => input.focus(), 0);
    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface CaptureChoice {
  text: string;
  /** "" for no keyword */
  state: string;
  scheduled: Date | null;
}

/**
 * CAP-1, CAP-4, CAP-7, CAP-8: one box for a quick capture, with its state
 * and schedule. On the desktop Enter files it and Shift+Enter adds a line; on
 * the phone Enter adds a line and the button files it.
 */
export class CaptureModal extends Modal {
  constructor(
    app: App,
    private target: string,
    private initial: string,
    private cursor: number,
    private states: string[],
    private file: (choice: CaptureChoice) => Promise<string | null>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Capture");
    contentEl.addClass("org-capture");
    contentEl.createDiv({ cls: "org-capture-target", text: `At the end of ${this.target}` });
    const input = contentEl.createEl("textarea", { cls: "org-capture-text", attr: { placeholder: "What's on your mind? Lines after the first are notes.", rows: "4" } });
    input.value = this.initial;

    const stateRow = contentEl.createDiv({ cls: "org-capture-row" });
    stateRow.createSpan({ cls: "org-capture-label", text: "State" });
    const state = stateRow.createEl("select", { cls: "dropdown org-capture-state" });
    for (const s of this.states) state.createEl("option", { value: s, text: s || "None" });
    state.value = this.states[0] ?? "";

    const dateRow = contentEl.createDiv({ cls: "org-capture-row" });
    dateRow.createSpan({ cls: "org-capture-label", text: "Scheduled" });
    const date = dateRow.createEl("input", { type: "date", cls: "org-capture-date" });
    const quick = dateRow.createDiv({ cls: "org-capture-quick" });
    const today = new Date();
    const chips: [string, Date | null][] = [["Today", today], ["Tomorrow", addDays(today, 1)], ["None", null]];
    const buttons = chips.map(([label, value]) => {
      const chip = quick.createEl("button", { text: label, cls: "org-capture-chip" });
      chip.addEventListener("click", () => {
        date.value = value ? dateFieldValue(value) : "";
        mark();
      });
      return { chip, value: value ? dateFieldValue(value) : "" };
    });
    const mark = () => buttons.forEach(({ chip, value }) => chip.toggleClass("is-active", value === date.value));
    date.value = dateFieldValue(today);
    date.addEventListener("input", mark);
    date.addEventListener("change", mark);
    mark();

    const error = contentEl.createDiv({ cls: "org-capture-error" });
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = async () => {
      // a half-typed date counts as none only when the field is empty
      const scheduled = parseDateField(date.value);
      if (date.value && !scheduled) {
        error.setText("Finish the date, or choose None.");
        return;
      }
      const problem = await this.file({ text: input.value, state: state.value, scheduled });
      if (problem) error.setText(problem);
      else this.close();
    };
    actions.createEl("button", { text: "Capture", cls: "mod-cta" }).addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !Platform.isMobile) {
        e.preventDefault();
        void submit();
      }
    });
    input.addEventListener("input", () => error.setText(""));
    const focus = () => {
      input.focus();
      input.setSelectionRange(this.cursor, this.cursor);
    };
    window.setTimeout(focus, 0);
    focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** ATT-4: the recorder's MIME type: MP4 (AAC) where it records that, as on iOS, else WebM (Opus), else the default. */
function recorderType(): string | undefined {
  for (const type of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/** ATT-4: record from the microphone with a running time; Stop saves, Cancel or closing throws it away. */
export class RecorderModal extends Modal {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  private keep = false;

  constructor(app: App, private onSave: (blob: Blob, mime: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("Record voice note");
    contentEl.addClass("org-recorder");
    const status = contentEl.createDiv({ cls: "org-recorder-status", text: "Starting the microphone…" });
    const time = contentEl.createDiv({ cls: "org-recorder-time", text: "0:00" });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const stop = buttons.createEl("button", { text: "Stop and save", cls: "mod-cta" });
    stop.disabled = true;
    stop.addEventListener("click", () => {
      this.keep = true;
      this.close();
    });
    void this.start(status, time, stop);
  }

  private async start(status: HTMLElement, time: HTMLElement, stop: HTMLButtonElement) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.contentEl.isConnected) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const type = recorderType();
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", (e) => { if (e.data.size) chunks.push(e.data); });
      recorder.addEventListener("stop", () => {
        const mime = recorder.mimeType || type || "audio/webm";
        if (this.keep && chunks.length) this.onSave(new Blob(chunks, { type: mime }), mime);
      });
      recorder.start(1000);
      this.recorder = recorder;
      const started = Date.now();
      status.setText("Recording");
      status.addClass("is-recording");
      stop.disabled = false;
      this.timer = window.setInterval(() => {
        const s = Math.floor((Date.now() - started) / 1000);
        time.setText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      }, 250);
    } catch (e) {
      status.setText(`Can't record: ${(e as Error).message}`);
    }
  }

  onClose() {
    window.clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.contentEl.empty();
  }
}

/** FIND-1..3: every note and heading with an ID, by title; the last entry can create the note. */
export class NodeFinderModal extends SuggestModal<NodeChoice> {
  constructor(app: App, private nodes: TitleCompletion[], private onChoose: (choice: NodeChoice) => void) {
    super(app);
    this.setPlaceholder("Find or create a node");
    this.setInstructions([{ command: "↵", purpose: "to open" }]);
  }
  getSuggestions(query: string): NodeChoice[] {
    const match = prepareFuzzySearch(query.trim());
    return findNodes(this.nodes, query, (label) => match(label)?.score ?? null);
  }
  renderSuggestion(choice: NodeChoice, el: HTMLElement) {
    el.addClass("org-node-choice");
    if (choice.kind === "create") {
      el.addClass("org-node-create");
      setIcon(el.createSpan({ cls: "org-node-icon" }), "file-plus");
      el.createSpan({ cls: "org-node-title", text: choice.title });
      el.createSpan({ cls: "org-node-detail", text: "Create note" });
      return;
    }
    el.createSpan({ cls: "org-node-title", text: choice.node.label });
    if (choice.node.detail) el.createSpan({ cls: "org-node-detail", text: choice.node.detail });
  }
  onChooseSuggestion(choice: NodeChoice) {
    this.onChoose(choice);
  }
}
