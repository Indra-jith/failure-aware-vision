/**
 * WebSocket client wrapper with auto-reconnection.
 */
class TrustWebSocket {
    constructor(url, onMessage, onStatusChange) {
        this.url = url;
        this.onMessage = onMessage;
        this.onStatusChange = onStatusChange;
        this.ws = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 10000;
        this.connected = false;
        this.connect();
    }

    connect() {
        try {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                this.connected = true;
                this.reconnectDelay = 1000;
                this.onStatusChange(true);
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.onMessage(data);
                } catch (e) {
                    console.warn('WS parse error:', e);
                }
            };

            this.ws.onclose = () => {
                this.connected = false;
                this.onStatusChange(false);
                this._reconnect();
            };

            this.ws.onerror = () => {
                this.connected = false;
                this.onStatusChange(false);
            };
        } catch (e) {
            this._reconnect();
        }
    }

    _reconnect() {
        setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
            this.connect();
        }, this.reconnectDelay);
    }

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}
