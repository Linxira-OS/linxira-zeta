package widgets

import (
	"encoding/json"
	"fmt"

	"github.com/eugenioenko/ttt/internal/term"
)

type WidgetDef struct {
	Type string `json:"type"`

	// title / dropdown
	Title  string      `json:"title,omitempty"`
	Menu   []MenuEntry `json:"menu,omitempty"`
	Icon   string      `json:"icon,omitempty"`
	Padded bool        `json:"padded,omitempty"`

	// box model (applies to any widget)
	BorderTop     bool `json:"borderTop,omitempty"`
	BorderBottom  bool `json:"borderBottom,omitempty"`
	BorderLeft    bool `json:"borderLeft,omitempty"`
	BorderRight   bool `json:"borderRight,omitempty"`
	PaddingTop    int  `json:"paddingTop,omitempty"`
	PaddingBottom int  `json:"paddingBottom,omitempty"`
	PaddingLeft   int  `json:"paddingLeft,omitempty"`
	PaddingRight  int  `json:"paddingRight,omitempty"`
	MarginTop     int  `json:"marginTop,omitempty"`
	MarginBottom  int  `json:"marginBottom,omitempty"`
	MarginLeft    int  `json:"marginLeft,omitempty"`
	MarginRight   int  `json:"marginRight,omitempty"`

	// tree / list
	Items          []*TreeNode `json:"items,omitempty"`
	ListItems      []ListItem  `json:"listItems,omitempty"`
	NodeMenu       []MenuEntry `json:"nodeMenu,omitempty"`
	MenuIcon       string      `json:"menuIcon,omitempty"`
	MenuIconPadded bool        `json:"menuIconPadded,omitempty"`

	// label
	Text string `json:"text,omitempty"`

	// button
	Label   string `json:"label,omitempty"`
	Command string `json:"command,omitempty"`

	// input
	Prefix      string `json:"prefix,omitempty"`
	Placeholder string `json:"placeholder,omitempty"`
	Bordered    *bool  `json:"bordered,omitempty"`

	// tabs
	Tabs []TabItem `json:"tabs,omitempty"`

	// dialog
	Width         int                `json:"width,omitempty"`
	DialogButtons []DialogButtonJSON `json:"buttons,omitempty"`

	// scroll
	Overflow string `json:"overflow,omitempty"`

	// layout
	Gap      int          `json:"gap,omitempty"`
	Align    string       `json:"align,omitempty"`
	Child    *WidgetDef   `json:"child,omitempty"`
	Children []*WidgetDef `json:"children,omitempty"`
}

type BuildContext struct {
	Borders term.BorderSet
}

func BuildFromJSON(data []byte, ctx BuildContext) (Widget, error) {
	var def WidgetDef
	if err := json.Unmarshal(data, &def); err != nil {
		return nil, fmt.Errorf("parse widget JSON: %w", err)
	}
	return buildWidget(&def, ctx)
}

func boxModelFromDef(def *WidgetDef, ctx BuildContext) BoxModel {
	return BoxModel{
		BorderTop: def.BorderTop, BorderBottom: def.BorderBottom,
		BorderLeft: def.BorderLeft, BorderRight: def.BorderRight,
		PaddingTop: def.PaddingTop, PaddingBottom: def.PaddingBottom,
		PaddingLeft: def.PaddingLeft, PaddingRight: def.PaddingRight,
		MarginTop: def.MarginTop, MarginBottom: def.MarginBottom,
		MarginLeft: def.MarginLeft, MarginRight: def.MarginRight,
		Borders: ctx.Borders,
	}
}

func buildWidget(def *WidgetDef, ctx BuildContext) (Widget, error) {
	var w Widget
	var err error

	switch def.Type {
	case "title":
		w = buildTitle(def)
	case "tree":
		w = buildTree(def)
	case "list":
		w = buildList(def)
	case "label":
		w = buildLabel(def)
	case "paragraph":
		w = NewParagraphWidget(def.Text)
	case "button":
		w = buildButton(def)
	case "input":
		w = buildInput(def)
	case "tabs":
		w = buildTabs(def)
	case "divider":
		w = buildDivider(def)
	case "tabbed":
		w, err = buildTabbed(def, ctx)
	case "dialog":
		w, err = buildDialog(def, ctx)
	case "box":
		w, err = buildBox(def, ctx)
	case "vstack":
		w, err = buildVStack(def, ctx)
	case "hstack":
		w, err = buildHStack(def, ctx)
	default:
		return nil, fmt.Errorf("unknown widget type: %q", def.Type)
	}
	if err != nil {
		return nil, err
	}

	w.SetBoxModel(boxModelFromDef(def, ctx))

	if def.Overflow == "scroll" {
		if sw, ok := w.(ScrollableWidget); ok {
			return NewScrollViewWidget(sw), nil
		}
	}

	return w, nil
}

func buildLabel(def *WidgetDef) *LabelWidget {
	return NewLabelWidget(LabelConfig{
		Text: def.Text,
	})
}

func buildButton(def *WidgetDef) *ButtonWidget {
	return NewButtonWidget(ButtonConfig{
		Label:   def.Label,
		Command: def.Command,
	})
}

func buildInput(def *WidgetDef) *InputWidget {
	bordered := true
	if def.Bordered != nil {
		bordered = *def.Bordered
	}
	return NewInputWidget(InputConfig{
		Prefix:      def.Prefix,
		Placeholder: def.Placeholder,
		Bordered:    bordered,
	})
}

func buildTabbed(def *WidgetDef, ctx BuildContext) (*TabbedWidget, error) {
	items := make([]TabItem, len(def.Tabs))
	copy(items, def.Tabs)
	tabs := NewTabsWidget(TabsConfig{Items: items})

	children := make([]Widget, 0, len(def.Children))
	for _, childDef := range def.Children {
		child, err := buildWidget(childDef, ctx)
		if err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	return NewTabbedWidget(tabs, children), nil
}

func buildTabs(def *WidgetDef) *TabsWidget {
	items := make([]TabItem, len(def.Tabs))
	copy(items, def.Tabs)
	return NewTabsWidget(TabsConfig{Items: items})
}

func buildDivider(def *WidgetDef) *DividerWidget {
	return NewDividerWidget(DividerConfig{})
}

func buildTitle(def *WidgetDef) *TitleWidget {
	return NewTitleWidget(TitleConfig{
		Title:  def.Title,
		Menu:   def.Menu,
		Icon:   def.Icon,
		Padded: def.Padded,
	})
}

func buildList(def *WidgetDef) *TreeWidget {
	items := make([]*TreeNode, len(def.ListItems))
	for i, li := range def.ListItems {
		items[i] = &TreeNode{
			ID:      li.ID,
			Label:   li.Label,
			Icon:    li.Icon,
			Badge:   li.Badge,
			Actions: li.Actions,
		}
	}
	return NewTreeWidget(TreeConfig{
		Items:          items,
		NodeMenu:       def.NodeMenu,
		MenuIcon:       def.MenuIcon,
		MenuIconPadded: def.MenuIconPadded,
	})
}

func buildTree(def *WidgetDef) *TreeWidget {
	return NewTreeWidget(TreeConfig{
		Items:          def.Items,
		NodeMenu:       def.NodeMenu,
		MenuIcon:       def.MenuIcon,
		MenuIconPadded: def.MenuIconPadded,
	})
}

func buildBox(def *WidgetDef, ctx BuildContext) (*BoxWidget, error) {
	box := NewBoxWidget(BoxModel{})
	if def.Child != nil {
		child, err := buildWidget(def.Child, ctx)
		if err != nil {
			return nil, err
		}
		box.Child = child
	}
	return box, nil
}

func buildVStack(def *WidgetDef, ctx BuildContext) (*VStackWidget, error) {
	children := make([]Widget, 0, len(def.Children))
	for _, childDef := range def.Children {
		child, err := buildWidget(childDef, ctx)
		if err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	vs := NewVStackWidget(children...)
	vs.Align = def.Align
	vs.Gap = def.Gap
	return vs, nil
}

type DialogButtonJSON struct {
	Label   string `json:"label"`
	Command string `json:"command"`
}

func buildDialog(def *WidgetDef, ctx BuildContext) (*DialogWidget, error) {
	d := NewDialogWidget(def.Width)
	d.Title = def.Title
	d.Borders = ctx.Borders
	for _, btn := range def.DialogButtons {
		d.Buttons = append(d.Buttons, DialogButton{Label: btn.Label})
	}
	if def.Child != nil {
		child, err := buildWidget(def.Child, ctx)
		if err != nil {
			return nil, err
		}
		d.SetContent(child)
	}
	return d, nil
}

func buildHStack(def *WidgetDef, ctx BuildContext) (*HStackWidget, error) {
	children := make([]Widget, 0, len(def.Children))
	for _, childDef := range def.Children {
		child, err := buildWidget(childDef, ctx)
		if err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	hs := NewHStackWidget(children...)
	hs.Align = def.Align
	hs.Gap = def.Gap
	return hs, nil
}
