package format

import (
	"fmt"
	"strings"
	"time"
	"uxbench/schema"
)

// GenerateMarkdownTable creates a Markdown formatted table string for the comparison results.
func GenerateMarkdownTable(reports []*schema.BenchmarkReport) string {
	var sb strings.Builder

	sb.WriteString("# UX Bench Comparison Report\n")
	sb.WriteString(fmt.Sprintf("Generated on: %s\n\n", time.Now().Format(time.RFC1123)))

	// Header Row
	sb.WriteString("| Metric |")
	for _, r := range reports {
		sb.WriteString(fmt.Sprintf(" %s |", r.Metadata.Product))
	}
	sb.WriteString("\n")

	// Separator Row
	sb.WriteString("|---|")
	for range reports {
		sb.WriteString("---|")
	}
	sb.WriteString("\n")
	
	// Task Row
	sb.WriteString("| **Task** |")
	for _, r := range reports {
		sb.WriteString(fmt.Sprintf(" %s |", r.Metadata.Task))
	}
	sb.WriteString("\n")

	// Helper for Metrics
	addMetricRow := func(label string, valFn func(schema.BenchmarkMetrics) float64, higherIsBetter bool) {
		sb.WriteString(fmt.Sprintf("| %s |", label))
		
		// Find best value
		bestVal := -1.0
		first := true
		for _, r := range reports {
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

		for _, r := range reports {
			val := valFn(r.Metrics)
			valStr := fmt.Sprintf("%.2f", val)
			if val == bestVal {
				valStr = "**" + valStr + "**" // Bold winner
			}
			sb.WriteString(fmt.Sprintf(" %s |", valStr))
		}
		sb.WriteString("\n")
	}

	addMetricRow("Composite Score", func(m schema.BenchmarkMetrics) float64 { return m.CompositeScore }, true)
	addMetricRow("Total Clicks", func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Total) }, false)
	addMetricRow("Time on Task (ms)", func(m schema.BenchmarkMetrics) float64 { return float64(m.TimeOnTask.TotalMS) }, false)
	addMetricRow("Fitts Avg ID", func(m schema.BenchmarkMetrics) float64 { return m.Fitts.AverageID }, false)
	addMetricRow("Info Density", func(m schema.BenchmarkMetrics) float64 { return m.InformationDensity.AverageContentRatio }, true)
	addMetricRow("Context Switches", func(m schema.BenchmarkMetrics) float64 { return float64(m.ContextSwitches.Total) }, false)
	addMetricRow("Shortcut Ratio", func(m schema.BenchmarkMetrics) float64 { return m.ShortcutCoverage.Ratio }, true)
	addMetricRow("Nav Depth", func(m schema.BenchmarkMetrics) float64 { return float64(m.NavigationDepth.MaxDepth) }, false)

	return sb.String()
}
