export class ClickCollector {
    private handler = (e: MouseEvent) => this.handleClick(e);

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
                className: target.className,
                innerText: target.innerText?.substring(0, 50) || '',
                rect: target.getBoundingClientRect()
            },
            x: e.clientX,
            y: e.clientY
        };

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: eventData
        });
    }
}
