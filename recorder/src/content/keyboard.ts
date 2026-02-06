// Keyboard collector — tracks context switches, shortcut usage, and typing ratio.
// "Context switch" = transition between mouse and keyboard input modes.
// "Shortcut" = any keydown with a modifier key (Ctrl, Cmd, Alt/Option).
// We don't maintain a dictionary of known shortcuts — we can't know what shortcuts
// an arbitrary application supports. Any modifier combo signals keyboard proficiency.

import { NOOP } from './shared';

/** Debounce interval for batching keyboard update messages to the worker */
const KEYBOARD_DEBOUNCE_MS = 250;

export class KeyboardCollector {
    private readonly captureOpts: AddEventListenerOptions = { capture: true, passive: true };
    private keydownHandler = (e: KeyboardEvent) => this.handleKeydown(e);
    private focusHandler = (e: FocusEvent) => this.handleFocus(e);

    private lastInputMode: 'mouse' | 'keyboard' | null = null;
    private contextSwitches = 0;
    private totalKeyActions = 0;
    private totalMouseActions = 0;
    private currentKeyboardStreak = 0;
    private currentMouseStreak = 0;
    private longestKeyboardStreak = 0;
    private longestMouseStreak = 0;
    private shortcutsUsed = 0;
    private freeTextInputs = 0;
    private constrainedInputs = 0;
    private freeTextFields: string[] = [];
    private trackedInputs: Set<HTMLElement> = new Set();
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    attach() {
        document.addEventListener('keydown', this.keydownHandler, this.captureOpts);
        document.addEventListener('focusin', this.focusHandler, this.captureOpts);
    }

    detach() {
        // Finalize current streaks before flushing (recording may end mid-streak)
        this.finalizeStreaks();

        // Flush any pending debounced update
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        this.sendUpdate();
        document.removeEventListener('keydown', this.keydownHandler, this.captureOpts);
        document.removeEventListener('focusin', this.focusHandler, this.captureOpts);
    }

    /** Record a mode transition (mouse↔keyboard), updating streaks and context switch count */
    private recordModeSwitch(newMode: 'mouse' | 'keyboard') {
        if (this.lastInputMode && this.lastInputMode !== newMode) {
            this.contextSwitches += 1;
            // Finalize the ending mode's streak
            if (this.lastInputMode === 'keyboard') {
                if (this.currentKeyboardStreak > this.longestKeyboardStreak)
                    this.longestKeyboardStreak = this.currentKeyboardStreak;
                this.currentKeyboardStreak = 0;
            } else {
                if (this.currentMouseStreak > this.longestMouseStreak)
                    this.longestMouseStreak = this.currentMouseStreak;
                this.currentMouseStreak = 0;
            }
        }
        // Increment new mode's streak and check longest
        if (newMode === 'keyboard') {
            this.currentKeyboardStreak += 1;
            if (this.currentKeyboardStreak > this.longestKeyboardStreak)
                this.longestKeyboardStreak = this.currentKeyboardStreak;
        } else {
            this.currentMouseStreak += 1;
            if (this.currentMouseStreak > this.longestMouseStreak)
                this.longestMouseStreak = this.currentMouseStreak;
        }
        this.lastInputMode = newMode;
    }

    /** Finalize both streaks (called on detach when recording ends mid-streak) */
    private finalizeStreaks() {
        if (this.currentKeyboardStreak > this.longestKeyboardStreak)
            this.longestKeyboardStreak = this.currentKeyboardStreak;
        if (this.currentMouseStreak > this.longestMouseStreak)
            this.longestMouseStreak = this.currentMouseStreak;
    }

    // Called by collector.ts when a click happens so we can track mouse→keyboard switches
    notifyMouseAction() {
        this.totalMouseActions += 1;
        this.recordModeSwitch('mouse');
    }

    private handleKeydown(e: KeyboardEvent) {
        // Ignore modifier-only presses
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

        this.totalKeyActions += 1;
        this.recordModeSwitch('keyboard');

        // Any modifier combo (Ctrl, Cmd, Alt/Option) counts as a shortcut
        if (e.ctrlKey || e.metaKey || e.altKey) {
            this.shortcutsUsed += 1;
        }

        this.scheduleUpdate();
    }

    private handleFocus(e: FocusEvent) {
        const target = e.target as HTMLElement;
        if (!target || this.trackedInputs.has(target)) return;

        // Classify input fields
        if (target instanceof HTMLInputElement) {
            this.trackedInputs.add(target);
            const type = target.type.toLowerCase();
            const constrained = ['checkbox', 'radio', 'range', 'color', 'date',
                'datetime-local', 'month', 'week', 'time', 'file', 'hidden'];

            if (constrained.includes(type)) {
                this.constrainedInputs += 1;
            } else {
                // text, email, password, search, tel, url, number
                this.freeTextInputs += 1;
                const label = target.labels?.[0]?.textContent?.trim() ||
                    target.placeholder || target.name || target.id || target.type;
                if (label) this.freeTextFields.push(label.substring(0, 50));
            }
        } else if (target instanceof HTMLTextAreaElement) {
            this.trackedInputs.add(target);
            this.freeTextInputs += 1;
            const label = target.labels?.[0]?.textContent?.trim() ||
                target.placeholder || target.name || target.id || 'textarea';
            if (label) this.freeTextFields.push(label.substring(0, 50));
        } else if (target instanceof HTMLSelectElement) {
            this.trackedInputs.add(target);
            this.constrainedInputs += 1;
        }
    }

    private scheduleUpdate() {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => {
            this.sendUpdate();
            this.updateTimer = null;
        }, KEYBOARD_DEBOUNCE_MS);
    }

    private sendUpdate() {
        const totalActions = this.totalKeyActions + this.totalMouseActions;
        const totalInputs = this.freeTextInputs + this.constrainedInputs;

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'keyboard_update',
                context_switches: {
                    total: this.contextSwitches,
                    ratio: totalActions > 0 ? this.contextSwitches / totalActions : 0,
                    longest_keyboard_streak: this.longestKeyboardStreak,
                    longest_mouse_streak: this.longestMouseStreak
                },
                shortcut_coverage: {
                    shortcuts_used: this.shortcutsUsed
                },
                typing_ratio: {
                    free_text_inputs: this.freeTextInputs,
                    constrained_inputs: this.constrainedInputs,
                    ratio: totalInputs > 0 ? this.freeTextInputs / totalInputs : 0,
                    free_text_fields: this.freeTextFields
                }
            }
        }).catch(NOOP);
    }
}
