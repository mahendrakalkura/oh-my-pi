**Tasks: verbatim content strings, NEVER auto-generated IDs; no "task-1"/"task-N". Pass content in `task`.**

Only `start` creates `in_progress`. `init`/`append` create `pending`; `done`/`drop`/`block` leave no implicit successor. Starting a task demotes any prior `in_progress` task to `pending`. Blocked tasks require `unblock` before `start`.

## Operations

| `op`      | Fields                               | Effect                                                                                                       |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `init`    | `list: [{phase, items: string[]}]`   | Initialize full list; replaces existing                                                                      |
| `init`    | `items: string[]`                    | Flattened single-phase init                                                                                  |
| `start`   | `task`                               | Mark in progress                                                                                             |
| `done`    | `task` or `phase`                    | Mark completed                                                                                               |
| `drop`    | `task` or `phase`                    | Mark abandoned                                                                                               |
| `block`   | `task` or `phase`; optional `reason` | Mark blocked: awaiting external input; never auto-promotes; excluded from stop-time incomplete-todo reminder |
| `unblock` | `task` or `phase`                    | Blocked task → `pending`                                                                                     |
| `rm`      | optional `task` or `phase`           | Remove task/phase; omit both → clear                                                                         |
| `append`  | `phase`; `items: string[]`           | Append tasks to phase; lazily creates phase                                                                  |
| `view`    | —                                    | Read-only; echo list                                                                                         |

## Anatomy

- Task content: 5–10 words; what, not how; unique identifier.
- Phase name: short noun phrase (e.g. `Foundation`, `Auth`, `Verification`); unique identifier. NEVER prefix `1.`, `A)`, `Phase 1:`.

## Rules

- Latest user direction MUST outrank conflicting prior todos; reconcile the list before work.
- MUST `start` a task before work; MUST `done` immediately after observable completion.
- Open actionable todos forbid completion claims. Continue until closed.
- NEVER make a todo call the turn's only tool call. Pair state changes with real work in the same turn.
- User decision, another agent, or external service required? `block` with optional `reason`; all remaining work blocked/waiting permits yield. Agent-actionable blocker? `append` the unblocking work instead.
- Keep introduced `task`/`phase` strings stable.
- Lost exact task text: `view` echoes list; NEVER guess from memory.

## Create a list

- Task requires 3+ distinct steps.
- User explicitly requests one.
- User provides a set of tasks.
- New instructions arrive mid-task: capture before proceeding.

<critical>
User gives multi-step plan—phased todo, numbered/bulleted checklist, or "N bugs/items/tasks":
- MUST `init` every item as its own task before working.
- Enumerate all; NEVER summarize into fewer tasks, sample "the important ones", drop items, or track the rest from memory.
</critical>
