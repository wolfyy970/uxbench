// Keyboard collector — tracks context switches, shortcut usage, and typing ratio.
// "Context switch" = transition between mouse and keyboard input modes.

// Common shortcuts we can detect
const KNOWN_SHORTCUTS: Record<string, string> = {
    'ctrl+c': 'Copy', 'meta+c': 'Copy',
    'ctrl+v': 'Paste', 'meta+v': 'Paste',
    'ctrl+x': 'Cut', 'meta+x': 'Cut',
    'ctrl+z': 'Undo', 'meta+z': 'Undo',
    'ctrl+shift+z': 'Redo', 'meta+shift+z': 'Redo',
    'ctrl+a': 'Select All', 'meta+a': 'Select All',
    'ctrl+s': 'Save', 'meta+s': 'Save',
    'ctrl+f': 'Find', 'meta+f': 'Find',
    'ctrl+enter': 'Submit', 'meta+enter': 'Submit',
    'escape': 'Escape/Close',
};

export class KeyboardCollector {
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

    attach() {
        document.addEventListener('keydown', this.keydownHandler, { capture: true, passive: true });
        document.addEventListener('focusin', this.focusHandler, { capture: true, passive: true });
    }

    detach() {
        document.removeEventListener('keydown', this.keydownHandler, { capture: true } as any);
        document.removeEventListener('focusin', this.focusHandler, { capture: true } as any);
    }

    // Called by collector.ts when a click happens so we can track mouse→keyboard switches
    notifyMouseAction() {
        this.totalMouseActions += 1;
        if (this.lastInputMode === 'keyboard') {
            this.contextSwitches += 1;
            // End keyboard streak, start mouse streak
            if (this.currentKeyboardStreak > this.longestKeyboardStreak) {
                this.longestKeyboardStreak = this.currentKeyboardStreak;
            }
            this.currentKeyboardStreak = 0;
        }
        this.currentMouseStreak += 1;
        if (this.currentMouseStreak > this.longestMouseStreak) {
            this.longestMouseStreak = this.currentMouseStreak;
        }
        this.lastInputMode = 'mouse';
    }

    private handleKeydown(e: KeyboardEvent) {
        // Ignore modifier-only presses
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

        this.totalKeyActions += 1;

        // Track context switch from mouse → keyboard
        if (this.lastInputMode === 'mouse') {
            this.contextSwitches += 1;
            if (this.currentMouseStreak > this.longestMouseStreak) {
                this.longestMouseStreak = this.currentMouseStreak;
            }
            this.currentMouseStreak = 0;
        }
        this.currentKeyboardStreak += 1;
        if (this.currentKeyboardStreak > this.longestKeyboardStreak) {
            this.longestKeyboardStreak = this.currentKeyboardStreak;
        }
        this.lastInputMode = 'keyboard';

        // Detect shortcuts (modifier + key)
        if (e.ctrlKey || e.metaKey) {
            const parts = [];
            if (e.ctrlKey) parts.push('ctrl');
            if (e.metaKey) parts.push('meta');
            if (e.shiftKey) parts.push('shift');
            parts.push(e.key.toLowerCase());
            const combo = parts.join('+');

            if (KNOWN_SHORTCUTS[combo]) {
                this.shortcutsUsed += 1;
            }
        }

        this.sendUpdate();
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
        }).catch(() => {});
    }
}
