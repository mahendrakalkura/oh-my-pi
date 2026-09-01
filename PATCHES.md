# Patches

Local patches carried on the `mahendra` branch against upstream `can1357/oh-my-pi`. The branch is published to the fork `git@github.com:mahendrakalkura/oh-my-pi.git` so both machines run the same series; upstream stays `origin`.

Commit hashes below are the ones current at base `18.1.2`. Every rebase onto `origin/main` rewrites them, so treat the subject line as the identifier and refresh the hashes when they drift.

## feat(editor): scope arrow-key recall to session then cwd

Commit `507d5c947d`.

Upstream lists every prompt ever submitted, from every project and every session, because `Editor.setHistoryStorage` loaded `HistoryStorage.getRecent(100)` with no filter. Recall now offers the prompts submitted in the active session, or the ones submitted in the current project when that session has none yet, which is the state of a fresh session. A brand-new session in a brand-new project starts with an empty list rather than falling back to the global one.

Changed:

- `packages/coding-agent/src/session/history-storage.ts`: added `getScoped(limit, cwd?)` plus the `#recentBySessionStmt` and `#recentByCwdStmt` prepared statements, both finalized in `#close()`. `getRecent` is untouched because the Ctrl+R search popup still uses it and stays global.
- `packages/tui/src/components/editor.ts`: the duck-typed `HistoryStorage` port now declares `getScoped` instead of `getRecent`, and `setHistoryStorage` calls `storage.getScoped(100, getProjectDir())`.
- `packages/coding-agent/src/modes/interactive-mode.ts`: `setSessionResolver` moved ahead of `setHistoryStorage`. The scoped load reads the resolver, so the old order made every session take the cwd branch.
- `packages/tui/test/editor.test.ts`: the fake storage implements `getScoped`.
- `packages/coding-agent/test/history-storage-scoped.test.ts`: new, five cases covering session precedence, the cwd fallback, the no-session fallback, the empty result when neither scope matches, and ordering plus limit.

No schema change. The `session_id` and `cwd` columns already existed and were already populated; only the read path is new. Because `prompt` is globally UNIQUE and the upsert overwrites provenance, a prompt reused in another project moves there and leaves the first project's recall.

Verified live: in `~/projects/nagi-reddy/mailcrux`, Up recalled that project's newest prompt while the globally newest row, `/copy` with cwd `/tmp`, stayed out of the list.

## feat(status-line): add an active profile segment

Commit `d1d9c5b8c7`.

Fourteen profiles live under `~/.omp/profiles` and nothing in the status bar said which one was active.

Changed:

- `packages/coding-agent/src/config/settings-schema.ts`: `profile` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `profileSegment` renders `getActiveProfile()` from `@oh-my-pi/pi-utils` and reports itself invisible when that returns `undefined`, which is what the default profile reports. Registered in `SEGMENTS` beside `hostname`.

The glyph is `theme.icon.package`, not `theme.icon.subscription`: the cost segment already renders the subscription glyph, and two identical glyphs in one bar read as a single segment.

Opt in per machine by listing `profile` in `statusLine.leftSegments`, which the dotfiles `config.yml` does.

## feat(slash-commands): copy the whole conversation on bare /copy

Commit `2cdcf0d281`.

Upstream opens the transcript picker on bare `/copy`, so copying everything took a selector round trip. It now copies `session.formatSessionAsText()` straight to the clipboard. Unlike `/dump` it writes no LLM-request JSON sidecar, so copying never leaves a file on disk.

Changed:

- `packages/coding-agent/src/slash-commands/builtin-collaboration.ts`: the bare branch copies the transcript, reports "No messages to copy yet." on an empty session, and the picker moves to `/copy pick`. `code` and `cmd` are unchanged; the usage string and description were updated.
- `packages/coding-agent/test/slash-commands/copy.test.ts`: the case asserting the picker on bare `/copy` was replaced by three cases covering the full copy, the empty session, and `/copy pick`.

## Configuration, not patches

These behaviors were requested alongside the patches and turned out to need no code. They live in `.agents/omp/config.yml` in the dotfiles.

`startup.quiet: true` removes the welcome panel, the logo, the Tips column, the LSP list, the recent-sessions column, the "Tip:" line under the box and the "Connected to MCP servers" notice, including the mid-session reprint from the `/mcp` dashboard. One key covers all of it; there is no finer granularity, and it also silences LSP startup notices, the model-scope banner and xdev mount notices. The panel can still flash once per directory because `cli.ts` prepaints from a per-cwd cache of the previous run's preferences before settings load.

`statusLine.leftSegments` lists `profile` to enable the segment above.

## Working on this branch

Iterate without compiling: `bun dev -- --version`, `bun dev -- --help`, and so on run the CLI from source. Rust changes need `bun run build:native` first.

Check before committing: `bun run check:ts`, plus `bun test` in the package touched.

`omp-sync` pulls the fork and rebuilds the installed binary. `omp-sync --rebase` replays this series onto the latest `origin/main` first, with rerere replaying recorded conflict resolutions. `omp-sync --publish` overwrites the fork with the local series after an amend or a local rebase.

Keep one commit per concern so a conflict stays confined to the commit that collided. Upstreaming a patch means branching off `origin/main`, cherry-picking the single commit, pushing that branch to the fork, and opening the PR against `can1357/oh-my-pi`; the `mahendra` branch itself is never the PR head.
