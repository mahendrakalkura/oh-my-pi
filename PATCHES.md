# Patches

Local patches carried on the `mahendra` branch against upstream `can1357/oh-my-pi`. The branch is published to the fork `git@github.com:mahendrakalkura/oh-my-pi.git` so both machines run the same series; upstream stays `origin`.

Commit hashes below are the ones current at base `18.1.10`. Every rebase onto `origin/main` rewrites them, so treat the subject line as the identifier and refresh the hashes when they drift.

## feat(editor): scope arrow-key recall to session then cwd

Commit `b94af864f3`.

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

Commit `a4e79d0aa6`.

Fourteen profiles live under `~/.omp/profiles` and nothing in the status bar said which one was active.

Changed:

- `packages/coding-agent/src/config/settings-schema.ts`: `profile` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `profileSegment` renders `getActiveProfile()` from `@oh-my-pi/pi-utils` and reports itself invisible when that returns `undefined`, which is what the default profile reports. Registered in `SEGMENTS` beside `hostname`.

The glyph is `theme.icon.package`, not `theme.icon.subscription`: the cost segment already renders the subscription glyph, and two identical glyphs in one bar read as a single segment.

Opt in per machine by listing `profile` in `statusLine.leftSegments`, which the dotfiles `config.yml` does.

## feat(slash-commands): copy the last answer on bare /copy

Commits `521c618727`, `f4fcdfc54c` and `e1bdf80413`.

Upstream opens the transcript picker on bare `/copy`, so taking an answer whole meant descending through a selector. Bare `/copy` now puts the entire last assistant message on the clipboard, with no picker and no block selection. `/copy all` takes the whole conversation, `/copy pick` still opens the picker, and `code` and `cmd` are unchanged. Unlike `/dump` none of these writes an LLM-request JSON sidecar, so copying never leaves a file on disk.

Two wrong readings preceded the current one, both recorded because the mistake is easy to repeat: the first commit reused `session.formatSessionAsText()`, which is `/dump`'s payload and leads with the system prompt and tool inventory; the second dropped that header but still copied the entire transcript. "Copy all" meant the whole of the last answer, not the whole session.

Changed:

- `packages/coding-agent/src/modes/utils/copy-targets.ts`: `extractLastAssistantText(messages)` walks the transcript backwards for the newest assistant message's text, beside the existing code-block and command extractors.
- `packages/coding-agent/src/session/session-dump-format.ts`: `formatTranscriptText(messages)` exports the transcript half of the dump renderer with no header; `/copy all` uses it.
- `packages/coding-agent/src/slash-commands/builtin-collaboration.ts`: the bare branch copies the last answer and reports "No answer to copy yet." when none exists; `all`, `pick`, `code` and `cmd` follow. The usage string and description were updated.
- `packages/coding-agent/test/slash-commands/copy.test.ts`: seven cases, including that bare `/copy` takes the last message entire and leaves earlier turns out, that `/copy all` carries the transcript without the dump header, and that a user-only session copies nothing.

Verified live: after an answer of `alpha-beta-gamma` the clipboard held exactly that, 17 bytes, and `/copy all` then held the 79-byte `## User` and `## Assistant` transcript.

## feat(status-line): add a turn stopwatch segment

Commit `3a7f2cb5c6`.

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

Commit `4125f85b82`.

The `pi` brand segment printed a whole-unit turn timer beside its spinner, so with `turn` configured the running turn appeared twice, once as `1m` and once as `1m30s`. The brand keeps the spinner as the activity signal and `turn` owns the clock. `brandTimer` went with it, as nothing else called it.

## feat(status-line): let the time segment show the date

Commit `3f29b40885`.

The `time` segment printed a bare clock. `segmentOptions.time.showDate` turns it into a `yyyy-mm-dd hh:mm:ss` log stamp. In that mode the 24h hour is zero-padded, since an unpadded hour changes the field's width every morning and shifts the whole bar.

Changed: `StatusLineSegmentOptions.time` in `status-line/types.ts` and `timeSegment` in `status-line/segments.ts`.

## feat(status-line): read both duration segments as a clock

Commit `7be154327f`.

`turn` and `time_spent` printed compound durations, `12s` then `1m30s` then `1h5m`. Both now render zero-padded `hh:mm` and never seconds. Two things drove it: the seconds field repainted the segment on every spinner tick, and the format's width changed as a turn crossed each unit boundary, shifting every segment beside it. A turn under a minute reads `00:00`, which is the cost of a fixed-width field.

Changed:

- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `formatTurnDuration` replaced by `formatClock`, used by both `turnSegment` and `timeSpentSegment`. The `formatDuration` import from `@oh-my-pi/pi-utils` went with it, since `time_spent` was its only caller here.
- `packages/coding-agent/test/status-line-turn.test.ts`: the four format cases now assert `00:00`, `00:01` and `01:05`, plus a case asserting no `s` appears in either face.
- `packages/coding-agent/test/status-line-time-spent.test.ts`: the same, asserting `00:05` and `02:00`.

The hour field grows past `99` rather than wrapping, and `time_spent` still hides below one second of activity so the bar does not carry a clock before any work has happened.

## feat(status-line): stamp the moment the last turn ended

Commit `d37f3ba15b`.

The `time` segment reads the clock on every render, and nothing drives a wall-clock repaint: repaints come from the working loader, the brand fade, the compaction blink, async git/PR/usage resolves and keystrokes. So `time` neither ticked while idle nor recorded anything - it froze wherever the last repaint happened to land, and any later keystroke overwrote that value with the current time. Recording when the agent last yielded needs the instant captured at turn close, not sampled at paint time.

Changed:

- `packages/coding-agent/src/modes/components/status-line/component.ts`: `ActiveMeter.lastTurnEndedAt` holds the wall-clock ms of the last closed window. `markActivityEnd` stamps it from the same `Date.now()` reading it uses for the duration, `resetActiveTime` clears it, and `getLastTurnEndedAt()` joins the sibling accessors feeding the segment context.
- `packages/coding-agent/src/modes/components/status-line/types.ts`: `SegmentContext.lastTurnEndedAt`, optional like `lastTurnMs`.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `turnEndedSegment` renders `yyyy-mm-dd hh:mm:ss` and hides itself before the first turn closes. The stamp is fixed rather than configurable: `segmentOptions.time` exists for a live clock, and this segment is a record of a past instant.
- `packages/coding-agent/src/config/settings-schema.ts`: `turn_ended` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`: gallery variants for a recorded end and for the pre-first-turn state.
- `packages/coding-agent/test/status-line-turn.test.ts`: a `turn_ended` block covering the stamp, the hold across a running turn, the hidden state before the first turn, and the meter's stamp-and-reset behavior including an unmatched `markActivityEnd`.

The segment keeps the previous end visible while the next turn runs, since the bar already signals a running turn through the brand spinner and the `turn` clock. The dotfiles `config.yml` swaps `time` for `turn_ended` and drops the now-unused `segmentOptions.time`.

## feat(shutdown): drop the exit chatter

Commit `daeb4070e4`.

Every exit printed two lines nobody reads. `#teardown` set a `Closing session…` status that flashes for the few milliseconds `session.dispose()` actually takes, and `shutdown` wrote a dim `Resume this session with omp --resume <id>` hint that repeats what `/resume` and the recent-sessions list already offer.

Changed:

- `packages/coding-agent/src/modes/interactive-mode.ts`: the `showStatus("Closing session…")` call and the `resumeCommand` stderr write are gone, along with the now-unused `resumeCommand` import. `#resumableSessionId()` stays because `restart()` still needs it to rebuild the relaunch argv.
- `packages/coding-agent/test/interactive-mode-still-closing.test.ts`: the case now asserts no status before the 3s threshold and only `Still closing… (flushing memory backend / network)` after it.

The `Still closing…` status stays. It fires only after `STILL_CLOSING_DELAY_MS`, so it never appears on a normal quit and is the only signal that a stalled memory flush is the reason the terminal has not come back.

## fix(transcript): drop the shutdown flush trailing blank

Commit `14b1c77b7a`.

Quitting shifted the final frame down one row: the transcript, the composer gap, then a second empty row above the status box that the terminal keeps in scrollback after exit. `TranscriptContainer.#renderRange` appends a blank separator to every history batch, and `TUI.stop()` retires the remaining transcript through `peekFlushBatch` with that blank attached. Under pressure the blank is correct, since more live transcript follows it and renders with no leading gap. A shutdown flush has no successor and the chrome below supplies its own gap.

Changed:

- `packages/coding-agent/src/modes/components/transcript-container.ts`: `#peekBatch` passes `trailingBlank = policy !== "flush"` into `#renderRange`, and the `commit` variant of `Offered` carries the flag so `rerenderOfferedBatch` reproduces the same rows when a frame is discarded. The pressure path is unchanged.
- `packages/coding-agent/test/modes/components/transcript-container.test.ts`: the two flush cases now expect `["fits"]` and `["tail"]` instead of a trailing `""`.

Verified with a throwaway `VirtualTerminal` end-to-end harness, since the row shift is only observable in the terminal buffer: before the fix the scroll buffer moved the status box from rows 6-7 to rows 7-8 across `mode.stop()`, and after it the before and after buffers are identical. The composer and end-to-end suites fail the same eight pre-existing cases with and without the change.

## test(settings): keep the ambient config overlay out of tests

Commit `55e4d4d273`.

A session launched by `omp` exports `PI_CONFIG_FILES` pointing at the dotfiles overlay, and the `Settings` constructor reads that variable at `packages/coding-agent/src/config/settings.ts:541`, before any `inMemory` or `readOnly` branch. Every test that initializes settings therefore inherited the developer's own preferences. The overlay's `startup.quiet: true` suppresses the welcome panel, and the panel's border title is where the version string lives, so each test that counts welcome rows read zero: eight failures across `test/startup-composer.test.ts`, `test/issue-9597-cold-launch-double-clear.test.ts` and `test/interactive-terminal-e2e.test.ts`. The failure imitates upstream breakage, because an `origin/main` worktree inherits the same exported environment and fails identically.

Changed:

- `scripts/test-preload.ts`: new, deletes `process.env.PI_CONFIG_FILES`.
- `bunfig.toml`: `[test] preload` runs it.
- `packages/coding-agent/bunfig.toml`: new, restates the same `preload`. Bun reads `bunfig.toml` from the current directory only and never from a parent, so `bun test` run inside the package would otherwise miss the root setting.

`inMemory` is the wrong gate for this: it only nulls `#configPath` and clears `#persist`, the env layer is read regardless, and `Settings.isolated()` passes `inMemory: true` on a production path. Gating on `isBunTestRuntime()` is wrong too, because `scripts/ci-test-ts.ts` sets `PI_TEST_RUNTIME=1` and child processes inherit it, which would make the spawned CLI in `test/config-cli.test.ts:200` ignore the `PI_CONFIG_FILES` that case passes on purpose.

Verified: the three affected files plus `test/config-cli.test.ts` and `test/modes/components/transcript-container.test.ts` give 59 pass, 0 fail from inside the package with the profile environment present. Before the preload the same set failed eight cases.

## Configuration, not patches

These behaviors were requested alongside the patches and turned out to need no code. They live in `.agents/omp/config.yml` in the dotfiles.

`startup.quiet: true` removes the welcome panel, the logo, the Tips column, the LSP list, the recent-sessions column, the "Tip:" line under the box and the "Connected to MCP servers" notice, including the mid-session reprint from the `/mcp` dashboard. One key covers all of it; there is no finer granularity, and it also silences LSP startup notices, the model-scope banner and xdev mount notices. The panel can still flash once per directory because `cli.ts` prepaints from a per-cwd cache of the previous run's preferences before settings load.

`statusLine.leftSegments` reads `pi, profile, model, path, turn, time_spent, context_pct, turn_ended, cost, usage`, which enables the segments added above and places the profile ahead of the model. The live-clock `time` segment is not listed, so `segmentOptions.time` carries no keys.

`display.showTokenUsage: false` hides the per-turn usage row under each answer. Every profile's own config turns it on; the shared overlay outranks them, so one key switches it off everywhere.

## Working on this branch

Iterate without compiling: `bun dev -- --version`, `bun dev -- --help`, and so on run the CLI from source. Rust changes need `bun run build:native` first.

Check before committing: `bun run check:ts`, plus `bun test` in the package touched.

`omp-sync` pulls the fork and rebuilds the installed binary. `omp-sync --rebase` replays this series onto the latest `origin/main` first, with rerere replaying recorded conflict resolutions. `omp-sync --publish` overwrites the fork with the local series after an amend or a local rebase.

Keep one commit per concern so a conflict stays confined to the commit that collided. Upstreaming a patch means branching off `origin/main`, cherry-picking the single commit, pushing that branch to the fork, and opening the PR against `can1357/oh-my-pi`; the `mahendra` branch itself is never the PR head.
