import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter, Place, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const place = atom({ plugin: 'usage-band', key: 'place' } as const, null)

const DOTS = 8
const LABEL = '#8a8a8a'
const FAINT = '#5a5a5a'

const ICON_PATHS = {
  branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  worktree: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
}

const iconSource = (kind: Place['kind']) =>
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, now, () => Date.now())
    const found = await findPlace($)
    await update($, place, () => found)
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage.context, usage.rateLimits))
    $.clock.every(60_000, () => update($, now, () => Date.now()))

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
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    const meter = (name: string, used: number, suffix: string) => {
      const filled = Math.min(DOTS, Math.round((used / 100) * DOTS))
      const color = colorFor(used)

      return (
        <Text key={name} size="footnote">
          <Text color={LABEL} weight="semibold">{name} </Text>
          <Text color={color}>{'●'.repeat(filled)}</Text>
          <Text color={FAINT}>{'·'.repeat(DOTS - filled)}</Text>
          <Text color={color} weight="semibold" tabular> {Math.round(used)}%</Text>
          {suffix ? <Text color={LABEL} tabular> · {suffix}</Text> : null}
        </Text>
      )
    }

    const items = []

    if (snap.context !== undefined) {
      items.push(meter('CTX', snap.context, ''))
    }

    if (snap.fiveHour) {
      items.push(meter('5H', snap.fiveHour.percentUsed, countdown(snap.fiveHour.resetsAt, at)))
    }

    if (snap.sevenDay) {
      items.push(meter('7D', snap.sevenDay.percentUsed, countdown(snap.sevenDay.resetsAt, at)))
    }

    return (
      <Box flexDirection="row" flexWrap="nowrap" columnGap={2}>
        <Text weight="bold" size="footnote">USAGE</Text>
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
}
