/**
 * The `turn` segment carries three time facts in one cell,
 * `0m05s · 3m20s · 17:23:47`: this turn, all turns, and when the last one
 * ended.
 *
 * Contract:
 * - Field one is `turnElapsedMs` whenever it is non-null, so a running turn is
 *   never masked by the previous one, and `lastTurnMs` once it settles.
 * - Field two is cumulative active time, omitted below one second so a fresh
 *   session does not carry a zero.
 * - Field three is the wall clock at the last turn's close, held while the next
 *   turn runs.
 * - With no field to show the cell is invisible rather than rendering zeros.
 * - `StatusLineComponent` records the duration and end instant of each closed
 *   `agent_start`→`agent_end` window, and `resetActiveTime` drops both along
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

function createCtx(
	turnElapsedMs: number | null,
	lastTurnMs: number | null,
	lastTurnEndedAt: number | null = null,
	activeMs = 0,
): SegmentContext {
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
		activeMs,
		turnElapsedMs,
		lastTurnMs,
		lastTurnEndedAt,
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

const ENDED_AT = new Date(2026, 8, 4, 9, 7, 5).getTime();

describe("turn segment", () => {
	it("leads with the running turn, not the previous one", () => {
		const rendered = renderSegment("turn", createCtx(65_000, 90_000));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("1m05s");
		expect(rendered.content).not.toContain("1m30s");
	});

	it("leads with the previous turn's duration once it settles", () => {
		const rendered = renderSegment("turn", createCtx(null, 90_000));
		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("1m30s");
	});

	it("grows the minute field past an hour instead of carrying hours", () => {
		const rendered = renderSegment("turn", createCtx(null, 3_900_000));
		expect(rendered.content).toContain("65m00s");
	});

	it("renders the turn, the cumulative active time, and the end stamp in that order", () => {
		const rendered = renderSegment("turn", createCtx(null, 90_000, ENDED_AT, 200_000));
		expect(Bun.stripANSI(rendered.content)).toContain("1m30s · 3m20s · 09:07:05");
	});

	it("omits the cumulative field below a second of activity", () => {
		const rendered = renderSegment("turn", createCtx(null, 90_000, null, 500));
		expect(Bun.stripANSI(rendered.content).endsWith("1m30s")).toBe(true);
	});

	it("holds the previous end stamp while a new turn runs", () => {
		const rendered = renderSegment("turn", createCtx(4_000, 92_000, ENDED_AT));
		expect(Bun.stripANSI(rendered.content)).toContain("0m04s · 09:07:05");
	});

	it("hides itself when no turn has run and nothing is active", () => {
		expect(renderSegment("turn", createCtx(null, null))).toEqual({ content: "", visible: false });
	});

	it("shows the cumulative field alone during the first turn's activity", () => {
		const rendered = renderSegment("turn", createCtx(null, null, null, 5_000));
		expect(rendered.visible).toBe(true);
		expect(Bun.stripANSI(rendered.content)).toContain("0m05s");
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

	it("records the wall-clock end of each closed turn and drops it on reset", () => {
		const component = new StatusLineComponent(makeSession());
		expect(component.getLastTurnEndedAt()).toBeNull();

		const before = Date.now();
		component.markActivityStart();
		component.markActivityEnd();
		const firstEnd = component.getLastTurnEndedAt();
		expect(firstEnd).toBeGreaterThanOrEqual(before);
		expect(firstEnd).toBeLessThanOrEqual(Date.now());

		// An unmatched end must not restamp: there is no window to close.
		component.markActivityEnd();
		expect(component.getLastTurnEndedAt()).toBe(firstEnd);

		component.resetActiveTime();
		expect(component.getLastTurnEndedAt()).toBeNull();
	});
});
