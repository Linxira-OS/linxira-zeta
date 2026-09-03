/**
 * Simplified Chinese localization for the settings UI.
 *
 * The settings schema (`settings-schema.ts`) ships English `ui.label` /
 * `ui.description` / `ui.options` text and English group/tab names. This
 * module is the zh overlay: it maps every tab, every TAB_GROUPS group, every
 * setting with a `ui:` block, and every submenu option to natural Simplified
 * Chinese. The defs layer (`modes/components/settings-defs.ts`) and the
 * selector layer (`modes/components/settings-selector.ts`) consult these maps
 * whenever `currentLanguage() === "zh"`, falling back to the schema text for
 * any key that is missing here.
 *
 * Keep this file in lockstep with the schema: the completeness script asserts
 * that every tab, group, ui-blocked path, and ui.options entry is covered.
 */
import type { SettingPath, SettingTab } from "./settings-schema";

/** Tab labels for the settings tab bar (zh). */
export const ZH_TAB_LABELS: Record<SettingTab, string> = {
	appearance: "外观",
	model: "模型",
	interaction: "交互",
	context: "上下文",
	memory: "记忆",
	files: "文件",
	shell: "终端",
	tools: "工具",
	tasks: "任务",
	providers: "服务商",
};

/** Group heading labels, keyed by the raw group id used in TAB_GROUPS. */
export const ZH_GROUP_LABELS: Record<string, string> = {
	General: "通用",
	Theme: "主题",
	"Status Line": "状态栏",
	Display: "显示",
	Images: "图片",
	Thinking: "思考",
	Sampling: "采样",
	Prompt: "提示词",
	"Retry & Fallback": "重试与回退",
	Advisor: "顾问",
	Prewalk: "预遍历",
	Vision: "视觉",
	Roles: "角色",
	Input: "输入",
	Approvals: "审批",
	Notifications: "通知",
	Speech: "语音",
	Collab: "协作",
	"Magic Keywords": "魔法关键词",
	"Startup & Updates": "启动与更新",
	"Power (macOS)": "电源（macOS）",
	Agent: "智能体",
	Git: "Git 仓库",
	Compaction: "压缩",
	"Zeta Context Cache": "Zeta 上下文缓存",
	"Rules (TTSR)": "规则（TTSR）",
	Experimental: "实验性",
	"Auto-Learn": "自动学习",
	Mnemopi: "记忆模型",
	Hindsight: "回溯分析",
	Editing: "编辑",
	Reading: "读取",
	"Read Summaries": "读取摘要",
	LSP: "LSP 语言服务",
	Bash: "Shell 命令",
	"Eval & Runtimes": "Eval 与运行时",
	"Available Tools": "可用工具",
	Todos: "待办",
	"Grep & Browser": "Grep 与浏览器",
	Computer: "电脑",
	GitHub: "GitHub 集成",
	"Output Limits": "输出限制",
	Execution: "执行",
	"Discovery & MCP": "发现与 MCP",
	Extensions: "扩展",
	Developer: "开发者",
	Modes: "模式",
	Subagents: "子代理",
	Isolation: "隔离",
	"Commands & Skills": "命令与技能",
	Services: "服务",
	Fireworks: "Fireworks 模型",
	"Tiny Model": "微型模型",
	Protocol: "协议",
	Timeouts: "超时",
	Privacy: "隐私",
};

/**
 * Setting label/description texts, keyed by SettingPath.
 * `description` is omitted only when the schema entry has no description.
 */
export const ZH_SETTING_TEXTS: Partial<Record<SettingPath, { label: string; description?: string }>> = {
	autoResume: {
		label: "自动恢复",
		description: "自动恢复当前目录中的最近会话",
	},
	"composer.shape": {
		label: "编辑器形状",
		description: "输入编辑器和状态行的视觉布局",
	},
	"statusLine.contextLine": {
		label: "上下文响应行",
		description: "左右分段之间的行如何反映上下文使用情况（仅限 box 编辑器形状）",
	},
	modelRoles: {
		label: "模型角色",
		description: "角色 → 提供商/模型[:思考级别] 的分配（例如 'anthropic/claude-sonnet-4-5:high'）。空值移除该角色。",
	},
	extendedContext: {
		label: "扩展上下文",
		description:
			"对超过阈值时额外计费的模型使用高级长上下文窗口（例如 GPT-5.6 1M 在 272K 以上对输入加倍收费）；关闭则以标准定价窗口为上限",
	},
	"compaction.asyncEnabled": {
		label: "异步压缩",
		description: "在上下文接近压缩阈值时后台推测性摘要，然后在越过阈值时拼接就绪结果",
	},
	"eval.autoBackground.enabled": {
		label: "Eval 自动后台",
		description: "自动将长时间运行的 eval 单元放到后台执行，稍后交付结果",
	},
	"power.sleepPrevention": {
		label: "防睡眠",
		description: "在活跃会话期间阻止 macOS 睡眠。每个级别是累加的——它包含所有更低级别的标志。",
	},
	"advisor.enabled": {
		label: "启用顾问",
		description: '搭配第二个模型（分配给"advisor"角色），被动审查每一轮并注入备注。',
	},
	"prewalk.enabled": {
		label: "启用预遍历",
		description:
			'先在当前模型上运行，然后在计划提示的待办列表就绪后的第一次编辑/写入时切换到快速/廉价模型（默认为"smol"角色）——强模型负责规划、提交待办并开始实现，之后再交接。可通过 --prewalk / --no-prewalk 按会话覆盖。',
	},
	"advisor.syncBacklog": {
		label: "顾问同步积压",
		description: "当顾问落后超过这么多轮时，最多暂停主智能体 30 秒。关闭可禁用追赶延迟。",
	},
	"advisor.immuneTurns": {
		label: "顾问免疫轮次",
		description: "当顾问的疑虑或阻塞打断后，在接下来的这么多主轮次中以非打断方式路由后续疑虑/阻塞。",
	},
	"git.enabled": {
		label: "启用 Git 集成",
		description: "在 TUI 中显示 git 分支、状态和 PR 信息，并监视仓库元数据。",
	},
	"providers.maxInFlightRequests": {
		label: "最大并发请求数",
		description:
			'每个服务商 ID（例如 "openai" 或 "anthropic"）的最大并发 LLM 请求数，在共享此配置根目录的本地 zeta 进程间共享。未列出的服务商不受限制。',
	},
	modelRoleStorage: {
		label: "模型角色存储",
		description: "模型选择器角色分配保存的位置",
	},
	language: {
		label: "语言",
		description: "面向用户文本的 CLI 语言（系统提示词保持英文）",
	},
	"theme.dark": {
		label: "深色主题",
		description: "终端为深色背景时使用的主题",
	},
	"theme.light": {
		label: "浅色主题",
		description: "终端为浅色背景时使用的主题",
	},
	symbolPreset: {
		label: "符号预设",
		description: "图标和符号使用的字形集（Unicode、Nerd Font 或 ASCII）",
	},
	colorBlindMode: {
		label: "色盲模式",
		description: "diff 新增内容使用蓝色而非绿色",
	},
	"statusLine.preset": {
		label: "状态栏预设",
		description: "预置的状态栏配置",
	},
	"statusLine.separator": {
		label: "状态栏分隔符",
		description: "片段之间分隔符的样式",
	},
	"statusLine.sessionAccent": {
		label: "会话强调色",
		description: "编辑器边框和状态栏间隔使用会话名称的颜色",
	},
	"statusLine.transparent": {
		label: "透明状态栏",
		description:
			"状态栏使用终端的默认背景而非主题的 `statusLineBg`。Powerline 端帽会被移除，因为它们需要对比填充来衔接周围终端。",
	},
	"statusLine.compactThinkingLevel": {
		label: "紧凑思考级别",
		description: "在模型名称上以单个图标显示思考级别，而非单独的 ` · <级别>` 后缀。",
	},
	"tools.artifactSpillThreshold": {
		label: "工件溢出阈值（KB）",
		description: "超过此大小的工具输出保存为工件；尾部保留在内联位置",
	},
	"tools.artifactTailBytes": {
		label: "工件尾部大小（KB）",
		description: "输出溢出到工件时保留的内联尾部内容量",
	},
	"tools.artifactHeadBytes": {
		label: "工件头部大小（KB）",
		description: "输出溢出到工件时，除尾部外保留在头部内联的内容量（中间省略）。0 表示禁用——仅保留尾部。",
	},
	"tools.outputMaxColumns": {
		label: "输出列数上限",
		description:
			"流式工具输出（bash、python、js eval）和 `read` 的每行字节上限。超过此宽度的行以省略号截断；到下一个换行符为止的剩余字节会被丢弃。0 表示禁用。",
	},
	"tools.artifactTailLines": {
		label: "工件尾部行数",
		description: "输出溢出到工件时保留的内联尾部内容最大行数",
	},
	"statusLine.showHookStatus": {
		label: "显示钩子状态",
		description: "在状态栏下方显示钩子状态消息",
	},

	"statusLine.turnTelemetry": {
		label: "回合遥测",
		description: "每回合结束后显示一行临时的 TPS/TTFT/耗时/费用信息",
	},
	"terminal.showImages": {
		label: "显示内联图片",
		description: "在终端内联渲染图片",
	},
	"images.autoResize": {
		label: "自动调整图片大小",
		description: "将大图片调整为最大 2000x2000 以获得更好的模型兼容性",
	},
	"images.blockImages": {
		label: "屏蔽图片",
		description: "阻止图片发送给 LLM 服务商",
	},
	"images.describeForTextModels": {
		label: "为文本模型描述图片",
		description: "当图片附加到不支持视觉的模型时，将其保存到 local:// 并从具备视觉能力的模型注入描述，而不是丢弃它",
	},
	"terminal.showProgress": {
		label: "原生终端进度",
		description: "在智能体或上下文维护运行时发送 OSC 9;4 不确定进度",
	},
	"tui.textSizing": {
		label: "大标题（Kitty）",
		description:
			"使用 Kitty 的 OSC 66 文本缩放协议以 2 倍大小渲染 Markdown H1 标题。仅对 Kitty 终端生效；其他终端忽略。默认关闭。",
	},
	"tui.renderMermaid": {
		label: "渲染 Mermaid 图表",
		description: "将 Mermaid 围栏代码块渲染为 ASCII 图表",
	},
	"tui.codexResetFireworks": {
		label: "Codex 重置烟花",
		description: "以顶部三分之一区域的烟花动画庆祝非计划内的 Codex 每周用量重置和新存入的保存重置，直到按 Esc 才消失",
	},
	"tui.titleState": {
		label: "终端标题运行状态",
		description:
			"在终端标题的分隔符中显示智能体运行状态——工作时为动画加载符（Windows 上为静态 ':'），轮到您时为 '>'，智能体等待您时为 '!'",
	},
	"tui.hyperlinks": {
		label: "终端超链接",
		description:
			"将路径和 URL 包装在 OSC 8 超链接中，实现终端原生点击打开（auto：检测支持；off：从不；always：无条件）",
	},
	"tui.tight": {
		label: "紧凑布局",
		description: "移除终端输出左右两侧的 1 字符水平内边距",
	},

	"tui.sidebar": {
		label: "侧边栏",
		description: "显示右侧边栏（上下文、用量、git、模型）",
	},
	"display.shimmer": {
		label: "微光动画",
		description: "工作/加载消息的动画样式",
	},
	"display.smoothStreaming": {
		label: "平滑流式输出",
		description: "在分块到达时平滑地显示助手文本和流式工具输入",
	},
	"display.hideToolActivity": {
		label: "隐藏工具活动",
		description: "从记录中隐藏模型发起的工具调用和结果",
	},
	"display.showTokenUsage": {
		label: "显示 token 用量",
		description: "在助手消息上显示每轮 token 用量",
	},
	"display.showTurnTime": {
		label: "显示轮次耗时",
		description: "在助手消息的用量行上显示从提示到产出结束的总耗时（含工具调用）",
	},
	"display.cacheMissMarker": {
		label: "缓存未命中标记",
		description: "在请求丢失（未命中）提示词缓存的助手轮次上方显示分隔线",
	},
	"display.collapseCompacted": {
		label: "折叠压缩历史",
		description: "在实时记录中将压缩前的历史折叠到摘要分隔线之后；禁用则保留完整记录，并在每个压缩点显示分隔线",
	},
	showHardwareCursor: {
		label: "显示硬件光标",
		description: "显示终端光标以支持 IME",
	},
	"tui.imeSafeCursor": {
		label: "IME 安全提示符布局",
		description: "将提示符的底部边框移动到单独一行，以免 macOS IME 预编辑将其移位",
	},
	defaultThinkingLevel: {
		label: "思考级别",
		description: "支持思考的模型的推理深度",
	},
	hideThinkingBlock: {
		label: "隐藏思考块",
		description: "隐藏助手响应中的思考块",
	},
	proseOnlyThinking: {
		label: "仅散文思考",
		description: "从思考摘要中省略代码块，并用省略号代替",
	},
	omitThinking: {
		label: "省略思考摘要",
		description: "指示上游服务商在响应中完全省略思考摘要（在支持的情况下）",
	},
	externalThinking: {
		label: "外部思考",
		description: "私有草稿；不向用户显示。禁用受支持的 GPT、Claude 和 Gemini 推理",
	},
	"tui.resizeScrollback": {
		label: "调整大小回滚",
		description: "终端调整大小后刷新保留在回滚中的转录行的方式",
	},
	"model.loopGuard.enabled": {
		label: "循环防护",
		description: "为模型推理和散文启用自动流循环检测",
	},
	"model.loopGuard.checkAssistantContent": {
		label: "循环防护扫描散文",
		description: "除思考日志外，还将循环防护应用于助手散文消息",
	},
	"model.loopGuard.toolCallReminder": {
		label: "循环防护工具调用提醒",
		description: "当 Gemini 推理流连续发出多个规划头却不调用工具时，中断它并注入提醒以发起工具调用（需要循环防护）",
	},
	"model.toolCallLoopGuard.enabled": {
		label: "工具调用循环防护",
		description: "检测跨轮次的连续相同工具调用并注入纠正性引导",
	},
	"model.toolCallLoopGuard.threshold": {
		label: "工具调用循环阈值",
		description: "注入纠正性引导所需的连续相同工具调用次数",
	},
	"model.toolCallLoopGuard.exemptTools": {
		label: "工具调用循环豁免工具",
		description: "允许连续重复而不触发跨轮循环防护的工具名称",
	},
	inlineToolDescriptors: {
		label: "内联工具描述符",
		description:
			"在系统提示词中渲染完整工具描述符，并从服务商工具模式中剥离顶层/嵌套描述，使描述文本只发送一次。Auto 对 Gemini 模型启用此功能，其他情况禁用",
	},
	includeModelInPrompt: {
		label: "在提示词中包含模型",
		description: "在系统提示词中呈现当前模型标识符，让智能体知道自己在使用哪个模型",
	},
	includeWorkspaceTree: {
		label: "包含工作区树",
		description: "在系统提示词中渲染工作区目录树。警告：文件被修改时，这可能破坏跨会话的提示词缓存。",
	},
	"workspace.additionalDirectories": {
		label: "附加工作区目录",
		description:
			"作为附加根目录添加到每个会话的额外工作区目录（多根工作区）。可通过 /add-dir 和 /remove-dir 实时管理。路径相对于 cwd 解析；建议使用绝对路径。智能体会被告知这些根目录存在，并且可以读取/grep/glob 它们。",
	},
	personality: {
		label: "个性",
		description: "渲染到系统提示词个性块的沟通风格",
	},
	temperature: {
		label: "温度",
		description: "采样温度（0 = 确定性，1 = 创造性，-1 = 服务商默认）",
	},
	topP: {
		label: "Top P（核采样）",
		description: "核采样截断值（0-1，-1 = 服务商默认）",
	},
	topK: {
		label: "Top K 采样",
		description: "从 top-K token 中采样（-1 = 服务商默认）",
	},
	minP: {
		label: "Min P 阈值",
		description: "最小概率阈值（0-1，-1 = 服务商默认）",
	},
	presencePenalty: {
		label: "存在惩罚",
		description: "引入已存在 token 的惩罚（-1 = 服务商默认）",
	},
	repetitionPenalty: {
		label: "重复惩罚",
		description: "重复 token 的惩罚（-1 = 服务商默认）",
	},
	textVerbosity: {
		label: "文本详细程度",
		description: "OpenAI Responses 和 Codex 响应的详细程度（低、中或高）",
	},
	"tier.openai": {
		label: "服务层级 — OpenAI",
		description:
			"OpenAI / OpenAI-Codex 请求以及经由 OpenRouter 路由的 OpenAI 系列模型的处理层级（none = 省略）。作为 `service_tier` 发送。",
	},
	"tier.anthropic": {
		label: "服务层级 — Anthropic",
		description:
			'Claude 请求的处理层级。`priority` 在受支持的直接 Anthropic 模型上启用快速模式（`speed: "fast"`）；在 Bedrock/Vertex Claude 及经由 OpenRouter 时忽略。',
	},
	"tier.google": {
		label: "服务层级 — Google",
		description:
			"Gemini（Google AI Studio + Vertex）请求以及经由 OpenRouter 路由的 Google 系列模型的处理层级（none = 省略）。作为顶层 `serviceTier` 字段发送。",
	},
	"tier.subagent": {
		label: "服务层级 — 子代理",
		description:
			"生成的 task/eval 子代理的服务层级。Inherit = 与主智能体的实时分系列层级保持一致（跟踪 /fast）；选择一个值可将其应用于子代理模型所属的任何系列。",
	},
	"tier.advisor": {
		label: "服务层级 — 顾问",
		description:
			"顾问模型的服务层级。None = 标准处理；Inherit = 与主智能体的实时分系列层级保持一致；选择一个值可将其应用于顾问模型所属系列。",
	},
	"retry.enabled": {
		label: "自动重试",
		description: "自动重试失败的轮次，而不是立即将错误呈现给你",
	},
	"retry.maxRetries": {
		label: "重试次数",
		description: "API 错误的最大重试次数",
	},
	"retry.maxDelayMs": {
		label: "最大重试延迟",
		description:
			"重试之间的最大等待时间（毫秒）。当服务商要求等待超过此时间且凭据或模型回退均未成功时，请求将快速失败而不是等待（例如 Anthropic 3 小时的限流窗口）。",
	},
	"retry.modelFallback": {
		label: "重试模型回退",
		description: "允许重试恢复切换到已配置的回退模型",
	},
	"retry.usageAwareFallback": {
		label: "用量感知回退",
		description:
			"在达到硬用量限制前，使用可靠的编程套餐配额报告优先选择同服务商账户，然后选择已配置的回退模型。普通配置的 API 密钥不在此列。",
	},
	"retry.usageReservePct": {
		label: "预留余量",
		description: "当编程套餐模型的剩余用量百分比低于此值时，将其视为接近限额。未知或未映射的用量保持主模型不变。",
	},
	"retry.usageReservePolicy": {
		label: "预留策略",
		description: "当所有同服务商编程套餐账户都处于预留余量内时该怎么做。",
	},
	"retry.fallbackChains": {
		label: "重试回退链",
		description:
			'将模型角色、模型选择器（"provider/model-id"）或服务商通配符（"provider/*"）映射到有序回退选择器的 JSON 对象，例如 {"default":["openai/gpt-4o-mini"],"google-antigravity/*":["google/*","google-vertex/*"]}。以模型为键的条目在该模型/服务商激活时适用，与角色无关；"provider/*" 条目保留失败模型的 id 并替换服务商。带 id 前缀的通配符（"openrouter/google/*"）会为失败模型的裸 id 重新加前缀（google-antigravity/gemini-x -> openrouter/google/gemini-x），作为键使用时仅匹配该服务商在前缀下的 id。',
	},
	"retry.fallbackRevertPolicy": {
		label: "回退还原策略",
		description: "回退后何时返回主模型",
	},
	"providers.anthropic.serverSideFallback": {
		label: "Anthropic 服务端回退（Fable 5）",
		description:
			"当 Claude Fable 5 / Mythos 5 请求被 Anthropic 的安全分类器阻止时，在 Claude Opus 4.8 服务端重试（Anthropic `server-side-fallback-2026-06-01` beta）。需手动开启——保持关闭可保留每次请求在回退前的行为。",
	},
	steeringMode: {
		label: "引导模式",
		description: "智能体工作时如何处理排队消息",
	},
	followUpMode: {
		label: "后续消息模式",
		description: "一轮结束后如何处理后续消息",
	},
	interruptMode: {
		label: "中断模式",
		description: "引导消息何时中断工具执行",
	},
	"loop.mode": {
		label: "循环模式",
		description: "重新提交提示词之前，/loop 迭代之间会发生什么",
	},
	doubleEscapeAction: {
		label: "双击 Esc 操作",
		description: "编辑器为空时连按两次 Esc 的操作",
	},
	treeFilterMode: {
		label: "会话树过滤器",
		description: "打开会话树时的默认过滤模式",
	},
	autocompleteMaxVisible: {
		label: "自动补全条目",
		description: "自动补全下拉菜单中的最大可见条目数（3-20）",
	},
	emojiAutocomplete: {
		label: "Emoji 自动补全",
		description: "从 `:name:` 短代码建议 emoji，并展开 `:D` 或 `:-)` 等文本表情",
	},
	"paste.largeMenuThreshold": {
		label: "大粘贴菜单",
		description:
			"当粘贴内容达到这么多行时，提供菜单将其包裹为代码块、包裹在 XML 标签中或保存到文件。0 禁用该菜单（大粘贴仍会折叠为 [Paste] 标记）。",
	},
	"startup.quiet": {
		label: "静默启动",
		description: "跳过欢迎界面和启动状态消息",
	},
	"startup.showSplash": {
		label: "显示启动画面",
		description: "在正常的交互式启动时显示完整的动画设置启动画面，而不重新运行设置。静默启动仍会抑制它。",
	},
	"startup.setupWizard": {
		label: "设置向导",
		description: "每个设置版本展示一次新增的上手步骤",
	},
	"startup.checkUpdate": {
		label: "检查更新",
		description: "启动时检查 zeta 更新",
	},
	"marketplace.autoUpdate": {
		label: "市场自动更新",
		description: "启动时检查插件更新",
	},
	"startup.changelogMode": {
		label: "启动更新日志",
		description: "选择更新说明以摘要、完整详情显示，还是保持隐藏",
	},
	"magicKeywords.enabled": {
		label: "魔法关键词",
		description: "为独立的 ultrathink、orchestrate 和 workflowz 关键词启用隐藏提示",
	},
	"magicKeywords.ultrathink": {
		label: "Ultrathink 关键词",
		description: "让独立的 ultrathink 请求最大自动思考并追加其隐藏提示",
	},
	"magicKeywords.orchestrate": {
		label: "Orchestrate 关键词",
		description: "让独立的 orchestrate 追加其隐藏的多智能体编排提示",
	},
	"magicKeywords.workflow": {
		label: "Workflow 关键词",
		description: "让独立的 workflowz 追加其隐藏的 eval 工作流提示",
	},
	"completion.notify": {
		label: "完成通知",
		description: "智能体完成一轮时通知",
	},
	"error.notify": {
		label: "错误通知",
		description: "智能体因错误停止时通知",
	},
	"ask.timeout": {
		label: "Ask 超时",
		description: "这么多秒后自动选择推荐的 ask 选项（0 禁用）",
	},
	"ask.notify": {
		label: "Ask 通知",
		description: "当 ask 工具等待输入时通知",
	},
	"recap.enabled": {
		label: "空闲回顾",
		description: "终端空闲后生成当前进展的简短 LLM 回顾",
	},
	"recap.idleSeconds": {
		label: "空闲回顾延迟",
		description: "空闲后显示回顾前等待的秒数",
	},
	"collab.relayUrl": {
		label: "中继 URL",
		description: "/collab 使用的中继（wss://host[:port]）",
	},
	"collab.webUrl": {
		label: "Web UI 地址",
		description: "/collab 链接使用的浏览器界面；留空则从 collab.relayUrl 推导；显式 http:// 仅限 localhost",
	},
	"collab.displayName": {
		label: "显示名称",
		description: "向其他协作参与者显示的名称（默认：操作系统用户名）",
	},
	"share.serverUrl": {
		label: "分享服务器",
		description: "/share 使用的分享查看器/上传基址（加密 blob 上传 + 查看器；链接为 <base>/<id>#<key>）",
	},
	"share.store": {
		label: "分享存储",
		description: "/share 上传加密会话 blob 的位置",
	},
	"share.redactSecrets": {
		label: "分享密钥脱敏",
		description: "上传前对 /share 快照运行密钥混淆器（使用 secrets.* 配置）",
	},
	"stt.enabled": {
		label: "语音转文字",
		description: "通过麦克风启用语音转文字输入",
	},
	"stt.language": {
		label: "语音识别语言",
		description: "语音转文字识别语言（例如 en、zh-CN）",
	},
	"stt.modelName": {
		label: "语音模型",
		description:
			"本地设备端语音模型。Parakeet TDT v3（sherpa-onnx）为当前最优默认；Whisper base/small/large-v3-turbo 各档（transformers.js）以大小为代价换取多语言覆盖。首次使用时下载。",
	},
	"stt.submitTrigger": {
		label: "语音转文字提交触发",
		description: '选择语音听写何时自动提交：从不、松开（2 个以上词）、松开且为完整句子，或当我说"提交"时。',
	},
	"contextPromotion.enabled": {
		label: "自动提升上下文",
		description: "上下文溢出时提升到更大上下文的模型，而不是压缩",
	},
	"compaction.enabled": {
		label: "自动压缩",
		description: "上下文过大时自动压缩",
	},
	"compaction.reserveTokens": {
		label: "预留令牌",
		description: "压缩时保留给摘要的令牌预算；留空以使用自动比例预留",
	},
	"compaction.keepRecentTokens": {
		label: "保留近期令牌",
		description: "压缩时原样保留的最近令牌数；更早的上下文会被摘要化",
	},
	"compaction.midTurnEnabled": {
		label: "轮中压缩",
		description: "在下一次服务商请求之前，在安全的轮中工具循环边界检查阈值",
	},
	"compaction.methodOrder": {
		label: "压缩方法顺序",
		description:
			"自动上下文维护的首选回退顺序；不可用或失败的方法会前进到下一个选择（remote、snapcompact、handoff、shake、soft）",
	},
	"compaction.thresholdPercent": {
		label: "压缩阈值",
		description: "上下文维护的百分比阈值；设为默认以使用旧的基于预留的行为",
	},
	"compaction.thresholdTokens": {
		label: "压缩 token 上限",
		description: "上下文维护的固定 token 上限；设置后覆盖百分比",
	},
	"compaction.handoffSaveToDisk": {
		label: "保存交接文档",
		description: "将生成的交接文档保存为 markdown 文件，用于自动交接流程",
	},
	"compaction.remoteStreamingV2Enabled": {
		label: "远程压缩 V2",
		description: "对兼容的远程压缩模型使用 Responses 流式压缩",
	},
	"compaction.idleEnabled": {
		label: "空闲压缩",
		description: "空闲时若 token 数超过阈值则压缩上下文",
	},
	"compaction.idleThresholdTokens": {
		label: "空闲压缩阈值",
		description: "触发空闲压缩的 token 数上限",
	},
	"compaction.idleTimeoutSeconds": {
		label: "空闲压缩延迟",
		description: "空闲后压缩前等待的秒数",
	},
	"compaction.supersedeReads": {
		label: "取代过期读取",
		description: "同一文件再次被读取时修剪较旧的读取结果（缓存感知，每轮运行）",
	},
	"compaction.dropUseless": {
		label: "省略平淡结果",
		description: "一旦消费，修剪被标记为上下文无用的工具结果（无匹配、超时等待）（缓存感知）",
	},
	"snapcompact.systemPrompt": {
		label: "Snapcompact 系统提示词",
		description:
			"实验性：将选定的系统提示词文本渲染为密集 PNG 图像并附加到第一条用户消息（仅限视觉模型）。节省 token；成像文本将失去提示词缓存。",
	},
	"snapcompact.toolResults": {
		label: "Snapcompact 工具结果",
		description:
			"实验性：将大型历史工具结果渲染为密集 PNG 图像而非文本（仅限视觉模型）。在累积的 read/search 输出上节省 token。",
	},
	"tools.format": {
		label: "工具调用模式",
		description:
			"控制工具如何暴露给模型。Auto 使用服务商原生工具调用，除非所选模型被标记为不支持，此时回退到 GLM 自有方言。Native 强制使用服务商原生工具；其他值强制使用指定的自有方言。在会话启动时生效。",
	},
	"snapcompact.shape": {
		label: "Snapcompact 形状",
		description: "snapcompact 打印文本所用的帧形状（压缩归档与内联成像）。Auto 为当前模型选择调优后的形状。",
	},
	"branchSummary.enabled": {
		label: "分支摘要",
		description: "离开分支时提示进行摘要",
	},
	"memory.backend": {
		label: "记忆后端",
		description: "关闭、本地摘要管线、Mnemopi SQLite 或 Hindsight 远程记忆",
	},
	"sharpshooter.model": {
		label: "Sharpshooter 模型",
		description: "抽取/整合所用的模型选择器，留空使用 smol 角色",
	},
	"autolearn.enabled": {
		label: "自动学习（实验性）",
		description: "智能体停止后，推动它将经验捕获到记忆，并创建/增强隔离的受管技能",
	},
	"autolearn.autoContinue": {
		label: "停止时自动运行捕获",
		description: "开启时，在停止时自动运行一次私有捕获轮（消耗额外 token）。关闭时，仅保留常驻的自动学习指导。",
	},
	"mnemopi.dbPath": {
		label: "Mnemopi 数据库路径",
		description: "可选 SQLite 数据库路径。默认为智能体记忆目录。",
	},
	"mnemopi.bank": {
		label: "Mnemopi 存储库",
		description: "可选共享存储库基础名称。按项目模式从中派生项目本地存储库。",
	},
	"mnemopi.scoping": {
		label: "Mnemopi 作用域",
		description:
			"global = 一个共享存储库；per-project = 每个 cwd 一个隔离存储库；per-project-tagged = 项目本地写入加全局回忆可见性",
	},
	"mnemopi.embeddingVariant": {
		label: "嵌入变体",
		description:
			"本地嵌入模型系列。en = 更强的英文模型；multilingual = 跨语言模型。更改后将在下次启动时重建现有记忆嵌入。",
	},
	"mnemopi.autoRecall": {
		label: "Mnemopi 自动回忆",
		description: "将本地记忆回忆到每个会话的第一轮",
	},
	"mnemopi.autoRetain": {
		label: "Mnemopi 自动保留",
		description: "将完成的对话轮次保留到本地 Mnemopi 记忆",
	},
	"mnemopi.polyphonicRecall": {
		label: "Mnemopi 多路回忆",
		description: "启用 4 路回忆（向量、图、事实、时序），使用互惠排名融合",
	},
	"mnemopi.enhancedRecall": {
		label: "Mnemopi 增强回忆",
		description: "为重复和相似的回忆查询启用分级查询结果缓存",
	},
	"mnemopi.proactiveLinking": {
		label: "Mnemopi 主动链接",
		description: "新记忆存储时摄取到情景图中，链接到相关实体和记忆",
	},
	"mnemopi.noEmbeddings": {
		label: "Mnemopi 禁用嵌入",
		description: "强制使用确定性的纯 FTS 回忆而非向量嵌入",
	},
	"mnemopi.embeddingModel": {
		label: "Mnemopi 嵌入模型",
		description: "高级：显式嵌入模型 id，覆盖变体设置。留空使用 mnemopi.embeddingVariant。",
	},
	"mnemopi.embeddingApiUrl": {
		label: "Mnemopi 嵌入 API URL",
		description: "传递给 Mnemopi 的可选 OpenAI 兼容嵌入端点",
	},
	"mnemopi.embeddingApiKey": {
		label: "Mnemopi 嵌入 API 密钥",
		description: "传递给 Mnemopi 的可选嵌入 API 密钥",
	},
	"mnemopi.llmMode": {
		label: "Mnemopi LLM 模式",
		description: "不使用 LLM、使用在线微型模型（/models 中的 TINY 角色，否则 @smol），或使用远程 OpenAI 兼容端点",
	},
	"mnemopi.llmBaseUrl": {
		label: "Mnemopi LLM 基础 URL",
		description: "Mnemopi 远程模式的可选 OpenAI 兼容 LLM 端点",
	},
	"mnemopi.llmApiKey": {
		label: "Mnemopi LLM API 密钥",
		description: "Mnemopi 远程模式的可选 LLM API 密钥",
	},
	"mnemopi.llmModel": {
		label: "Mnemopi LLM 模型",
		description: "Mnemopi 远程模式的可选 LLM 模型名称",
	},
	"hindsight.apiUrl": {
		label: "Hindsight API 地址",
		description: "Hindsight 服务器 URL（云或自托管）",
	},
	"hindsight.apiToken": {
		label: "Hindsight API 令牌",
		description: "用于已认证 Hindsight 服务器的 Bearer 令牌",
	},
	"hindsight.bankId": {
		label: "Hindsight 存储库 ID",
		description: "记忆存储库标识符（默认：项目名称）",
	},
	"hindsight.scoping": {
		label: "Hindsight 作用域",
		description:
			"global = 一个共享存储库；per-project = 每个 cwd 一个隔离存储库；per-project-tagged = 带项目标签的共享存储库，回忆时全局 + 项目记忆合并",
	},
	"hindsight.autoRecall": {
		label: "Hindsight 自动回忆",
		description: "在每个会话的第一轮回忆记忆",
	},
	"hindsight.autoRetain": {
		label: "Hindsight 自动保留",
		description: "每 N 轮和在会话边界保留记录",
	},
	"hindsight.retainMode": {
		label: "Hindsight 保留模式",
		description: "full-session = 每个会话 upsert 一个文档，last-turn = 分块",
	},
	"hindsight.mentalModelsEnabled": {
		label: "Hindsight 心智模型",
		description:
			"启动时将精选的反思摘要（心智模型）读入开发者指令。加载存储库上已有的模型——不写入。配合 hindsight.mentalModelAutoSeed 还可自动创建内置种子集。",
	},
	"hindsight.mentalModelAutoSeed": {
		label: "Hindsight 心智模型自动播种",
		description:
			"会话开始时，创建存储库上尚不存在的内置心智模型（project-conventions、project-decisions、user-preferences）。",
	},
	"ttsr.enabled": {
		label: "TTSR 规则中断",
		description: "当输出匹配规则模式时中断智能体的流式输出（Time-Traveling Stream Rules）",
	},
	"ttsr.contextMode": {
		label: "TTSR 上下文模式",
		description: "TTSR 触发时如何处理部分输出",
	},
	"ttsr.interruptMode": {
		label: "TTSR 中断模式",
		description: "何时中断流式输出，何时在完成后注入警告",
	},
	"ttsr.repeatMode": {
		label: "TTSR 重复模式",
		description: "规则如何重复：每会话一次，或在消息间隔后",
	},
	"ttsr.repeatGap": {
		label: "TTSR 重复间隔",
		description: "规则可再次触发前的消息数",
	},
	"ttsr.builtinRules": {
		label: "内置规则",
		description: "加载智能体自带默认规则（可用 ttsr.disabledRules 单独覆盖）",
	},
	"ttsr.disabledRules": {
		label: "禁用规则",
		description: "完全忽略的规则名称（适用于自带默认规则和自定义规则）",
	},
	"edit.mode": {
		label: "编辑模式",
		description: "选择 edit 工具变体（replace、patch、hashline 或 apply_patch）",
	},
	"edit.fuzzyMatch": {
		label: "模糊匹配",
		description: "接受空白差异的高置信度模糊匹配",
	},
	"edit.fuzzyThreshold": {
		label: "模糊匹配阈值",
		description: "接受模糊匹配的相似度阈值（0-1）",
	},
	"edit.streamingAbort": {
		label: "预览失败时中止",
		description: "补丁预览失败时中止流式编辑工具调用",
	},
	"edit.blockAutoGenerated": {
		label: "阻止自动生成文件",
		description: "阻止编辑看似自动生成的文件（protoc、sqlc、swagger 等）",
	},
	"edit.enforceSeenLines": {
		label: "强制已见行保护",
		description: "拒绝以先前 read/search 从未完整显示过的行作为锚点的编辑",
	},
	readLineNumbers: {
		label: "行号",
		description: "默认在 read 工具输出前附加行号",
	},
	"read.defaultLimit": {
		label: "默认读取上限",
		description: "智能体调用 read 而未指定上限时返回的默认行数",
	},
	"read.renderMarkdown": {
		label: "Markdown 预览",
		description: "将 Markdown 读取结果渲染为格式化终端 Markdown 预览，而非原始源码",
	},
	"read.summarize.enabled": {
		label: "读取摘要",
		description: "当 read 未指定显式选择器时返回结构化代码摘要",
	},
	"read.summarize.prose": {
		label: "散文摘要",
		description: "对 Markdown 和纯文本读取返回结构化摘要",
	},
	"read.summarize.minBodyLines": {
		label: "读取摘要正文行数",
		description: "读取摘要折叠多行正文或字面量前的最小长度",
	},
	"read.summarize.minCommentLines": {
		label: "读取摘要注释行数",
		description: "读取摘要折叠多行块注释前的最小长度",
	},
	"read.summarize.minTotalLines": {
		label: "读取摘要最小文件长度",
		description: "总行数更少的文件将逐字读取，而非结构化摘要",
	},
	"read.summarize.unfoldUntil": {
		label: "读取摘要展开目标",
		description: "BFS 展开可省略区间，直到摘要至少达到这么多可见行。0 仅保留最外层省略。",
	},
	"read.summarize.unfoldLimit": {
		label: "读取摘要展开上限",
		description:
			"BFS 展开时摘要大小的硬性上限。展开后行数超过此值的区间会被跳过（该区间保持折叠），继续展开其余区间。",
	},
	"read.toolResultPreview": {
		label: "内联读取预览",
		description: "在记录中内联渲染 read 工具结果，而非摘要行",
	},
	"lsp.enabled": {
		label: "LSP 代码智能",
		description: "启用 lsp 工具实现代码智能（定义、引用、诊断、重命名）",
	},
	"lsp.lazy": {
		label: "懒加载 LSP",
		description: "首次使用时（lsp 工具或编辑匹配的文件类型）才启动语言服务器，而非会话启动时",
	},
	"lsp.shared": {
		label: "共享语言服务器",
		description: "通过守护进程代理在 omp 实例间按项目共享一个语言服务器（不可用时回退到私有服务器）",
	},
	"lsp.formatOnWrite": {
		label: "写入时格式化",
		description: "写入后使用 LSP 自动格式化代码文件",
	},
	"lsp.diagnosticsOnWrite": {
		label: "写入时诊断",
		description: "写入代码文件后返回 LSP 诊断",
	},
	"lsp.diagnosticsOnEdit": {
		label: "编辑时诊断",
		description: "编辑代码文件后返回 LSP 诊断",
	},
	"lsp.diagnosticsDeduplicate": {
		label: "诊断去重",
		description: "抑制编辑后已显示过的文件 LSP 诊断；只呈现新的或变化的",
	},
	"bash.enabled": {
		label: "Bash 命令执行",
		description: "启用 bash 工具执行 shell 命令",
	},
	"bash.autoBackground.enabled": {
		label: "Bash 自动后台",
		description: "自动将长时间运行的 bash 命令放入后台，稍后交付结果",
	},
	"bash.patterns": {
		label: "Bash 审批模式",
		description: "有序的 bash 命令审批规则。每个条目包含 match 和 approval 字段；仅支持 '*' 通配符。",
	},
	"bashInterceptor.enabled": {
		label: "Bash 拦截器",
		description: "阻止有专用工具的 shell 命令",
	},
	"bash.direnv": {
		label: "direnv 自动加载",
		description:
			"自动将仓库的 direnv/devenv `.envrc` 加载到 bash 会话中，无需手动 `direnv exec` 即可获得 devenv 工具和环境变量。遵循 direnv 的允许列表：未 `direnv allow` 的 `.envrc` 绝不会被执行",
	},
	"bash.direnvLoadTimeoutMs": {
		label: "direnv 加载超时（毫秒）",
		description:
			"首次 `direnv export` 的最大等待时间（冷 devenv shell 可能较慢）；超时后会话在没有 direnv 环境的情况下运行",
	},
	"shellMinimizer.enabled": {
		label: "Shell 精简器",
		description: "将冗长的 shell 输出（git、npm、cargo 等）压缩后再返回给智能体",
	},
	"shellMinimizer.sourceOutlineLevel": {
		label: "Shell 精简器源码大纲",
		description: "cat/read 源码文件的源码大纲模式：default 或 aggressive",
	},
	"eval.py": {
		label: "Python Eval 后端",
		description: "允许 eval 工具将 Python 单元格分派到 IPython 内核",
	},
	"eval.js": {
		label: "JavaScript Eval 后端",
		description: "允许 eval 工具将 JavaScript 单元格分派到进程内运行时",
	},
	"eval.rb": {
		label: "Ruby Eval 后端",
		description: "允许 eval 工具将 Ruby 单元格分派到持久 Ruby 内核",
	},
	"eval.jl": {
		label: "Julia Eval 后端",
		description: "允许 eval 工具将 Julia 单元格分派到持久 Julia 内核",
	},
	"python.kernelMode": {
		label: "Python 内核模式",
		description: "在多次 eval 调用间保持 IPython 内核存活，或每次都全新启动",
	},
	"python.interpreter": {
		label: "Python 解释器",
		description: "精确 Python 可执行文件的可选路径。设置后跳过自动 Python 运行时发现。",
	},
	"ruby.interpreter": {
		label: "Ruby 解释器",
		description: "精确 Ruby 可执行文件的可选路径。设置后跳过自动 Ruby 运行时发现。",
	},
	"julia.interpreter": {
		label: "Julia 解释器",
		description: "精确 Julia 可执行文件的可选路径。设置后跳过自动 Julia 运行时发现。",
	},
	"tools.approval": {
		label: "工具审批策略",
		description:
			"按工具的审批策略。设为 'allow' 自动批准，'prompt' 要求确认，'deny' 阻止。覆盖在所有审批模式下都生效。",
	},
	"tools.approvalMode": {
		label: "工具审批",
		description:
			'工具调用的默认审批行为。"总是询问"仅自动批准只读工具。"写入"自动批准读取和工作区写入工具。"Yolo"自动批准所有层级；用户策略仍可能提示或阻止。',
	},
	"todo.enabled": {
		label: "待办",
		description: "启用 todo 工具进行任务跟踪",
	},
	"tracking.enabled": {
		label: "项目追踪文档",
		description: "启用 tracking_update 工具，让 agent 维护项目追踪文档（默认关闭）",
	},
	"channels.enabled": {
		label: "IM 渠道工具",
		description:
			"启用 channel_send / workspace_run，让 agent 向远程 IM 用户推送进度并委派其他工作区任务（仅 web/桌面模式）",
	},
	"todo.reminders": {
		label: "待办提醒",
		description: "提醒智能体在停止前完成待办",
	},
	"todo.remindersMax": {
		label: "待办提醒上限",
		description: "放弃前最大待办提醒次数",
	},
	"todo.eager": {
		label: "自动创建待办",
		description: "第一条消息后推动自动创建待办列表的力度",
	},
	"glob.enabled": {
		label: "Glob 文件查找",
		description: "启用 glob 工具进行基于 glob 的文件查找",
	},
	"grep.enabled": {
		label: "Grep 正则搜索",
		description: "启用 grep 工具进行正则内容搜索",
	},
	"grep.contextBefore": {
		label: "Grep 前文上下文",
		description: "每个 grep 匹配前的上下文行数",
	},
	"grep.contextAfter": {
		label: "Grep 后文上下文",
		description: "每个 grep 匹配后的上下文行数",
	},
	"astGrep.enabled": {
		label: "AST 结构化搜索",
		description: "启用 ast_grep 工具进行结构化 AST 搜索",
	},
	"astEdit.enabled": {
		label: "AST 结构化编辑",
		description: "启用 ast_edit 工具进行结构化 AST 重写",
	},
	"debug.enabled": {
		label: "调试（Debug）",
		description: "启用 debug 工具进行基于 DAP 的调试",
	},
	"launch.enabled": {
		label: "启动（Launch）",
		description: "启用 launch 工具监管共享的长期运行项目进程",
	},
	"speechgen.enabled": {
		label: "语音生成",
		description: "启用 tts 工具进行设备端（Kokoro）或 xAI Grok Voice 语音文件合成",
	},
	"generate_image.enabled": {
		label: "生成图片",
		description: "启用 generate_image 工具（文生图与编辑）。当 tools.xdev 开启时以 xd:// 设备形式暴露。",
	},
	"inspect_image.mode": {
		label: "检查图片（Inspect Image）",
		description:
			"控制 inspect_image 工具，它将图像理解委托给具备视觉能力的模型。'auto' 仅在当前模型缺少原生图像输入时暴露；'on' 始终暴露；'off' 从不暴露。",
	},
	"computer.enabled": {
		label: "计算机控制（Computer）",
		description: "启用可脚本化的宿主机桌面控制工具（截图、输入、辅助功能）",
	},
	"computer.display": {
		label: "Computer 显示器",
		description: "合成所有显示器或选择原生显示器 id",
	},
	"computer.maxWidth": {
		label: "Computer 截图宽度",
		description: "合成截图的最大宽度（像素）",
	},
	"computer.maxHeight": {
		label: "Computer 截图高度",
		description: "合成截图的最大高度（像素）",
	},
	"inspect_image.timeoutMs": {
		label: "Inspect Image 超时",
		description:
			"inspect_image 视觉模型调用的每次请求超时（毫秒）。停滞的服务商会快速失败并返回超时错误，而不是阻塞到手动中止。设为 0 禁用超时。",
	},
	"checkpoint.enabled": {
		label: "检查点/回退（Checkpoint/Rewind）",
		description: "启用 checkpoint 和 rewind 工具进行上下文检查点",
	},
	"fetch.enabled": {
		label: "读取 URL",
		description: "允许 read 工具获取和处理 URL",
	},
	"vault.enabled": {
		label: "Obsidian 仓库",
		description:
			"启用 vault:// 内部 URL，通过 Obsidian CLI 读取和编辑 Obsidian vault 内容。禁用时，vault:// 解析被拒绝，vault:// 条目从系统提示词中省略。",
	},
	"github.enabled": {
		label: "GitHub CLI 集成",
		description:
			"启用 github 工具（基于 op 的仓库、issue、pull request、diff、search、checkout、push 和 Actions 监视工作流分派）",
	},
	"github.cache.enabled": {
		label: "GitHub 视图缓存",
		description: "将渲染后的 issue/PR 视图输出缓存在 ~/.zeta/cache/github-cache.db 中，重复读取不再计费",
	},
	"github.cache.softTtlSec": {
		label: "GitHub 缓存软 TTL",
		description: "在此窗口内，直接返回缓存的 issue/PR 视图行（秒；默认 5 分钟）",
	},
	"github.cache.hardTtlSec": {
		label: "GitHub 缓存硬 TTL",
		description: "超过软 TTL 后，返回缓存的视图行并在后台刷新；超过硬 TTL 后丢弃（秒；默认 7 天）",
	},
	"web_search.enabled": {
		label: "网络搜索",
		description: "启用 web_search 工具获取实时网络结果",
	},
	"security.enabled": {
		label: "安全",
		description: "启用 Zeta 原生安全扫描的规划、执行，以及只读的 security:// 资源命名空间",
	},
	"ask.enabled": {
		label: "提问（Ask）",
		description: "启用 ask 工具进行交互式用户提问",
	},
	"browser.enabled": {
		label: "浏览器自动化（Browser）",
		description: "启用 browser 工具进行脚本化 Chromium 自动化（puppeteer）",
	},
	"browser.cdpUrl": {
		label: "浏览器 CDP 地址",
		description:
			"默认 HTTP CDP 发现端点（例如 http://127.0.0.1:9222），用于连接而非启动浏览器。工具调用中显式的 app.cdp_url 或 app.path 优先。",
	},
	"browser.relay": {
		label: "浏览器中继（Browser Relay）",
		description:
			"通过 omp browser relay 驱动你自己的 Chrome 标签页。安装一次扩展（`omp browser-relay install`）；browser 工具需要时中继服务器自动启动。优先于 Browser CDP URL；可设置 PI_BROWSER_RELAY=0 或 PI_BROWSER_RELAY=1 覆盖。",
	},
	"browser.relayUrl": {
		label: "浏览器中继地址",
		description: "omp browser relay 端点（默认 http://127.0.0.1:9224）。",
	},
	"browser.headless": {
		label: "无头浏览器",
		description: "以无头模式启动浏览器（禁用则显示浏览器界面）",
	},
	"browser.cmux": {
		label: "cmux 浏览器",
		description:
			"当 cmux socket 可用时，使用 cmux WKWebView 表面进行浏览器自动化。可设置 PI_BROWSER_CMUX=0 或 PI_BROWSER_CMUX=1 覆盖。",
	},
	"browser.screenshotDir": {
		label: "截图目录",
		description:
			"保存截图的目录。未设置时截图保存到临时文件。支持 ~。示例：~/Downloads、~/Desktop、/sdcard/Download（Android）",
	},
	"tools.intentTracing": {
		label: "意图追踪",
		description: "要求智能体在执行每个工具调用前描述其意图",
	},
	"tools.abortOnFabricatedResult": {
		label: "伪造工具结果时中止",
		description:
			"使用带内工具调用时，当模型在一轮中途开始幻觉出工具结果时立即停止。禁用则让模型完成生成并丢弃伪造的后续内容。",
	},
	"tools.maxTimeout": {
		label: "最大工具超时",
		description: "智能体可为任何工具设置的最大超时（秒）（0 = 无限制）",
	},
	"async.enabled": {
		label: "异步执行",
		description: "启用异步 bash 命令和后台任务执行",
	},
	"async.pollWaitDuration": {
		label: "最大轮询时间",
		description:
			"`hub` wait 在返回当前状态前监视后台任务的时间。固定值每次等待该确切时长。`smart` 自适应：从 5 秒开始，每次连续等待后延长（最多 5 分钟），停止等待约一分钟后重置为 5 秒。",
	},
	"irc.timeoutMs": {
		label: "IRC 超时",
		description: "hub 消息等待（以及 send await:true）的默认超时（毫秒）；0 禁用超时",
	},
	"tools.xdev": {
		label: "xd:// 工具",
		description:
			"将少用（可发现）工具挂载到 xd:// 设备 URL 下，通过 read/write 驱动，而不是在每次请求中携带其模式。未授予写入工具的会话跳过挂载并顶层暴露所有工具。禁用则顶层暴露所有已启用工具。",
	},
	"tools.xdevDocs": {
		label: "xd:// 提示词文档",
		description:
			"选择哪些已挂载设备的文档和模式内联到系统提示词中。内置项保持核心工具内联，而 MCP 和扩展工具保持按需获取。",
	},
	"tools.xdevInlineDevices": {
		label: "xd:// 内联设备",
		description:
			"当 xd:// 提示词文档为仅内置时，内联名称匹配这些 glob 模式的动态设备（例如 mcp__context_mode_*）。仅目录模式忽略此设置。",
	},
	"mcp.enableProjectConfig": {
		label: "MCP 项目配置",
		description: "从项目根目录加载 .mcp.json/mcp.json",
	},
	"mcp.renderMarkdownResults": {
		label: "MCP Markdown 结果",
		description: "在记录中将非 JSON 的 MCP 文本结果渲染为 Markdown",
	},
	"mcp.notifications": {
		label: "MCP 更新注入",
		description: "将 MCP 资源更新注入智能体对话",
	},
	"mcp.notificationDebounceMs": {
		label: "MCP 通知防抖",
		description: "将 MCP 资源更新注入对话前的防抖窗口（毫秒）",
	},
	"plan.enabled": {
		label: "计划模式",
		description: "在执行前启用计划模式进行只读探索和规划",
	},
	"plan.defaultOnStartup": {
		label: "以计划模式启动",
		description: "在每个新会话开始时自动进入计划模式",
	},
	"goal.enabled": {
		label: "目标模式",
		description: "启用每会话目标模式和隐藏的 goal 工具",
	},
	"goal.statusInFooter": {
		label: "页脚显示目标状态",
		description: "在状态栏中目标指示器旁显示 token 预算",
	},
	"goal.continuationModes": {
		label: "目标延续模式",
		description: "活动目标可在轮次间自动延续的运行模式",
	},
	"title.refreshOnReplan": {
		label: "重新规划时刷新标题",
		description: "在待办初始化重新规划后刷新生成的会话标题，除非标题由用户设置",
	},
	"worktree.base": {
		label: "Worktree 基础目录",
		description:
			"智能体管理工作树的基础目录——任务隔离副本、`github` PR 检出和 `omp worktree` 清理都在这里。未设置时使用 ~/.zeta/wt。必须是绝对路径或以 ~ 开头的路径；相对路径被忽略。OMP_WORKTREE_DIR 环境变量可覆盖此设置。",
	},
	"task.eager": {
		label: "偏好任务委派",
		description: "推动将工作委派给子代理的力度",
	},
	"task.batch": {
		label: "批量任务调用",
		description:
			"将 task 工具切换到批量形态：一次调用携带 { context, tasks[] }——每项一个子代理，可选的逐项代理（默认为会话生成策略代理）、逐项隔离，以及前置到每个任务分配中的必需共享上下文。async.enabled=true 时，每个生成作为独立后台智能体运行，遵循正常的空闲/驻留生命周期；否则调用阻塞等待合并结果。禁用则恢复扁平的单生成模式。",
	},
	"task.enableEffort": {
		label: "每任务思考投入",
		description: "在任务生成时暴露可选的 effort 参数，允许调用方覆盖每个子代理的思考级别",
	},
	"task.maxConcurrency": {
		label: "最大并发任务",
		description: "同时运行的子代理最大数量",
	},
	"task.enableLsp": {
		label: "子代理中的 LSP",
		description:
			"允许通过 task 工具生成的子代理使用 lsp 工具。默认关闭以保持子代理廉价；当 LSP 感知的委派值得额外 token 时启用。",
	},
	"task.maxRecursionDepth": {
		label: "最大任务递归",
		description: "子代理可以再生成子代理的嵌套深度",
	},
	"task.maxRuntimeMs": {
		label: "最大子代理运行时间",
		description:
			"每个子代理的硬性墙钟限制（毫秒）。0 禁用。纵深防御服务商侧逃脱推理层看门狗的流挂起；触发正常的子代理中止，原因为 'timed out'。",
	},
	"task.agentIdleTtlMs": {
		label: "智能体空闲 TTL",
		description:
			"空闲子代理在内存中保持活跃多长时间后被驻留到磁盘（毫秒）。驻留的智能体在收到消息或恢复时自动唤醒。0 保持空闲智能体活跃直到退出。",
	},
	"task.softRequestBudget": {
		label: "子代理软请求预算",
		description:
			"每个子代理的软请求预算（每次运行的助手请求数）。超过它时注入收尾引导通知（见 task.softRequestBudgetNotice）；达到预算的 1.5 倍时运行被强制停止，智能体必须提交其部分发现。0 禁用该防护。内置 scout/sonic 智能体以更低的内置预算封顶，因此低于该上限的值对它们仍然适用。",
	},
	"task.softRequestBudgetNotice": {
		label: "软请求预算通知",
		description: "当子代理超过其软请求预算时注入一条引导通知，要求它在 1.5 倍强制提交停止前收尾。",
	},
	"task.maxEffort": {
		label: "每次生成最大思考投入",
		description:
			"task 工具每次生成 effort 提示允许的最大推理投入。较低的值可防止调用方将子代理提升到超过此上限；默认保留模型的完整范围。",
	},
	"task.prewalk": {
		label: "通用任务预遍历",
		description:
			"为内置的通用 `task` 子代理启用预遍历：它在其解析模型上启动，规划并开始实现，然后在第一次编辑/写入时交接给 'smol' 角色。逐代理覆盖（task.agentPrewalk，从 /agents 中心配置）和用户智能体的 `prewalk` frontmatter 不受此开关影响。",
	},
	"tasks.todoClearDelay": {
		label: "待办自动清除延迟",
		description: "已完成或放弃的待办从待办组件中移除前的延迟",
	},
	"task.showResolvedModelBadge": {
		label: "显示已解析模型徽标",
		description: "在任务组件状态栏中显示每个子代理实际使用的模型 ID",
	},
	"skills.enabled": {
		label: "技能",
		description: "启用技能发现与加载（SKILL.md 工作流）",
	},
	shellPath: {
		label: "Shell 路径",
		description: "bash 工具使用的 Shell 可执行文件（例如 bash、zsh、pwsh 或绝对路径）",
	},
	"skills.enableSkillCommands": {
		label: "技能命令",
		description: "将技能注册为 /skill:name 命令",
	},
	"commands.enableClaudeUser": {
		label: "Claude 用户命令",
		description: "从 ~/.claude/commands/ 加载命令",
	},
	"commands.enableClaudeProject": {
		label: "Claude 项目命令",
		description: "从 .claude/commands/ 加载命令",
	},
	"commands.enableOpencodeUser": {
		label: "OpenCode 用户命令",
		description: "从 ~/.config/opencode/commands/ 加载命令",
	},
	"commands.enableOpencodeProject": {
		label: "OpenCode 项目命令",
		description: "从 .opencode/commands/ 加载命令",
	},
	"secrets.enabled": {
		label: "隐藏密钥",
		description: "在发送给 AI 服务商前混淆已配置的密钥并脱敏形似凭据的 token",
	},
	"providers.ollama-cloud.maxConcurrency": {
		label: "Ollama Cloud 最大并发",
		description: "每个进程的最大并发 Ollama Cloud 子代理运行数；0 禁用服务商特定限制",
	},
	"providers.webSearchOrder": {
		label: "网络搜索服务商顺序",
		description: "web_search 工具的优先服务商列表；未列出的服务商在其后保留默认顺序",
	},
	"providers.webSearchExclude": {
		label: "排除的网络搜索服务商",
		description: "web_search 永远不应使用的服务商，即使作为回退",
	},
	"providers.webSearchTimeoutSeconds": {
		label: "网络搜索超时",
		description: "web_search 推进到下一个回退前，每个服务商搜索传输的硬性超时（秒，最大 300）",
	},
	"providers.webSearchGeminiModel": {
		label: "Gemini web_search 模型",
		description: "Gemini Google 搜索接地的模型 ID。默认为 gemini-2.5-flash。",
	},
	"providers.antigravityEndpoint": {
		label: "Antigravity 端点模式",
		description: "google-antigravity 服务商（chat、search、image、discovery）的端点路由策略",
	},
	"providers.imageOrder": {
		label: "图片服务商顺序",
		description: "图片生成的优先服务商列表；未列出的服务商跟随当前会话服务商和内置顺序",
	},
	"providers.fireworksTier": {
		label: "Fireworks 层级",
		description:
			'Fireworks 请求的提供路径。Priority 发送 `service_tier: "priority"`，在高峰流量期间以更高价格换取更高可靠性；Standard 省略它。Fast（`-fast`）模型忽略此设置——Fast 是它自己的提供路径。',
	},
	"live.voice": {
		label: "实时语音",
		description: "Codex 支持的实时语音会话使用的语音",
	},
	"providers.tts": {
		label: "文字转语音服务商",
		description: "tts 工具的后端：本地设备端神经 TTS（Kokoro-82M）或 xAI Grok Voice",
	},
	"tts.localModel": {
		label: "本地 TTS 模型",
		description: "本地 TTS 后端使用的设备端神经 TTS 模型（Kokoro-82M）",
	},
	"tts.localVoice": {
		label: "本地 TTS 音色",
		description: "本地 TTS 后端使用的 Kokoro 音色（美式/英式，女声/男声）",
	},
	"speech.enabled": {
		label: "语音朗读",
		description: "流式输出时通过扬声器朗读助手的输出",
	},
	"speech.mode": {
		label: "语音朗读模式",
		description: "朗读内容：all = 助手消息 + 思考；assistant = 仅消息；yield = 仅轮次结束时的最终消息",
	},
	"speech.enhanced": {
		label: "增强语音改写",
		description:
			"合成前使用 tiny/smol 模型将助手输出改写为自然口语散文（描述代码、去掉链接和 markdown）。失败时回退到机械清理",
	},
	"speech.voice": {
		label: "语音朗读音色",
		description: "朗读助手输出时使用的 Kokoro 音色",
	},
	"providers.tinyModel": {
		label: "微型模型",
		description: "会话标题模型：默认为在线（/models 中的 TINY 角色，否则 @smol），或本地设备端模型",
	},
	"providers.tinyModelDevice": {
		label: "微型模型设备",
		description:
			"本地微型模型（标题 + 记忆）的 ONNX 执行提供程序。默认仅使用 CPU 推理。PI_TINY_DEVICE 环境变量可覆盖此设置。",
	},
	"providers.tinyModelDtype": {
		label: "微型模型精度",
		description:
			"本地微型模型的 ONNX 量化/精度。默认使用每个模型自带的 dtype（q4）；更低精度更快，更高精度更忠实。PI_TINY_DTYPE 环境变量可覆盖此设置。",
	},
	"providers.memoryModel": {
		label: "记忆模型",
		description:
			"用于事实提取 + 整合的 Mnemopi LLM：默认为在线（/models 中的 TINY 角色，否则 smol/remote），或本地设备端模型",
	},
	"providers.autoThinkingModel": {
		label: "自动思考模型",
		description: "`auto` 思考级别的难度分类器：默认为在线（/models 中的 TINY 角色，否则 smol），或本地设备端模型",
	},
	"providers.autoThinkingMaxEffort": {
		label: "自动思考上限",
		description:
			"`auto` 分类器可解析的最高投入。`xhigh` 使分类器保持低于顶档一档，因此只有显式的 `ultrathink` 才能达到 `max`；`max` 允许分类器判定为卓越的轮次在支持该档的模型上计费顶档。",
	},
	"features.unexpectedStopDetection": {
		label: "检测意外停止",
		description: "使用小模型检测助手说会继续却未调用工具就停止的情况；自动提示它继续。",
	},
	"providers.unexpectedStopModel": {
		label: "意外停止模型",
		description: "意外停止检测的分类器：默认为在线（/models 中的 TINY 角色，否则 smol），或本地设备端模型。",
	},
	"providers.kimiApiFormat": {
		label: "Kimi API 格式",
		description: "Kimi Code 服务商的 API 格式（auto 跟随实时模型元数据）",
	},
	"providers.openaiWebsockets": {
		label: "OpenAI WebSocket 策略",
		description: "OpenAI Codex 模型的 WebSocket 策略（auto 使用模型默认，on 强制，off 禁用）",
	},
	"providers.cacheRetention": {
		label: "提示缓存保留",
		description: "转发给支持的服务商（Anthropic、Bedrock、OpenRouter、OpenAI）的提示缓存保留策略",
	},
	"providers.streamFirstEventTimeoutSeconds": {
		label: "流首事件超时",
		description: "等待模型流的第一个事件的秒数；-1 使用服务商/环境默认值，0 禁用看门狗",
	},
	"providers.streamIdleTimeoutSeconds": {
		label: "流空闲超时",
		description: "模型流在事件之间可保持静默的秒数；-1 使用服务商/环境默认值，0 禁用看门狗",
	},
	"providers.openrouterVariant": {
		label: "OpenRouter 路由",
		description: "追加到 OpenRouter 模型 ID 的默认路由变体后缀（选择器已指定变体时覆盖）",
	},
	"providers.fetch": {
		label: "Fetch 服务商",
		description: "fetch/read URL 工具的读取后端优先级",
	},
	"codexResets.autoRedeem": {
		label: "Codex 自动赎回保存的重置",
		description:
			"自动使用保存的 Codex 限流重置：当一轮卡住且没有其他账户可接管时，恢复被耗尽的 5 小时或每周窗口阻止的账户，并挽救即将过期的额度。unset 在首次使用前询问，yes 无需提示直接使用，no 禁用两种检查。",
	},
	"codexResets.minBlockedMinutes": {
		label: "Codex 自动赎回最小阻塞",
		description:
			"仅在自然解除阻塞——耗尽的 5 小时/每周窗口中的最新重置——至少还有这么多分钟时自动赎回（不要为节省短暂等待而花费稀缺额度）。提高它（例如 360）以忽略仅 5 小时的阻塞。",
	},
	"codexResets.keepCredits": {
		label: "Codex 自动赎回预留",
		description:
			"自动使用后至少保留这么多保存重置（0 = 最后一条额度也可自动使用）。即将过期的额度不受此限——预留的额度若过期则一无所获。",
	},
	"codexResets.salvageHorizonHours": {
		label: "Codex 重置挽救窗口",
		description:
			"当保存的 Codex 重置将在这么多小时内过期，且任一聊天窗口（5 小时或每周）有可恢复的有意义用量时，自动使用它（0 禁用过期挽救）。",
	},
	"provider.appendOnlyContext": {
		label: "仅追加上下文",
		description:
			"缓存系统提示词 + 工具规格，并保持仅追加的消息日志，使服务商前缀缓存（DeepSeek、Xiaomi/SGLang、Anthropic）以最大命中率工作。Auto 为已知前缀缓存服务商启用。",
	},
	"exa.enabled": {
		label: "Exa 搜索",
		description: "启用 Exa 网络搜索服务商",
	},
	"exa.searchDelayMs": {
		label: "Exa 搜索延迟",
		description: "Exa 网络搜索请求之间的最小延迟（毫秒）；设为 0 禁用节流",
	},
	"searxng.endpoint": {
		label: "SearXNG 端点",
		description: "用于网络搜索的自托管 SearXNG 实例的基础 URL",
	},
	"searxng.categories": {
		label: "搜索分类",
		description: "逗号分隔的 SearXNG 分类（例如 general、images、news）",
	},
	"searxng.language": {
		label: "搜索语言",
		description: "搜索结果语言（例如 en、zh-CN 或 all）",
	},
	"searxng.safesearch": {
		label: "安全搜索",
		description: "SearXNG 安全搜索级别：0 关闭、1 适中、2 严格",
	},
	"extensionHandlers.toolCallTimeoutMs": {
		label: "工具调用处理超时（毫秒）",
		description: "扩展 tool_call 处理器的正有限活动工作超时；无效值使用 30000 毫秒，等待 OMP 自有对话框的时间不计入",
	},
	"dev.autoqa": {
		label: "自动 QA",
		description:
			"自动化工具问题上报（xd://report_issue）。默认开启；首次上报请求同意，拒绝后上报被禁用，直到显式重新启用",
	},
	"dev.autoqaPush.endpoint": {
		label: "自动 QA 推送端点",
		description: "接收自动 QA JSON 报告的完整 URL（留空则禁用推送）",
	},
	"zeta.contextCache.enabled": {
		label: "启用上下文缓存",
		description: "为上下文感知的记忆写入和 endTurn 压缩启用双状态机",
	},
	"zeta.contextCache.thresholdTokens": {
		label: "记忆写入阈值",
		description: "触发软 memory_edit 要求的上下文 token 阈值（状态机 A）",
	},
	"zeta.contextCache.memoryWriteEnabled": {
		label: "记忆写入（状态机 A）",
		description: "当上下文超过阈值时，提示模型通过 memory_edit 将重要信息保存到记忆",
	},
	"zeta.contextCache.endTurnCompactionEnabled": {
		label: "EndTurn 压缩（状态机 B）",
		description: "模型发出 endTurn 标签时触发自动压缩",
	},
	"images.urls.enabled": {
		label: "以 URL 提供图片",
		description: "将终端图片作为 URL 提供，供外部服务商访问",
	},
	"images.urls.backends": {
		label: "图片 URL 后端",
		description: "发布图片以供服务商访问时的有序目标",
	},
	"images.urls.command": {
		label: "图片上传命令",
		description: "发布图片时执行的自定义上传命令",
	},
	"images.urls.publicBaseUrl": {
		label: "图片 URL 公共基址",
		description: "面向 blob 服务器的外部可达基址（ssh 必需，direct 可选）",
	},
	"images.urls.bindHost": {
		label: "图片 URL 绑定主机",
		description: "blob 服务器绑定的主机；隧道用回环，直连用 0.0.0.0",
	},
	"images.urls.sshTarget": {
		label: "图片 URL SSH 目标",
		description: "ssh 反向转发目标 user@host",
	},
	"spelling.typoDetection": {
		label: "拼写错误检测 (macOS)",
		description: "用当前 macOS 词典标记拼写错误的提示词",
	},
	"spelling.autocomplete": {
		label: "单词自动补全 (macOS)",
		description: "显示 macOS 词典单词补全作为 Tab 接受的内联提示",
	},
	"spelling.autocorrect": {
		label: "自动更正 (macOS)",
		description: "在完成的单词后应用可信的 macOS 拼写更正",
	},
	"update.channel": {
		label: "更新通道",
		description: "omp update 和启动更新检查使用的更新通道",
	},
	"edit.blackbox.enabled": {
		label: "记录解析回归",
		description: "编辑引入 AST 解析失败时追加完整的前后源码",
	},
	"edit.autoRepair.enabled": {
		label: "自动修复解析回归",
		description: "编辑引入 AST 解析失败时自动修复",
	},
	"providers.openai-codex.codeMode": {
		label: "Codex 代码模式",
		description: "以代码优先模式运行 Codex",
	},
	// ===== v18.1.2–v18.1.5 上游新增设置项（合并批补齐） =====
	"async.maxJobs": {
		label: "异步任务并发上限",
		description: "同时运行的异步（后台）任务的最大数量",
	},
	"auth.broker.token": {
		label: "Auth Broker 令牌",
		description: "连接 auth-broker 时使用的 bearer 令牌",
	},
	"auth.broker.url": {
		label: "Auth Broker 地址",
		description: "auth-broker 服务器的 base URL",
	},
	"autolearn.minToolCalls": {
		label: "自动学习最小工具调用数",
		description: "触发自动学习所需的会话内最少工具调用次数",
	},
	"bash.autoBackground.thresholdMs": {
		label: "Bash 自动转后台阈值",
		description: "前台 Bash 超过该毫秒数后自动转入后台运行",
	},
	"bashInterceptor.patterns": {
		label: "Bash 拦截模式",
		description: "匹配这些 glob 模式的 Bash 命令将被拦截重写",
	},
	"branchSummary.reserveTokens": {
		label: "分支摘要保留 Token",
		description: "为分支摘要预留的上下文 token 预算",
	},
	"commit.cacheEnabled": {
		label: "提交缓存",
		description: "缓存 git 提交信息生成结果以加速重复提交",
	},
	"commit.cacheTtlDays": {
		label: "提交缓存保留天数",
		description: "提交信息生成缓存的保留天数",
	},
	"commit.changelogMaxDiffChars": {
		label: "Changelog 最大 Diff 字符",
		description: "生成 changelog 时读取的最大 diff 字符数",
	},
	"commit.mapBatchTokenBudget": {
		label: "提交分批 Token 预算",
		description: "map 阶段每批次处理的 token 预算",
	},
	"commit.mapReduceEnabled": {
		label: "提交 Map-Reduce 生成",
		description: "大 diff 使用 map-reduce 两阶段生成提交信息",
	},
	"commit.mapReduceThreshold": {
		label: "Map-Reduce 触发阈值",
		description: "超过该字符数的 diff 启用 map-reduce 路径",
	},
	"compaction.autoContinue": {
		label: "压缩后自动继续",
		description: "上下文压缩完成后自动继续被中断的回合",
	},
	"compaction.remoteEndpoint": {
		label: "远程压缩端点",
		description: "把压缩请求转发到该远程端点执行",
	},
	"compaction.v2RetainedMessageBudget": {
		label: "压缩 v2 保留消息预算",
		description: "v2 压缩策略中保留近期消息的 token 预算",
	},
	"dev.autoqaConsent": {
		label: "AutoQA 同意",
		description: "确认允许 AutoQA 自动化质量检查流程",
	},
	"dev.autoqaPush.token": {
		label: "AutoQA 推送令牌",
		description: "AutoQA 结果推送使用的认证令牌",
	},
	"edit.recoverInlineEdits": {
		label: "恢复内联编辑载荷",
		description: "将模型以纯文本输出的编辑载荷转换为 edit 工具调用执行",
	},
	"eval.autoBackground.thresholdMs": {
		label: "Eval 自动转后台阈值",
		description: "Eval 运行超过该毫秒数后自动转入后台",
	},
	"gc.archive": {
		label: "GC 归档",
		description: "垃圾回收时把冷数据移动到归档存储",
	},
	"gc.blobs": {
		label: "GC Blob 数据",
		description: "垃圾回收扫描未引用的 blob 附件",
	},
	"gc.coldArchiveAfterDays": {
		label: "冷归档天数",
		description: "数据闲置该天数后移入冷归档",
	},
	"gc.retainNewestGlobal": {
		label: "全局保留最新数",
		description: "全局保留的最新会话数量下限",
	},
	"gc.retainNewestPerCwd": {
		label: "每目录保留最新数",
		description: "每个工作目录保留的最新会话数量",
	},
	"gc.wal": {
		label: "GC WAL",
		description: "垃圾回收预写日志（WAL）文件",
	},
	"hindsight.bankIdPrefix": {
		label: "Hindsight Bank ID 前缀",
		description: "hindsight 记忆库 ID 的命名前缀",
	},
	"hindsight.bankMission": {
		label: "Hindsight 使命声明",
		description: "写入记忆库的使命描述，用于检索相关性判断",
	},
	"hindsight.debug": {
		label: "Hindsight 调试",
		description: "输出 hindsight 检索与写入的调试日志",
	},
	"hindsight.mentalModelMaxRenderChars": {
		label: "心智模型渲染上限",
		description: "心智模型渲染到上下文的最大字符数",
	},
	"hindsight.mentalModelRefreshIntervalMs": {
		label: "心智模型刷新间隔",
		description: "心智模型自动刷新的毫秒间隔",
	},
	"hindsight.recallBudget": {
		label: "回忆预算",
		description: "每次回忆（recall）允许消耗的 token 预算",
	},
	"hindsight.recallContextTurns": {
		label: "回忆上下文回合数",
		description: "参与召回查询构造的最近回合数",
	},
	"hindsight.recallMaxQueryChars": {
		label: "回忆查询字符上限",
		description: "单次召回查询的最大字符数",
	},
	"hindsight.recallMaxTokens": {
		label: "回忆 Token 上限",
		description: "召回内容注入上下文的最大 token 数",
	},
	"hindsight.recallTimeoutMs": {
		label: "回忆超时",
		description: "召回请求的超时毫秒数",
	},
	"hindsight.recallTypes": {
		label: "回忆类型",
		description: "允许召回的记忆条目类型列表",
	},
	"hindsight.reflectTimeoutMs": {
		label: "反思超时",
		description: "反思（reflect）阶段的超时毫秒数",
	},
	"hindsight.requestTimeoutMs": {
		label: "Hindsight 请求超时",
		description: "hindsight 后端请求的超时毫秒数",
	},
	"hindsight.retainContext": {
		label: "Hindsight 保留上下文",
		description: "回忆结果在后续回合中的保留策略",
	},
	"hindsight.retainEveryNTurns": {
		label: "「hindsight.retainEveryNTurns」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"hindsight.retainMission": {
		label: "「hindsight.retainMission」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"hindsight.retainOverlapTurns": {
		label: "「hindsight.retainOverlapTurns」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"hindsight.retainTimeoutMs": {
		label: "「hindsight.retainTimeoutMs」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"images.urls.credentials": {
		label: "「images.urls.credentials」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"images.urls.options": {
		label: "「images.urls.options」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"images.urls.sshRemotePort": {
		label: "「images.urls.sshRemotePort」设置",
		description: "（v18.1.x 新增设置项，英文原文：Remote listen port of the ssh reverse forward that your web ）",
	},
	"images.urls.ttlHours": {
		label: "「images.urls.ttlHours」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"isolation.backend": {
		label: "「isolation.backend」设置",
		description: "（v18.1.x 新增设置项，英文原文：Backend used for subagent isolation and worktree cloning）",
	},
	"memories.enabled": {
		label: "「memories.enabled」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.fallbackTokenLimit": {
		label: "「memories.fallbackTokenLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.maxRawMemoriesForGlobal": {
		label: "「memories.maxRawMemoriesForGlobal」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.maxRolloutAgeDays": {
		label: "「memories.maxRolloutAgeDays」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.maxRolloutsPerStartup": {
		label: "「memories.maxRolloutsPerStartup」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.minRolloutIdleHours": {
		label: "「memories.minRolloutIdleHours」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.phase1InputTokenLimit": {
		label: "「memories.phase1InputTokenLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.phase2HeartbeatSeconds": {
		label: "「memories.phase2HeartbeatSeconds」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.phase2LeaseSeconds": {
		label: "「memories.phase2LeaseSeconds」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.phase2RetryDelaySeconds": {
		label: "「memories.phase2RetryDelaySeconds」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.rolloutPayloadPercent": {
		label: "「memories.rolloutPayloadPercent」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.stage1Concurrency": {
		label: "「memories.stage1Concurrency」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.stage1LeaseSeconds": {
		label: "「memories.stage1LeaseSeconds」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.stage1RetryDelaySeconds": {
		label: "「memories.stage1RetryDelaySeconds」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.summaryInjectionTokenLimit": {
		label: "「memories.summaryInjectionTokenLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"memories.threadScanLimit": {
		label: "「memories.threadScanLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.debug": {
		label: "「mnemopi.debug」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.injectionTokenLimit": {
		label: "「mnemopi.injectionTokenLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.recallContextTurns": {
		label: "「mnemopi.recallContextTurns」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.recallLimit": {
		label: "「mnemopi.recallLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.recallMaxQueryChars": {
		label: "「mnemopi.recallMaxQueryChars」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"mnemopi.retainEveryNTurns": {
		label: "「mnemopi.retainEveryNTurns」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"retry.baseDelayMs": {
		label: "「retry.baseDelayMs」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"searxng.basicPassword": {
		label: "「searxng.basicPassword」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"searxng.basicUsername": {
		label: "「searxng.basicUsername」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"searxng.engines": {
		label: "「searxng.engines」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"searxng.token": {
		label: "「searxng.token」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"sharpshooter.injectionTokenLimit": {
		label: "「sharpshooter.injectionTokenLimit」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"sharpshooter.intervalMinutes": {
		label: "「sharpshooter.intervalMinutes」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"shellMinimizer.except": {
		label: "「shellMinimizer.except」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"shellMinimizer.legacyFilters": {
		label: "「shellMinimizer.legacyFilters」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"shellMinimizer.maxCaptureBytes": {
		label: "「shellMinimizer.maxCaptureBytes」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"shellMinimizer.only": {
		label: "「shellMinimizer.only」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"shellMinimizer.settingsPath": {
		label: "「shellMinimizer.settingsPath」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.customDirectories": {
		label: "「skills.customDirectories」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enableAgentsProject": {
		label: "「skills.enableAgentsProject」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enableAgentsUser": {
		label: "「skills.enableAgentsUser」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enableClaudeProject": {
		label: "「skills.enableClaudeProject」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enableClaudeUser": {
		label: "「skills.enableClaudeUser」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enableCodexUser": {
		label: "「skills.enableCodexUser」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enablePiProject": {
		label: "「skills.enablePiProject」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.enablePiUser": {
		label: "「skills.enablePiUser」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.ignoredSkills": {
		label: "「skills.ignoredSkills」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"skills.includeSkills": {
		label: "「skills.includeSkills」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"statusLine.leftSegments": {
		label: "「statusLine.leftSegments」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"statusLine.rightSegments": {
		label: "「statusLine.rightSegments」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"statusLine.segmentOptions": {
		label: "「statusLine.segmentOptions」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.agentAdvisor": {
		label: "「task.agentAdvisor」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.agentModelOverrides": {
		label: "「task.agentModelOverrides」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.agentPrewalk": {
		label: "「task.agentPrewalk」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.disabledAgents": {
		label: "「task.disabledAgents」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.isolation.apply": {
		label: "「task.isolation.apply」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"task.isolation.commits": {
		label: "「task.isolation.commits」设置",
		description: "（v18.1.x 新增设置项，英文原文：Commit message style for nested repo changes (generic or AI-）",
	},
	"task.isolation.enabled": {
		label: "「task.isolation.enabled」设置",
		description: "（v18.1.x 新增设置项，英文原文：Run subagents in an isolated copy of the checkout and integr）",
	},
	"task.isolation.merge": {
		label: "「task.isolation.merge」设置",
		description: "（v18.1.x 新增设置项，英文原文：How isolated task changes are integrated (patch apply or bra）",
	},
	"thinkingBudgets.high": {
		label: "「thinkingBudgets.high」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"thinkingBudgets.low": {
		label: "「thinkingBudgets.low」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"thinkingBudgets.max": {
		label: "「thinkingBudgets.max」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"thinkingBudgets.medium": {
		label: "「thinkingBudgets.medium」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"thinkingBudgets.minimal": {
		label: "「thinkingBudgets.minimal」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"thinkingBudgets.xhigh": {
		label: "「thinkingBudgets.xhigh」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"tui.maxInlineImageColumns": {
		label: "「tui.maxInlineImageColumns」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"tui.maxInlineImageRows": {
		label: "「tui.maxInlineImageRows」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"tui.maxInlineImages": {
		label: "「tui.maxInlineImages」设置",
		description: "（v18.1.x 新增设置项）",
	},
	"worktree.clone": {
		label: "「worktree.clone」设置",
		description: "（v18.1.x 新增设置项）",
	},
};
export type ZetaSettingsZhOverlay = typeof ZH_SETTING_TEXTS;

/**
 * Submenu option label/description texts, keyed by `${path}::${optionValue}`.
 * `description` is omitted only when the schema entry has no description.
 */
export const ZH_OPTION_TEXTS: Partial<Record<string, { label: string; description?: string }>> = {
	"power.sleepPrevention::off": {
		label: "关闭",
		description: "不阻止任何睡眠",
	},
	"power.sleepPrevention::idle": {
		label: "阻止空闲睡眠",
		description: "会话打开期间保持系统唤醒（caffeinate -i）",
	},
	"power.sleepPrevention::display": {
		label: "阻止显示器睡眠",
		description: "同时防止显示器空闲休眠（caffeinate -i -d）",
	},
	"power.sleepPrevention::system": {
		label: "阻止系统睡眠",
		description: "同时在接通电源时阻止所有系统睡眠并声明用户处于活动状态（caffeinate -i -d -s -u）",
	},
	"advisor.immuneTurns::0": {
		label: "0 轮",
		description: "允许每个疑虑/阻塞打断。",
	},
	"advisor.immuneTurns::1": {
		label: "1 轮",
	},
	"advisor.immuneTurns::2": {
		label: "2 轮",
	},
	"advisor.immuneTurns::3": {
		label: "3 轮",
		description: "默认。",
	},
	"advisor.immuneTurns::4": {
		label: "4 轮",
	},
	"advisor.immuneTurns::5": {
		label: "5 轮",
	},
	"modelRoleStorage::global": {
		label: "全局",
		description: "将角色模型保存到当前配置文件（当前行为）",
	},
	"modelRoleStorage::project": {
		label: "按项目",
		description: "将项目角色模型保存到 .zeta/config.yml；缺失的项目角色使用全局默认值",
	},
	"language::en": {
		label: "English",
		description: "英文界面文本（默认）",
	},
	"language::zh": {
		label: "中文",
		description: "简体中文界面",
	},
	"symbolPreset::unicode": {
		label: "Unicode",
		description: "标准符号（默认）",
	},
	"symbolPreset::nerd": {
		label: "Nerd Font",
		description: "需要 Nerd Font",
	},
	"symbolPreset::ascii": {
		label: "ASCII",
		description: "最大兼容性",
	},
	"statusLine.preset::default": {
		label: "默认",
		description: "模型、路径、git、上下文、token、费用",
	},
	"statusLine.preset::minimal": {
		label: "极简",
		description: "仅路径和 git",
	},
	"statusLine.preset::compact": {
		label: "紧凑",
		description: "模型、git、费用、上下文",
	},
	"statusLine.preset::full": {
		label: "完整",
		description: "包含时间在内的所有片段",
	},
	"statusLine.preset::nerd": {
		label: "Nerd",
		description: "使用 Nerd Font 图标显示最多信息",
	},
	"statusLine.preset::ascii": {
		label: "ASCII",
		description: "无特殊字符",
	},
	"statusLine.preset::custom": {
		label: "自定义",
		description: "用户自定义片段",
	},
	"statusLine.separator::powerline": {
		label: "Powerline",
		description: "实心箭头（Nerd Font）",
	},
	"statusLine.separator::powerline-thin": {
		label: "细箭头",
		description: "细箭头（Nerd Font）",
	},
	"statusLine.separator::slash": {
		label: "斜杠",
		description: "正斜杠",
	},
	"statusLine.separator::pipe": {
		label: "竖线",
		description: "竖线",
	},
	"statusLine.separator::block": {
		label: "方块",
		description: "实心方块",
	},
	"statusLine.separator::none": {
		label: "无",
		description: "仅空格",
	},
	"statusLine.separator::ascii": {
		label: "ASCII",
		description: "大于号",
	},
	"tools.artifactSpillThreshold::1": {
		label: "1 KB",
		description: "约 250 token",
	},
	"tools.artifactSpillThreshold::2.5": {
		label: "2.5 KB",
		description: "约 625 token",
	},
	"tools.artifactSpillThreshold::5": {
		label: "5 KB",
		description: "约 1.25K token",
	},
	"tools.artifactSpillThreshold::10": {
		label: "10 KB",
		description: "约 2.5K token",
	},
	"tools.artifactSpillThreshold::20": {
		label: "20 KB",
		description: "约 5K token",
	},
	"tools.artifactSpillThreshold::30": {
		label: "30 KB",
		description: "约 7.5K token",
	},
	"tools.artifactSpillThreshold::50": {
		label: "50 KB",
		description: "默认；约 12.5K token",
	},
	"tools.artifactSpillThreshold::75": {
		label: "75 KB",
		description: "约 19K token",
	},
	"tools.artifactSpillThreshold::100": {
		label: "100 KB",
		description: "约 25K token",
	},
	"tools.artifactSpillThreshold::200": {
		label: "200 KB",
		description: "约 50K token",
	},
	"tools.artifactSpillThreshold::500": {
		label: "500 KB",
		description: "约 125K token",
	},
	"tools.artifactSpillThreshold::1000": {
		label: "1 MB",
		description: "约 250K token",
	},
	"tools.artifactTailBytes::1": {
		label: "1 KB",
		description: "约 250 token",
	},
	"tools.artifactTailBytes::2.5": {
		label: "2.5 KB",
		description: "约 625 token",
	},
	"tools.artifactTailBytes::5": {
		label: "5 KB",
		description: "约 1.25K token",
	},
	"tools.artifactTailBytes::10": {
		label: "10 KB",
		description: "约 2.5K token",
	},
	"tools.artifactTailBytes::20": {
		label: "20 KB",
		description: "默认；约 5K token",
	},
	"tools.artifactTailBytes::50": {
		label: "50 KB",
		description: "约 12.5K token",
	},
	"tools.artifactTailBytes::100": {
		label: "100 KB",
		description: "约 25K token",
	},
	"tools.artifactTailBytes::200": {
		label: "200 KB",
		description: "约 50K token",
	},
	"tools.artifactHeadBytes::0": {
		label: "0 KB",
		description: "禁用；仅尾部截断",
	},
	"tools.artifactHeadBytes::1": {
		label: "1 KB",
		description: "约 250 token",
	},
	"tools.artifactHeadBytes::2.5": {
		label: "2.5 KB",
		description: "约 625 token",
	},
	"tools.artifactHeadBytes::5": {
		label: "5 KB",
		description: "约 1.25K token",
	},
	"tools.artifactHeadBytes::10": {
		label: "10 KB",
		description: "约 2.5K token",
	},
	"tools.artifactHeadBytes::20": {
		label: "20 KB",
		description: "默认；约 5K token",
	},
	"tools.artifactHeadBytes::50": {
		label: "50 KB",
		description: "约 12.5K token",
	},
	"tools.artifactHeadBytes::100": {
		label: "100 KB",
		description: "约 25K token",
	},
	"tools.artifactHeadBytes::200": {
		label: "200 KB",
		description: "约 50K token",
	},
	"tools.outputMaxColumns::0": {
		label: "关闭",
		description: "无每行上限",
	},
	"tools.outputMaxColumns::256": {
		label: "256",
		description: "紧凑",
	},
	"tools.outputMaxColumns::512": {
		label: "512",
	},
	"tools.outputMaxColumns::768": {
		label: "768",
		description: "默认",
	},
	"tools.outputMaxColumns::1024": {
		label: "1024",
	},
	"tools.outputMaxColumns::2048": {
		label: "2048",
	},
	"tools.outputMaxColumns::4096": {
		label: "4096",
		description: "宽松",
	},
	"tools.artifactTailLines::50": {
		label: "50 行",
		description: "约 250 token",
	},
	"tools.artifactTailLines::100": {
		label: "100 行",
		description: "约 500 token",
	},
	"tools.artifactTailLines::250": {
		label: "250 行",
		description: "约 1.25K token",
	},
	"tools.artifactTailLines::500": {
		label: "500 行",
		description: "默认；约 2.5K token",
	},
	"tools.artifactTailLines::1000": {
		label: "1000 行",
		description: "约 5K token",
	},
	"tools.artifactTailLines::2000": {
		label: "2000 行",
		description: "约 10K token",
	},
	"tools.artifactTailLines::5000": {
		label: "5000 行",
		description: "约 25K token",
	},
	"display.shimmer::classic": {
		label: "经典",
		description: "柔和余弦波扫过文本",
	},
	"display.shimmer::kitt": {
		label: "KITT 扫描",
		description: "霹雳游侠 1982 红色灯光左右跳动",
	},
	"display.shimmer::disabled": {
		label: "禁用",
		description: "无动画；静态弱化文本",
	},
	"defaultThinkingLevel::auto": {
		label: "auto",
		description: "按提示词自动检测",
	},
	"defaultThinkingLevel::minimal": {
		label: "min",
		description: "极简推理（约 1k token）",
	},
	"defaultThinkingLevel::low": {
		label: "low",
		description: "轻量推理（约 2k token）",
	},
	"defaultThinkingLevel::medium": {
		label: "medium",
		description: "中等推理（约 8k token）",
	},
	"defaultThinkingLevel::high": {
		label: "high",
		description: "深度推理（约 16k token）",
	},
	"defaultThinkingLevel::xhigh": {
		label: "xhigh",
		description: "扩展推理（约 32k token）",
	},
	"defaultThinkingLevel::max": {
		label: "max",
		description: "模型支持的最大推理",
	},
	"inlineToolDescriptors::auto": {
		label: "Auto",
		description: "为 Gemini 模型内联描述符；其他模型保留在工具模式中",
	},
	"inlineToolDescriptors::on": {
		label: "开启",
		description: "始终在系统提示词中内联描述符",
	},
	"inlineToolDescriptors::off": {
		label: "关闭",
		description: "仅在服务商工具模式中保留描述符",
	},
	"personality::default": {
		label: "默认",
		description: "简洁、以证据为先的工程师；紧凑、以行动为导向的回复",
	},
	"personality::friendly": {
		label: "友好",
		description: "温暖、鼓励性的协作者，注重进展和士气",
	},
	"personality::pragmatic": {
		label: "务实",
		description: "直接、高效的工程师，注重清晰和严谨",
	},
	"personality::none": {
		label: "无",
		description: "完全省略个性块",
	},
	"temperature::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"temperature::0": {
		label: "0",
		description: "确定性",
	},
	"temperature::0.2": {
		label: "0.2",
		description: "聚焦",
	},
	"temperature::0.5": {
		label: "0.5",
		description: "均衡",
	},
	"temperature::0.7": {
		label: "0.7",
		description: "创造性",
	},
	"temperature::1": {
		label: "1",
		description: "最大多样性",
	},
	"topP::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"topP::0.1": {
		label: "0.1",
		description: "非常聚焦",
	},
	"topP::0.3": {
		label: "0.3",
		description: "聚焦",
	},
	"topP::0.5": {
		label: "0.5",
		description: "均衡",
	},
	"topP::0.9": {
		label: "0.9",
		description: "宽泛",
	},
	"topP::1": {
		label: "1",
		description: "无核过滤",
	},
	"topK::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"topK::1": {
		label: "1",
		description: "贪婪取最高 token",
	},
	"topK::20": {
		label: "20",
		description: "聚焦",
	},
	"topK::40": {
		label: "40",
		description: "均衡",
	},
	"topK::100": {
		label: "100",
		description: "宽泛",
	},
	"minP::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"minP::0.01": {
		label: "0.01",
		description: "非常宽松",
	},
	"minP::0.05": {
		label: "0.05",
		description: "均衡",
	},
	"minP::0.1": {
		label: "0.1",
		description: "严格",
	},
	"presencePenalty::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"presencePenalty::0": {
		label: "0",
		description: "无惩罚",
	},
	"presencePenalty::0.5": {
		label: "0.5",
		description: "轻度新颖",
	},
	"presencePenalty::1": {
		label: "1",
		description: "鼓励新颖",
	},
	"presencePenalty::2": {
		label: "2",
		description: "强烈新颖",
	},
	"repetitionPenalty::-1": {
		label: "默认",
		description: "使用服务商默认值",
	},
	"repetitionPenalty::0.8": {
		label: "0.8",
		description: "允许重复",
	},
	"repetitionPenalty::1": {
		label: "1",
		description: "无惩罚",
	},
	"repetitionPenalty::1.1": {
		label: "1.1",
		description: "轻度惩罚",
	},
	"repetitionPenalty::1.2": {
		label: "1.2",
		description: "均衡",
	},
	"repetitionPenalty::1.5": {
		label: "1.5",
		description: "强烈惩罚",
	},
	"textVerbosity::low": {
		label: "低",
		description: "偏好简洁响应",
	},
	"textVerbosity::medium": {
		label: "中",
		description: "兼顾简洁与详细（默认）",
	},
	"textVerbosity::high": {
		label: "高",
		description: "偏好详细响应",
	},
	"tier.openai::none": {
		label: "无",
		description: "省略 service_tier（标准处理）",
	},
	"tier.openai::auto": {
		label: "Auto",
		description: "服务商默认层级选择",
	},
	"tier.openai::default": {
		label: "默认",
		description: "标准优先级处理",
	},
	"tier.openai::flex": {
		label: "Flex",
		description: "更低的成本，可用时更高的延迟",
	},
	"tier.openai::scale": {
		label: "Scale",
		description: "可用时使用 Scale 层级额度",
	},
	"tier.openai::priority": {
		label: "Priority",
		description: "更快、成本更高（高级请求）",
	},
	"tier.anthropic::none": {
		label: "无",
		description: "标准处理",
	},
	"tier.anthropic::priority": {
		label: "Priority",
		description: '在受支持的直接 Claude 模型上启用快速模式（`speed: "fast"`）；在 Bedrock/Vertex 上忽略',
	},
	"tier.google::none": {
		label: "无",
		description: "标准处理",
	},
	"tier.google::flex": {
		label: "Flex",
		description: "更低的成本、更高的延迟（Gemini API + Vertex）",
	},
	"tier.google::priority": {
		label: "Priority",
		description: "更快、更可靠（Gemini API + Vertex）",
	},
	"tier.subagent::inherit": {
		label: "继承",
		description: "与主智能体的实时分系列层级保持一致",
	},
	"tier.subagent::none": {
		label: "无",
		description: "标准处理",
	},
	"tier.subagent::auto": {
		label: "Auto",
		description: "服务商默认层级选择（OpenAI 系列）",
	},
	"tier.subagent::default": {
		label: "默认",
		description: "标准优先级处理（OpenAI 系列）",
	},
	"tier.subagent::flex": {
		label: "Flex",
		description: "弹性容量层级（OpenAI/Google 系列）",
	},
	"tier.subagent::scale": {
		label: "Scale",
		description: "Scale 层级额度（OpenAI 系列）",
	},
	"tier.subagent::priority": {
		label: "Priority",
		description: "生成模型支持的每个系列都使用优先级",
	},
	"tier.advisor::inherit": {
		label: "继承",
		description: "与主智能体的实时分系列层级保持一致",
	},
	"tier.advisor::none": {
		label: "无",
		description: "标准处理",
	},
	"tier.advisor::auto": {
		label: "Auto",
		description: "服务商默认层级选择（OpenAI 系列）",
	},
	"tier.advisor::default": {
		label: "默认",
		description: "标准优先级处理（OpenAI 系列）",
	},
	"tier.advisor::flex": {
		label: "Flex",
		description: "弹性容量层级（OpenAI/Google 系列）",
	},
	"tier.advisor::scale": {
		label: "Scale",
		description: "Scale 层级额度（OpenAI 系列）",
	},
	"tier.advisor::priority": {
		label: "Priority",
		description: "顾问模型所属每个受支持系列都使用优先级",
	},
	"retry.maxRetries::1": {
		label: "1 次",
	},
	"retry.maxRetries::2": {
		label: "2 次",
	},
	"retry.maxRetries::3": {
		label: "3 次",
	},
	"retry.maxRetries::5": {
		label: "5 次",
	},
	"retry.maxRetries::10": {
		label: "10 次",
	},
	"retry.usageReservePct::5": {
		label: "5%",
		description: "仅在几乎耗尽时触发",
	},
	"retry.usageReservePct::10": {
		label: "10%",
		description: "均衡的安全余量",
	},
	"retry.usageReservePct::15": {
		label: "15%",
		description: "保守",
	},
	"retry.usageReservePct::20": {
		label: "20%",
		description: "提前保护",
	},
	"retry.usageReservePct::25": {
		label: "25%",
		description: "非常保守",
	},
	"retry.usageReservePolicy::confirm": {
		label: "交互确认",
		description: "交互式会话保持在主模型上直到确认；后台智能体自动回退",
	},
	"retry.usageReservePolicy::auto": {
		label: "自动回退",
		description: "始终选择下一个符合条件的已配置回退",
	},
	"retry.usageReservePolicy::fail-closed": {
		label: "失败即关闭",
		description: "不消耗预留配额，也不选择回退",
	},
	"retry.fallbackRevertPolicy::cooldown-expiry": {
		label: "冷却期结束",
		description: "抑制窗口结束后返回主模型",
	},
	"retry.fallbackRevertPolicy::never": {
		label: "从不",
		description: "保持回退模型直到手动更改",
	},
	"loop.mode::prompt": {
		label: "提示词",
		description: "将提示词作为后续消息重新提交（当前行为）",
	},
	"loop.mode::compact": {
		label: "压缩",
		description: "先压缩会话上下文，然后重新提交提示词",
	},
	"loop.mode::reset": {
		label: "重置",
		description: "先开始新会话，然后重新提交提示词",
	},
	"autocompleteMaxVisible::3": {
		label: "3 条",
	},
	"autocompleteMaxVisible::5": {
		label: "5 条",
	},
	"autocompleteMaxVisible::7": {
		label: "7 条",
	},
	"autocompleteMaxVisible::10": {
		label: "10 条",
	},
	"autocompleteMaxVisible::15": {
		label: "15 条",
	},
	"autocompleteMaxVisible::20": {
		label: "20 条",
	},
	"paste.largeMenuThreshold::0": {
		label: "关闭",
	},
	"paste.largeMenuThreshold::100": {
		label: "100 行",
	},
	"paste.largeMenuThreshold::250": {
		label: "250 行",
	},
	"paste.largeMenuThreshold::500": {
		label: "500 行",
	},
	"paste.largeMenuThreshold::1000": {
		label: "1000 行",
	},
	"marketplace.autoUpdate::off": {
		label: "关闭",
		description: "不检查插件更新",
	},
	"marketplace.autoUpdate::notify": {
		label: "通知",
		description: "启动时检查并在有更新时通知",
	},
	"marketplace.autoUpdate::auto": {
		label: "自动",
		description: "启动时检查并自动安装更新",
	},
	"startup.changelogMode::summary": {
		label: "摘要",
		description: "显示发布与变更数量，并附 /changelog 提示",
	},
	"startup.changelogMode::expanded": {
		label: "展开",
		description: "完整显示最近的发布说明",
	},
	"startup.changelogMode::hidden": {
		label: "隐藏",
		description: "启动时不显示发布说明",
	},
	"ask.timeout::0": {
		label: "禁用",
	},
	"ask.timeout::15": {
		label: "15 秒",
	},
	"ask.timeout::30": {
		label: "30 秒",
	},
	"ask.timeout::60": {
		label: "60 秒",
	},
	"ask.timeout::120": {
		label: "120 秒",
	},
	"recap.idleSeconds::60": {
		label: "1 分钟",
	},
	"recap.idleSeconds::120": {
		label: "2 分钟",
	},
	"recap.idleSeconds::240": {
		label: "4 分钟",
	},
	"recap.idleSeconds::300": {
		label: "5 分钟",
	},
	"recap.idleSeconds::600": {
		label: "10 分钟",
	},
	"share.store::blob": {
		label: "加密 Blob",
		description: "上传到分享服务器（无需 GitHub 账户；避免 gist API 限流）",
	},
	"share.store::gist": {
		label: "GitHub Gist",
		description: "推送到私有 gist（需要已认证的 gh），失败时回退到分享服务器",
	},
	"stt.modelName::fast": {
		label: "快速（Whisper base）",
		description: "Whisper base，多语言。最小 + 最快；准确率最低。最适合低资源机器。",
	},
	"stt.modelName::balanced": {
		label: "均衡（Whisper small）",
		description: "Whisper small，多语言。比 Fast 更准确，CPU/内存占用仍然很轻。",
	},
	"stt.modelName::turbo": {
		label: "Turbo（Whisper large-v3）",
		description: "Whisper large-v3-turbo，99 种语言。语言覆盖最广；下载量大，速度较慢。",
	},
	"stt.modelName::parakeet": {
		label: "Parakeet TDT v3（SoTA）",
		description: "NVIDIA Parakeet TDT 0.6B v3，25 种语言。Open ASR 排行榜领先者——最佳准确率和最快的解码速度。默认。",
	},
	"stt.submitTrigger::never": {
		label: "从不",
		description: "从不自动提交；插入听写内容并停留在编辑器中。",
	},
	"stt.submitTrigger::release": {
		label: "松开",
		description: "松开时若语音包含 2 个以上词则提交，避免误发。",
	},
	"stt.submitTrigger::release-complete": {
		label: "松开且为完整句子",
		description: "松开时若语音以句末标点（. ? ! 等）结尾则提交。",
	},
	"stt.submitTrigger::say-submit": {
		label: '当我说"提交"时',
		description: '若语音以包含 "submit" 的词结尾则提交（提交前会去掉该词）。',
	},
	"compaction.strategy::context-full": {
		label: "完整上下文",
		description: "就地摘要并保留当前会话",
	},
	"compaction.strategy::handoff": {
		label: "交接",
		description: "生成交接并在新会话中继续",
	},
	"compaction.strategy::shake": {
		label: "抖动",
		description: "就地丢弃重内容（工具结果 + 大块）；可通过工件恢复",
	},
	"compaction.strategy::snapcompact": {
		label: "Snapcompact",
		description: "将历史归档到模型可读回的密集位图图像上；无需 LLM 调用",
	},
	"compaction.strategy::off": {
		label: "关闭",
		description: "禁用自动上下文维护（与自动压缩关闭行为相同）",
	},
	"compaction.thresholdPercent::default": {
		label: "默认",
		description: "旧的基于预留的阈值",
	},
	"compaction.thresholdPercent::10": {
		label: "10%",
		description: "极早维护",
	},
	"compaction.thresholdPercent::20": {
		label: "20%",
		description: "很早维护",
	},
	"compaction.thresholdPercent::30": {
		label: "30%",
		description: "较早维护",
	},
	"compaction.thresholdPercent::40": {
		label: "40%",
		description: "适度提前维护",
	},
	"compaction.thresholdPercent::50": {
		label: "50%",
		description: "中间点",
	},
	"compaction.thresholdPercent::60": {
		label: "60%",
		description: "中等上下文使用",
	},
	"compaction.thresholdPercent::70": {
		label: "70%",
		description: "均衡",
	},
	"compaction.thresholdPercent::75": {
		label: "75%",
		description: "略激进",
	},
	"compaction.thresholdPercent::80": {
		label: "80%",
		description: "典型阈值",
	},
	"compaction.thresholdPercent::85": {
		label: "85%",
		description: "激进的上下文使用",
	},
	"compaction.thresholdPercent::90": {
		label: "90%",
		description: "非常激进",
	},
	"compaction.thresholdPercent::95": {
		label: "95%",
		description: "接近上下文限制",
	},
	"compaction.thresholdTokens::default": {
		label: "默认",
		description: "使用基于百分比的阈值",
	},
	"compaction.thresholdTokens::25000": {
		label: "25K token",
		description: "200K 窗口的四分之一",
	},
	"compaction.thresholdTokens::50000": {
		label: "50K token",
		description: "200K 窗口的一半",
	},
	"compaction.thresholdTokens::100000": {
		label: "100K token",
		description: "200K 窗口的一半",
	},
	"compaction.thresholdTokens::150000": {
		label: "150K token",
		description: "200K 窗口的四分之三",
	},
	"compaction.thresholdTokens::200000": {
		label: "200K token",
		description: "完整标准上下文窗口",
	},
	"compaction.thresholdTokens::300000": {
		label: "300K token",
		description: "大上下文窗口",
	},
	"compaction.thresholdTokens::500000": {
		label: "500K token",
		description: "超大上下文窗口",
	},
	"compaction.idleThresholdTokens::100000": {
		label: "100K token",
	},
	"compaction.idleThresholdTokens::200000": {
		label: "200K token",
	},
	"compaction.idleThresholdTokens::300000": {
		label: "300K token",
	},
	"compaction.idleThresholdTokens::400000": {
		label: "400K token",
	},
	"compaction.idleThresholdTokens::500000": {
		label: "500K token",
	},
	"compaction.idleThresholdTokens::600000": {
		label: "600K token",
	},
	"compaction.idleThresholdTokens::700000": {
		label: "700K token",
	},
	"compaction.idleThresholdTokens::800000": {
		label: "800K token",
	},
	"compaction.idleThresholdTokens::900000": {
		label: "900K token",
	},
	"compaction.idleTimeoutSeconds::60": {
		label: "1 分钟",
	},
	"compaction.idleTimeoutSeconds::120": {
		label: "2 分钟",
	},
	"compaction.idleTimeoutSeconds::300": {
		label: "5 分钟",
	},
	"compaction.idleTimeoutSeconds::600": {
		label: "10 分钟",
	},
	"compaction.idleTimeoutSeconds::1800": {
		label: "30 分钟",
	},
	"compaction.idleTimeoutSeconds::3600": {
		label: "1 小时",
	},
	"snapcompact.systemPrompt::none": {
		label: "无",
		description: "将系统提示词保留为文本。",
	},
	"snapcompact.systemPrompt::agents-md": {
		label: "AGENTS.md",
		description: "仅在节省 token 时，将已加载的上下文文件指令移动到图像。",
	},
	"snapcompact.systemPrompt::all": {
		label: "全部",
		description: "在节省 token 时，将完整系统提示词移动到图像。",
	},
	"tools.format::auto": {
		label: "Auto",
		description: "使用原生工具调用，除非已知模型不支持。",
	},
	"tools.format::native": {
		label: "Native",
		description: "使用服务商原生工具调用。",
	},
	"tools.format::glm": {
		label: "GLM",
		description: "使用 GLM 风格带内工具调用。",
	},
	"tools.format::hermes": {
		label: "Hermes",
		description: "使用 Hermes 风格带内工具调用。",
	},
	"tools.format::kimi": {
		label: "Kimi",
		description: "使用 Kimi 风格带内工具调用。",
	},
	"tools.format::xml": {
		label: "XML",
		description: "使用通用 XML 带内工具调用。",
	},
	"tools.format::anthropic": {
		label: "Anthropic",
		description: "使用 Anthropic 风格带内工具调用。",
	},
	"tools.format::deepseek": {
		label: "DeepSeek",
		description: "使用 DeepSeek 风格带内工具调用。",
	},
	"tools.format::harmony": {
		label: "Harmony",
		description: "使用 Harmony 风格带内工具调用。",
	},
	"tools.format::qwen3": {
		label: "Qwen3",
		description: "使用 Qwen3 自有方言。",
	},
	"tools.format::gemini": {
		label: "Gemini",
		description: "使用 Gemini 自有方言。",
	},
	"tools.format::gemma": {
		label: "Gemma",
		description: "使用 Gemma 自有方言。",
	},
	"tools.format::minimax": {
		label: "MiniMax",
		description: "使用 MiniMax 自有方言。",
	},
	"snapcompact.shape::auto": {
		label: "Auto",
		description: "为当前模型选择调优形状，回退到其服务商系列。",
	},
	"snapcompact.shape::8x8r-bw": {
		label: "8x8 重复，黑色",
		description: "unscii 方形单元，黑色墨水，每行打印两次，副本位于浅色高亮带上。",
	},
	"snapcompact.shape::8x8r-sent": {
		label: "8x8 重复，句色",
		description: "重复网格，墨水在句子边界循环六种色调。",
	},
	"snapcompact.shape::8x8u-bw": {
		label: "8x8，黑色",
		description: "普通 unscii 方形单元，单次打印行，黑色墨水。",
	},
	"snapcompact.shape::8x8u-sent": {
		label: "8x8，句色",
		description: "普通 unscii 方形单元，句色墨水。",
	},
	"snapcompact.shape::6x6u-bw": {
		label: "6x6 密集，黑色",
		description: "unscii 压缩到 6x6——最密集的可读单元，帧数最少——黑色墨水。",
	},
	"snapcompact.shape::6x6u-sent": {
		label: "6x6 密集，句色",
		description: "最密集单元，句色墨水。",
	},
	"snapcompact.shape::5x8-bw": {
		label: "5x8 传统，黑色",
		description: "2576px 帧上的原始 X.org 5x8 字形，黑色墨水。",
	},
	"snapcompact.shape::5x8-sent": {
		label: "5x8 传统，句色",
		description: "原始 snapcompact 形状（形状表之前的会话曾渲染此形状）。",
	},
	"snapcompact.shape::6x12-dim": {
		label: "6x12，虚词变暗",
		description: "X.org 6x12 字形，黑色墨水，功能词变暗为灰色。",
	},
	"snapcompact.shape::8x13-bw": {
		label: "8x13，黑色",
		description: "X.org 8x13 字形，黑色墨水。",
	},
	"snapcompact.shape::8on16-bw": {
		label: "16px 间距上的 8x13，黑色",
		description: "8x16 单元上的 8x13 字形（额外行距），黑色墨水。",
	},
	"snapcompact.shape::8on22-bw": {
		label: "22px 间距上的 8x13（行距），黑色",
		description: "8x22 单元上的 8x13 字形——额外行距使行不拥挤。OpenAI/Google 的默认值。",
	},
	"snapcompact.shape::11on16-bw": {
		label: "11px 字距上的 8x13（字距），黑色",
		description: "11x16 单元上的 8x13 字形——额外字距使字符不粘连。Anthropic 的默认值。",
	},
	"snapcompact.shape::silver16-bw": {
		label: "Silver 16，CJK",
		description: "16px 网格上的嵌入式 Silver TrueType 字体，用于 CJK 和其他非拉丁文本。",
	},
	"snapcompact.shape::doc-8on16-bw": {
		label: "文档 8on16，黑色",
		description: "16px 间距上两列自动换行的报纸式 8x13 字形，黑色墨水。",
	},
	"snapcompact.shape::doc-8on16-sent": {
		label: "文档 8on16，句色",
		description: "双列文档布局，句色墨水。",
	},
	"snapcompact.shape::doc-8on16-sent-dim": {
		label: "文档 8on16，句色 + 虚词变暗",
		description: "双列文档布局，句色墨水，功能词变暗为灰色。",
	},
	"memory.backend::off": {
		label: "关闭",
		description: "不运行任何记忆子系统",
	},
	"memory.backend::local": {
		label: "本地",
		description: "本地滚动摘要管线（memory_summary.md）",
	},
	"memory.backend::hindsight": {
		label: "Hindsight",
		description: "向量化 Hindsight 远程记忆服务",
	},
	"memory.backend::mnemopi": {
		label: "Mnemopi",
		description: "本地 SQLite 回忆/保留后端，可选嵌入",
	},
	"mnemopi.scoping::global": {
		label: "全局",
		description: "每个项目共用一个 Mnemopi 存储库",
	},
	"mnemopi.scoping::per-project": {
		label: "按项目",
		description: "每个 cwd 基名一个项目本地 Mnemopi 存储库",
	},
	"mnemopi.scoping::per-project-tagged": {
		label: "按项目（带标签）",
		description: "写入项目本地存储库，但合并项目 + 共享的回忆结果",
	},
	"mnemopi.embeddingVariant::en": {
		label: "英文（bge-base-en-v1.5）",
		description: "BAAI/bge-base-en-v1.5（768d），仅英文",
	},
	"mnemopi.embeddingVariant::multilingual": {
		label: "多语言（multilingual-e5-large）",
		description: "intfloat/multilingual-e5-large（1024d），跨语言回忆",
	},
	"mnemopi.llmMode::none": {
		label: "无",
		description: "禁用 Mnemopi 基于 LLM 的提取",
	},
	"mnemopi.llmMode::smol": {
		label: "在线（微型）",
		description: "使用在线微型模型（/models 中的 TINY 角色，否则 @smol）",
	},
	"mnemopi.llmMode::remote": {
		label: "远程",
		description: "使用下方的 Mnemopi 远程 LLM 设置",
	},
	"hindsight.scoping::global": {
		label: "全局",
		description: "一个共享存储库——每个项目看到相同的记忆",
	},
	"hindsight.scoping::per-project": {
		label: "按项目",
		description: "每个 cwd 基名一个隔离存储库——项目之间看不到彼此的记忆",
	},
	"hindsight.scoping::per-project-tagged": {
		label: "按项目（带标签）",
		description: "共享存储库，保留内容以 project:<cwd> 标记。回忆同时呈现项目 + 未标记的全局记忆",
	},
	"hindsight.retainMode::full-session": {
		label: "完整会话",
		description: "每个会话 upsert 一个文档（推荐）",
	},
	"hindsight.retainMode::last-turn": {
		label: "最后一轮",
		description: "按轮次边界切分的分块保留",
	},
	"ttsr.interruptMode::always": {
		label: "always",
		description: "散文和工具流都中断",
	},
	"ttsr.interruptMode::prose-only": {
		label: "prose-only",
		description: "仅在回复/思考匹配时中断",
	},
	"ttsr.interruptMode::tool-only": {
		label: "tool-only",
		description: "仅在工具调用参数匹配时中断",
	},
	"ttsr.interruptMode::never": {
		label: "never",
		description: "从不中断；完成后注入警告",
	},
	"ttsr.repeatGap::5": {
		label: "5 条消息",
	},
	"ttsr.repeatGap::10": {
		label: "10 条消息",
	},
	"ttsr.repeatGap::15": {
		label: "15 条消息",
	},
	"ttsr.repeatGap::20": {
		label: "20 条消息",
	},
	"ttsr.repeatGap::30": {
		label: "30 条消息",
	},
	"edit.fuzzyThreshold::0.85": {
		label: "0.85",
		description: "宽松",
	},
	"edit.fuzzyThreshold::0.90": {
		label: "0.90",
		description: "适中",
	},
	"edit.fuzzyThreshold::0.95": {
		label: "0.95",
		description: "默认",
	},
	"edit.fuzzyThreshold::0.98": {
		label: "0.98",
		description: "严格",
	},
	"read.defaultLimit::200": {
		label: "200 行",
	},
	"read.defaultLimit::300": {
		label: "300 行",
	},
	"read.defaultLimit::500": {
		label: "500 行",
	},
	"read.defaultLimit::1000": {
		label: "1000 行",
	},
	"read.defaultLimit::5000": {
		label: "5000 行",
	},
	"tools.approvalMode::always-ask": {
		label: "总是询问",
		description: "自动批准只读工具；写入和执行工具需要确认。",
	},
	"tools.approvalMode::write": {
		label: "写入",
		description: "自动批准只读和写入工具；bash、eval、browser、task 等执行工具需要确认。",
	},
	"tools.approvalMode::yolo": {
		label: "Yolo",
		description: "自动批准读取、写入和执行工具。用户策略仍可要求确认或阻止调用。",
	},
	"todo.remindersMax::1": {
		label: "1 次",
	},
	"todo.remindersMax::2": {
		label: "2 次",
	},
	"todo.remindersMax::3": {
		label: "3 次",
	},
	"todo.remindersMax::5": {
		label: "5 次",
	},
	"todo.eager::default": {
		label: "默认",
		description: "由模型决定；不自动创建待办列表",
	},
	"todo.eager::preferred": {
		label: "偏好",
		description: "在第一条消息时建议待办列表（提醒而非强制）",
	},
	"todo.eager::always": {
		label: "总是",
		description: "在第一条消息时强制创建完整待办列表",
	},
	"grep.contextBefore::0": {
		label: "0 行",
	},
	"grep.contextBefore::1": {
		label: "1 行",
	},
	"grep.contextBefore::2": {
		label: "2 行",
	},
	"grep.contextBefore::3": {
		label: "3 行",
	},
	"grep.contextBefore::5": {
		label: "5 行",
	},
	"grep.contextAfter::0": {
		label: "0 行",
	},
	"grep.contextAfter::1": {
		label: "1 行",
	},
	"grep.contextAfter::2": {
		label: "2 行",
	},
	"grep.contextAfter::3": {
		label: "3 行",
	},
	"grep.contextAfter::5": {
		label: "5 行",
	},
	"grep.contextAfter::10": {
		label: "10 行",
	},
	"inspect_image.mode::auto": {
		label: "Auto（仅限无视觉模型）",
	},
	"inspect_image.mode::on": {
		label: "开启",
	},
	"inspect_image.mode::off": {
		label: "关闭",
	},
	"inspect_image.timeoutMs::0": {
		label: "禁用",
	},
	"inspect_image.timeoutMs::60000": {
		label: "1 分钟",
	},
	"inspect_image.timeoutMs::120000": {
		label: "2 分钟",
	},
	"inspect_image.timeoutMs::180000": {
		label: "3 分钟",
	},
	"inspect_image.timeoutMs::300000": {
		label: "5 分钟",
	},
	"tools.maxTimeout::0": {
		label: "无限制",
	},
	"tools.maxTimeout::30": {
		label: "30 秒",
	},
	"tools.maxTimeout::60": {
		label: "60 秒",
	},
	"tools.maxTimeout::120": {
		label: "120 秒",
	},
	"tools.maxTimeout::300": {
		label: "5 分钟",
	},
	"tools.maxTimeout::600": {
		label: "10 分钟",
	},
	"async.pollWaitDuration::5s": {
		label: "5 秒",
	},
	"async.pollWaitDuration::10s": {
		label: "10 秒",
	},
	"async.pollWaitDuration::30s": {
		label: "30 秒",
	},
	"async.pollWaitDuration::1m": {
		label: "1 分钟",
	},
	"async.pollWaitDuration::5m": {
		label: "5 分钟",
	},
	"async.pollWaitDuration::smart": {
		label: "智能",
		description: "默认——自适应 5 秒→5 分钟，停止轮询时重置",
	},
	"irc.timeoutMs::0": {
		label: "禁用",
	},
	"irc.timeoutMs::30000": {
		label: "30 秒",
	},
	"irc.timeoutMs::60000": {
		label: "1 分钟",
	},
	"irc.timeoutMs::120000": {
		label: "2 分钟",
	},
	"irc.timeoutMs::300000": {
		label: "5 分钟",
	},
	"tools.xdevDocs::inline": {
		label: "所有设备",
		description: "内联每个已挂载设备的文档和模式。",
	},
	"tools.xdevDocs::builtins": {
		label: "仅内置",
		description: "内联内置文档；按需获取 MCP 和扩展文档。",
	},
	"tools.xdevDocs::catalog": {
		label: "仅目录",
		description: "列出每个设备；按需获取所有文档。",
	},
	"task.isolation.mode::none": {
		label: "无",
		description: "无隔离",
	},
	"task.isolation.mode::auto": {
		label: "自动",
		description: "让 PAL 选择最佳可用后端",
	},
	"task.isolation.mode::apfs": {
		label: "APFS",
		description: "macOS clonefile reflink（APFS）",
	},
	"task.isolation.mode::btrfs": {
		label: "btrfs",
		description: "btrfs 子卷快照",
	},
	"task.isolation.mode::zfs": {
		label: "ZFS",
		description: "ZFS 快照 + 克隆",
	},
	"task.isolation.mode::reflink": {
		label: "Reflink",
		description: "Linux FICLONE 逐文件 reflink",
	},
	"task.isolation.mode::overlayfs": {
		label: "Overlayfs",
		description: "Linux 内核 overlay（或 fuse-overlayfs 回退）",
	},
	"task.isolation.mode::projfs": {
		label: "ProjFS",
		description: "Windows 投影文件系统",
	},
	"task.isolation.mode::block-clone": {
		label: "块克隆",
		description: "Windows FSCTL_DUPLICATE_EXTENTS_TO_FILE（NTFS/ReFS）",
	},
	"task.isolation.mode::rcopy": {
		label: "递归复制",
		description: "可用时用 git worktree，否则递归复制",
	},
	"task.isolation.merge::patch": {
		label: "补丁",
		description: "合并 diff 并 git apply",
	},
	"task.isolation.merge::branch": {
		label: "分支",
		description: "每任务提交，使用 --no-ff 合并",
	},
	"task.isolation.commits::generic": {
		label: "通用",
		description: "静态提交消息",
	},
	"task.isolation.commits::ai": {
		label: "AI",
		description: "根据 diff 由 AI 生成提交消息",
	},
	"task.eager::default": {
		label: "默认",
		description: "由模型决定何时委派",
	},
	"task.eager::preferred": {
		label: "偏好",
		description: "在系统提示词中添加委派指导",
	},
	"task.eager::always": {
		label: "总是",
		description: "提示词指导加首轮委派提醒",
	},
	"task.maxConcurrency::0": {
		label: "无限制",
	},
	"task.maxConcurrency::1": {
		label: "1 个任务",
	},
	"task.maxConcurrency::2": {
		label: "2 个任务",
	},
	"task.maxConcurrency::4": {
		label: "4 个任务",
	},
	"task.maxConcurrency::8": {
		label: "8 个任务",
	},
	"task.maxConcurrency::16": {
		label: "16 个任务",
	},
	"task.maxConcurrency::32": {
		label: "32 个任务",
	},
	"task.maxConcurrency::64": {
		label: "64 个任务",
	},
	"task.maxRecursionDepth::-1": {
		label: "无限制",
	},
	"task.maxRecursionDepth::0": {
		label: "无",
	},
	"task.maxRecursionDepth::1": {
		label: "单层",
	},
	"task.maxRecursionDepth::2": {
		label: "双层",
	},
	"task.maxRecursionDepth::3": {
		label: "三层",
	},
	"task.maxRuntimeMs::0": {
		label: "无限制",
		description: "默认",
	},
	"task.maxRuntimeMs::300000": {
		label: "5 分钟",
	},
	"task.maxRuntimeMs::900000": {
		label: "15 分钟",
	},
	"task.maxRuntimeMs::1800000": {
		label: "30 分钟",
	},
	"task.maxRuntimeMs::3600000": {
		label: "1 小时",
	},
	"task.softRequestBudget::0": {
		label: "禁用",
	},
	"task.softRequestBudget::90": {
		label: "90 次请求",
	},
	"task.softRequestBudget::150": {
		label: "150 次请求",
	},
	"task.softRequestBudget::200": {
		label: "200 次请求",
		description: "默认",
	},
	"task.maxEffort::minimal": {
		label: "min",
		description: "极简推理（约 1k token）",
	},
	"task.maxEffort::low": {
		label: "low",
		description: "轻量推理（约 2k token）",
	},
	"task.maxEffort::medium": {
		label: "medium",
		description: "中等推理（约 8k token）",
	},
	"task.maxEffort::high": {
		label: "high",
		description: "深度推理（约 16k token）",
	},
	"task.maxEffort::xhigh": {
		label: "xhigh",
		description: "扩展推理（约 32k token）",
	},
	"task.maxEffort::max": {
		label: "max",
		description: "模型支持的最大推理",
	},
	"tasks.todoClearDelay::0": {
		label: "立即",
	},
	"tasks.todoClearDelay::60": {
		label: "1 分钟",
		description: "默认",
	},
	"tasks.todoClearDelay::300": {
		label: "5 分钟",
	},
	"tasks.todoClearDelay::900": {
		label: "15 分钟",
	},
	"tasks.todoClearDelay::1800": {
		label: "30 分钟",
	},
	"tasks.todoClearDelay::3600": {
		label: "1 小时",
	},
	"tasks.todoClearDelay::-1": {
		label: "从不",
	},
	"providers.webSearchOrder::perplexity": {
		label: "Perplexity",
		description: "配置后使用认证；显式选择时回退到匿名搜索",
	},
	"providers.webSearchOrder::gemini": {
		label: "Gemini",
		description: "通过 Gemini 进行 Google 搜索接地（使用 google-gemini-cli 或 google-antigravity OAuth）",
	},
	"providers.webSearchOrder::anthropic": {
		label: "Anthropic",
		description: "Claude 的原生 web_search 工具（使用 Anthropic OAuth 或 ANTHROPIC_API_KEY）",
	},
	"providers.webSearchOrder::codex": {
		label: "OpenAI",
		description: "OpenAI 的原生 web_search（通过 /login openai-codex 使用 ChatGPT OAuth）",
	},
	"providers.webSearchOrder::xai": {
		label: "xAI",
		description:
			"通过 xAI Responses API 进行 Grok 网络搜索（通过 /login xai-oauth 使用 SuperGrok/X Premium+ OAuth，或 XAI_API_KEY）",
	},
	"providers.webSearchOrder::zai": {
		label: "Z.AI",
		description: "调用 Z.AI webSearchPrime MCP",
	},
	"providers.webSearchOrder::exa": {
		label: "Exa",
		description: "通过 /login exa 或 EXA_API_KEY 使用 API；通过 MCP 显式无密钥回退",
	},
	"providers.webSearchOrder::tinyfish": {
		label: "TinyFish",
		description: "需要 TINYFISH_API_KEY",
	},
	"providers.webSearchOrder::jina": {
		label: "Jina",
		description: "需要 JINA_API_KEY",
	},
	"providers.webSearchOrder::kagi": {
		label: "Kagi",
		description: "需要 KAGI_API_KEY 和 Kagi Search API 测试版访问权限",
	},
	"providers.webSearchOrder::tavily": {
		label: "Tavily",
		description: "需要 TAVILY_API_KEY",
	},
	"providers.webSearchOrder::firecrawl": {
		label: "Firecrawl",
		description: "设置 FIRECRAWL_API_KEY 时使用 Firecrawl API；否则回退到无密钥模式",
	},
	"providers.webSearchOrder::brave": {
		label: "Brave",
		description: "需要 BRAVE_API_KEY",
	},
	"providers.webSearchOrder::kimi": {
		label: "Kimi",
		description:
			"Kimi Code 搜索（需要 KIMI_SEARCH_API_KEY/MOONSHOT_SEARCH_API_KEY 或 /login kimi-code 获取 Kimi Code Console 密钥；不是 MOONSHOT_API_KEY）",
	},
	"providers.webSearchOrder::parallel": {
		label: "Parallel",
		description: "需要 PARALLEL_API_KEY",
	},
	"providers.webSearchOrder::synthetic": {
		label: "Synthetic",
		description: "需要 SYNTHETIC_API_KEY",
	},
	"providers.webSearchOrder::searxng": {
		label: "SearXNG",
		description: "需要 SEARXNG_ENDPOINT 或 searxng.endpoint",
	},
	"providers.webSearchOrder::startpage": {
		label: "Startpage",
		description: "无凭据抓取 Startpage（Google 支持）结果；可能遭遇机器人验证",
	},
	"providers.webSearchOrder::duckduckgo": {
		label: "DuckDuckGo",
		description: "无凭据尽力而为的回退；在数据中心/共享出口 IP 上可能遭遇机器人验证",
	},
	"providers.webSearchOrder::ecosia": {
		label: "Ecosia",
		description: "无凭据浏览器抓取 Ecosia（Google 支持）结果",
	},
	"providers.webSearchOrder::google": {
		label: "Google",
		description: "无凭据浏览器回退；较慢，可能遭遇机器人验证",
	},
	"providers.webSearchOrder::mojeek": {
		label: "Mojeek",
		description: "无凭据浏览器抓取 Mojeek 独立索引",
	},
	"providers.webSearchOrder::public": {
		label: "公共网络",
		description: "并行查询所有无凭据引擎并整合去重结果",
	},
	"providers.webSearchExclude::perplexity": {
		label: "Perplexity",
		description: "配置后使用认证；显式选择时回退到匿名搜索",
	},
	"providers.webSearchExclude::gemini": {
		label: "Gemini",
		description: "通过 Gemini 进行 Google 搜索接地（使用 google-gemini-cli 或 google-antigravity OAuth）",
	},
	"providers.webSearchExclude::anthropic": {
		label: "Anthropic",
		description: "Claude 的原生 web_search 工具（使用 Anthropic OAuth 或 ANTHROPIC_API_KEY）",
	},
	"providers.webSearchExclude::codex": {
		label: "OpenAI",
		description: "OpenAI 的原生 web_search（通过 /login openai-codex 使用 ChatGPT OAuth）",
	},
	"providers.webSearchExclude::xai": {
		label: "xAI",
		description:
			"通过 xAI Responses API 进行 Grok 网络搜索（通过 /login xai-oauth 使用 SuperGrok/X Premium+ OAuth，或 XAI_API_KEY）",
	},
	"providers.webSearchExclude::zai": {
		label: "Z.AI",
		description: "调用 Z.AI webSearchPrime MCP",
	},
	"providers.webSearchExclude::exa": {
		label: "Exa",
		description: "通过 /login exa 或 EXA_API_KEY 使用 API；通过 MCP 显式无密钥回退",
	},
	"providers.webSearchExclude::tinyfish": {
		label: "TinyFish",
		description: "需要 TINYFISH_API_KEY",
	},
	"providers.webSearchExclude::jina": {
		label: "Jina",
		description: "需要 JINA_API_KEY",
	},
	"providers.webSearchExclude::kagi": {
		label: "Kagi",
		description: "需要 KAGI_API_KEY 和 Kagi Search API 测试版访问权限",
	},
	"providers.webSearchExclude::tavily": {
		label: "Tavily",
		description: "需要 TAVILY_API_KEY",
	},
	"providers.webSearchExclude::firecrawl": {
		label: "Firecrawl",
		description: "设置 FIRECRAWL_API_KEY 时使用 Firecrawl API；否则回退到无密钥模式",
	},
	"providers.webSearchExclude::brave": {
		label: "Brave",
		description: "需要 BRAVE_API_KEY",
	},
	"providers.webSearchExclude::kimi": {
		label: "Kimi",
		description:
			"Kimi Code 搜索（需要 KIMI_SEARCH_API_KEY/MOONSHOT_SEARCH_API_KEY 或 /login kimi-code 获取 Kimi Code Console 密钥；不是 MOONSHOT_API_KEY）",
	},
	"providers.webSearchExclude::parallel": {
		label: "Parallel",
		description: "需要 PARALLEL_API_KEY",
	},
	"providers.webSearchExclude::synthetic": {
		label: "Synthetic",
		description: "需要 SYNTHETIC_API_KEY",
	},
	"providers.webSearchExclude::searxng": {
		label: "SearXNG",
		description: "需要 SEARXNG_ENDPOINT 或 searxng.endpoint",
	},
	"providers.webSearchExclude::startpage": {
		label: "Startpage",
		description: "无凭据抓取 Startpage（Google 支持）结果；可能遭遇机器人验证",
	},
	"providers.webSearchExclude::duckduckgo": {
		label: "DuckDuckGo",
		description: "无凭据尽力而为的回退；在数据中心/共享出口 IP 上可能遭遇机器人验证",
	},
	"providers.webSearchExclude::ecosia": {
		label: "Ecosia",
		description: "无凭据浏览器抓取 Ecosia（Google 支持）结果",
	},
	"providers.webSearchExclude::google": {
		label: "Google",
		description: "无凭据浏览器回退；较慢，可能遭遇机器人验证",
	},
	"providers.webSearchExclude::mojeek": {
		label: "Mojeek",
		description: "无凭据浏览器抓取 Mojeek 独立索引",
	},
	"providers.webSearchExclude::public": {
		label: "公共网络",
		description: "并行查询所有无凭据引擎并整合去重结果",
	},
	"providers.webSearchTimeoutSeconds::30": {
		label: "30 秒",
	},
	"providers.webSearchTimeoutSeconds::60": {
		label: "1 分钟",
	},
	"providers.webSearchTimeoutSeconds::120": {
		label: "2 分钟",
	},
	"providers.webSearchTimeoutSeconds::180": {
		label: "3 分钟",
	},
	"providers.webSearchTimeoutSeconds::300": {
		label: "5 分钟",
	},
	"providers.antigravityEndpoint::auto": {
		label: "Auto",
		description: "尝试生产端点，5xx/429 时故障转移到沙盒",
	},
	"providers.antigravityEndpoint::production": {
		label: "仅生产",
		description: "仅强制生产端点",
	},
	"providers.antigravityEndpoint::sandbox": {
		label: "仅沙盒",
		description: "仅强制沙盒端点",
	},
	"providers.imageOrder::openai": {
		label: "OpenAI",
		description: "OPENAI_API_KEY（gpt-image-2）或当前 GPT 模型；回退到已连接的 Codex 订阅",
	},
	"providers.imageOrder::openai-codex": {
		label: "OpenAI Codex（ChatGPT）",
		description: "使用已连接的 Codex / ChatGPT 订阅——无需 OPENAI_API_KEY",
	},
	"providers.imageOrder::antigravity": {
		label: "Antigravity",
		description: "需要 google-antigravity OAuth",
	},
	"providers.imageOrder::xai": {
		label: "xAI Grok Imagine",
		description: "需要 xAI Grok OAuth 或 XAI_API_KEY",
	},
	"providers.imageOrder::gemini": {
		label: "Gemini",
		description: "需要 GEMINI_API_KEY",
	},
	"providers.imageOrder::openrouter": {
		label: "OpenRouter",
		description: "需要 OPENROUTER_API_KEY",
	},
	"providers.fireworksTier::standard": {
		label: "标准",
		description: "默认提供路径（无 service_tier）",
	},
	"providers.fireworksTier::priority": {
		label: "Priority",
		description: "优先级提供路径：更高可靠性，按 token 计费更高",
	},
	"live.voice::arbor": {
		label: "Arbor",
	},
	"live.voice::breeze": {
		label: "Breeze",
	},
	"live.voice::cove": {
		label: "Cove",
	},
	"live.voice::ember": {
		label: "Ember",
	},
	"live.voice::juniper": {
		label: "Juniper",
	},
	"live.voice::maple": {
		label: "Maple",
	},
	"live.voice::sol": {
		label: "Sol",
	},
	"live.voice::spruce": {
		label: "Spruce",
	},
	"live.voice::vale": {
		label: "Vale",
	},
	"providers.tts::auto": {
		label: "Auto",
		description: "优先使用本地设备端 TTS；存在凭据时将 .mp3 输出路由到 xAI",
	},
	"providers.tts::local": {
		label: "本地",
		description: "设备端神经 TTS（Kokoro-82M）；输出为 WAV/PCM16",
	},
	"providers.tts::xai": {
		label: "xAI Grok Voice",
		description: "需要 xAI Grok OAuth 或 XAI_API_KEY；MP3 或 WAV",
	},
	"tts.localModel::kokoro": {
		label: "Kokoro-82M",
		description: "Kokoro-82M 神经 TTS——设备端最优质、多音色、完全本地",
	},
	"tts.localVoice::af_heart": {
		label: "Heart（美式女声）",
	},
	"tts.localVoice::af_bella": {
		label: "Bella（美式女声）",
	},
	"tts.localVoice::af_nicole": {
		label: "Nicole（美式女声）",
	},
	"tts.localVoice::af_aoede": {
		label: "Aoede（美式女声）",
	},
	"tts.localVoice::af_kore": {
		label: "Kore（美式女声）",
	},
	"tts.localVoice::af_sarah": {
		label: "Sarah（美式女声）",
	},
	"tts.localVoice::am_michael": {
		label: "Michael（美式男声）",
	},
	"tts.localVoice::am_fenrir": {
		label: "Fenrir（美式男声）",
	},
	"tts.localVoice::am_puck": {
		label: "Puck（美式男声）",
	},
	"tts.localVoice::bf_emma": {
		label: "Emma（英式女声）",
	},
	"tts.localVoice::bm_george": {
		label: "George（英式男声）",
	},
	"tts.localVoice::bm_fable": {
		label: "Fable（英式男声）",
	},
	"speech.mode::all": {
		label: "全部（消息 + 思考）",
	},
	"speech.mode::assistant": {
		label: "助手消息",
	},
	"speech.mode::yield": {
		label: "仅最终消息",
	},
	"speech.voice::af_heart": {
		label: "Heart（美式女声）",
	},
	"speech.voice::af_bella": {
		label: "Bella（美式女声）",
	},
	"speech.voice::af_nicole": {
		label: "Nicole（美式女声）",
	},
	"speech.voice::af_aoede": {
		label: "Aoede（美式女声）",
	},
	"speech.voice::af_kore": {
		label: "Kore（美式女声）",
	},
	"speech.voice::af_sarah": {
		label: "Sarah（美式女声）",
	},
	"speech.voice::am_michael": {
		label: "Michael（美式男声）",
	},
	"speech.voice::am_fenrir": {
		label: "Fenrir（美式男声）",
	},
	"speech.voice::am_puck": {
		label: "Puck（美式男声）",
	},
	"speech.voice::bf_emma": {
		label: "Emma（英式女声）",
	},
	"speech.voice::bm_george": {
		label: "George（英式男声）",
	},
	"speech.voice::bm_fable": {
		label: "Fable（英式男声）",
	},
	"providers.tinyModel::online": {
		label: "在线（TINY 角色，否则 @smol）",
		description:
			"在线标题生成：已分配时使用 TINY 模型角色（在 /models 中设置），否则使用在线回退（commit 角色，然后 @smol）。无本地下载或设备端推理。",
	},
	"providers.tinyModel::lfm2-350m": {
		label: "LFM2 350M",
		description: "推荐的本地模型；最佳速度/质量平衡，缓存约 212 MB。",
	},
	"providers.tinyModel::qwen3-0.6b": {
		label: "Qwen3 0.6B",
		description: "最稳健的本地选项；首次加载较慢，缓存约 500 MB。",
	},
	"providers.tinyModel::gemma-270m": {
		label: "Gemma 270M",
		description: "最小可行的本地选项；质量较低，缓存占用最低。",
	},
	"providers.tinyModel::qwen2.5-0.5b": {
		label: "Qwen2.5 0.5B",
		description: "均衡的本地回退；适中的质量和缓存占用。",
	},
	"providers.tinyModel::lfm2-700m": {
		label: "LFM2 700M",
		description: "最高质量的本地选项；比 LFM2 350M 更大更慢。",
	},
	"providers.tinyModelDevice::default": {
		label: "默认",
		description: "仅 CPU 推理",
	},
	"providers.tinyModelDevice::gpu": {
		label: "GPU",
		description: "加速提供程序（WebGPU/Metal、CUDA 或 DirectML）",
	},
	"providers.tinyModelDevice::cpu": {
		label: "CPU",
		description: "仅 CPU 推理",
	},
	"providers.tinyModelDevice::metal": {
		label: "Metal",
		description: "Apple GPU 的 WebGPU 别名",
	},
	"providers.tinyModelDevice::webgpu": {
		label: "WebGPU",
		description: "WebGPU/Metal 后端",
	},
	"providers.tinyModelDevice::cuda": {
		label: "CUDA",
		description: "NVIDIA CUDA（Linux x64）",
	},
	"providers.tinyModelDevice::dml": {
		label: "DirectML",
		description: "DirectML 后端（Windows）",
	},
	"providers.tinyModelDevice::coreml": {
		label: "CoreML",
		description: "Apple CoreML（可选；可能加载失败）",
	},
	"providers.tinyModelDevice::auto": {
		label: "Auto",
		description: "让 ONNX Runtime 选择提供程序",
	},
	"providers.tinyModelDevice::wasm": {
		label: "WASM",
		description: "WebAssembly 后端",
	},
	"providers.tinyModelDevice::webnn": {
		label: "WebNN",
		description: "WebNN 后端",
	},
	"providers.tinyModelDevice::webnn-gpu": {
		label: "WebNN GPU",
		description: "WebNN GPU 设备",
	},
	"providers.tinyModelDevice::webnn-cpu": {
		label: "WebNN CPU",
		description: "WebNN CPU 设备",
	},
	"providers.tinyModelDevice::webnn-npu": {
		label: "WebNN NPU",
		description: "WebNN NPU 设备",
	},
	"providers.tinyModelDtype::default": {
		label: "默认",
		description: "每个模型自带的 dtype（当前为 q4）",
	},
	"providers.tinyModelDtype::q4": {
		label: "q4",
		description: "4 位权重；最小最快",
	},
	"providers.tinyModelDtype::q4f16": {
		label: "q4f16",
		description: "4 位权重 + fp16 激活",
	},
	"providers.tinyModelDtype::q8": {
		label: "q8",
		description: "8 位量化",
	},
	"providers.tinyModelDtype::fp16": {
		label: "fp16",
		description: "16 位浮点；保真度更高，体积更大",
	},
	"providers.tinyModelDtype::fp32": {
		label: "fp32",
		description: "全精度；最大最慢",
	},
	"providers.tinyModelDtype::int8": {
		label: "int8",
		description: "有符号 8 位整数",
	},
	"providers.tinyModelDtype::uint8": {
		label: "uint8",
		description: "无符号 8 位整数",
	},
	"providers.tinyModelDtype::bnb4": {
		label: "bnb4",
		description: "bitsandbytes 4 位",
	},
	"providers.tinyModelDtype::q2": {
		label: "q2",
		description: "2 位权重",
	},
	"providers.tinyModelDtype::q2f16": {
		label: "q2f16",
		description: "2 位权重 + fp16 激活",
	},
	"providers.tinyModelDtype::q1": {
		label: "q1",
		description: "1 位权重",
	},
	"providers.tinyModelDtype::q1f16": {
		label: "q1f16",
		description: "1 位权重 + fp16 激活",
	},
	"providers.tinyModelDtype::auto": {
		label: "Auto",
		description: "让 transformers.js 按设备选择",
	},
	"providers.memoryModel::online": {
		label: "在线（TINY 角色，否则 @smol）",
		description: "使用在线模型：设置时使用 /models 中的 TINY 角色，否则 @smol。无本地模型下载或设备端推理。",
	},
	"providers.memoryModel::qwen3-1.7b": {
		label: "Qwen3 1.7B",
		description: "本地推理已禁用：onnxruntime-node 无法运行此 ONNX 导出的 RotaryEmbedding 缓存更新。",
	},
	"providers.memoryModel::llama3.2:3b": {
		label: "Llama 3.2 3B",
		description: "本地记忆/分类任务的更大 Llama 3.2 选项；质量潜力更高，但磁盘/内存/延迟成本更高。",
	},
	"providers.memoryModel::gemma-3-1b": {
		label: "Gemma 3 1B",
		description: "最佳整合/去重；占用更轻，但提取时会泄漏闲聊内容。",
	},
	"providers.memoryModel::qwen2.5-1.5b": {
		label: "Qwen2.5 1.5B",
		description: "最佳提取粒度（原子事实）；整合较弱。",
	},
	"providers.memoryModel::lfm2-1.2b": {
		label: "LFM2 1.2B",
		description: "加载最快；稳健的全能选手，提取标签略嘈杂。",
	},
	"providers.autoThinkingModel::online": {
		label: "在线（TINY 角色，否则 @smol）",
		description: "在线分类提示词难度，使用 TINY 角色模型（在 /models 中设置）或 @smol；无本地下载或设备端推理。",
	},
	"providers.autoThinkingModel::qwen3-1.7b": {
		label: "Qwen3 1.7B",
		description: "本地推理已禁用：onnxruntime-node 无法运行此 ONNX 导出的 RotaryEmbedding 缓存更新。",
	},
	"providers.autoThinkingModel::llama3.2:3b": {
		label: "Llama 3.2 3B",
		description: "本地记忆/分类任务的更大 Llama 3.2 选项；质量潜力更高，但磁盘/内存/延迟成本更高。",
	},
	"providers.autoThinkingModel::gemma-3-1b": {
		label: "Gemma 3 1B",
		description: "最佳整合/去重；占用更轻，但提取时会泄漏闲聊内容。",
	},
	"providers.autoThinkingModel::qwen2.5-1.5b": {
		label: "Qwen2.5 1.5B",
		description: "最佳提取粒度（原子事实）；整合较弱。",
	},
	"providers.autoThinkingModel::lfm2-1.2b": {
		label: "LFM2 1.2B",
		description: "加载最快；稳健的全能选手，提取标签略嘈杂。",
	},
	"providers.autoThinkingMaxEffort::xhigh": {
		label: "xhigh",
		description: "分类器在 xhigh 停止（默认）",
	},
	"providers.autoThinkingMaxEffort::max": {
		label: "max",
		description: "分类器可在模型支持时解析为 max",
	},
	"providers.unexpectedStopModel::online": {
		label: "在线（TINY 角色，否则 @smol）",
		description: "使用在线模型：设置时使用 /models 中的 TINY 角色，否则 @smol。无本地模型下载或设备端推理。",
	},
	"providers.unexpectedStopModel::qwen3-1.7b": {
		label: "Qwen3 1.7B",
		description: "本地推理已禁用：onnxruntime-node 无法运行此 ONNX 导出的 RotaryEmbedding 缓存更新。",
	},
	"providers.unexpectedStopModel::llama3.2:3b": {
		label: "Llama 3.2 3B",
		description: "本地记忆/分类任务的更大 Llama 3.2 选项；质量潜力更高，但磁盘/内存/延迟成本更高。",
	},
	"providers.unexpectedStopModel::gemma-3-1b": {
		label: "Gemma 3 1B",
		description: "最佳整合/去重；占用更轻，但提取时会泄漏闲聊内容。",
	},
	"providers.unexpectedStopModel::qwen2.5-1.5b": {
		label: "Qwen2.5 1.5B",
		description: "最佳提取粒度（原子事实）；整合较弱。",
	},
	"providers.unexpectedStopModel::lfm2-1.2b": {
		label: "LFM2 1.2B",
		description: "加载最快；稳健的全能选手，提取标签略嘈杂。",
	},
	"providers.kimiApiFormat::auto": {
		label: "Auto",
		description: "使用模型服务端声明的协议",
	},
	"providers.kimiApiFormat::openai": {
		label: "OpenAI",
		description: "api.kimi.com",
	},
	"providers.kimiApiFormat::anthropic": {
		label: "Anthropic",
		description: "api.moonshot.ai",
	},
	"providers.openaiWebsockets::auto": {
		label: "Auto",
		description: "使用模型/服务商默认 WebSocket 行为",
	},
	"providers.openaiWebsockets::off": {
		label: "关闭",
		description: "禁用 OpenAI Codex 模型的 WebSocket",
	},
	"providers.openaiWebsockets::on": {
		label: "开启",
		description: "强制 OpenAI Codex 模型使用 WebSocket",
	},
	"providers.streamFirstEventTimeoutSeconds::-1": {
		label: "Auto",
		description: "使用服务商默认值和 PI_* 超时环境变量",
	},
	"providers.streamFirstEventTimeoutSeconds::0": {
		label: "关闭",
		description: "禁用首事件超时",
	},
	"providers.streamFirstEventTimeoutSeconds::300": {
		label: "5 分钟",
	},
	"providers.streamFirstEventTimeoutSeconds::600": {
		label: "10 分钟",
	},
	"providers.streamFirstEventTimeoutSeconds::1800": {
		label: "30 分钟",
	},
	"providers.cacheRetention::auto": {
		label: "自动",
		description: "使用服务商默认值——Anthropic 使用 5 分钟条目并由空闲保活刷新保持热度；PI_CACHE_RETENTION 仍然生效",
	},
	"providers.cacheRetention::short": {
		label: "短（5 分钟）",
		description: "最便宜的缓存写入；Anthropic 在空闲时通过有界的保活刷新保持条目热度",
	},
	"providers.cacheRetention::long": {
		label: "长（1 小时）",
		description: "服务商支持时使用 1 小时 TTL；写入更贵，不发送保活刷新请求",
	},
	"providers.cacheRetention::none": {
		label: "关闭",
		description: "禁用提示缓存和缓存亲和路由",
	},
	"providers.streamIdleTimeoutSeconds::-1": {
		label: "Auto",
		description: "使用服务商默认值和 PI_* 超时环境变量",
	},
	"providers.streamIdleTimeoutSeconds::0": {
		label: "关闭",
		description: "禁用空闲超时",
	},
	"providers.streamIdleTimeoutSeconds::300": {
		label: "5 分钟",
	},
	"providers.streamIdleTimeoutSeconds::600": {
		label: "10 分钟",
	},
	"providers.streamIdleTimeoutSeconds::1800": {
		label: "30 分钟",
	},
	"providers.openrouterVariant::default": {
		label: "默认",
		description: "无后缀；使用 OpenRouter 默认路由",
	},
	"providers.openrouterVariant::nitro": {
		label: ":nitro",
		description: "优先吞吐量 / 最低延迟",
	},
	"providers.openrouterVariant::floor": {
		label: ":floor",
		description: "优先最便宜可用服务商",
	},
	"providers.openrouterVariant::online": {
		label: ":online",
		description: "启用 OpenRouter 的网络搜索插件",
	},
	"providers.openrouterVariant::exacto": {
		label: ":exacto",
		description: "精选高质量服务商（仅针对特定模型定义）",
	},
	"providers.fetch::auto": {
		label: "Auto",
		description: "优先级：native > trafilatura > lynx > parallel > jina",
	},
	"providers.fetch::native": {
		label: "原生",
		description: "进程内 HTML→Markdown 转换器（始终可用）",
	},
	"providers.fetch::trafilatura": {
		label: "Trafilatura",
		description: "通过 uv/pip 自动安装",
	},
	"providers.fetch::lynx": {
		label: "Lynx",
		description: "需要 lynx 系统包",
	},
	"providers.fetch::parallel": {
		label: "Parallel",
		description: "需要 PARALLEL_API_KEY",
	},
	"providers.fetch::jina": {
		label: "Jina",
		description: "使用 r.jina.ai 阅读器（JINA_API_KEY 可选）",
	},
	"codexResets.autoRedeem::unset": {
		label: "未设置",
		description: "先检查资格，再在首次使用保存的重置前询问。",
	},
	"codexResets.autoRedeem::yes": {
		label: "是",
		description: "无需提示直接使用符合条件的保存重置。",
	},
	"codexResets.autoRedeem::no": {
		label: "否",
		description: "不运行保存重置的自动赎回检查。",
	},
	"provider.appendOnlyContext::auto": {
		label: "Auto",
		description: "为已知前缀缓存服务商启用（推荐）",
	},
	"provider.appendOnlyContext::on": {
		label: "开启",
		description: "始终启用仅追加上下文",
	},
	"provider.appendOnlyContext::off": {
		label: "关闭",
		description: "禁用仅追加上下文",
	},
};
