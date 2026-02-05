package tui

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/dustin/go-humanize"
)

var (
	pickerSelectedItemStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("212")).Bold(true)
	checkedItemStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("42")).Bold(true) // Green for selected
	dirStyle             = lipgloss.NewStyle().Foreground(lipgloss.Color("99")).Bold(true)
	fileStyle            = lipgloss.NewStyle().Foreground(lipgloss.Color("243"))
	permissionStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	sizeStyle            = lipgloss.NewStyle().Foreground(lipgloss.Color("240")).Align(lipgloss.Right).Width(8)
	
	stagingStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("62")).
			Padding(0, 1).
			Margin(0, 0, 1, 2)
)

type fileItem struct {
	name  string
	path  string
	isDir bool
	info  fs.FileInfo
	// We won't store 'selected' status here to avoid list update churn.
	// We'll trust the Model to tell us what is selected during render if we could,
	// but standard list delegate doesn't easily access parent model.
	// So we WILL update the item in the list when toggled.
	isSelected bool
}

func (i fileItem) FilterValue() string { return i.name }

type fileDelegate struct{}

func (d fileDelegate) Height() int                             { return 1 }
func (d fileDelegate) Spacing() int                            { return 0 }
func (d fileDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d fileDelegate) Render(w io.Writer, m list.Model, index int, listItem list.Item) {
	i, ok := listItem.(fileItem)
	if !ok {
		return
	}

	// Columns: Check | Mode | Size | ModTime | Name
	var str string
	var mode, size, modTime string
	
	name := i.name

	if i.name == ".." {
		mode = "drwxr-xr-x"
		size = "-"
		modTime = "            "
	} else if i.info != nil {
		mode = i.info.Mode().String()
		size = humanize.Bytes(uint64(i.info.Size()))
		modTime = i.info.ModTime().Format("Jan 02 15:04")
		
		if i.isDir {
			size = "-"
			name = name + "/"
		}
	} else {
		mode = "?????????? "
		size = "?"
		modTime = "..."
	}

	nameStyle := fileStyle
	if i.isDir {
		nameStyle = dirStyle
	}

	// Selection Checkmark
	check := "[ ]"
	if i.isSelected {
		check = "[x]"
	}
	if i.isDir && i.name == ".." {
		check = "   " // No check for ..
	} else if i.isDir {
		check = "   " // No check for dirs
	}
	
	checkRender := fileStyle.Render(check)
	if i.isSelected {
		checkRender = checkedItemStyle.Render(check)
		nameStyle = checkedItemStyle // Highlight name if selected
	}

	cursor := " "
	if index == m.Index() {
		cursor = ">"
		// If cursor is on it, brighten up
		if !i.isSelected {
			nameStyle = pickerSelectedItemStyle
		}
	}

	str = fmt.Sprintf("%s %s %s %s %s  %s", 
		cursor,
		checkRender,
		permissionStyle.Render(mode),
		sizeStyle.Render(size),
		permissionStyle.Render(modTime),
		nameStyle.Render(name),
	)

	fmt.Fprint(w, str)
}

type Model struct {
	list       list.Model
	currentDir string
	
	// Track selected files
	SelectedPaths []string
	
	quitting   bool
	done       bool
}

func NewModel() Model {
	cwd, _ := os.Getwd()
	
	// We need to initialize the list items with selection state if we reload folders,
	// checking against SelectedPaths.
	
	l := list.New(getItems(cwd, nil), fileDelegate{}, 80, 20)
	l.Title = "Select Files to Compare"
	l.SetShowStatusBar(false)
	l.SetFilteringEnabled(false)
	l.Styles.Title = lipgloss.NewStyle().MarginLeft(2).Foreground(lipgloss.Color("205")).Bold(true)

	return Model{
		list:          l,
		currentDir:    cwd,
		SelectedPaths: []string{},
	}
}

// Helper to get items and mark them selected if they are in the list
func getItems(dir string, selected []string) []list.Item {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []list.Item{}
	}

	var dirs []fileItem
	var files []fileItem

	// Parent
	dirs = append(dirs, fileItem{name: "..", path: filepath.Dir(dir), isDir: true})

	selectedMap := make(map[string]bool)
	for _, p := range selected {
		selectedMap[p] = true
	}

	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") { continue }
		info, err := e.Info()
		if err != nil { continue }
		
		fullPath := filepath.Join(dir, e.Name())
		isSel := selectedMap[fullPath]

		item := fileItem{
			name:       e.Name(),
			path:       fullPath,
			isDir:      e.IsDir(),
			info:       info,
			isSelected: isSel,
		}

		if e.IsDir() {
			dirs = append(dirs, item)
		} else if strings.HasSuffix(e.Name(), ".json") {
			files = append(files, item)
		}
	}
    
    items := make([]list.Item, 0, len(dirs)+len(files))
    for _, d := range dirs { items = append(items, d) }
    for _, f := range files { items = append(items, f) }
    return items
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			m.quitting = true
			return m, tea.Quit
		
		case "enter":
			i, ok := m.list.SelectedItem().(fileItem)
			if ok && i.isDir {
				m.currentDir = i.path
				cmd := m.list.SetItems(getItems(m.currentDir, m.SelectedPaths))
				m.list.ResetSelected()
				return m, cmd
			}
			// If file, do standard toggle? Or stick to Space?
			// Let's make Enter toggle files too for ease of use
			if ok && !i.isDir {
				return m.toggleSelection(i)
			}
			return m, nil

		case " ":
			i, ok := m.list.SelectedItem().(fileItem)
			if ok && !i.isDir {
				return m.toggleSelection(i)
			}
		
		case "left", "backspace": 
			parent := filepath.Dir(m.currentDir)
			m.currentDir = parent
			cmd := m.list.SetItems(getItems(m.currentDir, m.SelectedPaths))
			m.list.ResetSelected()
			return m, cmd
			
		case "c":
			if len(m.SelectedPaths) >= 2 {
				m.done = true
				return m, tea.Quit
			}
		}

	case tea.WindowSizeMsg:
		m.list.SetSize(msg.Width, msg.Height-4) // Reserve space for header/footer
	}

	var cmd tea.Cmd
	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

func (m Model) toggleSelection(i fileItem) (Model, tea.Cmd) {
	// Check if already selected
	idx := -1
	for x, p := range m.SelectedPaths {
		if p == i.path {
			idx = x
			break
		}
	}

	if idx != -1 {
		// Deselect
		m.SelectedPaths = append(m.SelectedPaths[:idx], m.SelectedPaths[idx+1:]...)
	} else {
		// Select (no limit, or limit > 2 for multi-compare)
		m.SelectedPaths = append(m.SelectedPaths, i.path)
	}
	
	// Refresh list to update checkmarks
	cmd := m.list.SetItems(getItems(m.currentDir, m.SelectedPaths))
	return m, cmd
}

func (m Model) View() string {
	if m.quitting { return "" }
	
	// Render Staging Area
	var staging strings.Builder
	staging.WriteString("Comparison Staging:\n")
	if len(m.SelectedPaths) == 0 {
		staging.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("240")).Render("  (No files selected)"))
	} else {
		for _, p := range m.SelectedPaths {
			name := filepath.Base(p)
			staging.WriteString(fmt.Sprintf("  %s %s\n", checkedItemStyle.Render("✓"), name))
		}
	}
	
	if len(m.SelectedPaths) >= 2 {
		staging.WriteString("\n" + lipgloss.NewStyle().Background(lipgloss.Color("62")).Foreground(lipgloss.Color("255")).Bold(true).Padding(0,1).Render(" Press 'c' to Compare! "))
	} else {
		staging.WriteString(fmt.Sprintf("\n  %d files selected (pick at least 2)", len(m.SelectedPaths)))
	}
	
	header := stagingStyle.Render(staging.String())
	
	m.list.Title = fmt.Sprintf("Browse: %s", m.currentDir)
	
	help := "\n  (Space/Enter: Select • c: Compare • Backspace: Up)"

	return lipgloss.JoinVertical(lipgloss.Left, header, m.list.View(), help)
}
