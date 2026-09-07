import { beforeAll, describe, expect, it } from "bun:test";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

interface IdentityLookup {
	provider?: string;
	sessionId?: string;
}

interface OAuthIdentity {
	accountId?: string;
	email?: string;
	orgId?: string;
	orgName?: string;
	projectId?: string;
}

function createAccountContext(
	identity: OAuthIdentity | undefined,
	lookup: IdentityLookup,
	provider: string | null = "anthropic",
	tags?: Record<string, string>,
): SegmentContext {
	return {
		session: {
			model: provider ? { id: "claude-opus-5", name: "Claude Opus 5", provider } : undefined,
			sessionId: "session-under-test",
			modelRegistry: {
				authStorage: {
					getOAuthAccountIdentity: (requestedProvider: string, sessionId?: string) => {
						lookup.provider = requestedProvider;
						lookup.sessionId = sessionId;
						return identity;
					},
				},
			},
		} as unknown as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options: tags ? { account: { tags } } : {},
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
		turnElapsedMs: null,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

describe("status line account segment", () => {
	it("names this session's account for the active provider", () => {
		const lookup: IdentityLookup = {};
		const rendered = renderSegment("account", createAccountContext({ email: "mk@example.com" }, lookup));

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("mk@example.com");
		expect(rendered.content).toContain(theme.icon.account);
		// The identity is per-session sticky, so the segment must ask about its own
		// session and its own provider; either argument dropped reports someone else's account.
		expect(lookup.provider).toBe("anthropic");
		expect(lookup.sessionId).toBe("session-under-test");
	});

	it("falls back to the account id when the credential carries no email", () => {
		const rendered = renderSegment("account", createAccountContext({ accountId: "acct-4711" }, {}));

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("acct-4711");
	});

	it("renders the configured tag instead of the email, matching case-insensitively", () => {
		const rendered = renderSegment(
			"account",
			createAccountContext({ email: "Mahendra.Kalkura@FulcrumSaaS.com" }, {}, "anthropic", {
				"mahendra.kalkura@fulcrumsaas.com": "jg",
				"mahendrakalkura@gmail.com": "mk",
			}),
		);

		expect(rendered.content).toContain("jg");
		expect(rendered.content).not.toContain("fulcrumsaas");
	});

	it("names an unmapped account by email rather than hiding it", () => {
		const rendered = renderSegment(
			"account",
			createAccountContext({ email: "someone@elsewhere.test" }, {}, "anthropic", {
				"mahendrakalkura@gmail.com": "mk",
			}),
		);

		expect(rendered.content).toContain("someone@elsewhere.test");
	});

	it("hides itself on an api-key provider with no oauth identity", () => {
		const rendered = renderSegment("account", createAccountContext(undefined, {}));

		expect(rendered).toEqual({ content: "", visible: false });
	});

	it("hides itself before a model is resolved", () => {
		const lookup: IdentityLookup = {};
		const rendered = renderSegment("account", createAccountContext({ email: "mk@example.com" }, lookup, null));

		expect(rendered).toEqual({ content: "", visible: false });
		expect(lookup.provider).toBeUndefined();
	});

	it("keeps the icon and elides the account while the bar is still starting", () => {
		const ctx = createAccountContext({ email: "mk@example.com" }, {});
		ctx.startupPlaceholder = true;
		const rendered = renderSegment("account", ctx);

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain(theme.icon.account);
		expect(rendered.content).not.toContain("mk@example.com");
	});
});
