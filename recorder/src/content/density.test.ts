// Tests for the DensityCollector content script module

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { DensityCollector } from './density';

describe('DensityCollector', () => {
    let collector: DensityCollector;

    beforeEach(() => {
        resetChromeMock();
        collector = new DensityCollector();

        // Set up a viewport size
        Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });
    });

    afterEach(() => {
        collector.detach();
        document.body.innerHTML = '';
    });

    it('should take initial measurement on attach', () => {
        collector.attach();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EVENT_CAPTURED',
                payload: expect.objectContaining({
                    type: 'density_update',
                    information_density: expect.objectContaining({
                        method: 'dom-coverage',
                        average_content_ratio: expect.any(Number),
                        min_content_ratio: expect.any(Number),
                        max_content_ratio: expect.any(Number),
                    })
                })
            })
        );
    });

    it('should take measurement on sampleOnInteraction', () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        collector.sampleOnInteraction();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.type).toBe('density_update');
    });

    it('should take final measurement on detach', () => {
        collector.attach();
        chrome.runtime.sendMessage.mockClear();

        collector.detach();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should report ratio between 0 and 1', () => {
        // Add some content
        const p = document.createElement('p');
        p.textContent = 'Hello world this is some content for density testing';
        document.body.appendChild(p);

        collector.attach();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        const density = payload.information_density;

        expect(density.average_content_ratio).toBeGreaterThanOrEqual(0);
        expect(density.average_content_ratio).toBeLessThanOrEqual(1);
        expect(density.min_content_ratio).toBeGreaterThanOrEqual(0);
        expect(density.max_content_ratio).toBeLessThanOrEqual(1);
    });

    it('should handle empty viewport gracefully', () => {
        Object.defineProperty(window, 'innerWidth', { value: 0, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });

        // Should not throw
        collector.attach();
        collector.sampleOnInteraction();
    });

    it('should compute running average across multiple samples', () => {
        collector.attach();

        // Multiple interactions trigger multiple samples
        collector.sampleOnInteraction();
        collector.sampleOnInteraction();
        collector.sampleOnInteraction();

        // Should have been called 4 times total (1 attach + 3 interactions)
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4);

        // Each call should have an average based on all samples so far
        const lastPayload = chrome.runtime.sendMessage.mock.calls[3][0].payload;
        expect(lastPayload.information_density.average_content_ratio).toBeTypeOf('number');
    });

    it('should include page context for min/max', () => {
        // Set document title
        document.title = 'Test Page Title';

        collector.attach();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        const density = payload.information_density;

        // Context should be either the title or a path
        expect(
            density.min_content_context !== null || density.max_content_context !== null
        ).toBe(true);
    });
});
