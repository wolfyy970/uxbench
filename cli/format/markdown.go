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

	// Metric rows from shared registry (core metrics only)
	for _, def := range MetricRegistry {
		if def.DetailOnly {
			continue
		}
		sb.WriteString(fmt.Sprintf("| %s |", def.Label))

		// Find best value
		bestVal := -1.0
		first := true
		for _, r := range reports {
			val := def.Extractor(r.Metrics)
			if first {
				bestVal = val
				first = false
			} else {
				if def.HigherIsBetter {
					if val > bestVal { bestVal = val }
				} else {
					if val < bestVal { bestVal = val }
				}
			}
		}

		for _, r := range reports {
			val := def.Extractor(r.Metrics)
			valStr := fmt.Sprintf("%.2f", val)
			if val == bestVal {
				valStr = "**" + valStr + "**" // Bold winner
			}
			sb.WriteString(fmt.Sprintf(" %s |", valStr))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}
