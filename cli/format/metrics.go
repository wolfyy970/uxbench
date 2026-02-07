package format

import "uxbench/schema"

// MetricDef defines a single metric for use across all output formats (Markdown, CSV, TUI).
type MetricDef struct {
	Label          string
	Extractor      func(schema.BenchmarkMetrics) float64
	HigherIsBetter bool
	DetailOnly     bool // true = included only in detailed formats (CSV); false = all formats
}

// MetricRegistry is the single source of truth for which metrics appear in comparison outputs.
// Markdown and TUI use entries where DetailOnly == false.
// CSV includes all entries.
var MetricRegistry = []MetricDef{
	// --- Core metrics (all formats) ---
	{Label: "Composite Score", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.CompositeScore }, HigherIsBetter: true},
	{Label: "Total Clicks", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Total) }},
	{Label: "Time on Task (ms)", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.TimeOnTask.TotalMS) }},
	{Label: "Fitts Avg ID", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.Fitts.AverageID }},
	{Label: "Context Switches", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ContextSwitches.Total) }},
	{Label: "Shortcuts Used", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ShortcutCoverage.ShortcutsUsed) }, HigherIsBetter: true},
	{Label: "Scanning Dist (avg px)", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.ScanningDistance.AveragePx }},
	{Label: "Scroll Dist (px)", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.ScrollDistance.TotalPx }},
	{Label: "Typing Ratio", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.TypingRatio.Ratio }},

	// --- Detail-only metrics (CSV) ---
	{Label: "Productive Clicks", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Productive) }, DetailOnly: true},
	{Label: "Ceremonial Clicks", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Ceremonial) }, DetailOnly: true},
	{Label: "Wasted Clicks", Extractor: func(m schema.BenchmarkMetrics) float64 { return float64(m.ClickCount.Wasted) }, DetailOnly: true},
	{Label: "Fitts Cumulative ID", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.Fitts.CumulativeID }, DetailOnly: true},
	{Label: "Fitts Max ID", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.Fitts.MaxID }, DetailOnly: true},
	{Label: "Context Switch Ratio", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.ContextSwitches.Ratio }, DetailOnly: true},
	{Label: "Scanning Dist (cumulative px)", Extractor: func(m schema.BenchmarkMetrics) float64 { return m.ScanningDistance.CumulativePx }, DetailOnly: true},
}
