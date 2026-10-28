# usage-band

A Claude Code mod that shows a one-line usage band above the prompt:

```
USAGE   CTX ●······· 12%   5H ●●······ 25% · 2h 10m   7D ●●●····· 32% · 3d 4h   my-worktree
```

- **CTX** - how full the context window is
- **5H** - the 5-hour rate limit used, and when it resets
- **7D** - the weekly rate limit used, and when it resets
- **worktree or branch** - the git worktree name, or the current branch outside a worktree

Meters turn green, amber (30%+) and orange (75%+) as they fill. The 5H and 7D meters appear only on a Claude subscription. The band reads these figures from Claude Code itself and sends nothing anywhere.

Works in the terminal and in the Claude desktop app's Code tab.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install usage-band --marketplace olexandrbig/usage-band
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install usage-band --marketplace olexandrbig/usage-band
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `olexandrbig/usage-band`, then Add plugin.

## License

MIT
