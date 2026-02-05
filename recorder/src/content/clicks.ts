export class ClickCollector {
    private handler = (e: MouseEvent) => this.handleClick(e);

    // Callback for cross-collector coordination (context switches, density sampling)
    onClickCaptured: (() => void) | null = null;

    attach() {
        document.addEventListener('click', this.handler, { capture: true, passive: true });
    }

    detach() {
        document.removeEventListener('click', this.handler, { capture: true });
    }

    private handleClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const eventData = {
            type: 'click',
            timestamp: Date.now(),
            target: {
                tagName: target.tagName,
                id: target.id,
                className: typeof target.className === 'string' ? target.className : '',
                innerText: target.innerText?.substring(0, 50) || '',
                rect: target.getBoundingClientRect()
            },
            x: e.clientX,
            y: e.clientY
        };

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: eventData
        }).catch(() => {});

        // Notify other collectors
        if (this.onClickCaptured) this.onClickCaptured();
    }
}
