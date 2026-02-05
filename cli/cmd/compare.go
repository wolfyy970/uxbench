package cmd

import (
	"fmt"
	"uxbench/cli/loader"
	"uxbench/cli/tui"
	"uxbench/schema"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

var compareCmd = &cobra.Command{
	Use:   "compare [file1] [file2] ...",
	Short: "Compare multiple benchmark recordings",
	Long:  `Compare efficiency metrics between two or more product recordings.`,
	Args:  cobra.ArbitraryArgs, // Allow any number of args
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			// Interactive Flow (Picker -> Results)
			flow := tui.NewCompareFlowModel()
			p := tea.NewProgram(flow)
			if _, err := p.Run(); err != nil {
				return err
			}
			return nil
		}
		
		// If args provided, load them directly into ResultsModel (bypassing Picker)
		// Load reports
		reports := make([]*schema.BenchmarkReport, len(args))
		for i, f := range args {
			r, err := loader.LoadReport(f)
			if err != nil {
				return fmt.Errorf("failed to load %s: %w", f, err)
			}
			reports[i] = r
		}

		// Launch Results TUI directly
		resultsModel := tui.NewResultsModel(reports)
		p := tea.NewProgram(resultsModel)
		if _, err := p.Run(); err != nil {
			return err
		}
		
		return nil
	},
}

func init() {
	rootCmd.AddCommand(compareCmd)
}


