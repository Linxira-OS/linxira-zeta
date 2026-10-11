/**
 * Costs copy. Keys are slugs (`costs.<name>`); the English string is the
 * source of truth and `zh-CN` overrides it.
 */
export const costs = {
	en: {
		// ── page header / empty state ───────────────────────────────────────
		"costs.title": "Costs",
		"costs.description":
			"What {window} of usage would cost at public API rates. Subscription usage without a public price is counted as unpriced, not free.",
		"costs.no-usage-in-range": "No usage in this range",
		"costs.empty-hint": "Pick a wider range in the top bar.",
		// ── daily estimate card ─────────────────────────────────────────────
		"costs.daily-estimate": "Daily estimate",
		"costs.daily-by-model": "Per UTC day, stacked by model",
		"costs.daily-by-component": "Per UTC day, stacked by billing component",
		"costs.split-by": "Split by",
		"costs.by-model": "By model",
		"costs.by-component": "By component",
		"costs.no-priced-usage": "No priced usage in this range",
		"costs.unpriced-requests": "Unpriced requests",
		// ── component breakdown card ────────────────────────────────────────
		"costs.where-it-went": "Where it went",
		"costs.estimate-by-component": "Estimate by billing component",
		"costs.unpriced-note-one": "{count} unpriced subscription request is not included.",
		"costs.unpriced-note-n": "{count} unpriced subscription requests are not included.",
		// ── by model card + table ───────────────────────────────────────────
		"costs.by-model-description": "Estimate per model with its input, output and cache split",
		"costs.estimate": "Estimate",
		"costs.estimate-title": "API-equivalent estimate at public rates",
		"costs.split": "Split",
		"costs.split-title": "Input · output · cache read · cache write",
		"costs.per-request": "Per request",
		"costs.per-request-title": "Estimate ÷ priced requests",
		"costs.unpriced": "Unpriced",
		"costs.unpriced-column-title": "Requests with no public-equivalent price",
		// ── summary stats ───────────────────────────────────────────────────
		"costs.api-equivalent-estimate": "API-equivalent estimate",
		"costs.api-estimate-title": "What this usage would cost at public API rates",
		"costs.requests-n": "{count} requests",
		"costs.average-per-day": "Average per day",
		"costs.average-per-day-title": "Estimate ÷ days with any usage",
		"costs.active-days-one": "over {count} active day",
		"costs.active-days-n": "over {count} active days",
		"costs.top-model": "Top model",
		"costs.top-model-hint": "{cost} · {share} of estimate",
		"costs.nothing-priced-yet": "Nothing priced yet",
		"costs.per-priced-request": "Per priced request",
		"costs.per-priced-request-title": "Estimate ÷ requests that have a public price",
		"costs.priced-n": "{count} priced",
		"costs.unpriced-title": "Subscription usage with no public-equivalent price; excluded from the estimate",
		"costs.unpriced-hint": "excluded from the estimate",
		"costs.all-priced": "all usage priced",
	},
	"zh-CN": {
		// ── page header / empty state ───────────────────────────────────────
		"costs.title": "费用",
		"costs.description":
			"按公开 API 费率计算，{window}的用量需要多少费用。没有公开价格的订阅用量计为未定价，而不是免费。",
		"costs.no-usage-in-range": "此时间范围内没有用量",
		"costs.empty-hint": "请在顶栏选择更宽的时间范围。",
		// ── daily estimate card ─────────────────────────────────────────────
		"costs.daily-estimate": "每日估算",
		"costs.daily-by-model": "按 UTC 日统计，按模型堆叠",
		"costs.daily-by-component": "按 UTC 日统计，按计费组件堆叠",
		"costs.split-by": "拆分依据",
		"costs.by-model": "按模型",
		"costs.by-component": "按组件",
		"costs.no-priced-usage": "此时间范围内没有已定价的用量",
		"costs.unpriced-requests": "未定价请求",
		// ── component breakdown card ────────────────────────────────────────
		"costs.where-it-went": "费用去向",
		"costs.estimate-by-component": "按计费组件估算",
		"costs.unpriced-note-one": "{count} 个未定价的订阅请求未计入。",
		"costs.unpriced-note-n": "{count} 个未定价的订阅请求未计入。",
		// ── by model card + table ───────────────────────────────────────────
		"costs.by-model-description": "按模型估算，并附输入、输出与缓存的拆分",
		"costs.estimate": "估算",
		"costs.estimate-title": "按公开费率计算的 API 等效估算",
		"costs.split": "拆分",
		"costs.split-title": "输入 · 输出 · 缓存读取 · 缓存写入",
		"costs.per-request": "单次请求",
		"costs.per-request-title": "估算值 ÷ 已定价请求数",
		"costs.unpriced": "未定价",
		"costs.unpriced-column-title": "没有公开等效价格的请求",
		// ── summary stats ───────────────────────────────────────────────────
		"costs.api-equivalent-estimate": "API 等效估算",
		"costs.api-estimate-title": "此用量按公开 API 费率计算需要多少费用",
		"costs.requests-n": "{count} 个请求",
		"costs.average-per-day": "日均",
		"costs.average-per-day-title": "估算值 ÷ 有用量的天数",
		"costs.active-days-one": "共 {count} 个活跃日",
		"costs.active-days-n": "共 {count} 个活跃日",
		"costs.top-model": "费用最高的模型",
		"costs.top-model-hint": "{cost} · 占估算值的 {share}",
		"costs.nothing-priced-yet": "暂无已定价用量",
		"costs.per-priced-request": "单个已定价请求",
		"costs.per-priced-request-title": "估算值 ÷ 有公开价格的请求数",
		"costs.priced-n": "已定价 {count} 个",
		"costs.unpriced-title": "没有公开等效价格的订阅用量；不计入估算",
		"costs.unpriced-hint": "不计入估算",
		"costs.all-priced": "全部用量均已定价",
	},
} as const;
