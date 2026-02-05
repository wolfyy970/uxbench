.PHONY: all recorder cli install types clean

# Default target
all: recorder cli

# Build the Chrome Extension
recorder:
	@echo "Building Recorder..."
	cd recorder && npm ci && npm run build

# Build the CLI
cli:
	@echo "Building CLI..."
	cd cli && go build -o uxbench main.go

# Install CLI to GOPATH
install:
	@echo "Installing CLI..."
	cd cli && go install .

# Generate types from Schema
types:
	@echo "Generating types..."
	# Generate TypeScript types
	npx json-schema-to-typescript schema/benchmark.schema.json > schema/benchmark.ts
	# Generate Go types
	go generate ./schema/...

# Clean build artifacts
clean:
	rm -rf recorder/dist
	rm -f cli/uxbench
