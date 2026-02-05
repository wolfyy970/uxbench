// Tests for the KeyboardCollector content script module

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { KeyboardCollector } from './keyboard';

function keydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key, bubbles: true, ...opts,
    }));
}

describe('KeyboardCollector', () => {
    let collector: KeyboardCollector;

    beforeEach(() => {
        resetChromeMock();
        collector = new KeyboardCollector();
    });

    afterEach(() => {
        collector.detach();
    });

    it('should attach and detach keydown/focusin listeners', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        const removeSpy = vi.spyOn(document, 'removeEventListener');

        collector.attach();
        expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true, passive: true });
        expect(addSpy).toHaveBeenCalledWith('focusin', expect.any(Function), { capture: true, passive: true });

        collector.detach();
        expect(removeSpy).toHaveBeenCalled();

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('should ignore modifier-only key presses', () => {
        collector.attach();

        keydown('Shift');
        keydown('Control');
        keydown('Alt');
        keydown('Meta');

        // No sendMessage calls because only modifier keys
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('should count regular key presses and send keyboard_update', () => {
        collector.attach();

        keydown('a');
        keydown('b');
        keydown('c');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);

        const lastPayload = chrome.runtime.sendMessage.mock.calls[2][0].payload;
        expect(lastPayload.type).toBe('keyboard_update');
    });

    it('should track context switches from mouse to keyboard', () => {
        collector.attach();

        // Mouse action first
        collector.notifyMouseAction();
        // Then keyboard
        keydown('a');

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.context_switches.total).toBe(1);
    });

    it('should track context switches from keyboard to mouse', () => {
        collector.attach();

        // Keyboard first
        keydown('a');
        // Then mouse action
        collector.notifyMouseAction();
        // Then keyboard again — this should trigger another switch
        keydown('b');

        // Last call has the context switches update
        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        expect(lastCall.payload.context_switches.total).toBe(2); // keyboard→mouse + mouse→keyboard
    });

    it('should not count same-mode actions as switches', () => {
        collector.attach();

        keydown('a');
        keydown('b');
        keydown('c');

        const lastPayload = chrome.runtime.sendMessage.mock.calls[2][0].payload;
        expect(lastPayload.context_switches.total).toBe(0);
    });

    it('should detect known shortcuts (Ctrl+C, Cmd+S, etc.)', () => {
        collector.attach();

        keydown('c', { ctrlKey: true });
        keydown('s', { metaKey: true });

        const lastPayload = chrome.runtime.sendMessage.mock.calls[1][0].payload;
        expect(lastPayload.shortcut_coverage.shortcuts_used).toBe(2);
    });

    it('should not count unknown key combos as shortcuts', () => {
        collector.attach();

        keydown('q', { ctrlKey: true }); // Ctrl+Q is not in KNOWN_SHORTCUTS

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.shortcut_coverage.shortcuts_used).toBe(0);
    });

    it('should track longest keyboard and mouse streaks', () => {
        collector.attach();

        // 5 keyboard actions
        keydown('a');
        keydown('b');
        keydown('c');
        keydown('d');
        keydown('e');

        // Switch to mouse (3 clicks)
        collector.notifyMouseAction();
        collector.notifyMouseAction();
        collector.notifyMouseAction();

        // Back to keyboard
        keydown('f');

        const lastPayload = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0].payload;
        expect(lastPayload.context_switches.longest_keyboard_streak).toBe(5);
        expect(lastPayload.context_switches.longest_mouse_streak).toBe(3);
    });

    it('should classify input fields on focus', () => {
        collector.attach();

        // Free text input
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.placeholder = 'Enter name';
        document.body.appendChild(textInput);

        // Constrained input
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        document.body.appendChild(checkbox);

        // Textarea (free text)
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Notes';
        document.body.appendChild(textarea);

        // Select (constrained)
        const select = document.createElement('select');
        document.body.appendChild(select);

        // Trigger focusin events
        textInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        checkbox.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        select.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

        // Now trigger a keydown to get the update
        keydown('x');

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.typing_ratio.free_text_inputs).toBe(2); // text + textarea
        expect(payload.typing_ratio.constrained_inputs).toBe(2); // checkbox + select
        expect(payload.typing_ratio.ratio).toBeCloseTo(0.5);

        document.body.removeChild(textInput);
        document.body.removeChild(checkbox);
        document.body.removeChild(textarea);
        document.body.removeChild(select);
    });

    it('should not double-count the same input on repeat focus', () => {
        collector.attach();

        const input = document.createElement('input');
        input.type = 'text';
        document.body.appendChild(input);

        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

        keydown('a');

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.typing_ratio.free_text_inputs).toBe(1);

        document.body.removeChild(input);
    });

    it('should compute context switch ratio', () => {
        collector.attach();

        // 3 keyboard actions
        keydown('a');
        keydown('b');
        keydown('c');

        // 2 mouse actions
        collector.notifyMouseAction();
        collector.notifyMouseAction();

        // Back to keyboard
        keydown('d');

        // Total actions = 4 key + 2 mouse = 6, context switches = 2 (key→mouse, mouse→key)
        const lastPayload = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0].payload;
        expect(lastPayload.context_switches.total).toBe(2);
        expect(lastPayload.context_switches.ratio).toBeCloseTo(2 / 6, 2);
    });
});
