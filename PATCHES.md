# Patches

Local patches carried on the `mahendra` branch against upstream `can1357/oh-my-pi`. The branch is published to the fork `git@github.com:mahendrakalkura/oh-my-pi.git` so both machines run the same series; upstream stays `origin`.

Commit hashes below are the ones current at base `18.1.11`. Every rebase onto `origin/main` rewrites them, so treat the subject line as the identifier and refresh the hashes when they drift.

## feat(editor): scope arrow-key recall to session and cwd

Commits `a061e9fe5a`, `a2d888e072` and the union fix below.

Upstream lists every prompt ever submitted, from every project and every session, because `Editor.setHistoryStorage` loaded `HistoryStorage.getRecent(100)` with no filter. Recall now offers the prompts submitted in the active session first, then the rest of the ones submitted in the current project. The editor reloads this scope after every interactive session transition and after the first prompt persists, so a new session cannot retain the previous session's in-memory recall list.

The first version made the session scope exclusive: any session row at all suppressed the cwd rows. That treats one database read as complete, which it is not. With a corrupt `history_fts` index every INSERT aborted in the `history_ai` trigger while the `ON CONFLICT DO UPDATE` path kept working, so a long session persisted exactly one prompt - a resubmitted `/copy` - and recall collapsed to that single entry. The scopes are unioned now, and no read can shrink recall below the project's history.

Changed:

- `packages/coding-agent/src/session/history-storage.ts`: added `getScoped(limit, cwd?)` plus the `#recentBySessionStmt` and `#recentByCwdStmt` prepared statements, both finalized in `#close()`. It concatenates session rows ahead of cwd rows and de-duplicates by row id, which identifies the prompt because `prompt` is UNIQUE. `getRecent` is untouched because the Ctrl+R search popup still uses it and stays global.
- `packages/tui/src/components/editor.ts`: the duck-typed `HistoryStorage` port now declares `getScoped` instead of `getRecent`; `setHistoryStorage` and the public `reloadHistory()` load the active scope, and a completed `add()` reloads it.
- `packages/coding-agent/src/modes/interactive-mode.ts`: `setSessionResolver` moved ahead of `setHistoryStorage`. The scoped load reads the resolver, so the old order made every session read the cwd scope alone.
- `packages/coding-agent/src/modes/controllers/{command-controller,extension-ui-controller,selector-controller}.ts`: successful interactive new-session, resume, branch, and active-session deletion transitions reload editor history.
- `packages/tui/test/editor.test.ts`: storage fakes use `getScoped`, with regressions for changing scopes and for the reload after the first session prompt persists.
- `packages/coding-agent/test/command-controller-new-session.test.ts` and `packages/coding-agent/test/modes/controllers/resume-preflight.test.ts`: new-session recall and resume-boundary reload regressions.
- `packages/coding-agent/test/history-storage-scoped.test.ts`: six cases cover session-first ordering, the single-persisted-row case that the exclusive rule broke, the fresh-session and no-session cwd scopes, the empty result when neither scope matches, and ordering plus limit.

No schema change. The `session_id` and `cwd` columns already existed and were already populated; only the read path is new. Because `prompt` is globally UNIQUE and the upsert overwrites provenance, a prompt reused in another project moves there; the cwd half of the union is what keeps that from emptying a session's recall.

Verified against a copy of the damaged database: the exclusive query returned nothing for the affected session while the union returned the project's eight prompts.

## feat(status-line): add an active profile segment

Commit `7871318dd6`.

Fourteen profiles live under `~/.omp/profiles` and nothing in the status bar said which one was active.

Changed:

- `packages/coding-agent/src/config/settings-schema.ts`: `profile` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `profileSegment` renders `getActiveProfile()` from `@oh-my-pi/pi-utils` and reports itself invisible when that returns `undefined`, which is what the default profile reports. Registered in `SEGMENTS` beside `hostname`.

The glyph is `theme.icon.package`, not `theme.icon.subscription`: the cost segment already renders the subscription glyph, and two identical glyphs in one bar read as a single segment.

Opt in per machine by listing `profile` in `statusLine.leftSegments`, which the dotfiles `config.yml` does.

## feat(status-line): name the client and the endpoint in one cell

Commits `2aede07f62`, `8e9a3c1780`, `0ab93f0f69` and `681d24244c`.

Two facts were invisible in the bar: which client pays for the turn and which endpoint serves it. They are carried differently. `anthropic` holds three OAuth logins and `openai-codex` holds two, chosen per session by usage ranking, pinnable, and free to rotate mid-session. The other eight providers are person-suffixed API-key clones with no credential row at all, so `nr-alibaba` fuses both facts into its provider id.

Both render in the `client` cell as `mk · anthropic`. They started as two segments so either could be dropped independently; that cost a section separator and its padding, 3 columns, to divide two values that are always read together and are 2 and 9 columns wide. The separate `provider` segment is gone.

Changed:

- `packages/coding-agent/src/config/settings-schema.ts`: `client` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/modes/components/status-line/types.ts`: `StatusLineSegmentOptions.account.tags` names the client, keyed by credential email, account id, or provider id.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `sessionClient` reads `session.modelRegistry.authStorage.getOAuthAccountIdentity(provider, session.sessionId)` - the session-sticky credential, not the first stored one - and resolves the tag, else the email, account id, org name, or project id. `clientSegment` renders `<client> · <endpoint>`, strips the client prefix a clone id repeats so `nr-alibaba` reads `nr · alibaba`, falls back to the endpoint alone when nothing identifies a client, and hides only before a model resolves. Registered in `SEGMENTS` beside `profile`.
- `packages/coding-agent/src/modes/theme/symbols.ts`, `packages/coding-agent/src/modes/theme/theme-class.ts`: new `icon.account` glyph in all three symbol presets.
- `packages/coding-agent/src/cli/gallery-fixtures/preview-session.ts`, `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`: `GallerySessionOptions.oauthEmail` and `provider` stub the lookup, and the gallery renders four client samples.
- `packages/coding-agent/test/status-line-client-provider.test.ts`: covers the OAuth login, the clone lookup with its prefix strip, case-insensitive keys, the email and account-id fallbacks, the endpoint-alone path, the hidden pre-model path, and the startup placeholder.

Both parts are configuration rather than derivation. The three anthropic emails differ only in their domain, so automatic shortening yields three labels that read alike, and a provider id prefix is only a client when the tag map says so.

Opt in per machine by listing `client` in `statusLine.leftSegments` and mapping `statusLine.segmentOptions.account.tags`, which the dotfiles `config.yml` does for all five logins and all eight clones.

## feat(slash-commands): copy the last answer on bare /copy

Commits `5f8844ce8f`, `cfd3b3c654` and `0c405839f8`.

Upstream opens the transcript picker on bare `/copy`, so taking an answer whole meant descending through a selector. Bare `/copy` now puts the entire last assistant message on the clipboard, with no picker and no block selection. `/copy all` takes the whole conversation, `/copy pick` still opens the picker, and `code` and `cmd` are unchanged. Unlike `/dump` none of these writes an LLM-request JSON sidecar, so copying never leaves a file on disk.

Two wrong readings preceded the current one, both recorded because the mistake is easy to repeat: the first commit reused `session.formatSessionAsText()`, which is `/dump`'s payload and leads with the system prompt and tool inventory; the second dropped that header but still copied the entire transcript. "Copy all" meant the whole of the last answer, not the whole session.

Changed:

- `packages/coding-agent/src/modes/utils/copy-targets.ts`: `extractLastAssistantText(messages)` walks the transcript backwards for the newest assistant message's text, beside the existing code-block and command extractors.
- `packages/coding-agent/src/session/session-dump-format.ts`: `formatTranscriptText(messages)` exports the transcript half of the dump renderer with no header; `/copy all` uses it.
- `packages/coding-agent/src/slash-commands/builtin-collaboration.ts`: the bare branch copies the last answer and reports "No answer to copy yet." when none exists; `all`, `pick`, `code` and `cmd` follow. The usage string and description were updated.
- `packages/coding-agent/test/slash-commands/copy.test.ts`: seven cases, including that bare `/copy` takes the last message entire and leaves earlier turns out, that `/copy all` carries the transcript without the dump header, and that a user-only session copies nothing.

Verified live: after an answer of `alpha-beta-gamma` the clipboard held exactly that, 17 bytes, and `/copy all` then held the 79-byte `## User` and `## Assistant` transcript.

## feat(status-line): add a turn stopwatch segment

Commit `5b7890aa36`.

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

Commit `3a0bcb070a`.

The `pi` brand segment printed a whole-unit turn timer beside its spinner, so with `turn` configured the running turn appeared twice, once as `1m` and once as `1m30s`. The brand keeps the spinner as the activity signal and `turn` owns the clock. `brandTimer` went with it, as nothing else called it.

## feat(status-line): let the time segment show the date

Commit `709974f5d3`.

The `time` segment printed a bare clock. `segmentOptions.time.showDate` turns it into a `yyyy-mm-dd hh:mm:ss` log stamp. In that mode the 24h hour is zero-padded, since an unpadded hour changes the field's width every morning and shifts the whole bar.

Changed: `StatusLineSegmentOptions.time` in `status-line/types.ts` and `timeSegment` in `status-line/segments.ts`.

## feat(status-line): read both duration segments as a clock

Commit `defb438d57`.

`turn` and `time_spent` printed compound durations, `12s` then `1m30s` then `1h5m`. Both now render zero-padded `hh:mm` and never seconds. Two things drove it: the seconds field repainted the segment on every spinner tick, and the format's width changed as a turn crossed each unit boundary, shifting every segment beside it. A turn under a minute reads `00:00`, which is the cost of a fixed-width field.

Changed:

- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `formatTurnDuration` replaced by `formatClock`, used by both `turnSegment` and `timeSpentSegment`. The `formatDuration` import from `@oh-my-pi/pi-utils` went with it, since `time_spent` was its only caller here.
- `packages/coding-agent/test/status-line-turn.test.ts`: the four format cases now assert `00:00`, `00:01` and `01:05`, plus a case asserting no `s` appears in either face.
- `packages/coding-agent/test/status-line-time-spent.test.ts`: the same, asserting `00:05` and `02:00`.

The hour field grows past `99` rather than wrapping, and `time_spent` still hides below one second of activity so the bar does not carry a clock before any work has happened. `turn` no longer uses this format: the merged time cell below reads `XmYYs`, and `formatClock` now serves `time_spent` alone.

## feat(status-line): stamp the moment the last turn ended

Commit `43b80d5fbe`.

The `time` segment reads the clock on every render, and nothing drives a wall-clock repaint: repaints come from the working loader, the brand fade, the compaction blink, async git/PR/usage resolves and keystrokes. So `time` neither ticked while idle nor recorded anything - it froze wherever the last repaint happened to land, and any later keystroke overwrote that value with the current time. Recording when the agent last yielded needs the instant captured at turn close, not sampled at paint time.

Changed:

- `packages/coding-agent/src/modes/components/status-line/component.ts`: `ActiveMeter.lastTurnEndedAt` holds the wall-clock ms of the last closed window. `markActivityEnd` stamps it from the same `Date.now()` reading it uses for the duration, `resetActiveTime` clears it, and `getLastTurnEndedAt()` joins the sibling accessors feeding the segment context.
- `packages/coding-agent/src/modes/components/status-line/types.ts`: `SegmentContext.lastTurnEndedAt`, optional like `lastTurnMs`.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `turnEndedSegment` renders `yyyy-mm-dd hh:mm:ss` and hides itself before the first turn closes. The stamp is fixed rather than configurable: `segmentOptions.time` exists for a live clock, and this segment is a record of a past instant.
- `packages/coding-agent/src/config/settings-schema.ts`: `turn_ended` added to the `StatusLineSegmentId` union.
- `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`: gallery variants for a recorded end and for the pre-first-turn state.
- `packages/coding-agent/test/status-line-turn.test.ts`: a `turn_ended` block covering the stamp, the hold across a running turn, the hidden state before the first turn, and the meter's stamp-and-reset behavior including an unmatched `markActivityEnd`.

The stamp survives as the third field of the merged time cell below; `turnEndedSegment` and the `turn_ended` id are gone, while `ActiveMeter.lastTurnEndedAt` and `getLastTurnEndedAt()` still feed it. The dotfiles `config.yml` drops `time` and the now-unused `segmentOptions.time`.

## feat(status-line): fold the three time fields into one cell

Commit `681d24244c`.

The bar carried `turn`, `time_spent` and `turn_ended` as three segments: `0m05s`, `0m11s` and `2026-09-07 17:23:47`, 35 columns of value separated by 6 columns of section separator and padding. They are one thought - this turn, all turns, when the last one ended - so they are now one cell, `0m05s · 0m11s · 17:23:47`, 26 columns including its icon.

Changed:

- `packages/coding-agent/src/modes/components/status-line/segments.ts`: `turnSegment` renders all three fields, joined by ` · `. Field one is `turnElapsedMs` while a turn runs and `lastTurnMs` once it settles, field two is `activeMs` (omitted below one second), field three is `lastTurnEndedAt` as `hh:mm:ss` with the date dropped. Missing fields are left out rather than zero-filled, and the cell hides only when no field exists. `formatShortDuration` renders `XmYYs` with unpadded minutes that grow past 60 and zero-padded seconds; `formatWallClock` renders the stamp. The settled cell keeps `theme.icon.rewind`, the running one `theme.icon.time`.
- `packages/coding-agent/src/config/settings-schema.ts`: `turn_ended` removed from the `StatusLineSegmentId` union; `turnEndedSegment` removed from `SEGMENTS`.
- `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`: the fixture context gained `lastTurnEndedAt`, and the `turn` variants cover running, settled with the stamp, and the pre-first-turn state; the `turn_ended` variants are gone.
- `packages/coding-agent/test/status-line-turn.test.ts`: the running-over-settled precedence, the settled duration, minutes past an hour, the full three-field order, the omitted sub-second cumulative field, the stamp held across a running turn, the hidden state, the cumulative-only first turn, and both meter record-and-reset behaviors.

`time_spent` survives as an upstream segment and still renders `hh:mm` on its own; the dotfiles `config.yml` no longer lists it, since the merged cell carries its value.

Seconds are back in the first field, which is what the clock format above removed. The cost is real - the field repaints as the second ticks and gains a column at `10m`, `100m` - and it is accepted because a turn under a minute reading `00:00` said nothing about how long it took.

## feat(status-line): show only the current directory

Commit `681d24244c`.

`path` spent 42 columns on `…epositories/github.com/can1357/oh-my-pi`: a leading-edge truncation of a tree whose home directory and forge host never change. `segmentOptions.path.lastDir` renders `.../oh-my-pi` instead, 14 columns with the icon.

Changed:

- `packages/coding-agent/src/modes/components/status-line/types.ts`: `StatusLineSegmentOptions.path.lastDir`.
- `packages/coding-agent/src/modes/components/status-line/segments.ts`: under `lastDir`, `pathSegment` replaces the path with `.../${path.basename(pwd)}` and skips both `shortenPath` and `clampPathLength`, so `abbreviate` and `maxLength` no longer apply. The hyperlink still targets the full directory, and the linked-worktree branch above is untouched - it already collapses to the project name.
- `packages/coding-agent/test/status-line-path.test.ts`: a case asserting the current directory renders alone, that the tree above it is gone, and that a `maxLength` of 4 does not clip the name.

The status line's overflow handling shrinks `path` first, so this also removes the elastic segment the bar used to absorb a narrow terminal - the trade is a fixed short path instead of a variable-length one.

## feat(shutdown): drop the exit chatter

Commit `e6b05a3a46`.

Every exit printed two lines nobody reads. `#teardown` set a `Closing session…` status that flashes for the few milliseconds `session.dispose()` actually takes, and `shutdown` wrote a dim `Resume this session with omp --resume <id>` hint that repeats what `/resume` and the recent-sessions list already offer.

Changed:

- `packages/coding-agent/src/modes/interactive-mode.ts`: the `showStatus("Closing session…")` call and the `resumeCommand` stderr write are gone, along with the now-unused `resumeCommand` import. `#resumableSessionId()` stays because `restart()` still needs it to rebuild the relaunch argv.
- `packages/coding-agent/test/interactive-mode-still-closing.test.ts`: the case now asserts no status before the 3s threshold and only `Still closing… (flushing memory backend / network)` after it.

The `Still closing…` status stays. It fires only after `STILL_CLOSING_DELAY_MS`, so it never appears on a normal quit and is the only signal that a stalled memory flush is the reason the terminal has not come back.

## fix(transcript): drop the shutdown flush trailing blank

Commit `c144b315eb`.

Quitting shifted the final frame down one row: the transcript, the composer gap, then a second empty row above the status box that the terminal keeps in scrollback after exit. `TranscriptContainer.#renderRange` appends a blank separator to every history batch, and `TUI.stop()` retires the remaining transcript through `peekFlushBatch` with that blank attached. Under pressure the blank is correct, since more live transcript follows it and renders with no leading gap. A shutdown flush has no successor and the chrome below supplies its own gap.

Changed:

- `packages/coding-agent/src/modes/components/transcript-container.ts`: `#peekBatch` passes `trailingBlank = policy !== "flush"` into `#renderRange`, and the `commit` variant of `Offered` carries the flag so `rerenderOfferedBatch` reproduces the same rows when a frame is discarded. The pressure path is unchanged.
- `packages/coding-agent/test/modes/components/transcript-container.test.ts`: the two flush cases now expect `["fits"]` and `["tail"]` instead of a trailing `""`.

Verified with a throwaway `VirtualTerminal` end-to-end harness, since the row shift is only observable in the terminal buffer: before the fix the scroll buffer moved the status box from rows 6-7 to rows 7-8 across `mode.stop()`, and after it the before and after buffers are identical. The composer and end-to-end suites fail the same eight pre-existing cases with and without the change.

## test(settings): keep the ambient config overlay out of tests

Commit `07f702fa85`.

A session launched by `omp` exports `PI_CONFIG_FILES` pointing at the dotfiles overlay, and the `Settings` constructor reads that variable at `packages/coding-agent/src/config/settings.ts:541`, before any `inMemory` or `readOnly` branch. Every test that initializes settings therefore inherited the developer's own preferences. The overlay's `startup.quiet: true` suppresses the welcome panel, and the panel's border title is where the version string lives, so each test that counts welcome rows read zero: eight failures across `test/startup-composer.test.ts`, `test/issue-9597-cold-launch-double-clear.test.ts` and `test/interactive-terminal-e2e.test.ts`. The failure imitates upstream breakage, because an `origin/main` worktree inherits the same exported environment and fails identically.

Changed:

- `scripts/test-preload.ts`: new, deletes `process.env.PI_CONFIG_FILES`.
- `bunfig.toml`: `[test] preload` runs it.
- `packages/coding-agent/bunfig.toml`: new, restates the same `preload`. Bun reads `bunfig.toml` from the current directory only and never from a parent, so `bun test` run inside the package would otherwise miss the root setting.

`inMemory` is the wrong gate for this: it only nulls `#configPath` and clears `#persist`, the env layer is read regardless, and `Settings.isolated()` passes `inMemory: true` on a production path. Gating on `isBunTestRuntime()` is wrong too, because `scripts/ci-test-ts.ts` sets `PI_TEST_RUNTIME=1` and child processes inherit it, which would make the spawned CLI in `test/config-cli.test.ts:200` ignore the `PI_CONFIG_FILES` that case passes on purpose.

Verified: the three affected files plus `test/config-cli.test.ts` and `test/modes/components/transcript-container.test.ts` give 59 pass, 0 fail from inside the package with the profile environment present. Before the preload the same set failed eight cases.

## test(status-line): drop the brand timer assertion

Commit `da2989c7d5`.

Upstream commit `2047a97174` added `packages/coding-agent/test/status-line-brand-fade.test.ts`, which asserted `expect(early).toContain(" 0s ")` at turn start. The duplicate brand timer patch above removed that timer and never touched the test, which arrived in the tree only on the rebase onto `origin/main`. The case now asserts the bar carries no seconds field, and keeps the surrounding glyph-swap and fade-color assertions unchanged.

## fix(iso): pin diff path prefixes for change capture

Commit `d40aa3d33b`.

`crates/pi-iso/src/diff.rs` shells out to `git diff` and `parse_git_diff` splits the output on `diff --git a/<path> b/<path>`, stripping a literal `b/` at line 232. A `diff.mnemonicPrefix = true` user config renames those prefixes to `c/` and `w/`, so every captured path came back wrong and isolated-worktree change capture mis-parsed its own diff. `git_spawn` now pins `diff.mnemonicPrefix=false`, `diff.noprefix=false`, `diff.srcPrefix=a/` and `diff.dstPrefix=b/` on every invocation, beside the `core.quotepath=off` pin the diff call already carried.

`crates/pi-vcs` needs no equivalent: it renders patches in-process through gix, which writes the `a/` prefix itself at `src/git/diff.rs:571`, so no git config reaches it.

## test(vcs): keep the developer git config out of tests

Commit `dc5fe3a6fe`.

The same `diff.mnemonicPrefix` setting broke six Rust cases in `pi-vcs` and two in `packages/natives`, all of which compare in-process gix output against a reference `git` invocation that inherited the developer's config.

Changed:

- `scripts/test-preload.ts`: also pins `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to `/dev/null`.
- `packages/natives/bunfig.toml`: new, restates the root `preload` for package-local runs.
- `packages/natives/test/vcs.test.ts`: the `git` helper passes `env: { ...Bun.env }`, because `Bun.spawn` hands a child the environment as it stood at process start and ignores the preload's mutation. Measured with a probe: the parent read `/dev/null` while the child read an empty value.
- `crates/pi-vcs/src/git/diff.rs`, `crates/pi-vcs/src/git/patch.rs`, `crates/pi-vcs/src/lib.rs`: the test-only `git` helpers pin both config scopes per invocation, through a shared `stock_git` builder in the first two.

Verified with the developer config in place: `cargo test -p pi-vcs -p pi-iso` gives 53 pass, 0 fail, against 6 failures before; `bun test test/vcs.test.ts` in `packages/natives` gives 7 pass; `bun run check:ts` exits 0.

## fix(status-line): hide OpenAI plan labels

Commit `27cfc2f314`.

OpenAI reports account plans such as `plus`, `pro`, and `prolite` beside usage windows. The account plan does not help interpret quota percentages and takes permanent status-line width. OpenAI account plan labels are now omitted while scoped model tiers such as `spark` remain visible. Other providers keep their existing plan labels.

Changed:

- `packages/coding-agent/src/modes/components/status-line/component.ts`: OpenAI plan metadata no longer supplies the displayed usage tier; scoped limit tiers still do.
- `packages/coding-agent/test/status-line-usage.test.ts`: the active-account case verifies `prolite` stays hidden while both quota windows remain.
- `packages/coding-agent/CHANGELOG.md`: records the user-visible status-line change.

## fix(todo): synchronize canonical state

Commits `3d7b8d91dc` and `292cb992fd`.

Todo mutations previously followed separate persistence and display paths for direct tool calls, eval bridges, slash commands, RPC, Cursor, ACP, session reloads, and collaboration. Those paths could disagree, overwrite newer snapshots, lose changes after reload or compaction, and leave the model's displayed progress stale. Every writer now crosses one revisioned `AgentSession.setTodoPhases` boundary, while hydration rejects stale or identical snapshots without creating journal entries.

Changed:

- `packages/coding-agent/src/session/{agent-session,agent-session-events,todo-tracker}.ts` and `packages/coding-agent/src/tools/todo.ts`: added canonical revisioned snapshots, branch recovery, explicit task transitions, post-compaction context, bounded completion reminders, blocked-task yielding, and latest-user precedence.
- `packages/coding-agent/src/{cursor,sdk}.ts`, `packages/coding-agent/src/modes/`, and `packages/coding-agent/src/slash-commands/helpers/todo.ts`: routed Cursor, eval, RPC, ACP, TUI, focus changes, and slash commands through the canonical boundary and revision-aware UI events.
- `packages/coding-agent/src/collab/` and `packages/wire/src/index.ts`: replicated bounded, schema-valid todo snapshots in welcome state and live events, including stale-revision protection and UTF-8 payload measurement.
- `packages/collab-web/src/`: added a persistent live todo panel with completion counts and blocked reasons; the mock host now supplies representative todo state.
- Focused tests cover persistence, reloads, revisions, Cursor, ACP, RPC contracts, collaboration, explicit progress, compaction, reminder bounds, user questions, blocked work, and panel rendering.
- `packages/coding-agent/CHANGELOG.md`, `packages/collab-web/CHANGELOG.md`, and `packages/wire/CHANGELOG.md`: record the user-visible behavior and wire additions.

Verified live: the TUI moved a slash-command todo through pending, in-progress, and completed states with the HUD reaching `1/1`; the collaboration web guest rendered the host's `1/2` live board. Focused todo, RPC, ACP, Cursor, and collaboration tests pass; `bun check` exits 0.

## Configuration, not patches

These behaviors were requested alongside the patches and turned out to need no code. They live in `.agents/omp/config.yml` in the dotfiles.

`startup.quiet: true` removes the welcome panel, the logo, the Tips column, the LSP list, the recent-sessions column, the "Tip:" line under the box and the "Connected to MCP servers" notice, including the mid-session reprint from the `/mcp` dashboard. One key covers all of it; there is no finer granularity, and it also silences LSP startup notices, the model-scope banner and xdev mount notices. The panel can still flash once per directory because `cli.ts` prepaints from a per-cwd cache of the previous run's preferences before settings load.

`statusLine.leftSegments` reads `pi, client, model, path, turn, usage`, with `session_name` alone on the right. Everything that reported a number nobody acts on is off: `cost` and `token_total` because spend is read on demand, `context_pct` and `context_total` because the percentage never changed a decision, and `profile` and `subagents` because they are empty on the default config root with no children. `contextLine: "off"` retires the gauge with them, so the gap between the groups is the box's own top border in the session accent - no fill, no compaction markers, no labels. The live-clock `time` segment is not listed either, so `segmentOptions.time` carries no keys, and `segmentOptions.path` carries only `lastDir: true`.

`display.showTokenUsage: false` hides the per-turn usage row under each answer. Every profile's own config turns it on; the shared overlay outranks them, so one key switches it off everywhere.

## Working on this branch

Iterate without compiling: `bun dev -- --version`, `bun dev -- --help`, and so on run the CLI from source. Rust changes need `bun run build:native` first.

Check before committing: `bun run check:ts`, plus `bun test` in the package touched.

`omp-sync` pulls the fork and rebuilds the installed binary. `omp-sync --rebase` replays this series onto the latest `origin/main` first, with rerere replaying recorded conflict resolutions. `omp-sync --publish` overwrites the fork with the local series after an amend or a local rebase.

Keep one commit per concern so a conflict stays confined to the commit that collided. Upstreaming a patch means branching off `origin/main`, cherry-picking the single commit, pushing that branch to the fork, and opening the PR against `can1357/oh-my-pi`; the `mahendra` branch itself is never the PR head.
