// Information density collector — measures content-to-viewport area ratio.
// Uses DOM coverage approach: sums bounding rects of visible content elements
// relative to viewport area. Sampled on user interactions (not continuously).

export class DensityCollector {
    private samples: number[] = [];
    private minRatio = 1;
    private maxRatio = 0;
    private minContext: string | null = null;
    private maxContext: string | null = null;

    attach() {
        // Take an initial measurement
        this.sample();
    }

    detach() {
        // Final sample
        this.sample();
    }

    // Called by collector.ts on each click to sample density at interaction time
    sampleOnInteraction() {
        this.sample();
    }

    private sample() {
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const viewportArea = viewportW * viewportH;
        if (viewportArea === 0) return;

        let contentArea = 0;

        // Query visible content elements — text nodes, images, interactive controls
        const contentSelectors = 'p, h1, h2, h3, h4, h5, h6, span, a, button, input, select, textarea, img, svg, table, li, label, td, th';
        const elements = document.querySelectorAll(contentSelectors);

        const counted = new Set<Element>();

        for (const el of elements) {
            // Skip elements inside other counted elements (avoid double-counting)
            let dominated = false;
            for (const parent of counted) {
                if (parent.contains(el) && parent !== el) {
                    dominated = true;
                    break;
                }
            }
            if (dominated) continue;

            const rect = el.getBoundingClientRect();

            // Only count elements visible in the viewport
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.bottom < 0 || rect.top > viewportH) continue;
            if (rect.right < 0 || rect.left > viewportW) continue;

            // Clip to viewport bounds
            const clippedW = Math.min(rect.right, viewportW) - Math.max(rect.left, 0);
            const clippedH = Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0);

            if (clippedW > 0 && clippedH > 0) {
                contentArea += clippedW * clippedH;
                counted.add(el);
            }
        }

        // Clamp to max 1.0 (overlapping elements can push above viewport area)
        const ratio = Math.min(contentArea / viewportArea, 1.0);
        this.samples.push(ratio);

        // Get page context for min/max
        const pageContext = document.title?.substring(0, 40) || window.location.pathname;

        if (ratio <= this.minRatio) {
            this.minRatio = ratio;
            this.minContext = pageContext;
        }
        if (ratio >= this.maxRatio) {
            this.maxRatio = ratio;
            this.maxContext = pageContext;
        }

        this.sendUpdate();
    }

    private sendUpdate() {
        const avg = this.samples.length > 0
            ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length
            : 0;

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'density_update',
                information_density: {
                    method: 'dom-coverage',
                    average_content_ratio: Math.round(avg * 1000) / 1000,
                    min_content_ratio: Math.round(this.minRatio * 1000) / 1000,
                    max_content_ratio: Math.round(this.maxRatio * 1000) / 1000,
                    min_content_context: this.minContext,
                    max_content_context: this.maxContext
                }
            }
        }).catch(() => {});
    }
}
