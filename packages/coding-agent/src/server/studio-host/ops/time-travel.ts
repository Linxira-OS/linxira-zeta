import type { StudioFamily } from "../registry.js";
import { invalid, requiredString } from "../gateway.js";
import { studioTimeTravelService } from "../services/time-travel-boundary.js";
import {
	readTimeTravelTimeline,
	restoreTimeTravel,
	timeTravelAccess,
	timeTravelView,
} from "../services/time-travel-runtime.js";

export const timeTravelOps: StudioFamily = {
	id: "timeTravel",
	queries: {
		"timeTravel.settings.get": async (_input, context) => {
			const assert = timeTravelView(context),
				result = await studioTimeTravelService().settings();
			assert();
			return result;
		},
		"timeTravel.storage.get": async (_input, context) => {
			const assert = timeTravelView(context),
				result = await studioTimeTravelService().storage();
			assert();
			return result;
		},
		"timeTravel.timeline.read": async (input, context) => {
			requiredString(input, "sessionId");
			if (input.branchLeafId !== undefined) requiredString(input, "branchLeafId");
			return readTimeTravelTimeline(input, context);
		},
		"timeTravel.restore.preview": async (input, context) => {
			const access = await timeTravelAccess(requiredString(input, "sessionId"), context);
			const result = await studioTimeTravelService().preview(
				access.workspace,
				input.sessionId,
				requiredString(input, "snapshotId"),
			);
			access.assert();
			return result;
		},
	},
	commands: {
		"timeTravel.settings.set": async (input, context) =>
			studioTimeTravelService().updateSettings(input, timeTravelView(context)),
		"timeTravel.cleanup": async (input, context) => {
			if (input.scope !== "all" && input.scope !== "expired") throw invalid("Invalid cleanup scope");
			return studioTimeTravelService().cleanup(input.scope, timeTravelView(context));
		},
		"timeTravel.restore": async (input, context) => {
			requiredString(input, "sessionId");
			return restoreTimeTravel(input, context);
		},
	},
};
