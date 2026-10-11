/**
 * Ui copy. Keys are slugs (`ui.<name>`); the English string is the
 * source of truth and `zh-CN` overrides it.
 */
export const ui = {
	en: {
		// ── table / states ──────────────────────────────────────────────────
		"ui.table-shown-of": "{shown} of {total}",
		"ui.show-fewer": "Show fewer",
		"ui.retry": "Retry",
		"ui.delta-new": "new",
		"ui.json": "JSON",
		// ── request drawer ──────────────────────────────────────────────────
		"ui.trace": "Trace",
		"ui.open-trace": "Open this request's session in the trace view",
		"ui.status-ok": "OK",
		"ui.section-timing": "Timing",
		"ui.time-to-first-token": "Time to first token",
		"ui.uncached-input": "Uncached input",
		"ui.section-cost": "API-equivalent cost",
		"ui.section-identity": "Identity",
		"ui.stop-reason": "Stop reason",
		"ui.api": "API",
		"ui.session-file": "Session file",
		"ui.stats-row": "Stats row",
	},
	"zh-CN": {
		"ui.table-shown-of": "已显示 {shown} / 共 {total}",
		"ui.show-fewer": "收起",
		"ui.retry": "重试",
		"ui.delta-new": "新增",
		"ui.json": "JSON 数据",
		"ui.trace": "调用链",
		"ui.open-trace": "在调用链视图中打开该请求的会话",
		"ui.status-ok": "正常",
		"ui.section-timing": "时间",
		"ui.time-to-first-token": "首 Token 延迟",
		"ui.uncached-input": "未缓存输入",
		"ui.section-cost": "API 等价费用",
		"ui.section-identity": "标识",
		"ui.stop-reason": "停止原因",
		"ui.api": "接口",
		"ui.session-file": "会话文件",
		"ui.stats-row": "统计行",
	},
} as const;
