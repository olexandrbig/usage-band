import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, view: {}, scroll: { offset: 0, bodyRows: 10 } },
} as const

test('the band shows what is used of context, 7d and 5h', async ($, on) => {
  const at = Date.parse('2026-10-28T12:00:00Z')
  const values: Record<string, unknown> = {
    snapshot: {
      context: 40,
      fiveHour: { percentUsed: 18, resetsAt: '2026-10-28T14:10:00Z' },
      sevenDay: { percentUsed: 32, resetsAt: '2026-10-31T16:00:00Z' },
    },
    now: at,
    place: { kind: 'worktree', name: 'swift-otter' },
  }
  on('state.get', (_, e) => ({ value: { value: values[e.key], version: 1 } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
    expect(all).toMatch(/USAGE/)
    expect(all).toMatch(/40%/)
    expect(all).toMatch(/32%/)
    expect(all).toMatch(/3d 4h/)
    expect(all).toMatch(/18%/)
    expect(all).toMatch(/2h 10m/)
    expect(all).toMatch(/3d 4h.*swift-otter/)
    await ui.unmount()
  }
})

test('the band stays out of the way with no figures yet', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the branch gets an icon: a drawing on desktop, a glyph on the terminal', async ($, on) => {
  const values: Record<string, unknown> = {
    snapshot: { context: 10 },
    now: Date.parse('2026-10-28T12:00:00Z'),
    place: { kind: 'branch', name: 'master' },
  }
  on('state.get', (_, e) => ({ value: { value: values[e.key], version: 1 } }))

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: /^master$/ })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /⎇/ })).toBeDefined()
  await terminal.unmount()
})

test('a narrow band keeps the numbers and drops the dots', async ($, on) => {
  const values: Record<string, unknown> = {
    snapshot: {
      context: 18,
      fiveHour: { percentUsed: 12, resetsAt: '2026-10-28T13:20:00Z' },
      sevenDay: { percentUsed: 66, resetsAt: '2026-10-30T15:00:00Z' },
    },
    now: Date.parse('2026-10-28T12:00:00Z'),
    place: { kind: 'branch', name: 'master' },
  }
  on('state.get', (_, e) => ({ value: { value: values[e.key], version: 1 } }))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 }, surface: 'desktop' })
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  expect(all).not.toMatch(/●/)
  expect(all).toMatch(/18%/)
  expect(all).toMatch(/12% · 1h 20m/)
  expect(all).toMatch(/66% · 2d 3h/)
  await ui.unmount()
})
