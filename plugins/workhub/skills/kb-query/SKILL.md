---
name: kb-query
description: Query the workhub vault knowledge base to find information, synthesize answers from multiple notes, and optionally save insights. Use when asking questions about vault content or needing cross-document analysis.
argument-hint: "<question>"
---

# KB Query — Knowledge Search + Synthesis

Search the workhub vault, synthesize answers from multiple documents, cite
sources with wikilinks, and optionally accumulate new insights as vault notes.

## Vault map

| Zone | What lives there |
|------|------------------|
| `tasks/` | task board (`_ai/index/tasks.json` is the fast index) |
| `projects/<name>/` | per-project notes and deliverables |
| `knowledge/<topic>/` | durable reference knowledge by topic |
| `journal/` | daily/weekly notes (temporal queries) |
| `archive/` | completed/inactive material |
| `_ai/logs/` | agent reports and the KB activity log (`kb-log.md`) |

## Usage

```
/kb-query "list all notes related to kubernetes"
/kb-query "workhub design decisions so far"
/kb-query "documents referencing MyProject"
/kb-query "summary of work in last 2 weeks"
```

## Route Selection

Choose the optimal search path by question type. **Do not always start from an
index** — pick the fastest route.

### Inbox Structure Notes

- Treat `inbox/**/README.md` as structural guidance notes for folder usage.
- Exclude or de-prioritize them during routine knowledge queries; use them only
  when the question is about inbox structure or note organization.

### Route A: Direct Folder Access
**When:** Target is clearly in one zone.
```
"workhub design decisions" → read projects/workhub/ directly
"infra knowledge overview" → read knowledge/_index.md then scan knowledge/infra/
```

### Route B: Tag Cross-Collection
**When:** Need to gather documents across folders by topic.
```
"everything about my-project" → search #proj/my-project across vault
"ML optimization related" → search #topic/ml-optimization
```

### Route C: Backlink Traversal
**When:** Need to find what references a specific document or entity.
```
"where is MyProject used" → search for [[MyProject]] and "MyProject"
```
With obsidian CLI: `obsidian backlinks file="DocumentName"`.
Without CLI: Grep for `[[DocumentName]]` across vault.

### Route D: Index + Log Browse
**When:** Broad overview or temporal queries.
```
"what happened recently" → read _ai/logs/kb-log.md (last 20 entries) and recent journal/ notes
"project overview" → read projects/_index.md
"task status" → read _ai/index/tasks.json
```

### Route E: Full-Text Search
**When:** Specific term or concept lookup.
```
"Prometheus metric setup" → Grep "Prometheus" across vault
```

### Combined Routes
Complex questions may combine routes:
```
"key techniques in notes referenced by my-project"
  Route A: read project docs for references
  Route A: read each referenced note
  Synthesize: compare techniques
```

## Execution Flow

### 1. PARSE
- Extract: subject, scope, temporal range, expected output type
- Select route(s): A, B, C, D, E, or combination
- Estimate token budget (stay under 10K tokens of source reading)

### 2. SEARCH
- Start with `_index.md` files for orientation (10-20 lines, cheap)
- Read full documents only when needed for the answer
- Use Grep for targeted term search
- Exclude or de-prioritize `inbox/**/README.md` unless the query is about structure
- Expand with backlinks if initial results are insufficient

### 3. SYNTHESIZE
- Combine information from multiple sources
- **Always cite** with `[[wikilinks]]`
- Format by output type: lists include file locations; analysis includes
  evidence; timelines are chronological; comparisons use a table

### 4. ACCUMULATE (optional)
Decide whether the result is worth saving:

| Result Type | Action |
|-------------|--------|
| Simple factual answer | Respond only |
| New insight or synthesis | Offer to save as a note |
| Cross-document comparison | Suggest saving |
| List/catalog | Suggest if useful for reuse |

If saving:
- Choose the zone (`knowledge/<topic>/` for reusable insight,
  `projects/<name>/` for project-specific synthesis)
- Create with proper frontmatter and tags; wikilink source documents
- Update the zone's `_index.md` and append to `_ai/logs/kb-log.md`

### 5. RESPOND

```markdown
## Answer
{Direct answer}

### Sources
- [[Doc 1]] — relevant detail
- [[Doc 2]] — relevant detail

### Related
- [[Other Doc]] — might be useful
```

## Obsidian CLI Integration

When `obsidian` is available (Obsidian 1.12+), prefer it for:

```bash
obsidian tags sort=count counts               # tag inventory
obsidian search query="#proj/my-project"       # tag search
obsidian backlinks file="MyProject"            # precise backlinks
obsidian search query="Prometheus" limit=10    # native full-text search
obsidian read path="knowledge/_index.md"       # read by path
```

**Detection:** Check `which obsidian` or try a direct call. If unavailable,
fall back to Grep/Glob/Read tools.

## Token Efficiency

- Read `_index.md` first (~10-20 lines) before full documents
- Use CLI `search` or `Grep` to find specific sections, not read entire files
- For large documents, use `offset` + `limit` to read relevant portions
- Prioritize: index → frontmatter → target section → full document
