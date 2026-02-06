package format

import (
	"fmt"
	"strings"
	"uxbench/schema"
)

// GenerateCSV creates a CSV formatted string for the comparison results.
func GenerateCSV(reports []*schema.BenchmarkReport) string {
	var sb strings.Builder

	// Header Row
	sb.WriteString("Metric")
	for _, r := range reports {
		sb.WriteString(fmt.Sprintf(",%s", r.Metadata.Product))
	}
	sb.WriteString("\n")

	// Task Row
	sb.WriteString("Task")
	for _, r := range reports {
		sb.WriteString(fmt.Sprintf(",%s", r.Metadata.Task))
	}
	sb.WriteString("\n")

	// All metrics from shared registry (CSV includes detail-only metrics)
	for _, def := range MetricRegistry {
		sb.WriteString(def.Label)
		for _, r := range reports {
			sb.WriteString(fmt.Sprintf(",%.2f", def.Extractor(r.Metrics)))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}
