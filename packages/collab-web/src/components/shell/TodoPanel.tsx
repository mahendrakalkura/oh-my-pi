import type { TodoPhase } from "@oh-my-pi/pi-wire";
import type { ReactNode } from "react";
import { Board } from "../../tool-render/tools/todo";

export interface TodoPanelProps {
	phases: readonly TodoPhase[];
}

function openCount(phases: readonly TodoPhase[]): number {
	let open = 0;
	for (const phase of phases) {
		for (const task of phase.tasks) {
			if (task.status !== "abandoned" && task.status !== "completed") open++;
		}
	}
	return open;
}

/** Live todo board mirrored from the host's canonical todo snapshots. */
export function TodoPanel({ phases }: TodoPanelProps): ReactNode {
	const total = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
	if (total === 0) return null;
	const open = openCount(phases);

	return (
		<details className="sh-todo" open>
			<summary className="sh-todo-summary">
				todos - {total - open}/{total} done
			</summary>
			<div className="sh-todo-body">
				<Board phases={phases} />
			</div>
		</details>
	);
}
