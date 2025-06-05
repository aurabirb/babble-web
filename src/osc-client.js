import OSC from 'osc-js';

export class OSCClient {
    constructor(port = 9000) {
        // Create OSC UDP client
        this.osc = new OSC({
            plugin: new OSC.WebsocketClientPlugin({
                port: port,
                secure: false
            })
        });

        this.isConnected = false;
        this.port = port;
    }

    async connect() {
        try {
            await this.osc.open();
            this.isConnected = true;
            console.log(`OSC client connected to localhost:${this.port}`);
        } catch (err) {
            console.error('Failed to connect OSC client:', err);
            this.isConnected = false;
        }
    }

    disconnect() {
        if (this.isConnected) {
            this.osc.close();
            this.isConnected = false;
            console.log('OSC client disconnected');
        }
    }

    /**
     * Send blendshape values to VRCFaceTracking
     * @param {Object} blendshapes - Object containing blendshape values
     */
    sendBlendshapes(blendshapes) {
        if (!this.isConnected) return;

        // Send each blendshape value as a separate OSC message
        Object.entries(blendshapes).forEach(([name, value]) => {
            const message = new OSC.Message(`/avatar/parameters/${name}`, value);
            this.osc.send(message);
        });
    }
} 