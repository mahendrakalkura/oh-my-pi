import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { HistoryStorage } from "@oh-my-pi/pi-coding-agent/session/history-storage";
import { TempDir } from "@oh-my-pi/pi-utils";

let tempDir: TempDir | null = null;

async function freshStorage(prefix = "omp-history-scoped-"): Promise<{ storage: HistoryStorage; dbPath: string }> {
	tempDir = TempDir.createSync(`@${prefix}`);
	const dbPath = tempDir.join("history.db");
	HistoryStorage.close();
	return { storage: HistoryStorage.open(dbPath), dbPath };
}

/** Drain the insert batch window, then await the pending writes. */
async function flush(...writes: Promise<void>[]): Promise<void> {
	vi.advanceTimersByTime(100);
	await Promise.all(writes);
}

beforeEach(() => {
	HistoryStorage.close();
	vi.useFakeTimers();
});

afterEach(async () => {
	HistoryStorage.close();
	vi.useRealTimers();
	if (tempDir) {
		await tempDir.remove().catch(() => {});
		tempDir = null;
	}
});

describe("HistoryStorage scoped recall", () => {
	it("offers the active session's prompts ahead of the project's", async () => {
		const { storage } = await freshStorage();
		await flush(
			storage.add("prompt from an earlier session", "/repo", "session-old"),
			storage.add("prompt from this session", "/repo", "session-now"),
			storage.add("prompt in another project", "/elsewhere", "session-old"),
		);
		storage.setSessionResolver(() => "session-now");

		expect(storage.getScoped(10, "/repo").map(entry => entry.prompt)).toEqual([
			"prompt from this session",
			"prompt from an earlier session",
		]);
	});

	it("keeps the project's history when the session persisted only one prompt", async () => {
		const { storage } = await freshStorage();
		await flush(
			storage.add("earlier project prompt", "/repo", "session-old"),
			storage.add("only prompt this session kept", "/repo", "session-now"),
		);
		storage.setSessionResolver(() => "session-now");

		expect(storage.getScoped(10, "/repo").map(entry => entry.prompt)).toEqual([
			"only prompt this session kept",
			"earlier project prompt",
		]);
	});

	it("offers the project's prompts when the active session has none yet", async () => {
		const { storage } = await freshStorage();
		await flush(
			storage.add("prompt in this project", "/repo", "session-old"),
			storage.add("prompt in another project", "/elsewhere", "session-old"),
		);
		storage.setSessionResolver(() => "session-fresh");

		expect(storage.getScoped(10, "/repo").map(entry => entry.prompt)).toEqual(["prompt in this project"]);
	});

	it("offers the project's prompts when no session is resolvable", async () => {
		const { storage } = await freshStorage();
		await flush(storage.add("prompt in this project", "/repo", "session-old"));

		expect(storage.getScoped(10, "/repo").map(entry => entry.prompt)).toEqual(["prompt in this project"]);
	});

	it("returns nothing rather than the global list when neither scope matches", async () => {
		const { storage } = await freshStorage();
		await flush(storage.add("prompt in another project", "/elsewhere", "session-old"));
		storage.setSessionResolver(() => "session-fresh");

		expect(storage.getScoped(10, "/repo")).toEqual([]);
		expect(storage.getScoped(10)).toEqual([]);
		// The unscoped list still sees the prompt, so Ctrl+R search stays global.
		expect(storage.getRecent(10)).toHaveLength(1);
	});

	it("orders each scope newest first and honours the limit", async () => {
		const { storage } = await freshStorage();
		await flush(storage.add("older session prompt", "/repo", "session-now"));
		vi.advanceTimersByTime(2000);
		await flush(storage.add("newer session prompt", "/repo", "session-now"));
		storage.setSessionResolver(() => "session-now");

		expect(storage.getScoped(10, "/repo").map(entry => entry.prompt)).toEqual([
			"newer session prompt",
			"older session prompt",
		]);
		expect(storage.getScoped(1, "/repo").map(entry => entry.prompt)).toEqual(["newer session prompt"]);

		storage.setSessionResolver(() => "session-fresh");
		expect(storage.getScoped(1, "/repo").map(entry => entry.prompt)).toEqual(["newer session prompt"]);
	});
});
