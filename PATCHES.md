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

Commits `2cdcf0d281` and `275d0062c1`.

Upstream opens the transcript picker on bare `/copy`, so copying everything took a selector round trip. It now copies the conversation straight to the clipboard. Unlike `/dump` it writes no LLM-request JSON sidecar, so copying never leaves a file on disk.

The first attempt reused `session.formatSessionAsText()`, which is `/dump`'s payload: it leads with the system prompt, the model line and the tool inventory, so a paste showed the prompt rather than the exchange. The follow-up commit renders the transcript alone.

Changed:

- `packages/coding-agent/src/session/session-dump-format.ts`: `formatTranscriptText(messages)` exports the transcript half of the dump renderer with no header.
- `packages/coding-agent/src/slash-commands/builtin-collaboration.ts`: the bare branch copies that transcript, reports "No messages to copy yet." on an empty session, and the picker moves to `/copy pick`. `code` and `cmd` are unchanged; the usage string and description were updated.
- `packages/coding-agent/test/slash-commands/copy.test.ts`: the case asserting the picker on bare `/copy` was replaced by cases covering the transcript copy, the absence of the dump header, the empty session, and `/copy pick`.

Verified live: after a bash-only turn the clipboard held `## Bash Execution` and its output, with no `## System Prompt`, `## Configuration` or `## Available Tools`.

## feat(status-line): add a turn stopwatch segment

Commit `f24352490f`.

Nothing reported how long the last turn took. `turnElapsedMs` goes null the moment the agent yields, and the `pi` brand timer is whole-unit only, so it reads `1m` for anything between one and two minutes. The `turn` segment renders the running turn live while the agent works, then that turn's duration once it settles.

Changed:

- `packages/coding-agent/src/modes/components/status-line/component.ts`: `ActiveMeter` gains `lastTurnMs`, `markActivityEnd` records each closed window, `resetActiveTime` drops it, and `getLastTurnMs()` joins the sibling accessors feeding the segment context.
- `packages/coding-agent/src/modes/components/status-line/types.ts`: `SegmentContext.lastTurnMs`, optional in the manner of `brandFgAnsi` so the five hand-built preview and test fixtures need no edit.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `turnSegment` plus `formatTurnDuration`, which renders whole seconds instead of `formatDuration`'s tenths so the value does not churn on every 80ms spinner repaint. The settled value carries `theme.icon.rewind` rather than `theme.icon.time`, since the number alone cannot say whether it is still counting.
- `packages/coding-agent/src/config/settings-schema.ts`: `turn` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`: gallery variants for running, settled, and pre-first-turn.
- `packages/coding-agent/test/status-line-turn.test.ts`: new, six cases covering both faces, the running-over-settled precedence, hour compression, the hidden state before the first turn, and the meter's record-and-reset behavior including an unmatched `markActivityEnd`.

Verified live: the bar ticked `0s`, `1s`, `2s` during a turn, then showed the rewind icon with `2s` once it finished.

## feat(status-line): drop the duplicate brand turn timer

Commit `27ba74dd4f`.

The `pi` brand segment printed a whole-unit turn timer beside its spinner, so with `turn` configured the running turn appeared twice, once as `1m` and once as `1m30s`. The brand keeps the spinner as the activity signal and `turn` owns the clock. `brandTimer` went with it, as nothing else called it.

## feat(status-line): let the time segment show the date

Commit `26bdb49f3a`.

The `time` segment printed a bare clock. `segmentOptions.time.showDate` turns it into a `yyyy-mm-dd hh:mm:ss` log stamp. In that mode the 24h hour is zero-padded, since an unpadded hour changes the field's width every morning and shifts the whole bar.

Changed: `StatusLineSegmentOptions.time` in `status-line/types.ts` and `timeSegment` in `status-line/segments.ts`.

## Configuration, not patches

These behaviors were requested alongside the patches and turned out to need no code. They live in `.agents/omp/config.yml` in the dotfiles.

`startup.quiet: true` removes the welcome panel, the logo, the Tips column, the LSP list, the recent-sessions column, the "Tip:" line under the box and the "Connected to MCP servers" notice, including the mid-session reprint from the `/mcp` dashboard. One key covers all of it; there is no finer granularity, and it also silences LSP startup notices, the model-scope banner and xdev mount notices. The panel can still flash once per directory because `cli.ts` prepaints from a per-cwd cache of the previous run's preferences before settings load.

`statusLine.leftSegments` reads `pi, profile, model, path, turn, time_spent, context_pct, time, cost, usage`, which enables the segments added above and places the profile ahead of the model. `segmentOptions.time` sets `format: 24h`, `showDate: true` and `showSeconds: true`.

`display.showTokenUsage: false` hides the per-turn usage row under each answer. Every profile's own config turns it on; the shared overlay outranks them, so one key switches it off everywhere.

## Working on this branch

Iterate without compiling: `bun dev -- --version`, `bun dev -- --help`, and so on run the CLI from source. Rust changes need `bun run build:native` first.

Check before committing: `bun run check:ts`, plus `bun test` in the package touched.

`omp-sync` pulls the fork and rebuilds the installed binary. `omp-sync --rebase` replays this series onto the latest `origin/main` first, with rerere replaying recorded conflict resolutions. `omp-sync --publish` overwrites the fork with the local series after an amend or a local rebase.

Keep one commit per concern so a conflict stays confined to the commit that collided. Upstreaming a patch means branching off `origin/main`, cherry-picking the single commit, pushing that branch to the fork, and opening the PR against `can1357/oh-my-pi`; the `mahendra` branch itself is never the PR head.
