import { textArgumentRenderer } from "./resolve";

/** Command name for automatic tool issue reports. */
export const REPORT_ISSUE_COMMAND_NAME = "report_issue";

/** `xd://` device name for automatic tool issue reports. */
export const REPORT_ISSUE_DEVICE_NAME = "report_issue";

/** Full `xd://` path for the report device. */
export const REPORT_ISSUE_DEVICE_PATH = `xd://${REPORT_ISSUE_DEVICE_NAME}`;

/** Renders `report_issue` calls: the `<tool>: <description>` report, then the acknowledgement. */
export const reportIssueRenderer = textArgumentRenderer("Report Tool Issue", "report");
