// Information density collector — measures content-to-viewport area ratio.
// Uses DOM coverage approach: sums bounding rects of visible content elements
// relative to viewport area. Weighted by semantic importance.
// Sampled on user interactions and scroll events.

// Semantic weight by element type — text content > media > decorative
const SEMANTIC_WEIGHTS: Record<string, number> = {
    'P': 1.0, 'H1': 1.0, 'H2': 1.0, 'H3': 1.0, 'H4': 1.0, 'H5': 1.0, 'H6': 1.0,
    'LI': 1.0, 'TD': 1.0, 'TH': 1.0, 'LABEL': 1.0, 'BLOCKQUOTE': 1.0, 'PRE': 1.0,
    'INPUT': 0.8, 'SELECT': 0.8, 'TEXTAREA': 0.8, 'BUTTON': 0.7,
    'TABLE': 0.7, 'IMG': 0.5, 'SVG': 0.3,
    'A': 0.5, 'SPAN': 0.3,
};

import { NOOP } from './shared';

/** Minimum interval between scroll-triggered density samples */
const DENSITY_SAMPLE_THROTTLE_MS = 2000;

export class DensityCollector {
    private samples: number[] = [];
    private minRatio = 1;
    private maxRatio = 0;
    private minContext: string | null = null;
    private maxContext: string | null = null;
    private lastSampleTime = 0;

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

    // Called by collector.ts on scroll events (throttled to max 1 per 2s)
    sampleOnScroll() {
        const now = Date.now();
        if (now - this.lastSampleTime >= DENSITY_SAMPLE_THROTTLE_MS) {
            this.sample();
        }
    }

    private sample() {
        this.lastSampleTime = Date.now();
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
            // Walk up DOM tree — O(depth) per element instead of O(counted)
            let dominated = false;
            let ancestor = el.parentElement;
            while (ancestor) {
                if (counted.has(ancestor)) {
                    dominated = true;
                    break;
                }
                ancestor = ancestor.parentElement;
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
                const weight = SEMANTIC_WEIGHTS[el.tagName] || 0.3;
                contentArea += clippedW * clippedH * weight;
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
        }).catch(NOOP);
    }
}
