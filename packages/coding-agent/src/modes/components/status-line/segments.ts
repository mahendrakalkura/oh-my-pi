import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { SPINNER_ADVANCE_MS, TERMINAL } from "@oh-my-pi/pi-tui";
import {
	formatNumber,
	getActiveProfile,
	getProjectDir,
	pathIsWithin,
	relativePathWithinRoot,
} from "@oh-my-pi/pi-utils";
import { type Theme, type ThemeColor, theme } from "../../../modes/theme/theme";
import { shortenPath, TRUNCATE_LENGTHS, truncateToWidth } from "../../../tools/render-utils";
import { fileHyperlink } from "../../../tui/hyperlink";
import { getSessionAccentAnsi, getSessionAccentHex } from "../../../utils/session-color";
import { sanitizeStatusText } from "../../shared";
import { formatContextUsage, getContextUsageLevel, getContextUsageThemeColor } from "./context-thresholds";
import type { RenderedSegment, SegmentContext, StatusLineSegment, StatusLineSegmentId } from "./types";

export type { SegmentContext } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

const STARTUP_PLACEHOLDER = "…";

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

function statusValue(ctx: SegmentContext, value: string): string {
	return ctx.startupPlaceholder ? STARTUP_PLACEHOLDER : value;
}
/**
 * Hash-derived accent ANSI for the session title (or preview stand-in title).
 * Undefined when `statusLine.sessionAccent` is off or the session is unnamed,
 * so callers fall back to their theme color.
 */
function sessionAccentAnsi(ctx: SegmentContext): string | undefined {
	if (ctx.sessionAccent === false) return undefined;
	const name = ctx.session?.sessionManager?.getSessionName() || ctx.previewTitle;
	if (!name) return undefined;
	return getSessionAccentAnsi(getSessionAccentHex(name, theme.sessionAccentInputs));
}
/**
 * `theme.fg` for accent-role text: the hash-derived session accent when
 * enabled, else the given theme color. Callers route only the parts that
 * should carry the session identity color through this (pi icon, model name,
 * PR link, mode badges, session title) — status colors stay `theme.fg`.
 */
function accentFg(ctx: SegmentContext, color: ThemeColor, text: string): string {
	return `${sessionAccentAnsi(ctx) ?? theme.getFgAnsi(color)}${text}\x1b[39m`;
}

/** Left-truncate a path/label to `maxLen`, prefixing an ellipsis when clipped. */
function clampPathLength(pwd: string, maxLen: number): string {
	if (pwd.length <= maxLen) return pwd;
	const ellipsis = "…";
	return `${ellipsis}${pwd.slice(-Math.max(0, maxLen - ellipsis.length))}`;
}

/**
 * Leading glyph of a thinking-level display string (e.g. "◉ xhigh" → "◉").
 * Compact mode promotes this glyph to the model-segment icon so the level
 * stays visible without the verbose " · <level>" tail.
 */
function thinkingGlyph(display: string): string {
	const space = display.indexOf(" ");
	return space === -1 ? display : display.slice(0, space);
}

function stripDisplayRoot(pwd: string): string {
	for (const root of [path.join(os.homedir(), "Projects"), "/work"]) {
		const relative = relativePathWithinRoot(root, pwd);
		if (relative) return relative;
	}
	return pwd;
}

function normalizePremiumRequests(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
function formatSpend(amount: number, usingSubscription: boolean, uiTheme: Theme): string {
	const formatted = amount.toFixed(2);
	if (!usingSubscription) return `$${formatted}`;
	if (uiTheme.getSymbolPreset() === "nerd") {
		const icon = uiTheme.icon.subscription;
		return icon ? `${icon} ${formatted}` : `S${formatted}`;
	}
	return `S${formatted}`;
}

function formatAdvisorSpend(amount: number, usingSubscription: boolean, uiTheme: Theme): string {
	const spend = formatSpend(amount, usingSubscription, uiTheme);
	const icon = uiTheme.icon.advisor;
	if (icon && icon !== "(adv)") {
		return `${icon} ${spend}`;
	}
	return `${spend} (adv)`;
}

function formatSpendPlaceholder(usingSubscription: boolean, uiTheme: Theme): string {
	if (!usingSubscription) return "$…";
	if (uiTheme.getSymbolPreset() === "nerd" && uiTheme.icon.subscription) {
		return `${uiTheme.icon.subscription} …`;
	}
	return "S…";
}

function formatAdvisorSpendPlaceholder(usingSubscription: boolean, uiTheme: Theme): string {
	const spend = formatSpendPlaceholder(usingSubscription, uiTheme);
	const icon = uiTheme.icon.advisor;
	if (icon && icon !== "(adv)") return `${icon} ${spend}`;
	return `${spend} (adv)`;
}

const SCRATCH_ROOTS: readonly string[] = (() => {
	const roots = new Set<string>([os.tmpdir(), path.join(os.homedir(), "tmp")]);
	if (process.platform === "win32") {
		const { TEMP, TMP, SystemRoot } = process.env;
		if (TEMP) roots.add(TEMP);
		if (TMP) roots.add(TMP);
		if (SystemRoot) roots.add(path.join(SystemRoot, "Temp"));
	} else {
		roots.add("/tmp");
		roots.add("/var/tmp");
		if (process.platform === "darwin") {
			roots.add("/private/tmp");
			roots.add("/private/var/tmp");
		}
	}
	return [...roots];
})();

function classifyProjectDir(pwd: string): { scratch: boolean; relative: string | null } {
	for (const root of SCRATCH_ROOTS) {
		if (pathIsWithin(root, pwd)) {
			return { scratch: true, relative: relativePathWithinRoot(root, pwd) };
		}
	}
	return { scratch: false, relative: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment Implementations
// ═══════════════════════════════════════════════════════════════════════════

const piSegment: StatusLineSegment = {
	id: "pi",
	render(ctx) {
		if (ctx.focusedAgentId) {
			const icon = theme.icon.ghost ? `${theme.icon.ghost} ` : "";
			return {
				content: theme.fg("warning", `${icon}${statusValue(ctx, ctx.focusedAgentId)} `),
				visible: true,
			};
		}
		// Brand fg fades between dim gray (idle) and the accent (working) across
		// turn edges; the component samples the tween into `brandFgAnsi`.
		const fgAnsi = ctx.brandFgAnsi ?? theme.getFgAnsi("dim");
		// While a turn runs the brand icon becomes a braille spinner. Upstream also
		// prints a whole-unit turn timer here; the `turn` segment reports the same
		// clock with finer resolution, so the brand keeps only the activity signal.
		const content =
			ctx.turnElapsedMs != null
				? `${brandSpinnerFrame(ctx.now?.getTime())} `
				: theme.icon.omp
					? `${theme.icon.omp} `
					: "";
		return { content: `${fgAnsi}${content}\x1b[39m`, visible: true };
	},
};
/** Current braille-spinner glyph on the shared clock, at the Loader's 80ms cadence. */
function brandSpinnerFrame(nowMs = Date.now()): string {
	const frames = theme.getSpinnerFrames("activity");
	return frames[Math.floor(nowMs / SPINNER_ADVANCE_MS) % frames.length] ?? "";
}

const statusSegment: StatusLineSegment = {
	id: "status",
	render(ctx) {
		let text = "";
		for (const status of ctx.hookStatuses ?? []) {
			const sanitized = sanitizeStatusText(status);
			if (!sanitized) continue;
			text += text ? `${theme.sep.dot}${sanitized}` : sanitized;
		}
		return {
			content: text ? accentFg(ctx, "accent", text) : "",
			visible: text.length > 0,
		};
	},
};

const modelSegment: StatusLineSegment = {
	id: "model",
	render(ctx) {
		const state = ctx.session.state;
		const opts = ctx.options.model ?? {};

		let modelName = state.model?.name || state.model?.id || "no-model";
		if (modelName.startsWith("Claude ")) {
			modelName = modelName.slice(7);
		}
		modelName = statusValue(ctx, modelName);

		// Resolve the current thinking-level display ("◉ xhigh", "⟳ auto", …)
		// when the model supports thinking and the segment isn't hiding it.
		let thinkingDisplay = "";
		if (opts.showThinkingLevel !== false && state.model?.thinking) {
			if (ctx.session.isAutoThinking) {
				// Pending (no turn classified yet / classifying) shows a symbol-theme
				// question-box marker; once resolved it shows `<level>`.
				const resolved = ctx.session.autoResolvedThinkingLevel();
				thinkingDisplay = resolved
					? (theme.thinking[resolved as keyof typeof theme.thinking] ?? resolved)
					: `${theme.thinking.autoPending} auto`;
			} else {
				const level = state.thinkingLevel ?? ThinkingLevel.Off;
				thinkingDisplay =
					level === ThinkingLevel.Off
						? `${theme.status.disabled} off`
						: (theme.thinking[level as keyof typeof theme.thinking] ?? level);
			}
		}

		if (ctx.startupPlaceholder && thinkingDisplay) {
			thinkingDisplay = withIcon(thinkingGlyph(thinkingDisplay), STARTUP_PLACEHOLDER);
		}

		// Compact mode swaps the model icon for the thinking-level glyph and drops
		// the " · <level>" tail, keeping the level visible as a single icon.
		const compact = ctx.compactThinkingLevel && thinkingDisplay !== "";
		const modelIcon = compact ? thinkingGlyph(thinkingDisplay) : theme.icon.model;

		// Fast-mode icon and thinking-level suffix trail the model name and are
		// colored together with it as `statusLineModel`. The advisor symbol sits
		// between the name and that tail, so it reads as a distinct marker.
		// theme.fg resets only the fg, so the spans are concatenated (not
		// nested) to keep each color intact.
		let tail = "";
		if (ctx.session.isFastModeActive() && theme.icon.fast) {
			tail += ` ${theme.icon.fast}`;
		}
		if (!compact && thinkingDisplay) {
			tail += `${theme.sep.dot}${thinkingDisplay}`;
		}

		// `statusLineModel` is aliased to `accent` in many themes, so the badge
		// uses status colors to stay visibly distinct from the model name color.
		let content = accentFg(ctx, "statusLineModel", withIcon(modelIcon, modelName));
		// Advisor symbol, colored by the worst status in the roster:
		// success = all running, warning = quota-exhausted, error = failed,
		// dim = everything paused/no-model. Per-advisor detail lives in
		// `/advisor status`.
		// Optional chaining: lightweight session doubles (test mocks) that don't
		// implement getAdvisorStatusOverview skip the badge instead of crashing.
		const advisorStats = ctx.session.getAdvisorStatusOverview?.();
		if (advisorStats?.configured && advisorStats.advisors.length > 0) {
			const statuses = advisorStats.advisors.map(a => a.status);
			const badgeColor = statuses.includes("error")
				? "error"
				: statuses.includes("quota_exhausted")
					? "warning"
					: statuses.includes("running")
						? "success"
						: "dim";
			// Closed eye once every advisor has finished reviewing the yielded
			// turn — no more comments until a new primary turn starts.
			const allYielded = advisorStats.advisors.every(a => a.yielded);
			const advisorIcon = allYielded ? theme.icon.advisorClosed || theme.icon.advisor : theme.icon.advisor;
			if (advisorIcon) content += theme.fg(badgeColor, ` ${advisorIcon}`);
		}
		if (tail) {
			content += accentFg(ctx, "statusLineModel", tail);
		}

		return { content, visible: true };
	},
};

function formatGoalBudget(current: number, budget?: number): string {
	const used = formatNumber(current);
	if (budget === undefined) return used;
	return `${used}/${formatNumber(budget)}`;
}

function renderGoalMode(ctx: SegmentContext, mode: { enabled: boolean; paused: boolean }): RenderedSegment {
	const goal = ctx.session.getGoalModeState()?.goal;
	const status = goal?.status ?? (mode.paused ? "paused" : "active");

	let icon: string = theme.icon.goal;
	let color: ThemeColor = "accent";
	switch (status) {
		case "paused":
			icon = theme.icon.pause || theme.symbol("status.pending");
			color = "warning";
			break;
		case "complete":
			icon = theme.symbol("status.success");
			color = "success";
			break;
		case "budget-limited":
			icon = theme.symbol("status.warning");
			color = "warning";
			break;
		case "dropped":
			icon = theme.symbol("status.aborted");
			color = "dim";
			break;
		default:
			break;
	}

	const parts: string[] = [withIcon(icon, "Goal")];
	const showBudget = ctx.session.settings.get("goal.statusInFooter") === true;
	if (showBudget && goal) {
		parts.push(statusValue(ctx, formatGoalBudget(goal.tokensUsed, goal.tokenBudget)));
	}
	return {
		content: color === "accent" ? accentFg(ctx, color, parts.join(" ")) : theme.fg(color, parts.join(" ")),
		visible: true,
	};
}

function formatLoopLimit(
	limit: NonNullable<SegmentContext["loopMode"]>["limit"],
	nowMs = Date.now(),
): string | undefined {
	if (!limit) return undefined;
	if (limit.kind === "iterations") return `${limit.remaining}/${limit.initial}`;

	const totalSeconds = Math.max(0, Math.ceil((limit.deadlineMs - nowMs) / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ""} left`;
	if (minutes > 0) return `${minutes}m${seconds > 0 ? `${seconds}s` : ""} left`;
	return `${seconds}s left`;
}

const modeSegment: StatusLineSegment = {
	id: "mode",
	render(ctx) {
		const pauseSuffix = theme.icon.pause ? ` ${theme.icon.pause}` : " (paused)";

		const plan = ctx.planMode;
		if (plan && (plan.enabled || plan.paused)) {
			const label = plan.paused ? `Plan${pauseSuffix}` : "Plan";
			const content = withIcon(theme.icon.plan, label);
			return {
				content: plan.paused ? theme.fg("warning", content) : accentFg(ctx, "accent", content),
				visible: true,
			};
		}

		const prewalk = ctx.prewalk;
		if (prewalk?.enabled) {
			const content = withIcon(theme.icon.prewalk, "Prewalk");
			return { content: accentFg(ctx, "accent", content), visible: true };
		}

		const goal = ctx.goalMode;
		if (goal && (goal.enabled || goal.paused)) {
			return renderGoalMode(ctx, goal);
		}

		const vibe = ctx.vibeMode;
		if (vibe?.enabled) {
			const content = withIcon(theme.icon.agents, "Vibe");
			return { content: accentFg(ctx, "accent", content), visible: true };
		}

		const loop = ctx.loopMode;
		if (loop) {
			const icon = loop.state === "paused" ? theme.icon.pause || theme.icon.loop : theme.icon.loop;
			const color: ThemeColor = loop.state === "paused" ? "warning" : "customMessageLabel";
			const parts = [withIcon(icon, `Loop ${statusValue(ctx, loop.state)}`)];
			const limit = formatLoopLimit(loop.limit, ctx.now?.getTime());
			if (limit) parts.push(statusValue(ctx, limit));
			return { content: theme.fg(color, parts.join(" ")), visible: true };
		}

		return { content: "", visible: false };
	},
};

const pathSegment: StatusLineSegment = {
	id: "path",
	render(ctx) {
		const opts = ctx.options.path ?? {};
		const stripPrefix = opts.stripWorkPrefix !== false;
		const projectDir = ctx.activeRepo?.cwd ?? getProjectDir();
		const { scratch, relative } = classifyProjectDir(projectDir);
		const scratchIcon = scratch && stripPrefix ? theme.icon.scratchFolder : theme.icon.folder;

		// `lastDir` renders the directory the agent is in and nothing else: a bare
		// `oh-my-pi` where the full tree spent 40 columns on a home directory and a
		// forge host that never change. No ellipsis prefix either - it was 4 more
		// columns saying only that a path was cut. The folder icon already reads as
		// "this is a directory". It short-circuits both decorations below - the
		// worktree label's `project/worktree` and the nested-repo `↳ suffix` -
		// because either one puts a second name on a bar that asked for one, and
		// neither is the directory in question.
		if (opts.lastDir) {
			const leaf = path.basename(getProjectDir());
			const text = ctx.startupPlaceholder ? STARTUP_PLACEHOLDER : fileHyperlink(getProjectDir(), leaf);
			const icon = ctx.worktree && stripPrefix ? theme.icon.worktree : scratchIcon;
			return { content: theme.fg("statusLinePath", withIcon(icon, text)), visible: true };
		}

		// Linked git worktree: the on-disk path nests the worktree base, the
		// project, and a worktree dir that usually duplicates the branch (already
		// shown by the git segment). Collapse to the project name, appending the
		// worktree dir only when it diverges from the branch.
		if (stripPrefix && ctx.worktree) {
			const { projectName, worktreeName } = ctx.worktree;
			const label = ctx.git.branch === worktreeName ? projectName : `${projectName}/${worktreeName}`;
			const text = ctx.startupPlaceholder
				? STARTUP_PLACEHOLDER
				: fileHyperlink(getProjectDir(), clampPathLength(label, opts.maxLength ?? 40));
			const content = withIcon(theme.icon.worktree, text);
			return { content: theme.fg("statusLinePath", content), visible: true };
		}

		let pwd = projectDir;
		if (stripPrefix) {
			if (scratch) {
				if (relative) pwd = relative;
			} else {
				pwd = stripDisplayRoot(pwd);
			}
		}
		const repoSuffix = ctx.activeRepo ? ` ↳ ${ctx.activeRepo.relativeRepoRoot}` : "";
		if (opts.abbreviate !== false) {
			pwd = shortenPath(pwd);
		}
		pwd = clampPathLength(pwd, opts.maxLength ?? 40);

		const text = ctx.startupPlaceholder ? STARTUP_PLACEHOLDER : `${fileHyperlink(projectDir, pwd)}${repoSuffix}`;
		return { content: theme.fg("statusLinePath", withIcon(scratchIcon, text)), visible: true };
	},
};

const gitSegment: StatusLineSegment = {
	id: "git",
	render(ctx) {
		const { branch, status } = ctx.git;
		if (!branch && !status) return { content: "", visible: false };

		const opts = ctx.options.git ?? {};
		const gitStatus = status;
		const isDirty = gitStatus && (gitStatus.staged > 0 || gitStatus.unstaged > 0 || gitStatus.untracked > 0);

		const showBranch = opts.showBranch !== false;
		let content = "";
		if (showBranch && branch) {
			content = withIcon(theme.icon.branch, statusValue(ctx, branch));
		}

		// Add status indicators
		if (gitStatus) {
			const indicators: string[] = [];
			if (opts.showUnstaged !== false && gitStatus.unstaged > 0) {
				indicators.push(theme.fg("statusLineDirty", `*${statusValue(ctx, `${gitStatus.unstaged}`)}`));
			}
			if (opts.showStaged !== false && gitStatus.staged > 0) {
				indicators.push(theme.fg("statusLineStaged", `+${statusValue(ctx, `${gitStatus.staged}`)}`));
			}
			if (opts.showUntracked !== false && gitStatus.untracked > 0) {
				indicators.push(theme.fg("statusLineUntracked", `?${statusValue(ctx, `${gitStatus.untracked}`)}`));
			}
			if (indicators.length > 0) {
				const indicatorText = indicators.join(" ");
				if (!content && showBranch === false) {
					content = withIcon(theme.icon.git, indicatorText);
				} else {
					content += content ? ` ${indicatorText}` : indicatorText;
				}
			}
		}

		if (!content) return { content: "", visible: false };

		const colorName = isDirty ? "statusLineGitDirty" : "statusLineGitClean";
		return { content: theme.fg(colorName, content), visible: true };
	},
};

const prSegment: StatusLineSegment = {
	id: "pr",
	render(ctx) {
		const { pr } = ctx.git;
		if (!pr) return { content: "", visible: false };

		const label = withIcon(theme.icon.pr, `#${statusValue(ctx, `${pr.number}`)}`);
		const content =
			!ctx.startupPlaceholder && TERMINAL.hyperlinks ? `\x1b]8;;${pr.url}\x07${label}\x1b]8;;\x07` : label;
		return { content: accentFg(ctx, "accent", content), visible: true };
	},
};

const subagentsSegment: StatusLineSegment = {
	id: "subagents",
	render(ctx) {
		if (ctx.subagentCount === 0) {
			return { content: "", visible: false };
		}
		const content = withIcon(theme.icon.agents, statusValue(ctx, `${ctx.subagentCount}`));
		return { content: theme.fg("statusLineSubagents", content), visible: true };
	},
};

const tokenInSegment: StatusLineSegment = {
	id: "token_in",
	render(ctx) {
		const { input } = ctx.usageStats;
		if (!input) return { content: "", visible: false };

		const content = withIcon(theme.icon.input, statusValue(ctx, formatNumber(input)));
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const tokenOutSegment: StatusLineSegment = {
	id: "token_out",
	render(ctx) {
		const { output } = ctx.usageStats;
		if (!output) return { content: "", visible: false };

		const content = withIcon(theme.icon.output, statusValue(ctx, formatNumber(output)));
		return { content: theme.fg("statusLineOutput", content), visible: true };
	},
};

const tokenTotalSegment: StatusLineSegment = {
	id: "token_total",
	render(ctx) {
		// Excludes cacheRead: that field re-reads the full cached context every
		// turn, making the cumulative sum N×context_size. Orchestration cache read
		// follows the same rule; orchestration input/output remain in the total so
		// provider-side service work is preserved without labeling it prompt input.
		const { input, output, cacheWrite, orchestrationInput, orchestrationOutput } = ctx.usageStats;
		const total = input + output + cacheWrite + orchestrationInput + orchestrationOutput;
		if (!total) return { content: "", visible: false };

		const content = withIcon(theme.icon.tokens, statusValue(ctx, formatNumber(total)));
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const tokenRateSegment: StatusLineSegment = {
	id: "token_rate",
	render(ctx) {
		const { tokensPerSecond } = ctx.usageStats;
		if (!tokensPerSecond) return { content: "", visible: false };

		const content = withIcon(theme.icon.throughput, `${statusValue(ctx, tokensPerSecond.toFixed(1))} tok/s`);
		return { content: theme.fg("statusLineOutput", content), visible: true };
	},
};

const costSegment: StatusLineSegment = {
	id: "cost",
	render(ctx) {
		const { cost, premiumRequests } = ctx.usageStats;
		const advisorCost = ctx.session.getAdvisorCost?.() ?? 0;
		const normalizedPremiumRequests = normalizePremiumRequests(premiumRequests);
		const state = ctx.session.state;
		const usingSubscription = state.model ? (ctx.session.modelRegistry?.isUsingOAuth(state.model) ?? false) : false;

		if (!cost && !advisorCost && !usingSubscription && !normalizedPremiumRequests) {
			return { content: "", visible: false };
		}

		const billingParts: string[] = [];
		if (cost) {
			billingParts.push(
				ctx.startupPlaceholder
					? formatSpendPlaceholder(usingSubscription, theme)
					: formatSpend(cost, usingSubscription, theme),
			);
		} else if (usingSubscription) {
			billingParts.push(
				theme.getSymbolPreset() === "nerd" && theme.icon.subscription ? theme.icon.subscription : "(sub)",
			);
		}
		if (normalizedPremiumRequests) {
			billingParts.push(`★ ${statusValue(ctx, formatNumber(normalizedPremiumRequests))}`);
		}
		if (advisorCost) {
			const prefix = billingParts.length ? "+ " : "";
			// Resolve the advisor subscription flag lazily: with no active advisor
			// it walks the whole model catalog (getAvailable → hasAuth per provider
			// → credential-file reads), and the status line re-renders at the
			// working-spinner cadence, so an eager per-frame probe pinned CPU (#10129).
			const advisorUsingSubscription = ctx.session.isAdvisorUsingSubscription?.() ?? false;
			const spend = ctx.startupPlaceholder
				? formatAdvisorSpendPlaceholder(advisorUsingSubscription, theme)
				: formatAdvisorSpend(advisorCost, advisorUsingSubscription, theme);
			billingParts.push(`${prefix}${spend}`);
		}
		if (billingParts.length === 0) return { content: "", visible: false };

		return { content: theme.fg("statusLineCost", billingParts.join(" ")), visible: true };
	},
};

const contextPctSegment: StatusLineSegment = {
	id: "context_pct",
	render(ctx) {
		const pct = ctx.contextPercent;
		const window = ctx.contextWindow;

		const color = getContextUsageThemeColor(getContextUsageLevel(pct ?? 0, window));
		// Async-compaction indicator: pulse the auto icon while a background
		// speculation runs, hold it in accent once a result is armed.
		let autoIcon = "";
		if (ctx.autoCompactEnabled && theme.icon.auto) {
			const speculation = ctx.compactionSpeculation;
			const accentIcon = accentFg(ctx, "accent", theme.icon.auto);
			autoIcon = ` ${
				speculation === "running"
					? ctx.speculationBlinkOn
						? accentIcon
						: theme.fg("muted", theme.icon.auto)
					: speculation === "armed"
						? accentIcon
						: theme.fg(color, theme.icon.auto)
			}`;
		}
		const text = theme.fg(
			color,
			ctx.startupPlaceholder ? STARTUP_PLACEHOLDER : formatContextUsage(pct, window, ctx.contextTokens),
		);
		const content = withIcon(theme.icon.context, `${text}${autoIcon}`);

		return { content, visible: true };
	},
};

const contextTotalSegment: StatusLineSegment = {
	id: "context_total",
	render(ctx) {
		const window = ctx.contextWindow;
		if (!window) return { content: "", visible: false };
		return {
			content: theme.fg("statusLineContext", withIcon(theme.icon.context, statusValue(ctx, formatNumber(window)))),
			visible: true,
		};
	},
};

/**
 * Total time the agent was actively processing this session — the union of
 * every `agent_start`→`agent_end` window plus the currently-running window,
 * sourced from {@link SegmentContext.activeMs}. Idle wall-clock between turns
 * never accumulates, so the displayed total reflects how long the agent has
 * been working for the user, not how long the session has been open. Hidden
 * before the first second of activity to avoid flashing a clock at session
 * start.
 */
const timeSpentSegment: StatusLineSegment = {
	id: "time_spent",
	render(ctx) {
		if (ctx.activeMs < 1000) return { content: "", visible: false };
		return { content: withIcon(theme.icon.time, statusValue(ctx, formatClock(ctx.activeMs))), visible: true };
	},
};

/**
 * The session's three time facts in one cell: `0m05s · 3m20s · 17:23:47` reads
 * as this turn, all turns, and when the last one ended. The first field is the
 * running turn while the agent works and that turn's duration once it settles,
 * the second is cumulative active time ({@link SegmentContext.activeMs}, the
 * union of every agent window), and the third is the wall clock at the last
 * turn's close.
 *
 * One cell rather than three segments: each field is a few characters, so two
 * section separators and their padding cost more than any of the values. Fields
 * missing on a fresh session (no closed turn, under a second of activity) are
 * left out rather than padded with zeros, and the cell hides entirely until one
 * of them exists.
 *
 * The third field never re-reads the clock. It is a record of a past instant
 * stamped at turn close, so a repaint from any other source (keystroke, git
 * resolve, usage refresh) cannot overwrite it.
 */
const turnSegment: StatusLineSegment = {
	id: "turn",
	render(ctx) {
		const running = ctx.turnElapsedMs != null;
		const duration = ctx.turnElapsedMs ?? ctx.lastTurnMs;

		const fields: string[] = [];
		if (duration != null) fields.push(formatShortDuration(duration));
		if (ctx.activeMs >= 1000) fields.push(formatShortDuration(ctx.activeMs));
		if (ctx.lastTurnEndedAt != null) fields.push(formatWallClock(new Date(ctx.lastTurnEndedAt)));
		if (fields.length === 0) return { content: "", visible: false };

		// A different icon once the turn settles: the numbers alone cannot say
		// whether the first field is still counting, and the brand spinner is a
		// segment away.
		const icon = running ? theme.icon.time : theme.icon.rewind;
		return { content: withIcon(icon, statusValue(ctx, fields.join(" · "))), visible: true };
	},
};

/**
 * `time_spent` reads as a clock: zero-padded `hh:mm`, never seconds. Seconds
 * churned the field on every spinner repaint and changed its width as a turn
 * crossed each unit boundary, which shifted every segment beside it. The floor
 * is `00:00` for the first minute; the hour field grows past 99h rather than
 * wrapping.
 */
function formatClock(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	const hours = Math.floor(minutes / 60);
	return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * `XmYYs` for the merged `turn` cell, where minutes are unpadded and grow past
 * 60 rather than carrying an hour field. Seconds are zero-padded so the cell's
 * width only changes when the minute count gains a digit.
 */
function formatShortDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

/** `hh:mm:ss` for a recorded instant; every field zero-padded so width is fixed. */
function formatWallClock(at: Date): string {
	return [at.getHours(), at.getMinutes(), at.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
}

const timeSegment: StatusLineSegment = {
	id: "time",
	render(ctx) {
		const opts = ctx.options.time ?? {};
		const now = ctx.now ?? new Date();
		const twelveHour = opts.format === "12h";

		let hours = now.getHours();
		let suffix = "";
		if (twelveHour) {
			suffix = hours >= 12 ? "pm" : "am";
			hours = hours % 12 || 12;
		}

		// The 24h clock pads the hour only under `showDate`, where the segment reads
		// as a log stamp and a one-digit hour would shift the whole field's width.
		const hourText = twelveHour || !opts.showDate ? String(hours) : String(hours).padStart(2, "0");
		const parts = [hourText, now.getMinutes().toString().padStart(2, "0")];
		if (opts.showSeconds) parts.push(now.getSeconds().toString().padStart(2, "0"));

		let stamp = parts.join(":") + suffix;
		if (opts.showDate) {
			const month = (now.getMonth() + 1).toString().padStart(2, "0");
			const day = now.getDate().toString().padStart(2, "0");
			stamp = `${now.getFullYear()}-${month}-${day} ${stamp}`;
		}

		return { content: withIcon(theme.icon.time, statusValue(ctx, stamp)), visible: true };
	},
};

const sessionSegment: StatusLineSegment = {
	id: "session",
	render(ctx) {
		const sessionManager = ctx.session.sessionManager;
		const sessionId = sessionManager?.getSessionId?.();
		const display = statusValue(ctx, sessionId?.slice(0, 8) || "new");

		return { content: withIcon(theme.icon.session, display), visible: true };
	},
};

const hostnameSegment: StatusLineSegment = {
	id: "hostname",
	render(ctx) {
		const name = statusValue(ctx, ctx.hostname ?? os.hostname().split(".")[0]);
		const content = withIcon(theme.icon.host, name);
		const ansi = sessionAccentAnsi(ctx);
		return { content: ansi ? `${ansi}${content}\x1b[39m` : content, visible: true };
	},
};

/** Names the `--profile` / `OMP_PROFILE` config root in use; hidden on the default one. */
const profileSegment: StatusLineSegment = {
	id: "profile",
	render() {
		const profile = getActiveProfile();
		if (!profile) return { content: "", visible: false };

		// icon.package, not icon.subscription: the cost segment already renders the
		// subscription glyph, and two identical glyphs in one bar read as one segment.
		return { content: withIcon(theme.icon.package, profile), visible: true };
	},
};

/** Case-insensitive lookup of a configured client tag for one identity key. */
function accountTag(tags: Record<string, string> | undefined, key: string | undefined): string | undefined {
	if (!tags || !key) return undefined;
	const wanted = key.toLowerCase();
	for (const [candidate, tag] of Object.entries(tags)) {
		if (candidate.toLowerCase() === wanted) return tag;
	}
	return undefined;
}

/**
 * Resolves the client paying for this session from the session-sticky
 * credential. A provider holding several OAuth logins (three on `anthropic`,
 * two on `openai-codex`) identifies the client by that credential's email, so
 * the answer follows a mid-session rotation or a `/login` pin. A person-suffixed
 * API-key clone carries no credential identity and names its client in the
 * provider id instead, which is why the provider id is the last key tried.
 *
 * `segmentOptions.account.tags` supplies the short client label, keyed by
 * credential email, account id, or provider id. It is configuration rather than
 * derivation: the three anthropic emails differ only in their domain, and a
 * provider id prefix is only a client when the tag map says so.
 */
function sessionClient(ctx: SegmentContext, provider: string): string | undefined {
	const authStorage = ctx.session.modelRegistry?.authStorage;
	const identity = authStorage?.getOAuthAccountIdentity(provider, ctx.session.sessionId);
	const tags = ctx.options.account?.tags;
	return (
		accountTag(tags, identity?.email) ??
		accountTag(tags, identity?.accountId) ??
		accountTag(tags, provider) ??
		identity?.email ??
		identity?.accountId ??
		identity?.orgName ??
		identity?.projectId
	);
}

/**
 * Names the client paying for this session and the endpoint serving it in one
 * cell, `mk · anthropic`. A clone's provider id opens with its own client tag,
 * which the same cell already renders, so the prefix is stripped: `nr-alibaba`
 * beside client `nr` reads `nr · alibaba`. Two facts in one cell rather than two
 * segments: they are always read together, and a section separator plus its
 * padding between them cost as much as the shorter of the two values.
 */
const clientSegment: StatusLineSegment = {
	id: "client",
	render(ctx) {
		const provider = ctx.session?.model?.provider;
		if (!provider) return { content: "", visible: false };

		const client = sessionClient(ctx, provider);
		const prefix = client ? `${client.toLowerCase()}-` : "";
		const endpoint = prefix && provider.toLowerCase().startsWith(prefix) ? provider.slice(prefix.length) : provider;

		// Emails, org names and provider ids come from the provider, so they are
		// sanitized like any other foreign text before they reach the bar.
		const parts = client ? [client, endpoint] : [endpoint];
		const display = ctx.startupPlaceholder
			? STARTUP_PLACEHOLDER
			: parts.map(value => truncateToWidth(sanitizeStatusText(value), TRUNCATE_LENGTHS.SHORT)).join(" · ");
		return { content: withIcon(theme.icon.account, display), visible: true };
	},
};

const cacheReadSegment: StatusLineSegment = {
	id: "cache_read",
	render(ctx) {
		const { cacheRead } = ctx.usageStats;
		if (!cacheRead) return { content: "", visible: false };

		const parts = [theme.icon.cache, statusValue(ctx, formatNumber(cacheRead))].filter(Boolean);
		const content = parts.join(" ");
		return { content: theme.fg("statusLineSpend", content), visible: true };
	},
};

const cacheWriteSegment: StatusLineSegment = {
	id: "cache_write",
	render(ctx) {
		const { cacheWrite } = ctx.usageStats;
		if (!cacheWrite) return { content: "", visible: false };

		const parts = [theme.icon.cache, statusValue(ctx, formatNumber(cacheWrite))].filter(Boolean);
		const content = parts.join(" ");
		return { content: theme.fg("statusLineOutput", content), visible: true };
	},
};

const cacheHitSegment: StatusLineSegment = {
	id: "cache_hit",
	render(ctx) {
		const { cacheRead, cacheWrite, input } = ctx.usageStats;
		if (!cacheRead) return { content: "", visible: false };

		// Hit rate = cacheRead / total prompt tokens. The prompt is the sum of
		// cacheRead (served from cache), cacheWrite (newly cached this turn) and
		// input (uncached). Including uncached input keeps the denominator honest
		// for Anthropic/OpenRouter; DeepSeek reports its miss as input with
		// cacheWrite 0, so this still yields hit/(hit+miss).
		const total = cacheRead + cacheWrite + input;

		const rate = (cacheRead / total) * 100;
		const rateStr = statusValue(ctx, rate.toFixed(2));

		const parts: string[] = [theme.icon.cache];
		parts.push(theme.fg("statusLineSpend", `${rateStr}%`));
		return { content: parts.join(" "), visible: true };
	},
};

const sessionNameSegment: StatusLineSegment = {
	id: "session_name",
	render(ctx) {
		const sessionManager = ctx.session.sessionManager;
		const name = sessionManager?.getSessionName() || ctx.previewTitle;
		if (!name) return { content: "", visible: false };

		const content = ctx.startupPlaceholder ? STARTUP_PLACEHOLDER : sanitizeStatusText(name);
		return { content: accentFg(ctx, "accent", content), visible: true };
	},
};

const collabSegment: StatusLineSegment = {
	id: "collab",
	render(ctx) {
		if (!ctx.collab) return { content: "", visible: false };
		const participants = statusValue(ctx, `${ctx.collab.participantCount}`);
		const label = ctx.collab.role === "host" ? `⇄ collab:${participants}` : `⇄ collab guest:${participants}`;
		return { content: accentFg(ctx, "accent", label), visible: true };
	},
};

function pickUsageColor(percent: number): "muted" | "warning" | "error" {
	if (percent >= 80) return "error";
	if (percent >= 50) return "warning";
	return "muted";
}

function formatUsageReset(value: number, unit: "m" | "h"): string {
	if (unit === "m") {
		// Short-window reset timers retain minute precision.
		if (value < 60) return `${value}m`;
		const hours = Math.floor(value / 60);
		const mins = value % 60;
		return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
	}
	// total hours (7d window: max 168)
	if (value < 24) return `${value}h`;
	const days = Math.floor(value / 24);
	const hours = value % 24;
	return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

const usageSegment: StatusLineSegment = {
	id: "usage",
	render(ctx) {
		const u = ctx.usage;
		if (!u || (!u.fiveHour && !u.daily && !u.sevenDay && !u.monthly)) {
			return { content: "", visible: false };
		}
		const parts: string[] = [];
		if (u.tier) {
			const tier = ctx.startupPlaceholder
				? STARTUP_PLACEHOLDER
				: truncateToWidth(sanitizeStatusText(u.tier), TRUNCATE_LENGTHS.SHORT);
			if (tier) parts.push(accentFg(ctx, "accent", tier));
		}
		if (u.fiveHour) {
			const pct = u.fiveHour.percent;
			const pctText = theme.fg(pickUsageColor(pct), `${statusValue(ctx, `${Math.round(pct)}`)}%`);
			const reset =
				u.fiveHour.resetMinutes !== undefined
					? theme.fg(
							"muted",
							ctx.startupPlaceholder ? " (…)" : ` (${formatUsageReset(u.fiveHour.resetMinutes, "m")})`,
						)
					: "";
			parts.push(`5h ${pctText}${reset}`);
		}
		if (u.daily) {
			const pct = u.daily.percent;
			const pctText = theme.fg(pickUsageColor(pct), `${statusValue(ctx, `${Math.round(pct)}`)}%`);
			const reset =
				u.daily.resetMinutes !== undefined
					? theme.fg(
							"muted",
							ctx.startupPlaceholder ? " (…)" : ` (${formatUsageReset(u.daily.resetMinutes, "m")})`,
						)
					: "";
			parts.push(`1d ${pctText}${reset}`);
		}
		if (u.sevenDay) {
			const pct = u.sevenDay.percent;
			const pctText = theme.fg(pickUsageColor(pct), `${statusValue(ctx, `${Math.round(pct)}`)}%`);
			const reset =
				u.sevenDay.resetHours !== undefined
					? theme.fg(
							"muted",
							ctx.startupPlaceholder ? " (…)" : ` (${formatUsageReset(u.sevenDay.resetHours, "h")})`,
						)
					: "";
			parts.push(`7d ${pctText}${reset}`);
		}
		if (u.monthly) {
			const pct = u.monthly.percent;
			// Cursor and OpenCode Go (normalize gates monthly to those providers).
			// Both floor used percents upstream (Cursor's dashboard shows 1.88 →
			// "1% used"; OpenCode's endpoint already emits floored integers).
			const pctText = theme.fg(pickUsageColor(pct), `${statusValue(ctx, `${Math.floor(pct)}`)}%`);
			const reset =
				u.monthly.resetHours !== undefined
					? theme.fg(
							"muted",
							ctx.startupPlaceholder ? " (…)" : ` (${formatUsageReset(u.monthly.resetHours, "h")})`,
						)
					: "";
			parts.push(`mo ${pctText}${reset}`);
		}
		const content = withIcon(theme.icon.time, parts.join(theme.sep.dot));
		return { content, visible: true };
	},
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment Registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
	pi: piSegment,
	status: statusSegment,
	model: modelSegment,
	mode: modeSegment,
	path: pathSegment,
	git: gitSegment,
	pr: prSegment,
	subagents: subagentsSegment,
	token_in: tokenInSegment,
	token_out: tokenOutSegment,
	token_total: tokenTotalSegment,
	token_rate: tokenRateSegment,
	cost: costSegment,
	context_pct: contextPctSegment,
	context_total: contextTotalSegment,
	time_spent: timeSpentSegment,
	turn: turnSegment,
	time: timeSegment,
	session: sessionSegment,
	hostname: hostnameSegment,
	profile: profileSegment,
	client: clientSegment,
	cache_read: cacheReadSegment,
	cache_write: cacheWriteSegment,
	cache_hit: cacheHitSegment,
	session_name: sessionNameSegment,
	usage: usageSegment,
	collab: collabSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
	const segment = SEGMENTS[id];
	if (!segment) {
		return { content: "", visible: false };
	}
	return segment.render(ctx);
}

export const ALL_SEGMENT_IDS: StatusLineSegmentId[] = Object.keys(SEGMENTS) as StatusLineSegmentId[];
