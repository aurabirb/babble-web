export class WebSerialCamera {
    constructor(options = {}) {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.buffer = new Uint8Array();
        this.lastFrameTime = Date.now();
        this.fps = 0;
        this.frameNumber = 0;
        this.eventListeners = new Map();
        this.latestFrame = null;
        this.currentImageUrl = null;

        // Default options - match the original implementation
        this.options = {
            baudRate: (/mac/i.test(navigator.userAgent)) ? 115200 : 3000000,
            ...options
        };
    }

    async requestPort() {
        if (!navigator.serial) {
            throw new Error('WebSerial is not supported in this browser');
        }

        try {
            this.port = await navigator.serial.requestPort();
            return true;
        } catch (err) {
            console.error('Failed to get port:', err);
            return false;
        }
    }

    async connect() {
        if (!this.port) {
            throw new Error('No port selected. Call requestPort() first.');
        }

        try {
            await this.port.open({
                baudRate: this.options.baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                flowControl: 'none',
                bufferSize: 32768
            });

            this.isConnected = true;
            this._emit('connected');
            this._startReading();
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
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        if (this.writer) {
            await this.writer.close();
            this.writer = null;
        }
        if (this.port) {
            await this.port.close();
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

    async _startReading() {
        while (this.port.readable && this.isConnected) {
            try {
                this.reader = this.port.readable.getReader();
                
                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) {
                        break;
                    }
                    await this._processData(value);
                }
            } catch (err) {
                console.error('Error reading from port:', err);
                this._emit('error', err);
            } finally {
                if (this.reader) {
                    await this.reader.releaseLock();
                }
            }

            // Small delay before attempting to reopen the reader
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async _processData(newData) {
        // Concatenate new data with existing buffer
        const combinedBuffer = new Uint8Array(this.buffer.length + newData.length);
        combinedBuffer.set(this.buffer);
        combinedBuffer.set(newData, this.buffer.length);
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