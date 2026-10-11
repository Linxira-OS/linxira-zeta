/**
 * Overview copy. Keys are slugs (`overview.<name>`); the English string is the
 * source of truth and `zh-CN` overrides it.
 */
export const overview = {
	en: {
		// ── page header ─────────────────────────────────────────────────────
		"overview.title": "Overview",
		"overview.description": "Everything zeta did across your sessions in {window}.",
		// ── summary stats ───────────────────────────────────────────────────
		"overview.api-equivalent-cost": "API-equivalent cost",
		"overview.api-cost-title": "What this usage would cost at public API rates",
		"overview.unpriced-n": "{count} unpriced",
		"overview.failed-n": "{count} failed",
		"overview.conversation-tokens": "Conversation tokens",
		"overview.tokens-title": "Uncached input + cache reads + cache writes + output",
		"overview.output-n": "{count} output",
		"overview.cache-rate": "Cache rate",
		"overview.cache-rate-title": "Cache reads ÷ (uncached input + cache reads)",
		"overview.cache-saved": "{value} saved",
		"overview.succeeded-n": "{count} succeeded",
		"overview.uncached-input": "Uncached input",
		"overview.avg-latency": "Avg latency",
		"overview.avg-ttft": "Avg TTFT",
		// ── activity card ───────────────────────────────────────────────────
		"overview.activity": "Activity",
		"overview.per-5m": "Per 5 minutes",
		"overview.per-hour": "Per hour",
		"overview.per-day": "Per day",
		"overview.succeeded": "Succeeded",
		"overview.api-equivalent": "API-equivalent",
		// ── token mix card ──────────────────────────────────────────────────
		"overview.token-mix": "Token mix",
		"overview.token-mix-description": "Where conversation tokens went",
		"overview.by-agent": "By agent",
		"overview.requests-short": "{count} req",
		"overview.main-agent": "Main agent",
		"overview.subagents": "Subagents",
		"overview.advisor": "Advisor",
		// ── latest requests card + table ────────────────────────────────────
		"overview.latest-requests": "Latest requests",
		"overview.latest-requests-description": "Most recent model calls across every session",
		"overview.all-requests": "All requests",
		"overview.when": "When",
		"overview.status": "Status",
		"overview.ok": "OK",
	},
	"zh-CN": {
		// ── page header ─────────────────────────────────────────────────────
		"overview.title": "概览",
		"overview.description": "在{window}内，zeta 在你的所有会话中完成的一切。",
		// ── summary stats ───────────────────────────────────────────────────
		"overview.api-equivalent-cost": "API 等效费用",
		"overview.api-cost-title": "这些用量按公开 API 费率计算所需的费用",
		"overview.unpriced-n": "{count} 个未定价",
		"overview.failed-n": "{count} 个失败",
		"overview.conversation-tokens": "对话 Token",
		"overview.tokens-title": "未缓存输入 + 缓存读取 + 缓存写入 + 输出",
		"overview.output-n": "{count} 输出",
		"overview.cache-rate": "缓存命中率",
		"overview.cache-rate-title": "缓存读取 ÷（未缓存输入 + 缓存读取）",
		"overview.cache-saved": "节省 {value}",
		"overview.succeeded-n": "{count} 个成功",
		"overview.uncached-input": "未缓存输入",
		"overview.avg-latency": "平均延迟",
		"overview.avg-ttft": "平均 TTFT",
		// ── activity card ───────────────────────────────────────────────────
		"overview.activity": "活动",
		"overview.per-5m": "每 5 分钟",
		"overview.per-hour": "每小时",
		"overview.per-day": "每天",
		"overview.succeeded": "成功",
		"overview.api-equivalent": "API 等效",
		// ── token mix card ──────────────────────────────────────────────────
		"overview.token-mix": "Token 构成",
		"overview.token-mix-description": "对话 Token 的去向",
		"overview.by-agent": "按代理",
		"overview.requests-short": "{count} 次请求",
		"overview.main-agent": "主代理",
		"overview.subagents": "子代理",
		"overview.advisor": "顾问",
		// ── latest requests card + table ────────────────────────────────────
		"overview.latest-requests": "最新请求",
		"overview.latest-requests-description": "所有会话中最近的模型调用",
		"overview.all-requests": "全部请求",
		"overview.when": "时间",
		"overview.status": "状态",
		"overview.ok": "正常",
	},
} as const;
