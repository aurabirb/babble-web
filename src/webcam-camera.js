export class WebcamCamera {
    constructor() {
        this.stream = null;
        this.videoElement = document.createElement('video');
        this.videoElement.playsInline = true;
        this.isConnected = false;
        this.lastFrameTime = Date.now();
        this.fps = 0;
        this.frameNumber = 0;
        this.eventListeners = new Map();
    }

    async requestPort() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user"
                } 
            });
            this.stream = stream;
            this.videoElement.srcObject = stream;
            await this.videoElement.play();
            return true;
        } catch (err) {
            console.error('Failed to access webcam:', err);
            this._emit('error', err);
            return false;
        }
    }

    async connect() {
        if (!this.stream) {
            throw new Error('No webcam selected. Call requestPort() first.');
        }
        this.isConnected = true;
        this._emit('connected');
        return true;
    }

    async disconnect() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.isConnected = false;
        this._emit('disconnected');
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

    async getFrame() {
        if (!this.isConnected || !this.stream) {
            return null;
        }

        // Calculate FPS
        const currentTime = Date.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        // Exponential moving average for FPS
        const currentFps = deltaTime > 0 ? 1 / deltaTime : 0;
        this.fps = 0.02 * currentFps + 0.98 * this.fps;

        this.frameNumber++;

        // Create a canvas to capture the current frame
        const canvas = document.createElement('canvas');
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(this.videoElement, 0, 0);

        // Convert to blob and create URL
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        const imageUrl = URL.createObjectURL(blob);

        return {
            imageData: null, // Not needed for web display
            frameNumber: this.frameNumber,
            fps: this.fps,
            timestamp: currentTime,
            imageUrl: imageUrl
        };
    }
} 