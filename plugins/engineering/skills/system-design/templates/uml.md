# Diagrams: <change title>

<!--
Pictures for the human reviewer. They illustrate the proposal, specs and design;
they never introduce a decision those files do not contain.

Every diagram is a Mermaid code block (```mermaid). Include only the diagrams
that apply, and list the omitted ones with a reason under "Omitted" at the end.
Keep each diagram small enough to read — about a dozen nodes; split by area
rather than drawing everything at once.
-->

## Use case diagram

<!--
When: the change adds or alters what an actor (user, admin, external system)
can do. Mermaid has no native use case diagram, so draw it as a flowchart:
actors as stadium nodes outside, use cases as rounded nodes inside a system
subgraph.

```mermaid
flowchart LR
  user([User])
  subgraph system[System]
    uc1(Export data)
    uc2(Schedule export)
  end
  user --> uc1
  user --> uc2
```
-->

## ER diagram

<!--
When: entities, their fields or their relationships are added or changed.
Show the entities the change touches plus their direct neighbours; mark new or
changed entities in the prose above the diagram.

```mermaid
erDiagram
  USER ||--o{ EXPORT_JOB : requests
  EXPORT_JOB {
    string id PK
    string user_id FK
    string status
  }
```
-->

## Sequence diagram

<!--
When: a flow crosses components, processes or systems. One diagram per main
flow; include the important failure path (alt/else) where the spec defines one.

```mermaid
sequenceDiagram
  actor U as User
  participant UI
  participant API
  U->>UI: Click Export
  UI->>API: POST /exports
  alt accepted
    API-->>UI: 202 job id
  else rejected
    API-->>UI: 400 reason
  end
```
-->

## File change map

<!--
When: always, unless no file changes (a pure policy or process design).
The whole picture of where the change lands: repository → area → file, each
file marked added / modified / removed. Group by repository and by area with
subgraphs; list files, not functions. Paths that do not exist yet are
proposals — say so in the prose above.

```mermaid
flowchart LR
  subgraph repo[workhub]
    subgraph backend[src-tauri/src]
      f1[export.rs]:::added
      f2[commands.rs]:::modified
    end
    subgraph frontend[src/components]
      f3[export-dialog.tsx]:::added
      f4[legacy-export.tsx]:::removed
    end
  end
  f3 --> f2 --> f1
  classDef added fill:#d4f7d4,stroke:#2e7d32
  classDef modified fill:#fff3c4,stroke:#b8860b
  classDef removed fill:#f9d0d0,stroke:#c62828,stroke-dasharray:4 3
```

Arrows are optional; use them only for a dependency the reader needs to see.
-->

## Omitted

<!-- Diagram → reason, one per line. Delete the section if every diagram is present. -->
