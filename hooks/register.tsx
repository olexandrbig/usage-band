import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { AgentRow, Meter, Place, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const place = atom({ plugin: 'usage-band', key: 'place' } as const, null)
const agents = atom({ plugin: 'usage-band', key: 'agents' } as const, [])

const AGENTS_PANE = 'usage-band-agents'
const ACTIVE = new Set(['pending', 'running', 'waiting'])

const DOTS = 8
const LABEL = '#8a8a8a'
const FAINT = '#5a5a5a'

const ICON_PATHS = {
  branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  agents: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  worktree: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
}

const iconSource = (kind: keyof typeof ICON_PATHS) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${LABEL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[kind]}</svg>`

const toSnapshot = (context: SessionContextUsage, limits: SessionRateLimit[]): Snapshot => {
  const meter = (kind: string): Meter | undefined => {
    const limit = limits.find(l => l.kind === kind)

    return limit && { percentUsed: limit.percentUsed, resetsAt: limit.resetsAt }
  }

  return { context: context.percent, fiveHour: meter('five_hour'), sevenDay: meter('seven_day') }
}

// Green while little is used, amber in between, orange near the limit.
const colorFor = (used: number) => (used >= 75 ? '#f26b3a' : used >= 30 ? '#f5a524' : '#4fbf7f')

const countdown = (resetsAt: string | undefined, at: number) => {
  if (!resetsAt) {
    return ''
  }

  const minutes = Math.max(0, Math.round((Date.parse(resetsAt) - at) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`
}

const currentBranch = async ($: EngineInterface, cwd: string) => {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 5000 })

    return exitCode === 0 && stdout.trim() ? stdout.trim() : null
  } catch {
    return null
  }
}

// The worktree's folder name in a linked git worktree, else the current branch, else null.
const findPlace = async ($: EngineInterface): Promise<Place | null> => {
  const [root, repo] = await Promise.all([$.session.root(), $.session.repo()])

  if (!repo) {
    return null
  }

  if (root.replace(/\/+$/, '') === repo.root.replace(/\/+$/, '')) {
    const branch = await currentBranch($, root)

    return branch ? { kind: 'branch', name: branch } : null
  }

  const folder = root.split('/').filter(Boolean).pop()

  return folder ? { kind: 'worktree', name: folder } : null
}

// The session's subagents and teammates, active ones first; written only when the list changed.
const refreshAgents = async ($: EngineInterface) => {
  const list = await $.agent.list()
  const rows: AgentRow[] = list
    .map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status }))
    .sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)))
  const previous = await read($, agents)

  if (JSON.stringify(previous) !== JSON.stringify(rows)) {
    await update($, agents, () => rows)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, now, () => Date.now())
    const found = await findPlace($)
    await update($, place, () => found)
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage.context, usage.rateLimits))
    $.clock.every(60_000, () => update($, now, () => Date.now()))
    await refreshAgents($)
    $.clock.every(2_000, () => refreshAgents($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e.context, e.rateLimits))
    await update($, now, () => Date.now())
    const found = await findPlace($)
    await update($, place, () => found)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    const hasData = snap && (snap.context !== undefined || snap.fiveHour || snap.sevenDay)

    if (e.props.hasSurvey || !hasData) {
      return next(e)
    }

    const at = (await read($, now)) || Date.now()
    const where = await read($, place)
    const running = (await read($, agents)).filter(a => ACTIVE.has(a.status)).length
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui

    const specs: { name: string; used: number; suffix: string }[] = []

    if (snap.context !== undefined) {
      specs.push({ name: 'CTX', used: snap.context, suffix: '' })
    }

    if (snap.fiveHour) {
      specs.push({ name: '5H', used: snap.fiveHour.percentUsed, suffix: countdown(snap.fiveHour.resetsAt, at) })
    }

    if (snap.sevenDay) {
      specs.push({ name: '7D', used: snap.sevenDay.percentUsed, suffix: countdown(snap.sevenDay.resetsAt, at) })
    }

    // Drop the dot meters when the whole row with them would not fit on one line.
    const meterText = (s: (typeof specs)[number], dots: number) =>
      `${s.name} ${dots ? '●'.repeat(dots) + ' ' : ''}${Math.round(s.used)}%${s.suffix ? ` · ${s.suffix}` : ''}`
    const fullWidth =
      specs.reduce((sum, s) => sum + 2 + meterText(s, DOTS).length, 0) +
      (where ? 5 + where.name.length : 0) +
      (running ? 5 + String(running).length : 0)
    const dots = fullWidth <= e.props.bodyColumns ? DOTS : 0

    const meter = ({ name, used, suffix }: (typeof specs)[number]) => {
      const filled = Math.min(DOTS, Math.round((used / 100) * DOTS))
      const color = colorFor(used)

      return (
        <Text key={name} size="footnote">
          <Text color={LABEL} weight="semibold">{name} </Text>
          {dots ? <Text color={color}>{'●'.repeat(filled)}</Text> : null}
          {dots ? <Text color={FAINT}>{'·'.repeat(DOTS - filled)} </Text> : null}
          <Text color={color} weight="semibold" tabular>{Math.round(used)}%</Text>
          {suffix ? <Text color={LABEL} tabular> · {suffix}</Text> : null}
        </Text>
      )
    }

    const items = specs.map(meter)

    return (
      <Box flexDirection="row" flexWrap="nowrap" columnGap={2}>
        {running ? (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            {e.surface !== 'terminal' && 'Svg' in ui ? (
              <ui.Svg source={iconSource('agents')} alt="agents" width={12} height={12} />
            ) : null}
            <Button
              key="agents"
              plain
              label={`${running} running agent${running === 1 ? '' : 's'}`}
              onPress={() => void $.ui.open({ id: AGENTS_PANE, title: 'Agents' })}
            >
              <Text color="#a78bfa" weight="semibold" size="footnote" tabular>
                {e.surface === 'terminal' ? '◆ ' : ''}
                {running}
              </Text>
            </Button>
          </Box>
        ) : null}
        {items}
        {where ? (
          <Box marginLeft={1} flexDirection="row" alignItems="center" columnGap={1}>
            {e.surface !== 'terminal' && 'Svg' in ui ? (
              <ui.Svg source={iconSource(where.kind)} alt={where.kind} width={12} height={12} />
            ) : (
              <Text color={LABEL} size="footnote">{where.kind === 'branch' ? '⎇' : '▢'}</Text>
            )}
            <Text color={LABEL} size="footnote">{where.name}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const viewing = e.props.view.agentId

    return (
      <Box flexDirection="column" rowGap={1}>
        {viewing ? (
          <Button key="main" plain onPress={() => void $.ui.view({})}>
            <Text color={LABEL}>← Back to the main conversation</Text>
          </Button>
        ) : null}
        {list.length === 0 ? <Text color={LABEL}>No agents in this session yet.</Text> : null}
        {list.map(a => (
          <Button key={a.id} plain onPress={() => void $.ui.view({ agentId: a.id })}>
            <Text weight={a.id === viewing ? 'semibold' : 'regular'} dimColor={!ACTIVE.has(a.status)}>
              {a.description || a.type}
            </Text>
            <Text color={ACTIVE.has(a.status) ? '#a78bfa' : FAINT}> · {a.status}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
