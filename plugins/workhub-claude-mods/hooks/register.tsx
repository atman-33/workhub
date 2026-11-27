import type { Register } from 'claude-code'

const PANE = 'workhub-tasks'
const REFRESH_MS = 15000
const FILTER_KEY = 'projectFilter'
const ALL = '__all__'
const NONE = '__none__' // tasks with no `project`

type Task = {
  id: string
  title: string
  status: string
  blocked: boolean
  completed: string
  project: string
  backlog: string
  file: string // absolute path of the task note
  backlogFile?: string // absolute path of the backlog entry note, when found
}

// ---------------------------------------------------------------- icons
// Lucide-style line icons, 16px. SVG cannot inherit theme colors, so each
// carries a mid-tone stroke that reads on both light and dark.
const GRAY = '#8b8f98'
const ICON_BODY: Record<string, string> = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  backlog:
    '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  doing: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  review: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  todo: '<circle cx="12" cy="12" r="9"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
}

function svg(name: string, color: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" ' +
    `fill="none" stroke="${color}" color="${color}" stroke-width="1.75" ` +
    'stroke-linecap="round" stroke-linejoin="round">' +
    ICON_BODY[name] +
    '</svg>'
  )
}

// Sections in display order. inbox is deliberately absent: it holds what is parked.
const SECTIONS = [
  { status: 'doing', icon: 'doing', color: '#3b82f6', emoji: '🔵', label: 'Doing' },
  { status: 'review', icon: 'review', color: '#a855f7', emoji: '🟣', label: 'Review' },
  { status: 'todo', icon: 'todo', color: GRAY, emoji: '⚪', label: 'ToDo' },
  { status: 'done', icon: 'done', color: '#22c55e', emoji: '✅', label: 'Done' },
] as const

// ---------------------------------------------------------------- tasks
function field(head: string, key: string): string {
  const m = head.match(new RegExp(`^${key}:[ \t]*(.*)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}

function parse(text: string, file: string): Task | undefined {
  const m = text.replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---/)
  if (!m) return undefined
  const head = m[1]
  const id = field(head, 'id')
  if (!id) return undefined
  return {
    id,
    title: field(head, 'title'),
    status: field(head, 'status'),
    blocked: field(head, 'blocked') === 'true',
    completed: field(head, 'completed'),
    project: field(head, 'project'),
    backlog: field(head, 'backlog'),
    file,
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// "projects/NNNN-<slug>/backlog/B-NNN-*/B-NNN-*.md": the entry note keeps the
// folder's exact name. Only hits are cached; a miss is looked up again.
const backlogCache = new Map<string, string>()

async function findBacklog(
  $: any,
  vault: string,
  project: string,
  backlog: string,
): Promise<string | undefined> {
  if (!project || !backlog) return undefined
  const key = `${vault}|${project}/${backlog}`
  const hit = backlogCache.get(key)
  if (hit) return hit
  try {
    const projectsDir = `${vault}/projects`
    const projects = await $.fs.list(projectsDir)
    const dir = projects.find((p: any) => p.kind === 'dir' && p.name.endsWith(`-${project}`))
    if (!dir) return undefined
    const root = `${projectsDir}/${dir.name}/backlog`
    const items = await $.fs.list(root)
    const item = items.find((i: any) => i.kind === 'dir' && i.name.startsWith(`${backlog}-`))
    if (!item) return undefined
    const path = `${root}/${item.name}/${item.name}.md`
    if (!(await $.fs.exists(path))) return undefined
    backlogCache.set(key, path)
    return path
  } catch {
    return undefined
  }
}

async function load($: any, vault: string): Promise<{ tasks: Task[]; today: string; error?: string }> {
  const d = new Date(await $.clock.now())
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  try {
    const entries = await $.fs.list(`${vault}/tasks`)
    const files = entries.filter((f: any) => f.kind === 'file' && f.name.endsWith('.md'))
    const tasks = (
      await Promise.all(
        files.map(async (f: any) => {
          try {
            const path = `${vault}/tasks/${f.name}`
            const task = parse(await $.fs.read(path), path)
            if (task) task.backlogFile = await findBacklog($, vault, task.project, task.backlog)
            return task
          } catch {
            return undefined
          }
        }),
      )
    ).filter((t): t is Task => t !== undefined)
    return { tasks, today }
  } catch (err) {
    return { tasks: [], today, error: String(err) }
  }
}

// ---------------------------------------------------------------- vault
// A workhub vault has `tasks/` and `_ai/` at its root (the same test the
// workhub plugin's hooks use). The session's directory may be anywhere inside
// it, so walk up. Outside a vault this is undefined and the mod stays silent.
const norm = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/[/]+$/, '')

async function findVault($: any): Promise<string | undefined> {
  try {
    let dir = norm(await $.session.cwd())
    for (let i = 0; i < 64 && dir; i++) {
      if ((await $.fs.exists(`${dir}/tasks`)) && (await $.fs.exists(`${dir}/_ai`))) return dir
      const parent = dir.replace(/[/][^/]*$/, '')
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // no session directory to read: not in a vault
  }
  return undefined
}

// ---------------------------------------------------------------- obsidian
function obsidianUri(path: string, windows: boolean): string {
  const p = windows ? path.split('/').join(String.fromCharCode(92)) : path
  return `obsidian://open?path=${encodeURIComponent(p).split("'").join('%27')}`
}

// The URI goes straight to the registered handler, with no shell in between to
// re-read the % escapes. On Windows that is rundll32 url.dll,FileProtocolHandler
// (explorer.exe exits quietly without opening it: checked against Obsidian
// 1.15.1); macOS has `open`, Linux `xdg-open`.
async function openInObsidian($: any, path: string) {
  try {
    // A drive letter or a backslash means Windows; otherwise `uname -s` tells
    // macOS (Darwin) from Linux.
    const windows = /^[A-Za-z]:/.test(path) || path.includes(String.fromCharCode(92))
    const mac = !windows && (await $.process.run(['uname', '-s'])).stdout.trim() === 'Darwin'
    const uri = obsidianUri(path, windows)
    const argv = windows
      ? ['rundll32.exe', 'url.dll,FileProtocolHandler', uri]
      : mac
        ? ['open', uri]
        : ['xdg-open', uri]
    await $.process.run(argv)
  } catch (err) {
    $.ui.toast(`Could not open Obsidian: ${String(err)}`)
  }
}

// ---------------------------------------------------------------- mod
export const register: Register = on => {
  // True once the person closed the pane; the band below then offers it back.
  let isClosed = false
  // The project picked in the filter; read from $.store on the first draw.
  let filter: string | undefined
  // The vault the session runs in; undefined means the mod does nothing.
  let vault: string | undefined

  on('session.start', async ($, e, next) => {
    vault = await findVault($)
    if (!vault) return next(e)
    await $.command.register({
      name: 'workhub-tasks',
      description: "Show today's workhub tasks in a pane",
    })
    void $.ui.open({ id: PANE, title: 'Tasks' })
    $.clock.every(REFRESH_MS, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('command.run', { command: 'workhub-tasks' }, async $ => {
    vault = vault ?? (await findVault($))
    if (!vault) return { text: 'Not in a workhub vault.' }
    await $.ui.open({ id: PANE, title: 'Tasks' })
    isClosed = false
    $.ui.invalidate('ui.render')

    return { text: 'Tasks pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      isClosed = true
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // One quiet row above the prompt while the pane is closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!vault || !isClosed) return next(e)
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const { tasks } = await load($, vault)
    // What is in flight, not what is finished: one icon and count per status.
    const live = SECTIONS.filter(s => s.status !== 'done')
      .map(s => ({ s, n: tasks.filter(t => t.status === s.status).length }))
      .filter(x => x.n > 0)

    return (
      <Box flexDirection="row" justifyContent="flex-start" alignItems="center">
        {Svg && <Svg source={svg('list', GRAY)} alt="" width={14} height={14} />}
        <Button
          key="reopen"
          label=" Tasks"
          plain
          onPress={async () => {
            await $.ui.open({ id: PANE, title: 'Tasks' })
            isClosed = false
            $.ui.invalidate('ui.render')
          }}
        />
        {live.map(({ s, n }) => (
          <Box key={s.status} marginLeft={2} alignItems="center">
            {Svg ? (
              <Svg source={svg(s.icon, s.color)} alt={s.label} width={14} height={14} />
            ) : (
              <Text>{s.emoji}</Text>
            )}
            <Text dimColor> {n}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    vault = vault ?? (await findVault($))
    if (!vault) return next(e)
    const { Box, Text, Button, Svg, Select } = $.ui.resolve(e) as any
    const { tasks, today, error } = await load($, vault)

    if (filter === undefined) {
      const saved = await $.store.get(FILTER_KEY)
      filter = typeof saved === 'string' ? saved : ALL
    }

    const byId = (a: Task, b: Task) => a.id.localeCompare(b.id)
    // What the pane shows at all: inbox never, a done task only when it was
    // finished today.
    const shown = tasks.filter(
      t =>
        t.status === 'doing' ||
        t.status === 'review' ||
        t.status === 'todo' ||
        (t.status === 'done' && t.completed.startsWith(today)),
    )

    // One option per project that has a shown task, so an empty project never
    // appears. A saved choice that no longer has an option reads as All.
    const counts = new Map<string, number>()
    for (const t of shown) {
      const key = t.project || NONE
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const projects = [...counts.keys()].filter(k => k !== NONE).sort()
    const options = [
      { value: ALL, label: `All (${shown.length})` },
      ...projects.map(p => ({ value: p, label: `${p} (${counts.get(p)})` })),
      ...(counts.has(NONE)
        ? [{ value: NONE, label: `(no project) (${counts.get(NONE)})` }]
        : []),
    ]
    const current = options.some(o => o.value === filter) ? filter : ALL

    const inScope = shown.filter(t => current === ALL || (t.project || NONE) === current)
    const rows = {
      doing: inScope.filter(t => t.status === 'doing').sort(byId),
      review: inScope.filter(t => t.status === 'review').sort(byId),
      todo: inScope.filter(t => t.status === 'todo').sort(byId),
      done: inScope.filter(t => t.status === 'done').sort(byId),
    }
    const total = inScope.length

    // A Button takes only a label or Text, never an Svg, and a Link takes only
    // https. So the openers are plain text buttons: the task id opens the task
    // note, one quiet glyph at the row's end opens the backlog entry note.
    const BACKLOG_GLYPH = '▤'

    return (
      <Box flexDirection="column">
        {error && <Text color="red">Failed to read tasks: {error}</Text>}
        {Select && (
          <Select
            key="project-filter"
            label="Project "
            options={options}
            value={current}
            onSelect={async (value: string) => {
              filter = value
              await $.store.set(FILTER_KEY, value)
              $.ui.invalidate('ui.render')
            }}
          />
        )}
        <Text bold>
          Done {rows.done.length} / {total}
        </Text>
        {SECTIONS.map(s => {
          const list = rows[s.status]
          if (list.length === 0) return null
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box>
                {Svg ? (
                  <Svg source={svg(s.icon, s.color)} alt={s.label} width={16} height={16} />
                ) : (
                  <Text>{s.emoji}</Text>
                )}
                <Text bold>
                  {' '}
                  {s.label} ({list.length})
                </Text>
              </Box>
              {list.map(t => (
                <Box key={t.id}>
                  <Box flexShrink={0}>
                    <Text>{'  '}</Text>
                    <Button
                      key={`${t.id}-note`}
                      label={t.id}
                      plain
                      dimColor={s.status === 'done'}
                      onPress={() => openInObsidian($, t.file)}
                    />
                  </Box>
                  <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Text wrap="truncate-end" dimColor={s.status === 'done'}>
                      {' '}
                      {t.title}
                      {t.blocked ? ' [blocked]' : ''}
                    </Text>
                  </Box>
                  {t.backlogFile && (
                    <Box flexShrink={0} marginLeft={1}>
                      <Button
                        key={`${t.id}-backlog`}
                        label={BACKLOG_GLYPH}
                        plain
                        dimColor
                        onPress={() => openInObsidian($, t.backlogFile)}
                      />
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
