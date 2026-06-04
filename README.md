# Dice Table Calculator: An Obsidian Plugin

When you run the command on a table with dice notation as the first column's header, it automatically calculates and fills the first column of a Markdown table with evenly distributed dice ranges.

As far as plugins go, this is about as simple and lightweight as you can get. Two total commands, one setting, and it only runs when you tell it to.

## How it works

Write a Markdown table whose **first column header** is any standard dice notation:

| Notation | Die / Pool |
|----------|------------|
| `d6`     | Six-sided die (1–6) |
| `d20`    | Twenty-sided die (1–20) |
| `d100` / `d%` | Percentile (1–100) |
| `2d6`    | Two six-sided dice (2–12) |
| `3d8`    | Three eight-sided dice (3–24) |

Leave the first-column cells blank (or anything — they'll be overwritten). Fill in your table content in the other columns. Then run a command and the plugin fills the dice column with an even spread.

## Supported dice notation
Case insensitive throughout.

- `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`
- `d%` (alias for d100)
- `NdX` — any count and any number of faces, e.g. `2d6`, `3d10`, `5d4`

## Caveats

- Only the **first column** is examined for dice notation.
- Existing content in the dice column is **overwritten** — intentionally.
- Tables must be standard Obsidian/GFM Markdown pipe tables.
- Auto-fill on save can be disruptive if you're mid-edit; keep it off until the table is fully structured.

## Example

**Before:**

```markdown
| d6 | Encounter         |
|----|-------------------|
|    | Goblin ambush     |
|    | Merchant caravan  |
|    | Empty road        |
|    | Bandit scouts     |
|    | Travelling mage   |
|    | Wild animal       |
```

**After running the "Fill dice column" command:**

```markdown
| d6 | Encounter         |
|----|-------------------|
| 1  | Goblin ambush     |
| 2  | Merchant caravan  |
| 3  | Empty road        |
| 4  | Bandit scouts     |
| 5  | Travelling mage   |
| 6  | Wild animal       |
```

### Ranges (more rows than die faces, or pooled dice)

When the number of rows doesn't divide the range evenly — or you're using a dice pool — the plugin produces ranges:

**Before (d20 with 8 rows):**

```markdown
| d20 | Wilderness Event        |
|-----|-------------------------|
|     | Clear skies, easy march |
|     | Heavy rain, slow travel |
|     | Distant smoke           |
|     | Tracks in the mud       |
|     | Abandoned campsite      |
|     | Howling in the night    |
|     | Strange lights          |
|     | Ambush!                 |
```

**After:**

```markdown
| d20 | Wilderness Event        |
|-----|-------------------------|
| 1-3 | Clear skies, easy march |
| 4-5 | Heavy rain, slow travel |
| 6-8 | Distant smoke           |
| 9-10 | Tracks in the mud      |
| 11-13 | Abandoned campsite    |
| 14-15 | Howling in the night  |
| 16-18 | Strange lights        |
| 19-20 | Ambush!               |
```

> [!TIP]
> Remainder values are spread across the first buckets so the distribution stays as even as possible.

For `2d6`, the rollable range is **2–12** (11 values). A table with 5 rows gets:

```
| 2d6  | Result       |
|------|--------------|
| 2-3  | Critical fail|
| 4-5  | Failure      |
| 6-8  | Mixed        |
| 9-10 | Success      |
| 11-12| Critical hit |
```

## Commands

| Command | Action |
|---------|--------|
| **Fill dice column in table at cursor** | Fills only the table your cursor is inside |
| **Fill all dice columns in this file** | Scans the whole file and fills every dice table |

Access via the Command Palette (`Ctrl/Cmd + P`) and search for "Dice".

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-fill on file modify | Off | Runs "fill all" automatically on every file save (300ms if autosave) |

## Manual Installation
For those too cool for using the plugin browser. Assuming this gets accepted for the store.

### Manual (recommended for development)
1. Clone / download this repo.
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Copy the resulting `main.js`, `manifest.json`, and `styles.css` into your vault at:
   ```
   <YourVault>/.obsidian/plugins/dice-table/
   ```
5. In Obsidian → Settings → Community Plugins → enable **Dice Table**.

### Via BRAT (beta plugin manager)
Add the repository URL in BRAT settings to get automatic updates.
