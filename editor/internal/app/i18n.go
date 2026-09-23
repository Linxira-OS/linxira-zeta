package app

import (
	"os"
	"strings"

	"github.com/eugenioenko/ttt/internal/config"
)

// zh is true when the editor UI should present Simplified Chinese labels.
//
// Resolution order (first match wins):
//  1. settings.json "language" ("zh" / "zh-CN" / "zh-TW" / "en" ...)
//  2. TTT_LANG environment variable
//  3. LANG / LC_ALL environment variables
//
// The label layer is deliberately display-only: setting IDs, JSON tags and
// stored values stay English so configs written under one locale remain
// readable (and mergeable) under another.
var zh = detectZH()

func detectZH() bool {
	lang := ""
	if appSettingsLang != "" {
		lang = appSettingsLang
	} else if s := os.Getenv("TTT_LANG"); s != "" {
		lang = s
	} else if s := os.Getenv("LC_ALL"); s != "" {
		lang = s
	} else {
		lang = os.Getenv("LANG")
	}
	lang = strings.ToLower(lang)
	return strings.HasPrefix(lang, "zh")
}

// appSettingsLang is installed by the App at startup from its loaded settings.
var appSettingsLang string

// installLang publishes the persisted language so t() answers in the user's
// locale. Called once after Settings load, and again on Apply.
func installLang(s *config.Settings) {
	appSettingsLang = s.Language
	zh = detectZH()
}

// L returns label for the active locale: the Chinese entry when zh is on,
// otherwise the English one. Keeping both in the table (instead of a runtime
// map) makes the pairing auditable at the call site.
func L(en, zhCN string) string {
	if zh {
		return zhCN
	}
	return en
}

// zhLabels translates the static chrome of the settings surface.
var zhLabels = map[string]string{
	// category tabs
	"Editor":             "编辑器",
	"Appearance":         "外观",
	"Completion":         "补全",
	"Advanced":           "高级",
	"Settings":           "设置",
	"Cancel":             "取消",
	"Apply":              "应用",
	"Done":               "完成",
	"Default":            "默认",
	"Settings applied":   "已应用设置",
	"Settings cancelled": "已取消",
}

// zhFieldLabels translates setting-field labels. Keyed by the English label
// so a missing translation is visibly English rather than silently empty.
var zhFieldLabels = map[string]string{
	"Tab size":                      "制表符宽度",
	"Insert spaces":                 "插入空格",
	"Word wrap":                     "自动换行",
	"Diff mode":                     "差异模式",
	"Diff word wrap":                "差异自动换行",
	"Line numbers":                  "行号",
	"Auto indent":                   "自动缩进",
	"Auto dedent":                   "自动反缩进",
	"Insert final newline":          "插入末尾换行",
	"Show trailing newline":         "显示末尾换行",
	"Trim trailing whitespace":      "裁剪行尾空白",
	"Format on save":                "保存时格式化",
	"Focus editor on open":          "打开时聚焦编辑器",
	"Theme":                         "主题",
	"Diff context":                  "差异上下文",
	"High contrast diffs":           "高对比度差异",
	"Emphasize collapsed diff rows": "强调折叠差异行",
	"Border style":                  "边框样式",
	"Gutter style":                  "槽线样式",
	"Cursor style":                  "光标样式",
	"Syntax highlight":              "语法高亮",
	"Bracket pair colors":           "括号配对着色",
	"Menu bar":                      "菜单栏",
	"Git gutter":                    "Git 槽线",
	"Transparent background":        "透明背景",
	"Markdown wrap width":           "Markdown 换行宽度",
	"Enable completion":             "启用补全",
	"Suggest as you type":           "输入时提示",
	"Signature help":                "签名帮助",
	"Debounce (ms)":                 "防抖（毫秒）",
	"Git: file view":                "Git：文件视图",
	"Explorer: hidden files":        "资源管理器：隐藏文件",
	"Explorer: git-ignored files":   "资源管理器：Git 忽略文件",
	"Terminal shell":                "终端 Shell",
	"Terminal scrollback":           "终端回滚行数",
	"Search debounce (ms)":          "搜索防抖（毫秒）",
	"Enable plugins":                "启用插件",
	"Debug mode":                    "调试模式",
}

// zhEnumLabels translates enum option labels (Diff mode, Border style, ...).
var zhEnumLabels = map[string]string{
	"Tree":                 "树",
	"List":                 "列表",
	"Split":                "分栏",
	"Unified":              "统一",
	"Side by side":         "并排",
	"Bar (blinking)":       "竖线（闪烁）",
	"Bar (steady)":         "竖线（常亮）",
	"Block (blinking)":     "块（闪烁）",
	"Block (steady)":       "块（常亮）",
	"Underline (blinking)": "下划线（闪烁）",
	"Underline (steady)":   "下划线（常亮）",
	"Single":               "单线",
	"Double":               "双线",
	"Rounded":              "圆角",
	"Thick":                "粗线",
	"ASCII":                "ASCII",
	"None":                 "无",
	"On":                   "开",
	"Off":                  "关",
}

// t translates a label through the active locale, falling back to the source
// string when no Chinese entry exists (keeps untranslated chrome readable).
func t(en string) string {
	if !zh {
		return en
	}
	if v, ok := zhLabels[en]; ok {
		return v
	}
	if v, ok := zhFieldLabels[en]; ok {
		return v
	}
	if v, ok := zhEnumLabels[en]; ok {
		return v
	}
	return en
}

// langSetting exposes the persisted language so tests can flip the locale.
func setLangForTest(s string) { zh = s == "zh" }
