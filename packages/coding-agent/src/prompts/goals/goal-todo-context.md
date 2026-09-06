<todo_context>
Persisted todos are prior live progress state, not newer authority. Latest user direction MUST outrank conflicts; reconcile stale items before work.
MUST call `todo start` before each task's work and `todo done` immediately after observable completion. Open actionable todos forbid completion claims; exclusively blocked/waiting work or a genuine user question permits yield.

Overall: {{closed}}/{{total}} done, {{open}} open.
{{#each phases}}

- {{name}}
  {{#each tasks}}
   - [{{status}}] {{content}}
     {{/each}}
     {{/each}}
     </todo_context>
