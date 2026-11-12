import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthStepUpBoundary, stepUpFetch } from "../AuthStepUpBoundary";

function App() {
	const [status, setStatus] = useState("idle");
	return (
		<AuthStepUpBoundary>
			<button
				id="challenge"
				onClick={async () => {
					const response = await stepUpFetch("/api/v1/command", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							commandName: "core.abort",
							input: {},
							idempotencyKey: "fixture-1",
							requestId: "fixture-request-1",
						}),
					});
					setStatus(String(response.status));
				}}
			>
				Fire protected action
			</button>
			<div id="status">{status}</div>
		</AuthStepUpBoundary>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
