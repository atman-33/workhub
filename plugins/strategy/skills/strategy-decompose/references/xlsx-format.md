# Output format

## The intermediate JSON

The decomposition is written as JSON first; `scripts/build_xlsx.py` assembles the
workbook. Improvising openpyxl code each run makes the columns and formatting
drift.

```json
{
  "sheet": "Decomposition",
  "header_note": "One line describing the sheet — the flow between phases, for example.",
  "strategies": [
    {
      "level1": "Strategy 1 [PoC phase] — <the upper strategy, verbatim>",
      "color": "blue",
      "domains": [
        {
          "level2": "1 Value — we understand what sells",
          "components": [
            {
              "level3": "Customer and problem — we can state whose problem we solve",
              "aspects": [
                {
                  "level4": "Target definition — who this is for is defined",
                  "states": [
                    {
                      "level5": "We can explain the target user's attributes, domain knowledge and working environment",
                      "memo": "",
                      "priority": "A",
                      "rationale": "which upper objective it connects to / which local constraint it bites on",
                      "note": ""
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- `color` is `blue` / `orange` / `green` / `purple` / `gray`, shading the Level 1
  column. Omit it and colours are assigned in order
- `priority`, `rationale`, `memo`, `note` may be empty — straight out of a
  decomposition they *should* be

## Columns

| Column | Content |
|---|---|
| A | Strategy / phase (Level 1) |
| B | Domain (Level 2) |
| C | Component (Level 3) |
| D | Aspect (Level 4) |
| E | Target state (Level 5) |
| F | Memo |
| G | Priority |
| H | Rationale (upper connection / local situation) |
| I | Notes |

Row 1 is `header_note`, merged across A-I. Row 2 is the header. Data starts at
row 3.

**When reading an existing workbook, do not assume those positions.** A file a
human has edited may carry a note on row 1, a blank row 2 and the header on row 3.
`scripts/read_xlsx.py` finds the header row first and reads from the row after
it; do the same if you parse a sheet yourself.

Parent values are written **only on the row where they change**. Filling every
row hides where a branch begins.

## Two files, not two sheets

- `<name>-draft.xlsx` — **the AI's workbook.** The agent rewrites it; the owner
  reads it
- `<name>.xlsx` — **the owner's workbook.** The owner edits it; the agent is
  **read-only** here

Why: the owner can keep their file open in Excel while the agent updates its own,
and openpyxl round-trips silently drop conditional formatting and data validation
that Excel put there.

## Saving

1. Copy the current file to `.backup/<name>-YYYYMMDD.xlsx` (add `-2` if that
   name is taken)
2. Save
3. Report which sheet and how many rows

Only when the owner explicitly asks for their own workbook to be updated: read
it, report what is there and what would change, get approval (including that
Excel is closed), back up, then save.
