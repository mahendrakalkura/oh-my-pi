import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { TodoTracker, type TodoTrackerHost } from "@oh-my-pi/pi-coding-agent/session/todo-tracker";

function createTracker(activeTools: string[] = ["todo"]): TodoTracker {
	const messages: unknown[] = [];
	const host = {
		agent: {
			state: { messages },
			appendMessage: (message: unknown) => messages.push(message),
		},
		sessionManager: {
			getBranch: () => [],
			appendMessage: () => {},
		},
		settings: Settings.isolated({
			"todo.enabled": true,
			"todo.reminders": true,
			"todo.remindersMax": 3,
		}),
		model: () => undefined,
		agentKind: () => "main",
		emitSessionEvent: async () => {},
		scheduleAgentContinue: () => {},
		promptGeneration: () => 1,
		hasPendingAsyncWake: () => false,
		getActiveToolNames: () => activeTools,
		getEnabledToolNames: () => activeTools,
		toolRegistry: () => new Map(),
		planModeEnabled: () => false,
		prewalkWillHandoff: () => false,
		consumeLastServedToolChoiceLabel: () => undefined,
	} as unknown as TodoTrackerHost;
	return new TodoTracker(host);
}

describe("TodoTracker post-compaction context", () => {
	it("re-injects every actionable task from an existing list", () => {
		const tracker = createTracker();
		tracker.setPhases([
			{
				name: "Implementation",
				tasks: [
					{ content: "Continue active change", status: "in_progress" },
					{ content: "Run remaining check", status: "pending" },
					{ content: "Wait for approval", status: "blocked", blocker: "user decision" },
					{ content: "Already verified", status: "completed" },
				],
			},
		]);

		const nudge = tracker
			.buildPostCompactionEagerNudges()
			.find(message => message.role === "custom" && message.customType === "post-compaction-todo-context");
		if (nudge?.role !== "custom") throw new Error("Expected post-compaction todo context");
		const content = typeof nudge.content === "string" ? nudge.content : "";
		expect(content).toContain("Continue active change");
		expect(content).toContain("Run remaining check");
		expect(content).not.toContain("Wait for approval");
		expect(content).not.toContain("Already verified");
	});

	it("does not revive an exclusively blocked or settled list", () => {
		const tracker = createTracker();
		tracker.setPhases([
			{
				name: "Waiting",
				tasks: [
					{ content: "Need user choice", status: "blocked" },
					{ content: "Finished", status: "completed" },
					{ content: "Discarded", status: "abandoned" },
				],
			},
		]);

		expect(tracker.buildPostCompactionEagerNudges()).toEqual([]);
	});
});
