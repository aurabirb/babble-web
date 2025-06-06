let SerialPort = null;

// Function to dynamically load SerialPort when needed
async function loadSerialPort() {
    if (SerialPort) return SerialPort; // Already loaded
    
    if (window.__TAURI__) {
        try {
            const module = await import('tauri-plugin-serialplugin');
            SerialPort = module.SerialPort;
            return SerialPort;
        } catch (err) {
            console.warn('Failed to import SerialPort plugin:', err);
            return null;
        }
    }
    return null;
}

export class TauriSerialCamera {
    constructor(options = {}) {
        this.port = null;
        this.isConnected = false;
        this.buffer = new Uint8Array();
        this.lastFrameTime = Date.now();
        this.fps = 0;
        this.frameNumber = 0;
        this.eventListeners = new Map();
        this.latestFrame = null;
        this.currentImageUrl = null;
        this.isListening = false;
        this.portPath = null;

        // Default options - match the original implementation
        this.options = {
            baudRate: (/mac/i.test(navigator.userAgent)) ? 115200 : 3000000,
            ...options
        };
        console.log(`TauriSerialCamera initialized with options: ${JSON.stringify(this.options)}`);
    }

    async getAvailablePorts() {
        try {
            // Get SerialPort class
            const currentSerialPort = await loadSerialPort();
            if (!currentSerialPort) {
                throw new Error('SerialPort not available');
            }
            // Get available ports
            const ports = await currentSerialPort.available_ports();
            console.log('Available ports:', ports);
            return ports;
        } catch (err) {
            console.error('Failed to get available ports:', err);
            this._emit('error', err);
            return {};
        }
    }

    async requestPort(selectedPortPath = null) {
        try {
            // Get available ports
            console.log('Tauri serial requested...');

            const ports = await this.getAvailablePorts()
            const portNames = Object.keys(ports);
            
            if (portNames.length === 0) {
                throw new Error('No serial ports found');
            }

            // Use the selected port if provided, otherwise use the first available port
            if (selectedPortPath && portNames.includes(selectedPortPath)) {
                this.portPath = selectedPortPath;
            } else {
                this.portPath = portNames[0];
                console.warn(`No port selected, using first available port: ${this.portPath}`);
            }
            
            console.log(`Selected port: ${this.portPath}`, ports[this.portPath]);
            
            return true;
        } catch (err) {
            console.error('Failed to get port:', err);
            this._emit('error', err);
            return false;
        }
    }

    async connect() {
        if (!this.portPath) {
            throw new Error('No port selected. Call requestPort() first.');
        }

        try {
            // Get SerialPort class
            const currentSerialPort = await loadSerialPort();
            if (!currentSerialPort) {
                throw new Error('SerialPort not available');
            }
            
            // Create SerialPort instance
            this.port = new currentSerialPort({
                path: this.portPath,
                baudRate: this.options.baudRate
            });

            // Open the port
            await this.port.open();
            this.isConnected = true;
            
            // Start listening for data
            await this._startListening();
            
            this._emit('connected');
            return true;
        } catch (err) {
            console.error('Failed to connect:', err);
            this._emit('error', err);
            return false;
        }
    }

    async disconnect() {
        if (this.currentImageUrl) {
            URL.revokeObjectURL(this.currentImageUrl);
            this.currentImageUrl = null;
        }
        
        if (this.port && this.isConnected) {
            try {
                if (this.isListening) {
                    await this.port.cancelListen();
                    this.isListening = false;
                }
                await this.port.close();
            } catch (err) {
                console.error('Error during disconnect:', err);
            }
            this.isConnected = false;
            this._emit('disconnected');
        }
    }

    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event).add(callback);
    }

    off(event, callback) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).delete(callback);
        }
    }

    _emit(event, ...args) {
        if (this.eventListeners.has(event)) {
            for (const callback of this.eventListeners.get(event)) {
                callback(...args);
            }
        }
    }

    async _startListening() {
        try {
            await this.port.startListening();
            this.isListening = true;
            
            // Set up data listener with binary data
            await this.port.listen((data) => {
                this._processData(data);
            }, false); // false = receive raw binary data
            
        } catch (err) {
            console.error('Error starting to listen:', err);
            this._emit('error', err);
        }
    }

    async _processData(newData) {
        // Convert to Uint8Array if needed
        const dataArray = newData instanceof Uint8Array ? newData : new Uint8Array(newData);
        
        // Concatenate new data with existing buffer
        const combinedBuffer = new Uint8Array(this.buffer.length + dataArray.length);
        combinedBuffer.set(this.buffer);
        combinedBuffer.set(dataArray, this.buffer.length);
        this.buffer = combinedBuffer;

        // Process all complete frames in buffer
        while (this.buffer.length > 0) {
            // Find JPEG start marker (FF D8 FF)
            const startIndex = this._findSequence(this.buffer, [0xFF, 0xD8, 0xFF]);
            if (startIndex === -1) {
                // No start marker found, clear buffer and wait for more data
                this.buffer = new Uint8Array();
                break;
            }

            // Remove data before start marker
            if (startIndex > 0) {
                this.buffer = this.buffer.slice(startIndex);
            }

            // Find JPEG end marker (FF D9)
            const endIndex = this._findSequence(this.buffer, [0xFF, 0xD9], 3);
            if (endIndex === -1) {
                // No end marker found, wait for more data
                if (this.buffer.length >= 32768) {
                    console.log(`Buffer too large (${this.buffer.length} bytes), discarding`);
                    this.buffer = new Uint8Array();
                }
                break;
            }

            // Extract JPEG frame (including end marker)
            const jpegFrame = this.buffer.slice(0, endIndex + 2);
            
            // Remove processed frame from buffer
            this.buffer = this.buffer.slice(endIndex + 2);

            // Process the frame
            await this._handleFrame(jpegFrame);
        }
    }

    _findSequence(buffer, sequence, startFrom = 0) {
        for (let i = startFrom; i <= buffer.length - sequence.length; i++) {
            let found = true;
            for (let j = 0; j < sequence.length; j++) {
                if (buffer[i + j] !== sequence[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return -1;
    }

    async _handleFrame(jpegBuffer) {
        try {
            // Calculate FPS
            const currentTime = Date.now();
            const deltaTime = (currentTime - this.lastFrameTime) / 1000;
            this.lastFrameTime = currentTime;

            // Exponential moving average for FPS
            const currentFps = deltaTime > 0 ? 1 / deltaTime : 0;
            this.fps = 0.02 * currentFps + 0.98 * this.fps;

            this.frameNumber++;

            // Clean up previous URL if it exists
            if (this.currentImageUrl) {
                URL.revokeObjectURL(this.currentImageUrl);
            }

            // Create new blob and URL
            const blob = new Blob([jpegBuffer], { type: 'image/jpeg' });
            this.currentImageUrl = URL.createObjectURL(blob);

            // Store the frame
            this.latestFrame = {
                imageData: jpegBuffer,
                frameNumber: this.frameNumber,
                fps: this.fps,
                timestamp: currentTime,
                imageUrl: this.currentImageUrl
            };

        } catch (err) {
            console.error('Error processing frame:', err);
            this._emit('frameError', err);
        }
    }

    async getFrame() {
        // Return the latest frame if available
        if (this.latestFrame) {
            return this.latestFrame;
        }
        return null;
    }
}
