// Tests for the ClickCollector content script module

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { ClickCollector } from './clicks';

describe('ClickCollector', () => {
    let collector: ClickCollector;

    beforeEach(() => {
        resetChromeMock();
        collector = new ClickCollector();
    });

    it('should attach and detach click listener', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        const removeSpy = vi.spyOn(document, 'removeEventListener');

        collector.attach();
        expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), { capture: true, passive: true });

        collector.detach();
        expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('should send EVENT_CAPTURED message on click', () => {
        collector.attach();

        // Create a mock button element
        const btn = document.createElement('button');
        btn.id = 'test-btn';
        btn.textContent = 'Click Me';
        document.body.appendChild(btn);

        // Dispatch a click event
        const clickEvent = new MouseEvent('click', {
            clientX: 150, clientY: 250, bubbles: true
        });
        btn.dispatchEvent(clickEvent);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EVENT_CAPTURED',
                payload: expect.objectContaining({
                    type: 'click',
                    x: 150,
                    y: 250,
                    target: expect.objectContaining({
                        tagName: 'BUTTON',
                        id: 'test-btn',
                    })
                })
            })
        );

        document.body.removeChild(btn);
        collector.detach();
    });

    it('should invoke onClickCaptured callback', () => {
        const callback = vi.fn();
        collector.onClickCaptured = callback;
        collector.attach();

        const btn = document.createElement('button');
        document.body.appendChild(btn);

        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(callback).toHaveBeenCalledOnce();

        document.body.removeChild(btn);
        collector.detach();
    });

    it('should handle SVG elements without crashing (className is SVGAnimatedString)', () => {
        collector.attach();

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);

        // Should not throw
        svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(chrome.runtime.sendMessage).toHaveBeenCalled();

        document.body.removeChild(svg);
        collector.detach();
    });

    it('should include bounding rect in target data', () => {
        collector.attach();

        const div = document.createElement('div');
        document.body.appendChild(div);

        div.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const call = chrome.runtime.sendMessage.mock.calls[0][0];
        expect(call.payload.target.rect).toBeDefined();

        document.body.removeChild(div);
        collector.detach();
    });

    it('should truncate innerText to 50 characters', () => {
        collector.attach();

        const p = document.createElement('p');
        p.textContent = 'A'.repeat(100);
        document.body.appendChild(p);

        p.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const call = chrome.runtime.sendMessage.mock.calls[0][0];
        expect(call.payload.target.innerText.length).toBeLessThanOrEqual(50);

        document.body.removeChild(p);
        collector.detach();
    });
});
