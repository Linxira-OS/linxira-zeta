package widgets

type ListItem struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Icon    string   `json:"icon,omitempty"`
	Badge   string   `json:"badge,omitempty"`
	Actions []Action `json:"actions,omitempty"`
}

type ListConfig struct {
	EmptyText  string
	OnSelect   func(node *TreeNode)
	OnCommand  func(command string, node *TreeNode)
	RenderItem func(surface Surface, node *TreeNode, idx, y, w int, selected bool)
}

func NewListWidget(items []ListItem) *TreeWidget {
	nodes := make([]*TreeNode, len(items))
	for i, li := range items {
		nodes[i] = &TreeNode{
			ID:      li.ID,
			Label:   li.Label,
			Icon:    li.Icon,
			Badge:   li.Badge,
			Actions: li.Actions,
		}
	}
	return NewTreeWidget(TreeConfig{Items: nodes})
}

func NewListWidgetFromConfig(cfg ListConfig) *TreeWidget {
	return NewTreeWidget(TreeConfig{
		EmptyText:  cfg.EmptyText,
		Indent:     -1,
		OnSelect:   cfg.OnSelect,
		OnCommand:  cfg.OnCommand,
		RenderItem: cfg.RenderItem,
	})
}
