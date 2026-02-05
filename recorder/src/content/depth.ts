// Navigation depth collector — MutationObserver for modals, dialogs, popovers, and overlays.
// Tracks the "stack" of UI layers the user is navigating through.

// Selectors that indicate a new UI layer
const LAYER_SELECTORS = [
    'dialog[open]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="menu"]',
    '[role="listbox"]',
    '[aria-modal="true"]',
    '.modal', '.modal-dialog', '.modal-content',
    '.popover', '.popup', '.dropdown-menu',
    '.overlay', '.lightbox',
    '[data-modal]', '[data-popup]', '[data-popover]',
];

const LAYER_QUERY = LAYER_SELECTORS.join(', ');

export class DepthCollector {
    private observer: MutationObserver | null = null;
    private currentDepth = 1; // Base page = depth 1
    private maxDepth = 1;
    private totalDepthChanges = 0;
    private depthPath: Array<{ direction: 'open' | 'close'; layer: string }> = [];
    private knownLayers: Set<Element> = new Set();

    attach() {
        // Take initial snapshot
        this.scanLayers();

        // Observe DOM mutations for layer changes
        this.observer = new MutationObserver((mutations) => {
            let changed = false;
            for (const mutation of mutations) {
                // Check added nodes
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) {
                        if (this.isLayer(node) || node.querySelector(LAYER_QUERY)) {
                            changed = true;
                        }
                    }
                }
                // Check removed nodes
                for (const node of mutation.removedNodes) {
                    if (node instanceof HTMLElement) {
                        if (this.knownLayers.has(node) || this.isLayer(node)) {
                            changed = true;
                        }
                    }
                }
                // Check attribute changes (e.g., dialog[open], aria-modal)
                if (mutation.type === 'attributes') {
                    const target = mutation.target as HTMLElement;
                    if (this.isLayer(target) || this.knownLayers.has(target)) {
                        changed = true;
                    }
                }
            }
            if (changed) this.scanLayers();
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['open', 'aria-modal', 'role', 'class', 'style']
        });
    }

    detach() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.knownLayers.clear();
    }

    private isLayer(el: Element): boolean {
        try {
            return el.matches(LAYER_QUERY);
        } catch {
            return false;
        }
    }

    private getLayerName(el: Element): string {
        // Try to get a meaningful name for the layer
        const role = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        const title = el.getAttribute('title');
        const tag = el.tagName.toLowerCase();
        const id = el.id;

        if (ariaLabel) return ariaLabel.substring(0, 40);
        if (title) return title.substring(0, 40);
        if (id) return `${tag}#${id}`;
        if (role) return `${role}`;
        // Check for heading inside
        const heading = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="header"]');
        if (heading?.textContent) return heading.textContent.trim().substring(0, 40);
        return tag;
    }

    private scanLayers() {
        const currentLayers = new Set<Element>();
        const elements = document.querySelectorAll(LAYER_QUERY);

        // Only count layers that are visible
        for (const el of elements) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' &&
                parseFloat(style.opacity) > 0) {
                currentLayers.add(el);
            }
        }

        const newDepth = 1 + currentLayers.size; // base page + layers

        // Detect opens
        for (const el of currentLayers) {
            if (!this.knownLayers.has(el)) {
                this.totalDepthChanges += 1;
                this.depthPath.push({ direction: 'open', layer: this.getLayerName(el) });
            }
        }

        // Detect closes
        for (const el of this.knownLayers) {
            if (!currentLayers.has(el)) {
                this.totalDepthChanges += 1;
                this.depthPath.push({ direction: 'close', layer: this.getLayerName(el) });
            }
        }

        this.knownLayers = currentLayers;
        this.currentDepth = newDepth;

        if (newDepth > this.maxDepth) {
            this.maxDepth = newDepth;
        }

        this.sendUpdate();
    }

    private sendUpdate() {
        // Build deepest_moment description
        const openLayers = this.depthPath
            .filter(p => p.direction === 'open')
            .map(p => p.layer);
        const deepestMoment = openLayers.length > 0
            ? openLayers.slice(-3).join(' > ')
            : null;

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'depth_update',
                navigation_depth: {
                    max_depth: this.maxDepth,
                    current_depth: this.currentDepth,
                    total_depth_changes: this.totalDepthChanges,
                    deepest_moment: deepestMoment,
                    depth_path: this.depthPath.slice(-20) // Last 20 changes
                }
            }
        }).catch(() => {});
    }
}
