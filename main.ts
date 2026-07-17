// TODO: New command: Suggest dice for table at cursor based on row count, aiming for even odds across the table.
// TODO: Warn before calc if first column contains content.
// TODO: Remove 'builtin modules' dependency

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

/**
 * How the dice range is distributed across table rows.
 *
 * "alternating"   — Bresenham/error-diffusion: sizes alternate between base and
 *                   base+1 as evenly as possible across the whole table.
 *                   Visually: 2,3,2,3,2,3… with surplus spread throughout.
 *                   DEFAULT — produces the most aesthetically balanced tables.
 *
 * "even-top"      — All larger buckets come first, smaller ones at the end.
 *                   Visually: 3,3,3,…,2,2,2 (front-loaded remainder).
 *                   Named "Distributed (subtle top-weight)" in the UI because
 *                   early results are very slightly more likely to be rolled.
 *
 * "bottom-weighted" — Bucket sizes grow linearly from top to bottom.
 *                     Rows at the top of the table have small buckets (single
 *                     values), rows at the bottom have large buckets.
 *                     High die values are more likely to be rolled.
 *
 * "top-weighted"  — Bucket sizes shrink linearly from top to bottom (mirror of
 *                   bottom-weighted). Low die values are more likely.
 */
type DistributionMode =
  | "alternating"
  | "even-top"
  | "bottom-weighted"
  | "top-weighted";

interface DiceTableSettings {
  autoFillOnSave: boolean;
  distributionMode: DistributionMode;
}

const DEFAULT_SETTINGS: DiceTableSettings = {
  autoFillOnSave: false,
  distributionMode: "alternating",
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

// ─── Distribution Algorithms ──────────────────────────────────────────────────

interface Bucket { from: number; to: number; }

/**
 * ALTERNATING (default)
 * Uses a Bresenham/error-diffusion accumulator so that surplus (+1) buckets are
 * spread as evenly as possible across the whole table, visually alternating
 * between base-size and (base+1)-size rows.
 *
 * Example – d20, 8 rows (base=2, remainder=4):
 *   1-2, 3-5, 6-7, 8-10, 11-12, 13-15, 16-17, 18-20
 *   sizes: 2,3,2,3,2,3,2,3
 */
function distributeAlternating(min: number, max: number, rows: number): Bucket[] {
  const total = max - min + 1;
  const base = Math.floor(total / rows);
  const remainder = total % rows;
  let cursor = min;
  let acc = 0;
  return Array.from({ length: rows }, () => {
    acc += remainder;
    const size = acc >= rows ? (acc -= rows, base + 1) : base;
    const bucket: Bucket = { from: cursor, to: cursor + size - 1 };
    cursor += size;
    return bucket;
  });
}

/**
 * EVEN-TOP (original behaviour)
 * All larger buckets come first; smaller ones fill the tail.
 * Subtle upward weighting since rows with wider ranges are at the top.
 *
 * Example – d20, 8 rows (base=2, remainder=4):
 *   1-3, 4-6, 7-9, 10-12, 13-14, 15-16, 17-18, 19-20
 *   sizes: 3,3,3,3,2,2,2,2
 */
function distributeEvenTop(min: number, max: number, rows: number): Bucket[] {
  const total = max - min + 1;
  const base = Math.floor(total / rows);
  const remainder = total % rows;
  let cursor = min;
  return Array.from({ length: rows }, (_, i) => {
    const size = base + (i < remainder ? 1 : 0);
    const bucket: Bucket = { from: cursor, to: cursor + size - 1 };
    cursor += size;
    return bucket;
  });
}

/**
 * Build a linearly-ramped set of integer sizes that sum to `total` across
 * `rows` buckets. When ascending=true, sizes grow from ~1 up to ~max;
 * when ascending=false, they shrink from ~max down to ~1.
 *
 * The slope is derived from the arithmetic series formula so that the
 * sequence a_i = round(1 + slope*i) sums as close to total as possible,
 * then any rounding difference is spread among the largest-value end.
 */
function rampedSizes(rows: number, total: number, ascending: boolean): number[] {
  if (rows === 1) return [total];
  // Slope from: sum of (1 + slope*i) for i=0..n-1 = n + slope*(n-1)*n/2 = total
  // → slope = (total - rows) / (rows*(rows-1)/2)
  const slope = (total - rows) / ((rows * (rows - 1)) / 2);
  let sizes = Array.from({ length: rows }, (_, i) =>
    Math.max(1, Math.round(1 + slope * i))
  );
  if (!ascending) sizes = sizes.reverse();

  // Fix any rounding drift so sizes sum exactly to total
  let diff = total - sizes.reduce((a, b) => a + b, 0);
  // Apply corrections to the "large" end (last element when ascending, first when descending)
  const bigEnd = ascending ? rows - 1 : 0;
  const step = ascending ? -1 : 1;
  let idx = bigEnd;
  while (diff > 0) {
    sizes[idx]++;
    diff--;
    idx = ((idx + step) % rows + rows) % rows;
  }
  while (diff < 0) {
    if (sizes[idx] > 1) { sizes[idx]--; diff++; }
    idx = ((idx + step) % rows + rows) % rows;
  }
  return sizes;
}

/**
 * BOTTOM-WEIGHTED
 * Bucket sizes grow linearly from the top of the table to the bottom.
 * The first rows have narrow (single-value) buckets; the last rows have wide
 * buckets. High die results are therefore more probable.
 *
 * Example – d20, 8 rows:
 *   1, 2, 3-4, 5-6, 7-9, 10-12, 13-16, 17-20
 *   sizes: 1,1,2,2,3,3,4,4
 */
function distributeBottomWeighted(min: number, max: number, rows: number): Bucket[] {
  const total = max - min + 1;
  const sizes = rampedSizes(rows, total, true /* ascending */);
  let cursor = min;
  return sizes.map((s) => {
    const bucket: Bucket = { from: cursor, to: cursor + s - 1 };
    cursor += s;
    return bucket;
  });
}

/**
 * TOP-WEIGHTED
 * Mirror of bottom-weighted: bucket sizes shrink from top to bottom.
 * The first rows have wide buckets; the last rows have narrow buckets.
 * Low die results are more probable.
 *
 * Example – d20, 8 rows:
 *   1-4, 5-8, 9-11, 12-14, 15-16, 17-18, 19, 20
 *   sizes: 4,4,3,3,2,2,1,1
 */
function distributeTopWeighted(min: number, max: number, rows: number): Bucket[] {
  const total = max - min + 1;
  const sizes = rampedSizes(rows, total, false /* descending */);
  let cursor = min;
  return sizes.map((s) => {
    const bucket: Bucket = { from: cursor, to: cursor + s - 1 };
    cursor += s;
    return bucket;
  });
}

/** Dispatch to the chosen distribution mode. */
function distribute(
  min: number,
  max: number,
  rows: number,
  mode: DistributionMode
): Bucket[] {
  switch (mode) {
    case "alternating":      return distributeAlternating(min, max, rows);
    case "even-top":         return distributeEvenTop(min, max, rows);
    case "bottom-weighted":  return distributeBottomWeighted(min, max, rows);
    case "top-weighted":     return distributeTopWeighted(min, max, rows);
  }
}

/** Format a bucket as "N" or "N-M". */
function formatBucket(b: Bucket): string {
  return b.from === b.to ? `${b.from}` : `${b.from}-${b.to}`;
}

// ─── Markdown Table Parsing ───────────────────────────────────────────────────

interface TableInfo {
  startLine: number;
  endLine: number;
  headerCols: string[];
  separatorLine: string;
  dataRows: string[][];
  colCount: number;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function joinRow(cells: string[]): string {
  return "| " + cells.join(" | ") + " |";
}

function isSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|/.test(line);
}

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
  // Also search forward if cursor is not already in a table
  if (headerLine === -1) {
    for (let i = cursorLine; i < lines.length; i++) {
      if (lines[i].trim().startsWith("|")) {
        headerLine = i;
        break;
      }
    }
  }
  if (headerLine === -1) return null;
  if (headerLine + 1 >= lines.length || !isSeparator(lines[headerLine + 1])) {
    return null;
  }

  const headerCols = splitRow(lines[headerLine]);
  const separatorLine = lines[headerLine + 1];
  const colCount = headerCols.length;

  const dataRows: string[][] = [];
  let endLine = headerLine + 1;
  for (let i = headerLine + 2; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|")) break;
    dataRows.push(splitRow(lines[i]));
    endLine = i;
  }

  if (dataRows.length === 0) return null;

  return { startLine: headerLine, endLine, headerCols, separatorLine, dataRows, colCount };
}

// ─── Core Fill Logic ──────────────────────────────────────────────────────────

function fillDiceColumn(
  table: TableInfo,
  mode: DistributionMode
): string[] | null {
  const dice = parseDice(table.headerCols[0]);
  if (!dice) return null;

  const rows = table.dataRows.length;
  if (rows === 0) return null;

  const buckets = distribute(dice.min, dice.max, rows, mode);

  const newLines: string[] = [];
  newLines.push(joinRow(table.headerCols));
  newLines.push(table.separatorLine);

  table.dataRows.forEach((row, i) => {
    const updated = [...row];
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

    this.addCommand({
      id: "fill-dice-table",
      name: "Fill dice column in table at cursor",
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        this.fillTableAtCursor(editor);
      },
    });

    this.addCommand({
      id: "fill-all-dice-tables",
      name: "Fill all dice columns in this file",
      editorCallback: (editor: Editor, _view: MarkdownView) => {
        this.fillAllTables(editor);
      },
    });

    if (this.settings.autoFillOnSave) {
      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (view && view.file === file) {
            setTimeout(() => {
              const editor = view.editor;
              if (editor) this.fillAllTables(editor, true);
            }, 300);
          }
        })
      );
    }

    this.addSettingTab(new DiceTableSettingTab(this.app, this));
  }

  onunload() {}

  fillTableAtCursor(editor: Editor) {
    const cursor = editor.getCursor();
    const lines = editor.getValue().split("\n");
    const table = findTable(lines, cursor.line);

    if (!table) {
      new Notice("No markdown table found at cursor.");
      return;
    }

    const newTableLines = fillDiceColumn(table, this.settings.distributionMode);
    if (!newTableLines) {
      new Notice(
        `First column "${table.headerCols[0]}" is not dice notation (e.g. d6, 2d8, d100).`
      );
      return;
    }

    this.replaceTableInEditor(editor, lines, table, newTableLines);
    new Notice(`✅ Filled ${table.dataRows.length} rows for ${table.headerCols[0]}`);
  }

  fillAllTables(editor: Editor, silent = false) {
    let lines = editor.getValue().split("\n");
    let filled = 0;
    let i = 0;

    while (i < lines.length) {
      if (!lines[i].trim().startsWith("|")) { i++; continue; }
      const table = findTable(lines, i);
      if (!table) { i++; continue; }

      const newTableLines = fillDiceColumn(table, this.settings.distributionMode);
      if (newTableLines) {
        lines.splice(table.startLine, table.endLine - table.startLine + 1, ...newTableLines);
        filled++;
        i = table.startLine + newTableLines.length;
      } else {
        i = table.endLine + 1;
      }
    }

    if (filled > 0) {
      editor.setValue(lines.join("\n"));
      if (!silent) new Notice(`✅ Filled ${filled} dice table(s).`);
    } else {
      if (!silent) new Notice("No dice tables found in this file.");
    }
  }

  replaceTableInEditor(editor: Editor, lines: string[], table: TableInfo, newTableLines: string[]) {
    editor.replaceRange(
      newTableLines.join("\n"),
      { line: table.startLine, ch: 0 },
      { line: table.endLine, ch: lines[table.endLine].length }
    );
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

    containerEl.createEl("h2", { text: "Dice Table" });

    // ── Distribution mode dropdown ──────────────────────────────────────────
    new Setting(containerEl)
      .setName("Distribution mode")
      .setDesc(
        "Controls how the dice range is spread across table rows when the " +
        "number of rows doesn't divide the range evenly."
      )
      .addDropdown((drop) => {
        drop
          .addOption("alternating",     "Distributed (alternating)  — 2,3,2,3,2,3…")
          .addOption("even-top",        "Distributed (subtle top-weight)  — 3,3,…,2,2")
          .addOption("bottom-weighted", "Bottom-weighted  — 1,1,…,3,3,5,5")
          .addOption("top-weighted",    "Top-weighted  — 5,5,3,3,…,1,1")
          .setValue(this.plugin.settings.distributionMode)
          .onChange(async (value: string) => {
            this.plugin.settings.distributionMode = value as DistributionMode;
            await this.plugin.saveSettings();
          });
      });

    // ── Mode descriptions ───────────────────────────────────────────────────
    const descEl = containerEl.createEl("div", { cls: "setting-item-description" });
    descEl.style.marginBottom = "1.5em";
    descEl.innerHTML = `
      <table style="border-collapse:collapse;font-size:0.85em;width:100%;">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border)">Mode</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border)">Bucket sizes (d20, 8 rows)</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border)">Best for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:4px 8px">Alternating</td>
            <td style="padding:4px 8px;font-family:monospace">2,3,2,3,2,3,2,3</td>
            <td style="padding:4px 8px">Maximally even spread; no obvious bias</td>
          </tr>
          <tr>
            <td style="padding:4px 8px">Subtle top-weight</td>
            <td style="padding:4px 8px;font-family:monospace">3,3,3,3,2,2,2,2</td>
            <td style="padding:4px 8px">Slight preference for low rolls</td>
          </tr>
          <tr>
            <td style="padding:4px 8px">Bottom-weighted</td>
            <td style="padding:4px 8px;font-family:monospace">1,1,2,2,3,3,4,4</td>
            <td style="padding:4px 8px">High rolls are much more likely</td>
          </tr>
          <tr>
            <td style="padding:4px 8px">Top-weighted</td>
            <td style="padding:4px 8px;font-family:monospace">4,4,3,3,2,2,1,1</td>
            <td style="padding:4px 8px">Low rolls are much more likely</td>
          </tr>
        </tbody>
      </table>`;

    // ── Auto-fill toggle ────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName("Auto-fill on file modify")
      .setDesc(
        "Automatically recalculate all dice columns whenever the file is saved. " +
        "Disable if you want to trigger fills manually via the command palette."
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
