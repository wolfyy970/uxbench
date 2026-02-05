package tui

import (
	"fmt"
	"os"
	"strings"
	"uxbench/cli/format"
	"uxbench/schema"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var (
	resultsTitleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FAFAFA")).Background(lipgloss.Color("#7D56F4")).Padding(0, 1)
	headerStyle       = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("205"))
	winnerStyle       = lipgloss.NewStyle().Foreground(lipgloss.Color("42")).Bold(true) // Green
	// We use a base cell style with some right padding for separation
	cellStyle         = lipgloss.NewStyle().PaddingRight(4)
)

type ResultsModel struct {
	reports  []*schema.BenchmarkReport
	quitting bool
	Saved    bool // Track if saved
	SaveMsg  string
}

func NewResultsModel(reports []*schema.BenchmarkReport) ResultsModel {
	return ResultsModel{reports: reports}
}

func (m ResultsModel) Init() tea.Cmd { return nil }

func (m ResultsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c", "esc":
			m.quitting = true
			return m, tea.Quit
		case "s":
			if !m.Saved {
				// Generate and Save
				content := format.GenerateMarkdownTable(m.reports)
				filename := "comparison_report.md" // Or use timestamp in name
				err := os.WriteFile(filename, []byte(content), 0644)
				if err != nil {
					m.SaveMsg = fmt.Sprintf("Error saving: %v", err)
				} else {
					m.Saved = true
					m.SaveMsg = fmt.Sprintf("Saved to %s!", filename)
				}
			}
			return m, nil
		}
	}
	return m, nil
}

func (m ResultsModel) View() string {
	if m.quitting {
		return ""
	}

	// 1. Prepare Data Grid (Rows -> Cols)
	// Row 0: Header (Metric, Prod1, Prod2...)
	// Row 1: Task (Task, TaskName...)
	// Row 2: Separator (empty)
	// Row 3..N: Metrics
	
	type cell struct {
		content string
		style   lipgloss.Style
	}
	
	var grid [][]cell
	
	// Headers
	headerRow := []cell{{content: "Metric", style: lipgloss.NewStyle()}}
	for _, r := range m.reports {
		headerRow = append(headerRow, cell{content: r.Metadata.Product, style: headerStyle})
	}
	grid = append(grid, headerRow)
	
	// Task
	taskRow := []cell{{content: "Task", style: lipgloss.NewStyle()}}
	for _, r := range m.reports {
		taskRow = append(taskRow, cell{content: r.Metadata.Task, style: lipgloss.NewStyle()})
	}
	grid = append(grid, taskRow)
	
	// Spacer
	grid = append(grid, nil) // nil row = spacer
	
	// Metrics Helper
	addMetricRow := func(label string, valFn func(schema.BenchmarkMetrics) float64, higherIsBetter bool) {
		row := []cell{{content: label, style: lipgloss.NewStyle()}}
		
		// Find best
		bestVal := -1.0
		first := true
		for _, r := range m.reports {
			val := valFn(r.Metrics)
			if first {
				bestVal = val
				first = false
			} else {
				if higherIsBetter {
					if val > bestVal { bestVal = val }
				} else {
					if val < bestVal { bestVal = val }
				}
			}
		}

		for _, r := range m.reports {
			val := valFn(r.Metrics)
			valStr := fmt.Sprintf("%.2f", val)
			style := lipgloss.NewStyle()
			
			if val == bestVal {
				valStr += "*"
				style = winnerStyle
			}
			row = append(row, cell{content: valStr, style: style})
		}
		grid = append(grid, row)
	}
	
	addMetricRow("Composite Score", func(m schema.BenchmarkMetrics) float64 { return m.CompositeScore }, true)
	addMetricRow("Total Clicks", func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Total) }, false)
	addMetricRow("Time on Task (ms)", func(m schema.BenchmarkMetrics) float64 { return float64(m.TimeOnTask.TotalMS) }, false)
	
	// Extended Metrics
	addMetricRow("Fitts Avg ID", func(m schema.BenchmarkMetrics) float64 { return m.Fitts.AverageID }, false)
	addMetricRow("Info Density", func(m schema.BenchmarkMetrics) float64 { return m.InformationDensity.AverageContentRatio }, true)
	addMetricRow("Ctx Switches", func(m schema.BenchmarkMetrics) float64 { return float64(m.ContextSwitches.Total) }, false)
	addMetricRow("Shortcut Ratio", func(m schema.BenchmarkMetrics) float64 { return m.ShortcutCoverage.Ratio }, true)
	addMetricRow("Nav Depth", func(m schema.BenchmarkMetrics) float64 { return float64(m.NavigationDepth.MaxDepth) }, false)


	// 2. Calculate Column Widths
	// We need to know max visual width for each column index
	numCols := len(m.reports) + 1
	colWidths := make([]int, numCols)
	
	for _, row := range grid {
		if row == nil { continue }
		for i, c := range row {
			w := lipgloss.Width(c.content) // Visual width! ignoring ansi
			if w > colWidths[i] {
				colWidths[i] = w
			}
		}
	}
	
	// 3. Render
	var s strings.Builder
	s.WriteString("\n")
	s.WriteString(resultsTitleStyle.Render(" Comparison Matrix "))
	s.WriteString("\n\n")
	
	for _, row := range grid {
		if row == nil {
			s.WriteString("\n")
			continue
		}
		
		line := strings.Builder{}
		for i, c := range row {
			renderStyle := c.style.Copy().Inherit(cellStyle).Width(colWidths[i])
			line.WriteString(renderStyle.Render(c.content))
		}
		s.WriteString(line.String() + "\n")
	}

	return s.String()
}
