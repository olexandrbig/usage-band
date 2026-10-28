export type Meter = { percentUsed: number; resetsAt?: string }
export type Snapshot = { context?: number; fiveHour?: Meter; sevenDay?: Meter }
export type Place = { kind: 'worktree' | 'branch'; name: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; now: number; place: Place | null }
  }
}
