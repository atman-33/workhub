import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'workhub-tasks',
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
