// Tests for the DepthCollector content script module
//
// Note: The DepthCollector uses MutationObserver and getComputedStyle to detect
// visible layers. Happy-dom has limited CSS support, so some layer visibility
// checks may behave differently than in a real browser. Tests that depend on
// MutationObserver + getComputedStyle interaction are written defensively.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { DepthCollector } from './depth';

// Helper: make element visible to getComputedStyle by setting inline styles
function makeVisible(el: HTMLElement) {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
}

describe('DepthCollector', () => {
    let collector: DepthCollector;

    beforeEach(() => {
        resetChromeMock();
        collector = new DepthCollector();
    });

    afterEach(() => {
        collector.detach();
        document.body.innerHTML = '';
    });

    it('should report base depth of 1 with no layers', () => {
        collector.attach();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EVENT_CAPTURED',
                payload: expect.objectContaining({
                    type: 'depth_update',
                    navigation_depth: expect.objectContaining({
                        current_depth: 1,
                        max_depth: 1,
                    })
                })
            })
        );
    });

    it('should detect dialog[open] as a layer when visible', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        makeVisible(dialog);
        document.body.appendChild(dialog);

        // MutationObserver fires asynchronously
        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        // At least one depth update should have fired
        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        expect(lastDepth.current_depth).toBe(2);
        expect(lastDepth.max_depth).toBe(2);
    });

    it('should detect role="dialog" as a layer when visible', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        makeVisible(modal);
        document.body.appendChild(modal);

        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        expect(lastDepth.current_depth).toBe(2);
    });

    it('should detect .modal class as a layer when visible', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        const modal = document.createElement('div');
        modal.className = 'modal';
        makeVisible(modal);
        document.body.appendChild(modal);

        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        expect(lastDepth.current_depth).toBe(2);
    });

    it('should track multiple nested layers', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        // Add a modal
        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'Settings');
        makeVisible(modal);
        document.body.appendChild(modal);

        // Add a dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-menu';
        makeVisible(dropdown);
        document.body.appendChild(dropdown);

        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        expect(lastDepth.current_depth).toBe(3); // base + modal + dropdown
        expect(lastDepth.max_depth).toBe(3);
    });

    it('should track depth decrease when layers are removed', async () => {
        collector.attach();

        // Add a modal
        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        makeVisible(modal);
        document.body.appendChild(modal);

        await new Promise(r => setTimeout(r, 100));
        chrome.runtime.sendMessage.mockClear();

        // Remove the modal
        document.body.removeChild(modal);

        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        expect(lastDepth.current_depth).toBe(1); // back to base
        expect(lastDepth.max_depth).toBe(2); // max was 2
        expect(lastDepth.total_depth_changes).toBeGreaterThanOrEqual(2); // open + close
    });

    it('should disconnect observer on detach', () => {
        collector.attach();
        collector.detach();

        // Add a layer after detach — should NOT trigger any new messages
        chrome.runtime.sendMessage.mockClear();

        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        makeVisible(modal);
        document.body.appendChild(modal);

        return new Promise<void>(resolve => {
            setTimeout(() => {
                const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
                    (c: any) => c[0]?.payload?.type === 'depth_update'
                );
                expect(depthCalls.length).toBe(0);
                resolve();
            }, 100);
        });
    });

    it('should extract meaningful layer names from aria-label', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', 'User Preferences');
        makeVisible(modal);
        document.body.appendChild(modal);

        await new Promise(r => setTimeout(r, 100));

        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        expect(depthCalls.length).toBeGreaterThan(0);
        const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
        const openPaths = lastDepth.depth_path.filter(
            (p: any) => p.direction === 'open'
        );
        expect(openPaths.length).toBeGreaterThan(0);
        expect(openPaths[0].layer).toBe('User Preferences');
    });

    it('should not count hidden layers (display: none)', async () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        const modal = document.createElement('div');
        modal.setAttribute('role', 'dialog');
        modal.style.display = 'none';
        document.body.appendChild(modal);

        await new Promise(r => setTimeout(r, 100));

        // Check if any depth update shows depth > 1
        const depthCalls = chrome.runtime.sendMessage.mock.calls.filter(
            (c: any) => c[0]?.payload?.type === 'depth_update'
        );

        if (depthCalls.length > 0) {
            const lastDepth = depthCalls[depthCalls.length - 1][0].payload.navigation_depth;
            expect(lastDepth.current_depth).toBe(1); // hidden layer should not count
        }
    });
});
