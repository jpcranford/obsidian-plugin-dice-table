# Dice Table Calculator: An Obsidian Plugin

A simple plugin that automatically calculates and fills the first column of a Markdown table with evenly distributed dice ranges.

As far as plugins go, this is about as simple and lightweight as you can get. Two total commands, one setting, and it only changes stuff when you tell it to.[^2]

## How to use

Create a Markdown table whose **first column's header** is any standard dice notation. That is `d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`, `d%`, and anything matching `XdX`, e.g. `2d6`, `3d10`, `5d4`. Case insensitive throughout.

Leave the first-column cells blank (or don't — they'll be overwritten). Fill in your table content in the other columns. 

Then, run one of the included commands via the Command Palette (`Ctrl/Cmd + P`): **"Fill dice column in table at cursor"** or **"Fill all dice columns in this file"**. They do what they sound like.

### Caveats

- Only the **first column** is examined for dice notation.
- Existing content in the dice column is **overwritten**. Seriously, don't come crying to me if you put important stuff in there.[^1]
- Tables must be standard Obsidian/GFM Markdown pipe tables.
- Auto-fill on save can be disruptive if you're mid-edit; keep that setting off until the table is fully structured.

[^1]: In the event of frustrating and/or cataclysmic data loss, please create a warning prompt PR so everyone wins.

## Examples

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

When the number of rows doesn't divide the range evenly — or you're using a dice pool — the plugin produces ranges. Remainder values are evenly spread across the rows so the distribution stays as even as possible.

For `2d6`, the rollable range is **2–12** (11 values). A table with 5 rows gets:

```markdown
| 2d6  | Result       |
|------|--------------|
| 2-3  | Critical fail|
| 4-5  | Failure      |
| 6-8  | Mixed        |
| 9-10 | Success      |
| 11-12| Critical hit |
```

## Optional Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Auto-fill on file modify | Off | Runs "fill all" automatically on every file save |

[^2]: Unless you forgot that you told it to run every 300ms. But I'm a programmer, not a mind-reader.