// TODO: New command: Suggest dice for table at cursor based on row count, aiming for even odds across the table.

import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiceTableSettings {
  autoFillOnSave: boolean;
  useRanges: boolean; // true = "1-5", false = single value per row (only valid when rows === faces)
}

const DEFAULT_SETTINGS: DiceTableSettings = {
  autoFillOnSave: false,
  useRanges: true,
};

interface DiceSpec {
  count: number;  // number of dice (e.g. 2 in 2d6)
  faces: number;  // die faces (e.g. 6 in 2d6)
  min: number;    // minimum rollable value
  max: number;    // maximum rollable value
  total: number;  // total span (max - min + 1)
  raw: string;    // original header text
}

// ─── Dice Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse dice notation from a string.
 * Supports: d6, D20, d%, 1d6, 2d8, 3d6, d100, d66
 * Returns null if not dice notation.
 */
function parseDice(header: string): DiceSpec | null {
  const trimmed = header.trim().toLowerCase().replace(/\s/g, "");

  // Handle d% as d100
  const normalised = trimmed.replace(/d%/, "d100");

  // Pattern: optional count, then d, then faces
  const match = normalised.match(/^(\d+)?d(\d+)$/);
  if (!match) return null;

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const faces = parseInt(match[2], 10);

  if (faces < 2 || count < 1) return null;

  const min = count;          // e.g. 2d6 min = 2
  const max = count * faces;  // e.g. 2d6 max = 12
  const total = max - min + 1;

  return { count, faces, min, max, total, raw: header.trim() };
}

// ─── Range Distribution ───────────────────────────────────────────────────────

/**
 * Distribute [min..max] across `rows` buckets as evenly as possible.
 * Returns an array of { from, to } objects.
 * Remainder values are spread across the first buckets.
 */
function distributeRange(
  min: number,
  max: number,
  rows: number
): Array<{ from: number; to: number }> {
  const total = max - min + 1;
  const base = Math.floor(total / rows);
  const remainder = total % rows;

  const buckets: Array<{ from: number; to: number }> = [];
  let cursor = min;

  for (let i = 0; i < rows; i++) {
    const size = base + (i < remainder ? 1 : 0);
    buckets.push({ from: cursor, to: cursor + size - 1 });
    cursor += size;
  }

  return buckets;
}

/**
 * Format a bucket as a string.
 * If from === to, return a single number. Otherwise return "from-to".
 */
function formatBucket(b: { from: number; to: number }): string {
  return b.from === b.to ? `${b.from}` : `${b.from}-${b.to}`;
}

// ─── Markdown Table Parsing ───────────────────────────────────────────────────

interface TableInfo {
  startLine: number;   // line index of header row
  endLine: number;     // line index of last data row
  headerCols: string[];
  separatorLine: string;
  dataRows: string[][];// [rowIndex][colIndex] = cell content
  colCount: number;
}

/** Split a markdown table row into trimmed cell strings */
function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "") // strip leading/trailing pipes
    .split("|")
    .map((c) => c.trim());
}

/** Re-join cells into a markdown table row */
function joinRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

/** Detect whether a line is a markdown table separator (|---|---| etc.) */
function isSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|/.test(line);
}

/**
 * Find and parse the first markdown table at or after `cursorLine` in `lines`.
 */
function findTable(lines: string[], cursorLine: number): TableInfo | null {
  // Walk backwards from cursor to find table start
  let headerLine = -1;
  for (let i = cursorLine; i >= 0; i--) {
    if (lines[i].trim().startsWith("|")) {
      headerLine = i;
    } else {
      break;
    }
  }
  // Also search forward if cursor not in a table
  if (headerLine === -1) {
    for (let i = cursorLine; i < lines.length; i++) {
      if (lines[i].trim().startsWith("|")) {
        headerLine = i;
        break;
      }
    }
  }
  if (headerLine === -1) return null;

  // Make sure next line is separator
  if (headerLine + 1 >= lines.length || !isSeparator(lines[headerLine + 1])) {
    return null;
  }

  const headerCols = splitRow(lines[headerLine]);
  const separatorLine = lines[headerLine + 1];
  const colCount = headerCols.length;

  // Collect data rows
  const dataRows: string[][] = [];
  let endLine = headerLine + 1;
  for (let i = headerLine + 2; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith("|")) break;
    dataRows.push(splitRow(lines[i]));
    endLine = i;
  }

  if (dataRows.length === 0) return null;

  return {
    startLine: headerLine,
    endLine,
    headerCols,
    separatorLine,
    dataRows,
    colCount,
  };
}

// ─── Core Fill Logic ──────────────────────────────────────────────────────────

/**
 * Given a table, check if its first column is dice notation and, if so,
 * return the updated table lines (header + sep + data rows).
 * Returns null if the table doesn't need updating.
 */
function fillDiceColumn(
  table: TableInfo,
  settings: DiceTableSettings
): string[] | null {
  const firstHeader = table.headerCols[0];
  const dice = parseDice(firstHeader);
  if (!dice) return null;

  const rows = table.dataRows.length;
  if (rows === 0) return null;

  const buckets = distributeRange(dice.min, dice.max, rows);

  // Build updated lines
  const newLines: string[] = [];

  // Header (unchanged)
  newLines.push(joinRow(table.headerCols));
  // Separator (unchanged)
  newLines.push(table.separatorLine);

  // Data rows — only update column 0
  table.dataRows.forEach((row, i) => {
    const updated = [...row];
    // Pad if row has fewer columns than header
    while (updated.length < table.colCount) updated.push("");
    updated[0] = formatBucket(buckets[i]);
    newLines.push(joinRow(updated));
  });

  return newLines;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class DiceTablePlugin extends Plugin {
  settings: DiceTableSettings;

  async onload() {
    await this.loadSettings();

    // ── Command: fill table at cursor ──
    this.addCommand({
      id: "fill-dice-table",
      name: "Fill dice column in table at cursor",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.fillTableAtCursor(editor);
      },
    });

    // ── Command: fill ALL dice tables in file ──
    this.addCommand({
      id: "fill-all-dice-tables",
      name: "Fill all dice columns in this file",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.fillAllTables(editor);
      },
    });

    // ── Optional: auto-fill on file save ──
    if (this.settings.autoFillOnSave) {
      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          const view =
            this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view && view.file === file) {
            // slight delay to avoid fighting with the editor
            window.setTimeout(() => {
              const editor = view.editor;
              if (editor) this.fillAllTables(editor, true);
            }, 300);
          }
        })
      );
    }

    this.addSettingTab(new DiceTableSettingTab(this.app, this));

    // console.log("Dice Table plugin loaded.");
  }

  onunload() {}

  // ── Fill table at editor cursor position ──
  fillTableAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const lines = content.split("\n");

    const table = findTable(lines, cursor.line);
    if (!table) {
      new Notice("No Markdown table found at cursor.");
      return;
    }

    const newTableLines = fillDiceColumn(table, this.settings);
    if (!newTableLines) {
      new Notice(
        `First column "${table.headerCols[0]}" is not dice notation (e.g. d6, 2d8, d100).`
      );
      return;
    }

    this.replaceTableInEditor(editor, lines, table, newTableLines);
    new Notice(`Filled ${table.dataRows.length} rows for ${table.headerCols[0]}`);
  }

  // ── Fill ALL dice tables in the file ──
  fillAllTables(editor: Editor, silent = false) {
    const content = editor.getValue();
    let lines = content.split("\n");
    let filled = 0;

    // Walk through lines, find each table
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim().startsWith("|")) {
        i++;
        continue;
      }
      const table = findTable(lines, i);
      if (!table) {
        i++;
        continue;
      }

      const newTableLines = fillDiceColumn(table, this.settings);
      if (newTableLines) {
        // Splice updated lines in
        lines.splice(
          table.startLine,
          table.endLine - table.startLine + 1,
          ...newTableLines
        );
        filled++;
        // Move past this table
        i = table.startLine + newTableLines.length;
      } else {
        // Skip to end of this table
        i = table.endLine + 1;
      }
    }

    if (filled > 0) {
      editor.setValue(lines.join("\n"));
      if (!silent) new Notice(`Filled ${filled} dice table(s).`);
    } else {
      if (!silent) new Notice("No dice tables found in this file.");
    }
  }

  // ── Replace table lines in editor without touching the rest ──
  replaceTableInEditor(
    editor: Editor,
    lines: string[],
    table: TableInfo,
    newTableLines: string[]
  ) {
    const from = { line: table.startLine, ch: 0 };
    const to = {
      line: table.endLine,
      ch: lines[table.endLine].length,
    };
    editor.replaceRange(newTableLines.join("\n"), from, to);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class DiceTableSettingTab extends PluginSettingTab {
  plugin: DiceTablePlugin;

  constructor(app: App, plugin: DiceTablePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Dice table settings" });

    new Setting(containerEl)
      .setName("Auto-fill on file modify")
      .setDesc(
        "Automatically recalculate dice columns whenever the file is saved. " +
          "Disable if you want to trigger fills manually."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFillOnSave)
          .onChange(async (value) => {
            this.plugin.settings.autoFillOnSave = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
