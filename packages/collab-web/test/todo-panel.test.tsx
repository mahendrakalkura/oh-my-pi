import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TodoPanel } from "../src/components/shell/TodoPanel";

describe("TodoPanel", () => {
	it("renders the live completion count and blocked reason", () => {
		const html = renderToStaticMarkup(
			<TodoPanel
				phases={[
					{
						name: "Delivery",
						tasks: [
							{ content: "Ship", status: "completed" },
							{ blocker: "waiting for approval", content: "Deploy", status: "blocked" },
						],
					},
				]}
			/>,
		);

		expect(html).toContain("todos - 1/2 done");
		expect(html).toContain("waiting for approval");
		expect(html).toContain("tv-task--blocked");
	});
});
