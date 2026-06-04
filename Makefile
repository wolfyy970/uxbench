.PHONY: all recorder clean

# Default target
all: recorder

# Build the Chrome Extension
recorder:
	@echo "Building Recorder..."
	cd recorder && npm ci && npm run build

# Clean build artifacts
clean:
	rm -rf recorder/dist
