package loader

import (
	"encoding/json"
	"fmt"
	"os"

	"uxbench/schema"
)

// LoadReport reads a JSON file and unmarshals it into a BenchmarkReport
func LoadReport(path string) (*schema.BenchmarkReport, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", path, err)
	}

	var report schema.BenchmarkReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("failed to parse JSON in %s: %w", path, err)
	}

	// Basic version check
	if report.SchemaVersion != "1.0" {
		fmt.Printf("Warning: Schema version %s in file %s may not be fully supported (expected 1.0)\n", report.SchemaVersion, path)
	}

	return &report, nil
}
