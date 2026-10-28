export type Meter = { percentUsed: number; resetsAt?: string }
export type Snapshot = { context?: number; fiveHour?: Meter; sevenDay?: Meter }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; now: number }
  }
}
