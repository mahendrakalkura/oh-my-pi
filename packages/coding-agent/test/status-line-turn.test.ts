/**
 * The `turn` segment is a stopwatch with two faces: the running turn's elapsed
 * time while the agent works, and the duration that turn took once it yields.
 *
 * Contract:
 * - `turnElapsedMs` wins whenever it is non-null, so a running turn is never
 *   masked by the previous one.
 * - `lastTurnMs` renders when idle; before the first turn closes the segment
 *   is invisible rather than rendering a zero.
 * - `StatusLineComponent` records the duration of each closed
 *   `agent_start`→`agent_end` window, and `resetActiveTime` drops it along
 *   with the accumulator.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

function createCtx(turnElapsedMs: number | null, lastTurnMs: number | null): SegmentContext {
	return {
		// The segment under test never touches `session`; stub it.
		session: {} as unknown as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options: {},
		planMode: null,
		loopMode: null,
		prewalk: null,
		goalMode: null,
		vibeMode: null,
		collab: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			orchestrationInput: 0,
			orchestrationOutput: 0,
			orchestrationCacheRead: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: 0,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		compactionSpeculation: "idle",
		speculationBlinkOn: true,
		subagentCount: 0,
		activeMs: 0,
		turnElapsedMs,
		lastTurnMs,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

function makeSession(): ConstructorParameters<typeof StatusLineComponent>[0] {
	// Mirrors the stub in status-line-time-spent.test.ts: the turn accounting
	// path only needs the surface the constructor settles against.
	return {
		state: { messages: [], model: undefined },
		messages: [],
		systemPrompt: [],
		agent: { state: { tools: [] } },
		skills: [],
		isStreaming: false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		isFastModeEnabled: () => false,
		getGoalModeState: () => null,
		getAsyncJobSnapshot: () => ({ running: [] }),
		modelRegistry: { isUsingOAuth: () => false },
		sessionFile: undefined,
		sessionManager: {
			getSessionName: () => "turn test",
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				orchestrationInput: 0,
				orchestrationOutput: 0,
				orchestrationCacheRead: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];
}

describe("turn segment", () => {
	it("renders the running turn as a zero-padded clock", () => {
		const rendered = renderSegment("turn", createCtx(12_400, null));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("00:00");
	});

	it("prefers the running turn over the previous one", () => {
		const rendered = renderSegment("turn", createCtx(5_000, 90_000));
		expect(rendered.content).toContain("00:00");
		expect(rendered.content).not.toContain("00:01");
	});

	it("renders the previous turn while idle", () => {
		const rendered = renderSegment("turn", createCtx(null, 90_000));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("00:01");
	});

	it("carries hours in the leading field", () => {
		const rendered = renderSegment("turn", createCtx(null, 3_900_000));
		expect(rendered.content).toContain("01:05");
	});

	it("never renders seconds", () => {
		expect(renderSegment("turn", createCtx(59_000, null)).content).not.toContain("s");
		expect(renderSegment("turn", createCtx(null, 12_400)).content).not.toContain("s");
	});

	it("hides itself before the first turn closes", () => {
		expect(renderSegment("turn", createCtx(null, null))).toEqual({ content: "", visible: false });
	});

	it("records the duration of each closed turn and drops it on reset", () => {
		const component = new StatusLineComponent(makeSession());
		expect(component.getLastTurnMs()).toBeNull();

		component.markActivityStart();
		component.markActivityEnd();
		const firstTurn = component.getLastTurnMs();
		expect(firstTurn).not.toBeNull();
		expect(firstTurn).toBeGreaterThanOrEqual(0);

		// An unmatched end must not overwrite the recorded duration with a new window.
		component.markActivityEnd();
		expect(component.getLastTurnMs()).toBe(firstTurn);

		component.resetActiveTime();
		expect(component.getLastTurnMs()).toBeNull();
	});
});
