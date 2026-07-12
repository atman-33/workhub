# File naming conventions

All source files under `src/` use lowercase kebab-case names.

- React components: `src/app.tsx`, `src/components/task-dialog.tsx`
- Custom hooks: `src/components/music/use-youtube-player.ts`
- Utility modules: `src/lib/git-graph.ts`, `src/lib/task-body.ts`, `src/lib/utils.ts`
- Store slices: `src/stores/music/playlist-slice.ts`
- Tests: `src/lib/git-graph.test.ts`

Exceptions:
- `src/main.tsx` and `src/index.css` keep their conventional names.

Do not introduce new PascalCase filenames under `src/`.
