# workhub

A desktop hub where humans and AI agents work on the same Markdown vault. This glossary holds the terms the editors share; it is not a spec.

## Language

**Diagram note**:
A diagram stored as one Markdown file in the vault.
_Avoid_: diagram file, canvas

**Kind**:
The type of a Diagram note (flow, pfd, ifdam, architecture, usecase, algorithm, matrix2x2).
_Avoid_: type, diagram type

**Agent lock**:
The state in which an AI agent is editing a Diagram note and the editor refuses edits.
_Avoid_: read-only mode, busy

**Diagram session**:
One open Diagram note together with its unsaved edits, undo history and the file version it was read at.
_Avoid_: editor state, document state
