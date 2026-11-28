import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'workhub-claude-mods',
  component: 'Pane',
  requestId: 'workhub-tasks',
  props: {
    title: 'タスク',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const VAULT = '/vault'
// The session runs inside the vault: tasks/ and _ai/ exist at its root.
const inVault = (on: any, cwd = VAULT) => {
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: any, e: any) => ({
    // the engine resolves the path (C:\vault\tasks on Windows), so match its tail
    value: ['/vault/tasks', '/vault/_ai'].some(p =>
      String(e.path).replaceAll(String.fromCharCode(92), '/').endsWith(p),
    ),
  }))
}

const file = (id: string, title: string, status: string, extra = '') =>
  `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n${extra}---\n\n## Description\n`

test('inbox hidden, only todays done shown, blocked marked', async ($, on) => {
  const now = new Date(2026, 10, 26, 12, 0).getTime()
  const files: Record<string, string> = {
    'T-0001 a.md': file('T-0001', 'todo one', 'todo'),
    'T-0002 b.md': file('T-0002', 'parked', 'inbox'),
    'T-0003 c.md': file('T-0003', 'finished today', 'done', 'completed: 2026-11-26 09:00\n'),
    'T-0004 d.md': file('T-0004', 'finished long ago', 'done', 'completed: 2026-11-01 09:00\n'),
    'T-0005 e.md': file('T-0005', 'stuck', 'doing', 'blocked: true\n'),
  }
  inVault(on)
  on('clock.now', () => ({ value: now }))
  on('store.get', () => ({ value: undefined }))
  on('fs.read', (_, e: any) => { return { value: files[String(e.path).replaceAll(String.fromCharCode(92), '/').split('/').pop()!] } })
  on('fs.list', (_, e: any) => { return { value: Object.keys(files).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  const buttons = (await ui.findAll({ type: 'Button' })).map((b: any) => b.text)
  const all = [...texts, ...buttons].join(' | ')

  expect(all).toContain('Done 1 / 3')
  expect(all).toContain('todo one')
  expect(all).toContain('finished today')
  expect(all).toContain('stuck [blocked]')
  for (const id of ['T-0001', 'T-0003', 'T-0005']) expect(buttons).toContain(id)
  expect(all).not.toContain('T-0002')
  expect(all).not.toContain('parked')
  expect(all).not.toContain('long ago')
  await ui.unmount()
})

const filterFiles: Record<string, string> = {
  'T-0001 a.md': file('T-0001', 'garden one', 'todo', 'project: ever-garden\n'),
  'T-0002 b.md': file('T-0002', 'garden two', 'doing', 'project: ever-garden\n'),
  'T-0003 c.md': file('T-0003', 'blade one', 'todo', 'project: blade\n'),
  'T-0004 d.md': file('T-0004', 'loose one', 'todo'),
  'T-0005 e.md': file('T-0005', 'parked only', 'inbox', 'project: parked\n'),
}

const stub = (on: any, saved: unknown, cwd = VAULT) => {
  const now = new Date(2026, 10, 26, 12, 0).getTime()
  inVault(on, cwd)
  on('clock.now', () => ({ value: now }))
  on('store.get', () => ({ value: saved }))
  on('store.set', () => ({ value: undefined }))
  on('fs.read', (_: any, e: any) => ({
    value: filterFiles[String(e.path).replaceAll(String.fromCharCode(92), '/').split('/').pop()!],
  }))
  on('fs.list', () => ({
    value: Object.keys(filterFiles).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
}

const textsOf = async (ui: any) =>
  (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join(' | ')

test('filter options skip projects with no shown task', async ($, on) => {
  stub(on, undefined)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const select: any = await ui.find({ type: 'Select' })
  const labels = select.props.options.map((o: any) => o.label)
  expect(labels).toEqual(['All (4)', 'blade (1)', 'ever-garden (2)', '(no project) (1)'])
  expect(await textsOf(ui)).toContain('Done 0 / 4')
  await ui.unmount()
})

test('a saved project narrows the pane and its count', async ($, on) => {
  stub(on, 'ever-garden')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const t = await textsOf(ui)
  expect(t).toContain('Done 0 / 2')
  expect(t).toContain('garden one')
  expect(t).not.toContain('blade one')
  await ui.unmount()
})

test('a saved project with no option reads as All', async ($, on) => {
  stub(on, 'parked')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(ui)).toContain('Done 0 / 4')
  await ui.unmount()
})

test('a session started in a vault subfolder still finds the vault', async ($, on) => {
  stub(on, undefined, '/vault/projects/foo')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(ui)).toContain('Done 0 / 4')
  await ui.unmount()
})

test('outside a vault the pane passes the draw on and shows nothing', async ($, on) => {
  stub(on, undefined, '/somewhere/else')
  // The hook hands ui.render to next(); with nothing beneath it, mounting fails.
  await expect($.ui.mount({ ...PANE, surface: 'desktop' })).rejects.toThrow('no implementation for ui.render')
})

// ---- status changes and the Inbox toggle
const actionFiles: Record<string, string> = {
  'T-0001 a.md': file('T-0001', 'to review', 'review'),
  'T-0002 b.md': file('T-0002', 'parked one', 'inbox'),
  'T-0003 c.md': file('T-0003', 'to start', 'todo'),
}

const stubActions = (on: any, store: Record<string, unknown>, calls: string[][]) => {
  const now = new Date(2026, 10, 26, 12, 0).getTime()
  const slash = (p: unknown) => String(p).replaceAll(String.fromCharCode(92), '/')
  on('session.cwd', () => ({ value: VAULT }))
  on('fs.exists', (_: any, e: any) => ({
    value: ['/vault/tasks', '/vault/_ai', '/scripts/task-cli.mjs'].some(p => slash(e.path).endsWith(p)),
  }))
  on('clock.now', () => ({ value: now }))
  on('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('fs.read', (_: any, e: any) => ({ value: actionFiles[slash(e.path).split('/').pop()!] }))
  on('fs.list', (_: any, e: any) => ({
    value: slash(e.path).endsWith('/workhub')
      ? [
          { name: '0.9.0', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
          { name: '0.54.0', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
        ]
      : Object.keys(actionFiles).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('process.run', (_: any, e: any) => {
    calls.push(e.argv)
    return { value: { exitCode: 0, stdout: '/home/me', stderr: '' } }
  })
}

const buttonsOf = async (ui: any) =>
  (await ui.findAll({ type: 'Button' })).map((b: any) => b.text)

test('inbox is hidden until the toggle turns it on, and that is remembered', async ($, on) => {
  const store: Record<string, unknown> = {}
  stubActions(on, store, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(ui)).not.toContain('parked one')
  expect(await buttonsOf(ui)).toContain('▸ Inbox (1)')
  await ui.press({ key: 'inbox-toggle' })
  expect(await textsOf(ui)).toContain('parked one')
  expect(store.showInbox).toBe(true)
  await ui.unmount()
})

const moveOf = (calls: string[][], verb: string) => calls.find(a => a.includes(verb))!.slice(2, -2)

test('Done runs on one pick with the newest installed task-cli', async ($, on) => {
  const calls: string[][] = []
  stubActions(on, {}, calls)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'T-0001-move', value: 'done' })
  const run = calls.find(a => a.includes('update'))!
  expect(run.slice(2, 6)).toEqual(['update', 'T-0001', '--status', 'done'])
  expect(run[1].replaceAll(String.fromCharCode(92), '/')).toContain('/workhub/0.54.0/scripts/task-cli.mjs')
  await ui.unmount()
})

test('the dropdown lists the moves for the row, Review can go back to Doing', async ($, on) => {
  stubActions(on, {}, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const select: any = await ui.find({ key: 'T-0001-move' })
  expect(select.props.options.map((o: any) => o.value)).toEqual(['', 'done', 'doing', 'inbox', 'block', 'archive'])
  await ui.unmount()
})

test('Doing goes back to ToDo, a blocked task offers Clear blocked, Archive uses archive', async ($, on) => {
  const calls: string[][] = []
  stubActions(on, {}, calls)
  actionFiles['T-0004 d.md'] = file('T-0004', 'in progress', 'doing', 'blocked: true' + String.fromCharCode(10))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const select: any = await ui.find({ key: 'T-0004-move' })
  expect(select.props.options.map((o: any) => o.value)).toEqual(['', 'done', 'todo', 'inbox', 'unblock', 'archive'])
  await ui.select({ key: 'T-0004-move', value: 'unblock' })
  expect(moveOf(calls, 'update')).toEqual(['update', 'T-0004', '--blocked', 'false'])
  await ui.select({ key: 'T-0004-move', value: 'todo' })
  expect(calls.filter(a => a.includes('update')).at(-1)!.slice(2, 6)).toEqual(['update', 'T-0004', '--status', 'todo'])
  await ui.select({ key: 'T-0003-move', value: 'archive' })
  expect(moveOf(calls, 'archive')).toEqual(['archive', 'T-0003'])
  delete actionFiles['T-0004 d.md']
  await ui.unmount()
})

// ---- Done from any open status
test('ToDo and Doing offer Done first, and Done can be taken back', async ($, on) => {
  stubActions(on, {}, [])
  actionFiles['T-0004 d.md'] = file('T-0004', 'in progress', 'doing')
  actionFiles['T-0005 e.md'] = file('T-0005', 'finished', 'done', 'completed: 2026-11-26 09:00' + String.fromCharCode(10))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const values = async (key: string) =>
    ((await ui.find({ key })) as any).props.options.map((o: any) => o.value)
  expect(await values('T-0003-move')).toEqual(['', 'done', 'doing', 'inbox', 'block', 'archive'])
  expect(await values('T-0004-move')).toEqual(['', 'done', 'todo', 'inbox', 'block', 'archive'])
  expect(await values('T-0005-move')).toEqual(['', 'review', 'doing', 'todo', 'archive'])
  delete actionFiles['T-0004 d.md']
  delete actionFiles['T-0005 e.md']
  await ui.unmount()
})

// ---- context gauge
const BAND = {
  plugin: 'workhub-claude-mods',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

type Git = { branch?: string; sha?: string }

const mountBand = async (
  $: any,
  on: any,
  context: object,
  surface: 'terminal' | 'desktop',
  git: Git | 'none' = { branch: 'feature/x' },
  cwd = VAULT,
) => {
  stub(on, undefined, cwd)
  on('process.run', (_: any, e: any) => {
    const a: string[] = e.argv
    const reply = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (git === 'none') return reply('', 128)
    if (a.includes('--show-current')) return reply(git.branch ? git.branch + String.fromCharCode(10) : '')
    if (a.includes('--short')) return reply(git.sha ? git.sha + String.fromCharCode(10) : '', git.sha ? 0 : 128)
    return reply('')
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { context, rateLimits: [], startedAt: 0 } }))
  await $.session.start({ cwd: VAULT, surface: 'terminal', isInteractive: true })
  return $.ui.mount({ ...BAND, surface })
}

const gaugeText = async ($: any, on: any, context: object) => {
  const ui = await mountBand($, on, context, 'terminal')
  const text = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
  await ui.unmount()
  return text
}

const FILL = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' }

for (const [percent, color] of [[59, 'green'], [60, 'yellow'], [79, 'yellow'], [80, 'red']] as const) {
  test(`the gauge bar is ${color} at ${percent}%`, async ($, on) => {
    const ui = await mountBand($, on, { percent, tokens: percent * 2000, window: 200000 }, 'desktop')
    const bars = (await ui.findAll({ type: 'Svg' })).map((b: any) => String(b.props.source))
    expect(bars.some((src: string) => src.includes(FILL[color]))).toBe(true)
    await ui.unmount()
  })
}

test('the gauge reads the percentage and the token counts, with no emoji', async ($, on) => {
  const text = await gaugeText($, on, { percent: 64, tokens: 128000, window: 200000 })
  expect(text).toContain('64%')
  expect(text).toContain('128k / 200k')
  expect(text).not.toMatch(/[🟢🟡🔴⚪]/u)
})

test('the gauge has no figure before the first response', async ($, on) => {
  const text = await gaugeText($, on, { window: 200000 })
  expect(text).toContain('—')
  expect(text).not.toContain('⚪')
})


test('a row names the folder, its parent and the branch', async ($, on) => {
  const ui = await mountBand($, on, { percent: 10, tokens: 1, window: 2 }, 'terminal', { branch: 'main' }, 'C:/repos/vault')
  const text = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
  expect(text).toContain('vault')
  expect(text).toContain('C:' + String.fromCharCode(92) + 'repos')
  expect(text).toContain('main')
  await ui.unmount()
})

test('a detached HEAD shows the short commit id', async ($, on) => {
  const ui = await mountBand($, on, { percent: 10, tokens: 1, window: 2 }, 'terminal', { sha: 'abc1234' })
  expect((await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')).toContain('abc1234')
  await ui.unmount()
})

test('outside git the folder shows and the branch does not', async ($, on) => {
  const ui = await mountBand($, on, { percent: 10, tokens: 1, window: 2 }, 'terminal', 'none')
  const text = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('')
  expect(text).toContain('vault')
  expect(text).not.toContain('⑂')
  await ui.unmount()
})

test('the desktop gauge draws its bar as an image', async ($, on) => {
  const ui = await mountBand($, on, { percent: 32, tokens: 64000, window: 200000 }, 'desktop')
  const bar: any = await ui.find({ type: 'Svg' })
  expect(bar.props.source).toContain('#22c55e')
  await ui.unmount()
})
