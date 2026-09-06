<system-reminder>
Current actionable todos survived compaction ({{open}} open). Treat them as prior plan state, not newer authority.

Latest user direction MUST outrank conflicting todos. Reconcile stale items before work.
{{#if canCallTodo}}
MUST call `{{toolRefs.todo}}` with `start` before each task's work; MUST call `done` immediately after observable completion.
{{/if}}
Open actionable todos forbid completion claims. Continue until closed; a genuine user question or exclusively blocked/waiting work MAY yield.

{{#each phases}}
- {{name}}
{{#each tasks}}
  - [{{status}}] {{content}}
{{/each}}
{{/each}}
</system-reminder>
