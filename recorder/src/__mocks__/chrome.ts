// Chrome Extension API mock for testing
// Provides minimal stubs for chrome.storage.local, chrome.runtime, chrome.tabs, etc.

import { vi } from 'vitest';

const storage: Record<string, any> = {};

export const chrome = {
    storage: {
        local: {
            get: vi.fn(async (keys: string | string[]) => {
                const keyList = typeof keys === 'string' ? [keys] : keys;
                const result: Record<string, any> = {};
                for (const key of keyList) {
                    if (key in storage) result[key] = storage[key];
                }
                return result;
            }),
            set: vi.fn(async (items: Record<string, any>) => {
                Object.assign(storage, items);
            }),
            remove: vi.fn(async (keys: string | string[]) => {
                const keyList = typeof keys === 'string' ? [keys] : keys;
                for (const key of keyList) {
                    delete storage[key];
                }
            }),
            // Expose for test inspection
            _storage: storage,
            _clear: () => {
                for (const key of Object.keys(storage)) delete storage[key];
            }
        }
    },
    runtime: {
        sendMessage: vi.fn(async () => {}),
        onMessage: {
            addListener: vi.fn(),
        },
        onInstalled: {
            addListener: vi.fn((fn: () => void) => fn()),
        },
    },
    tabs: {
        query: vi.fn(async () => [{ id: 1, url: 'https://example.com' }]),
        sendMessage: vi.fn(async () => {}),
    },
    action: {
        setBadgeText: vi.fn(async () => {}),
        setBadgeBackgroundColor: vi.fn(async () => {}),
    },
    windows: {
        getCurrent: vi.fn(async () => ({ id: 1, width: 1280, height: 800 })),
        update: vi.fn(async () => {}),
    },
    scripting: {
        executeScript: vi.fn(async () => [{ result: { w: 1280, h: 800 } }]),
    },
    sidePanel: {
        setPanelBehavior: vi.fn(),
    },
    commands: {
        onCommand: {
            addListener: vi.fn(),
        },
    },
};

// Reset all mocks and storage
export function resetChromeMock() {
    chrome.storage.local._clear();
    vi.clearAllMocks();
}
