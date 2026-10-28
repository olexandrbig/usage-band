export type Meter = { percentUsed: number; resetsAt?: string }
export type Snapshot = { context?: number; fiveHour?: Meter; sevenDay?: Meter }
export type Place = { kind: 'worktree' | 'branch'; name: string }
export type AgentRow = { id: string; description: string; type: string; status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed' }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; now: number; place: Place | null; agents: AgentRow[] }
  }
}
