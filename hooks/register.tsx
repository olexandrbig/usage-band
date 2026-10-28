import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const worktree = atom({ plugin: 'usage-band', key: 'worktree' } as const, null)

const DOTS = 8
const LABEL = '#8a8a8a'
const FAINT = '#5a5a5a'

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

// The worktree's folder name when the session runs in a linked git worktree, else null.
const worktreeName = async ($: EngineInterface) => {
  const [root, repo] = await Promise.all([$.session.root(), $.session.repo()])

  if (!repo || root.replace(/\/+$/, '') === repo.root.replace(/\/+$/, '')) {
    return null
  }

  return root.split('/').filter(Boolean).pop() ?? null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, now, () => Date.now())
    const name = await worktreeName($)
    await update($, worktree, () => name)
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage.context, usage.rateLimits))
    $.clock.every(60_000, () => update($, now, () => Date.now()))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e.context, e.rateLimits))
    await update($, now, () => Date.now())
    const name = await worktreeName($)
    await update($, worktree, () => name)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    const hasData = snap && (snap.context !== undefined || snap.fiveHour || snap.sevenDay)

    if (e.props.hasSurvey || !hasData) {
      return next(e)
    }

    const at = (await read($, now)) || Date.now()
    const tree = await read($, worktree)
    const { Box, Text } = $.ui.resolve(e)

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
        {tree ? (
          <Box marginLeft={1}>
            <Text color={LABEL} size="footnote">{tree}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
