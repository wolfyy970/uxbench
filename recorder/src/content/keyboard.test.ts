// Tests for the KeyboardCollector content script module

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { KeyboardCollector } from './keyboard';

function keydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key, bubbles: true, ...opts,
    }));
}

// Flush the 250ms debounce timer used by KeyboardCollector
function flushDebounce() {
    vi.advanceTimersByTime(300);
}

describe('KeyboardCollector', () => {
    let collector: KeyboardCollector;

    beforeEach(() => {
        vi.useFakeTimers();
        resetChromeMock();
        collector = new KeyboardCollector();
    });

    afterEach(() => {
        collector.detach();
        vi.useRealTimers();
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
        flushDebounce();

        // No sendMessage calls because only modifier keys
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('should count regular key presses and send keyboard_update', () => {
        collector.attach();

        keydown('a');
        keydown('b');
        keydown('c');
        flushDebounce();

        // Debounced: one batched sendMessage call
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.type).toBe('keyboard_update');
    });

    it('should track context switches from mouse to keyboard', () => {
        collector.attach();

        // Mouse action first
        collector.notifyMouseAction();
        // Then keyboard
        keydown('a');
        flushDebounce();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.context_switches.total).toBe(1);
    });

    it('should track context switches from keyboard to mouse', () => {
        collector.attach();

        // Keyboard first
        keydown('a');
        flushDebounce();
        // Then mouse action
        collector.notifyMouseAction();
        // Then keyboard again — this should trigger another switch
        keydown('b');
        flushDebounce();

        // Last call has the context switches update
        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        expect(lastCall.payload.context_switches.total).toBe(2); // keyboard→mouse + mouse→keyboard
    });

    it('should not count same-mode actions as switches', () => {
        collector.attach();

        keydown('a');
        keydown('b');
        keydown('c');
        flushDebounce();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.context_switches.total).toBe(0);
    });

    it('should count any modifier combo as a shortcut (Ctrl, Cmd, Alt)', () => {
        collector.attach();

        keydown('c', { ctrlKey: true });
        keydown('s', { metaKey: true });
        keydown('q', { altKey: true });
        flushDebounce();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.shortcut_coverage.shortcuts_used).toBe(3);
    });

    it('should not count keys without modifiers as shortcuts', () => {
        collector.attach();

        keydown('Escape');
        keydown('a');
        keydown('Enter');
        flushDebounce();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.shortcut_coverage.shortcuts_used).toBe(0);
    });

    it('should not count Shift-only combos as shortcuts', () => {
        collector.attach();

        keydown('A', { shiftKey: true }); // Shift+A = typing capital A, not a shortcut
        flushDebounce();

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
        flushDebounce();

        // Switch to mouse (3 clicks)
        collector.notifyMouseAction();
        collector.notifyMouseAction();
        collector.notifyMouseAction();

        // Back to keyboard
        keydown('f');
        flushDebounce();

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
        flushDebounce();

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
        flushDebounce();

        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.typing_ratio.free_text_inputs).toBe(1);

        document.body.removeChild(input);
    });

    it('should debounce rapid keystrokes into a single message', () => {
        collector.attach();

        // Type 5 keys rapidly without flushing
        keydown('h');
        keydown('e');
        keydown('l');
        keydown('l');
        keydown('o');

        // Before debounce fires, no messages should have been sent
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

        // Flush debounce
        flushDebounce();

        // Only ONE batched message
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('should flush pending update and finalize streaks on detach', () => {
        collector.attach();

        // Build a keyboard streak of 4
        keydown('a');
        keydown('b');
        keydown('c');
        keydown('d');
        // Do NOT flush — leave the debounce pending

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

        // Detach should flush the pending update
        collector.detach();

        // The flush on detach should have sent the update
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        const payload = chrome.runtime.sendMessage.mock.calls[0][0].payload;
        expect(payload.context_switches.longest_keyboard_streak).toBe(4);
    });

    it('should compute context switch ratio', () => {
        collector.attach();

        // 3 keyboard actions
        keydown('a');
        keydown('b');
        keydown('c');
        flushDebounce();

        // 2 mouse actions
        collector.notifyMouseAction();
        collector.notifyMouseAction();

        // Back to keyboard
        keydown('d');
        flushDebounce();

        // Total actions = 4 key + 2 mouse = 6, context switches = 2 (key→mouse, mouse→key)
        const lastPayload = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0].payload;
        expect(lastPayload.context_switches.total).toBe(2);
        expect(lastPayload.context_switches.ratio).toBeCloseTo(2 / 6, 2);
    });
});
