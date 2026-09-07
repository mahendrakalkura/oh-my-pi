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
	it("names the provider and this session's client", () => {
		const lookup: IdentityLookup = {};
		const rendered = renderSegment(
			"account",
			createAccountContext({ email: "mahendrakalkura@gmail.com" }, lookup, "anthropic", {
				"mahendrakalkura@gmail.com": "mk",
			}),
		);

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain(`anthropic${theme.sep.dot}mk`);
		expect(rendered.content).toContain(theme.icon.account);
		// The identity is per-session sticky, so the segment must ask about its own
		// session and its own provider; either argument dropped reports someone else's account.
		expect(lookup.provider).toBe("anthropic");
		expect(lookup.sessionId).toBe("session-under-test");
	});

	it("splits a person-suffixed api-key clone into provider and client", () => {
		const rendered = renderSegment(
			"account",
			createAccountContext(undefined, {}, "nr-alibaba", { "nr-alibaba": "nr" }),
		);

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain(`alibaba${theme.sep.dot}nr`);
		expect(rendered.content).not.toContain("nr-alibaba");
	});

	it("matches tag keys case-insensitively", () => {
		const rendered = renderSegment(
			"account",
			createAccountContext({ email: "Mahendra.Kalkura@FulcrumSaaS.com" }, {}, "anthropic", {
				"mahendra.kalkura@fulcrumsaas.com": "jg",
			}),
		);

		expect(rendered.content).toContain(`anthropic${theme.sep.dot}jg`);
		expect(rendered.content).not.toContain("fulcrumsaas");
	});

	it("names an unmapped login by email rather than hiding it", () => {
		const rendered = renderSegment(
			"account",
			createAccountContext({ email: "someone@elsewhere.test" }, {}, "anthropic", {
				"mahendrakalkura@gmail.com": "mk",
			}),
		);

		expect(rendered.content).toContain(`anthropic${theme.sep.dot}someone@elsewhere.test`);
	});

	it("falls back to the account id when the credential carries no email", () => {
		const rendered = renderSegment("account", createAccountContext({ accountId: "acct-4711" }, {}));

		expect(rendered.content).toContain(`anthropic${theme.sep.dot}acct-4711`);
	});

	it("names the provider alone when no client is known", () => {
		const rendered = renderSegment("account", createAccountContext(undefined, {}, "nr-alibaba"));

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("nr-alibaba");
		expect(rendered.content).not.toContain(theme.sep.dot);
	});

	it("hides itself before a model is resolved", () => {
		const lookup: IdentityLookup = {};
		const rendered = renderSegment("account", createAccountContext({ email: "mk@example.com" }, lookup, null));

		expect(rendered).toEqual({ content: "", visible: false });
		expect(lookup.provider).toBeUndefined();
	});

	it("keeps the icon and elides provider and client while the bar is still starting", () => {
		const ctx = createAccountContext({ email: "mahendrakalkura@gmail.com" }, {}, "anthropic", {
			"mahendrakalkura@gmail.com": "mk",
		});
		ctx.startupPlaceholder = true;
		const rendered = renderSegment("account", ctx);

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain(theme.icon.account);
		expect(rendered.content).not.toContain("anthropic");
	});
});
