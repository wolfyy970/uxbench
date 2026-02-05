package cmd

import (
	"uxbench/cli/tui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "uxbench",
	Short: "UX Bench - Analyze and compare interaction efficiency",
	Long: `UX Bench is a CLI tool for analyzing benchmark data collected
by the UX Bench Recorder extension. It allows for head-to-head comparisons
of product efficiency.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			// Interactive Menu
			p := tea.NewProgram(tui.NewMenuModel())
			m, err := p.Run()
			if err != nil {
				return err
			}
			menu := m.(tui.MenuModel)
			
			if menu.Selected == "Compare Recordings" {
				// Run compare command interactively
				// We can't easily execute a sub-command's RunE directly if it relies on its own flags/args parsing
				// usually, but we designed compareCmd.RunE to handle 0 args as interactive.
				// So we can just call it with empty args.
				return compareCmd.RunE(compareCmd, []string{})
			}
		}
		return nil // Or print help? If nothing selected/exit
	},
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	// Add subcommands here
	// rootCmd.AddCommand(compareCmd)
}
