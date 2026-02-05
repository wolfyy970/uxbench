package tui

import (
	"fmt"
	"strings"
	"uxbench/cli/loader"
	"uxbench/schema"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type FlowState int

const (
	StatePicking FlowState = iota
	StateLoading
	StateResults
)

type CompareFlowModel struct {
	state   FlowState
	picker  Model
	results ResultsModel
	width   int
	height  int
	err     error
}

func NewCompareFlowModel() CompareFlowModel {
	return CompareFlowModel{
		state:  StatePicking,
		picker: NewModel(),
		// Results initialized empty
	}
}

func (m CompareFlowModel) Init() tea.Cmd {
	return m.picker.Init()
}

func (m CompareFlowModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	// Handle Global Messages
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.picker.list.SetSize(msg.Width, msg.Height-4)
		return m, nil
	
	case reportsLoadedMsg:
		m.results = NewResultsModel(msg)
		m.state = StateResults
		return m, nil

	case errMsg:
		m.err = msg
		return m, nil // Show error view
	
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
	}

	switch m.state {
	case StatePicking:
		// Intercept 'c' for transition
		if msg, ok := msg.(tea.KeyMsg); ok && msg.String() == "c" {
			if len(m.picker.SelectedPaths) >= 2 {
				m.state = StateLoading
				return m, func() tea.Msg {
					// Async loader
					reports := make([]*schema.BenchmarkReport, len(m.picker.SelectedPaths))
					for i, p := range m.picker.SelectedPaths {
						r, err := loader.LoadReport(p)
						if err != nil {
							return errMsg(err)
						}
						reports[i] = r
					}
					return reportsLoadedMsg(reports)
				}
			}
		}

		// Delegate to Picker
		newPicker, newCmd := m.picker.Update(msg)
		m.picker = newPicker.(Model)
		
		if m.picker.quitting {
			return m, tea.Quit
		}
		
		cmd = newCmd

	case StateResults:
		if msg, ok := msg.(tea.KeyMsg); ok {
			switch msg.String() {
			case "q":
				return m, tea.Quit
			case "esc", "backspace":
				m.state = StatePicking
				return m, nil
			}
		}
		
		newResults, newCmd := m.results.Update(msg)
		m.results = newResults.(ResultsModel)
		cmd = newCmd
	}

	return m, cmd
}

// Custom Messages
type reportsLoadedMsg []*schema.BenchmarkReport
type errMsg error

func (m CompareFlowModel) View() string {
	if m.err != nil {
		return fmt.Sprintf("\nError: %v\n\n(Press q to quit)", m.err)
	}

	switch m.state {
	case StatePicking:
		return m.picker.View()
	case StateLoading:
		return "\n  Loading reports...\n" // Could be a spinner
	case StateResults:
		view := m.results.View()
		footer := "\n  (Esc: Back • s: Save Report • q: Quit)"
		
		if m.results.SaveMsg != "" {
			color := "42" // Green
			if strings.HasPrefix(m.results.SaveMsg, "Error") {
				color = "196" // Red
			}
			msg := lipgloss.NewStyle().Foreground(lipgloss.Color(color)).Bold(true).Render(m.results.SaveMsg)
			footer = fmt.Sprintf("\n  %s\n  (Esc: Back • s: Save Report • q: Quit)", msg)
		}
		
		return view + lipgloss.NewStyle().Foreground(lipgloss.Color("240")).Render(footer)
	}
	return ""
}
