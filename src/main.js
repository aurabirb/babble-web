import { WebSerialCamera } from './serial-camera';
import { TauriSerialCamera } from './tauri-serial-camera';
import { WebcamCamera } from './webcam-camera';
import { BabbleModel } from './babble-model';
import './style.css';
import { MultiOneEuroFilter } from './one-euro-filter.js';

// for events: https://v2.tauri.app/develop/calling-rust/
import { listen, emit } from '@tauri-apps/api/event';
// for commands
// import { invoke } from '@tauri-apps/api/core';

const modelUrl = '/babble-web/model.onnx';
const IMAGE_SIZE = 224; // Model's required input size

class BabbleApp {
    constructor() {
        console.log('Initializing Babble Web App...');
        // Detect environment and choose appropriate serial implementation
        this.isTauriEnvironment = window.__TAURI__ !== undefined;
        console.log(`Is Tauri environment: ${this.isTauriEnvironment}`);
        this.hasWebSerial = 'serial' in navigator;

        // Initialize serial camera based on environment
        if (this.hasWebSerial) {
            this.serialCamera = new WebSerialCamera();
            this.logMessage('Using WebSerial API for serial communication');
        } else if (this.isTauriEnvironment) {
            this.serialCamera = new TauriSerialCamera();
            this.logMessage('Using Tauri plugin for serial communication');
        } else {
            this.serialCamera = null;
            console.warn('WebSerial is not supported in this browser');
            this.logMessage('WebSerial is not supported in this browser');
        }

        this.webcamCamera = new WebcamCamera();
        this.activeCamera = null;
        this.model = new BabbleModel();
        this.oneEuroFilter = new MultiOneEuroFilter(
            BabbleModel.blendshapeNames.length,  // Size based on number of blendshapes
            3.0,  // minCutoff (from original Babble settings)
            0.9,  // beta (from original Babble settings)
            1.0   // dCutoff
        );
        this.isModelInitialized = false;
        this.targetFps = 60;
        this.frameInterval = 1000 / this.targetFps; // 60 FPS = 16.67ms between frames
        this.lastFrameTime = 0;
        this.currentFps = 0;
        this.frameTimeoutId = null;
        this.isVerticallyFlipped = false;
        this.isHorizontallyFlipped = false;

        // Filter parameters
        this.filterParams = {
            minCutoff: 3.0,
            beta: 0.9,
            dCutoff: 1.0
        };

        // Crop rectangle state
        this.cropRect = {
            x: 0,
            y: 0,
            width: IMAGE_SIZE,
            height: IMAGE_SIZE
        };

        // Drawing state
        this.isDrawing = false;
        this.drawStart = { x: 0, y: 0 };
        this.drawEnd = { x: 0, y: 0 };  // Add end position tracking

        this.setupUI();
        this.setupEventListeners();
    }

    logMessage(message) {
        const logElement = document.querySelector('#log');
        const messages = logElement.querySelectorAll('pre');
        if (messages.length >= 50) {
            logElement.removeChild(logElement.lastChild);
        }
        const pre = document.createElement('pre');
        pre.textContent = message;
        logElement.prepend(pre);
    }

    setupUI() {
        // Create UI elements
        const app = document.querySelector('#app');
        app.innerHTML = `
            <div class="container">
                <div class="header">
                    <h1>Babble Web</h1>
                    <div class="controls">
                        <select id="cameraSource">
                            <option value="serial">Serial Camera</option>
                            <option value="webcam">Webcam</option>
                        </select>
                        <button id="connectBtn">Connect Camera</button>
                        <button id="flipVerticalBtn">Flip Vertical: Off</button>
                        <button id="flipHorizontalBtn">Flip Horizontal: Off</button>
                        <span id="fpsCounter">FPS: 0</span>
                    </div>
                    <div class="filter-controls">
                        <div class="filter-param">
                            <label for="minCutoff">Min Cutoff: <span id="minCutoffValue">3.0</span></label>
                            <input type="range" id="minCutoff" min="0.1" max="10.0" step="0.1" value="3.0">
                        </div>
                        <div class="filter-param">
                            <label for="beta">Beta: <span id="betaValue">0.9</span></label>
                            <input type="range" id="beta" min="0.1" max="1.0" step="0.01" value="0.9">
                        </div>
                        <div class="filter-param">
                            <label for="dCutoff">D Cutoff: <span id="dCutoffValue">1.0</span></label>
                            <input type="range" id="dCutoff" min="0.1" max="5.0" step="0.1" value="1.0">
                        </div>
                    </div>
                </div>
                <div class="main-content">
                    <div class="preview">
                        <canvas id="preview" alt="Camera Preview"></canvas>
                        <canvas id="previewCropped" alt="Cropped Preview"></canvas>
                        <div id="log"></div>
                    </div>
                    <div class="blendshapes">
                        <h2>Blendshapes</h2>
                        <div id="blendshapesList"></div>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        const connectBtn = document.getElementById('connectBtn');
        const flipVerticalBtn = document.getElementById('flipVerticalBtn');
        const flipHorizontalBtn = document.getElementById('flipHorizontalBtn');
        const cameraSource = document.getElementById('cameraSource');
        /** @type {HTMLCanvasElement} */
        const preview = document.getElementById('preview');
        preview.style.cursor = 'grab';
        const fpsCounter = document.getElementById('fpsCounter');

        // Filter parameter sliders
        const minCutoffSlider = document.getElementById('minCutoff');
        const betaSlider = document.getElementById('beta');
        const dCutoffSlider = document.getElementById('dCutoff');
        const minCutoffValue = document.getElementById('minCutoffValue');
        const betaValue = document.getElementById('betaValue');
        const dCutoffValue = document.getElementById('dCutoffValue');

        // Add event listeners for filter parameter sliders
        minCutoffSlider.addEventListener('input', (e) => {
            this.filterParams.minCutoff = parseFloat(e.target.value);
            minCutoffValue.textContent = e.target.value;
            this.updateFilter();
        });

        betaSlider.addEventListener('input', (e) => {
            this.filterParams.beta = parseFloat(e.target.value);
            betaValue.textContent = e.target.value;
            this.updateFilter();
        });

        dCutoffSlider.addEventListener('input', (e) => {
            this.filterParams.dCutoff = parseFloat(e.target.value);
            dCutoffValue.textContent = e.target.value;
            this.updateFilter();
        });

        // Listen for UDP messages from the backend
        // const unlisten = listen('udp-message', (event) => {
        //     this.logMessage(`Received UDP message: ${event.payload}`);
        // });

        // Add mouse event listeners for drawing crop rectangle
        preview.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', () => this.handleMouseUp());

        cameraSource.addEventListener('change', async () => {
            if (this.activeCamera && this.activeCamera.isConnected) {
                this.stopFrameProcessing();
                await this.activeCamera.disconnect();
                // reset the crop rectangle
                this.cropRect = {
                    x: preview.width / 2 - IMAGE_SIZE / 2,
                    y: preview.height / 2 - IMAGE_SIZE / 2,
                    width: IMAGE_SIZE,
                    height: IMAGE_SIZE
                };
                connectBtn.textContent = 'Connect Camera';
            }
        });

        connectBtn.addEventListener('click', async () => {
            const selectedSource = cameraSource.value;
            // Check if serial communication is supported for serial camera
            if (selectedSource === 'serial' && !this.serialCamera) {
                this.logMessage('Serial communication is not supported in this browser. Please use a browser that supports WebSerial API (Chrome, Edge) or use the Blubber dektop app.');
            }

            const camera = selectedSource === 'webcam' ? this.webcamCamera : this.serialCamera;
            
            if (!camera || !camera.isConnected) {
                console.log(`Connecting to ${selectedSource} camera...`);
                if (camera && await camera.requestPort()) {
                    await camera.connect();
                    this.activeCamera = camera;
                    connectBtn.textContent = 'Disconnect';

                    // Initialize model if not already done
                    if (!this.isModelInitialized) {
                        try {
                            await this.model.initialize(modelUrl);
                            this.isModelInitialized = true;
                            // Start frame processing loop after model is initialized
                            this.startFrameProcessing();
                        } catch (err) {
                            console.error('Failed to initialize model:', err);
                            alert('Failed to initialize model. Please check console for details.');
                        }
                    } else {
                        // Start frame processing if model was already initialized
                        this.startFrameProcessing();
                    }
                }
            } else {
                this.stopFrameProcessing();
                await this.activeCamera.disconnect();
                this.activeCamera = null;
                connectBtn.textContent = 'Connect Camera';
            }
        });

        flipVerticalBtn.addEventListener('click', () => {
            this.isVerticallyFlipped = !this.isVerticallyFlipped;
            flipVerticalBtn.textContent = `Flip Vertical: ${this.isVerticallyFlipped ? 'On' : 'Off'}`;
        });

        flipHorizontalBtn.addEventListener('click', () => {
            this.isHorizontallyFlipped = !this.isHorizontallyFlipped;
            flipHorizontalBtn.textContent = `Flip Horizontal: ${this.isHorizontallyFlipped ? 'On' : 'Off'}`;
        });

        if (this.serialCamera) {
            this.serialCamera.on('error', (error) => {
                console.error('Serial camera error:', error);
                alert('Serial camera error: ' + error.message);
            });
        }

        this.webcamCamera.on('error', (error) => {
            console.error('Webcam error:', error);
            alert('Webcam error: ' + error.message);
        });
    }

    handleMouseDown(e) {
        /** @type {HTMLCanvasElement} */
        const preview = document.getElementById('preview');
        const rect = preview.getBoundingClientRect();
        const scaleX = preview.width / rect.width;
        const scaleY = preview.height / rect.height;

        // Get mouse position relative to canvas and scale it
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        this.isDrawing = true;
        this.drawStart = { x: mouseX, y: mouseY };
        this.drawEnd = { x: mouseX, y: mouseY };  // Initialize end position

        // Initialize crop rectangle at click point
        this.cropRect = {
            x: mouseX,
            y: mouseY,
            width: 0,
            height: 0
        };
    }

    handleMouseMove(e) {
        if (!this.isDrawing) return;

        /** @type {HTMLCanvasElement} */
        const preview = document.getElementById('preview');
        const rect = preview.getBoundingClientRect();
        const scaleX = preview.width / rect.width;
        const scaleY = preview.height / rect.height;

        // Get mouse position relative to canvas and scale it
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;

        this.drawEnd = { x: mouseX, y: mouseY };  // Update end position

        // Calculate rectangle dimensions
        const width = mouseX - this.drawStart.x;
        const height = mouseY - this.drawStart.y;

        // Update crop rectangle, handling negative dimensions
        this.cropRect = {
            x: width >= 0 ? this.drawStart.x : mouseX,
            y: height >= 0 ? this.drawStart.y : mouseY,
            width: Math.abs(width),
            height: Math.abs(height)
        };

        // Constrain to preview boundaries
        this.cropRect.x = Math.max(0, Math.min(this.cropRect.x, preview.width));
        this.cropRect.y = Math.max(0, Math.min(this.cropRect.y, preview.height));
        this.cropRect.width = Math.min(this.cropRect.width, preview.width - this.cropRect.x);
        this.cropRect.height = Math.min(this.cropRect.height, preview.height - this.cropRect.y);
    }

    handleMouseUp() {
        if (!this.isDrawing) return;
        this.isDrawing = false;

        // Check if this was a click without drag
        if (this.drawStart.x === this.drawEnd.x && this.drawStart.y === this.drawEnd.y) {
            /** @type {HTMLCanvasElement} */
            const preview = document.getElementById('preview');

            // Center a default-sized crop rectangle around the click point
            const centerX = this.drawStart.x;
            const centerY = this.drawStart.y;

            // Calculate the crop rectangle position, ensuring it stays within bounds
            let x = centerX - IMAGE_SIZE / 2;
            let y = centerY - IMAGE_SIZE / 2;

            // Constrain to preview boundaries
            x = Math.max(0, Math.min(x, preview.width - IMAGE_SIZE));
            y = Math.max(0, Math.min(y, preview.height - IMAGE_SIZE));

            this.cropRect = {
                x: x,
                y: y,
                width: IMAGE_SIZE,
                height: IMAGE_SIZE
            };
        }
    }

    async processFrame() {
        if (!this.activeCamera || !this.activeCamera.isConnected || !this.isModelInitialized) return;

        // Use Date.now() for timestamp since we're not using requestAnimationFrame anymore
        const timestamp = Date.now();

        // Calculate FPS
        if (this.lastFrameTime) {
            const deltaTime = timestamp - this.lastFrameTime;
            const instantFps = 1000 / deltaTime;
            // Use exponential moving average for smoother FPS display
            this.currentFps = this.currentFps * 0.9 + instantFps * 0.1;
        }
        this.lastFrameTime = timestamp;

        const frame = await this.activeCamera.getFrame();
        if (!frame) return;

        /** @type {HTMLCanvasElement} */
        const preview = document.getElementById('preview');
        /** @type {HTMLCanvasElement} */
        const previewCropped = document.getElementById('previewCropped');
        const fpsCounter = document.getElementById('fpsCounter');

        // Create a temporary image to load the frame data
        const img = new Image();
        img.onload = () => {
            // Set main preview canvas dimensions to match the image
            preview.width = img.width;
            preview.height = img.height;
            const ctx = preview.getContext('2d', { willReadFrequently: true });

            // Clear the canvas
            ctx.clearRect(0, 0, preview.width, preview.height);

            // Save the current context state
            ctx.save();

            // Apply transformations based on flip states
            if (this.isHorizontallyFlipped) {
                ctx.translate(preview.width, 0);
                ctx.scale(-1, 1);
            }
            if (this.isVerticallyFlipped) {
                ctx.translate(0, preview.height);
                ctx.scale(1, -1);
            }

            // Draw the transformed image
            ctx.drawImage(img, 0, 0);

            // Restore the context state
            ctx.restore();

            // Draw crop rectangle overlay
            if (this.cropRect.width > 0 && this.cropRect.height > 0) {
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.strokeRect(
                    this.cropRect.x,
                    this.cropRect.y,
                    this.cropRect.width,
                    this.cropRect.height
                );

                // Set up cropped preview canvas - always use IMAGE_SIZE
                previewCropped.width = IMAGE_SIZE;
                previewCropped.height = IMAGE_SIZE;
                const ctxCropped = previewCropped.getContext('2d');

                // Clear the cropped canvas
                ctxCropped.clearRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);

                // Save state before transformations
                ctxCropped.save();

                // Apply the same flip transformations to the cropped preview
                if (this.isHorizontallyFlipped) {
                    ctxCropped.translate(IMAGE_SIZE, 0);
                    ctxCropped.scale(-1, 1);
                }
                if (this.isVerticallyFlipped) {
                    ctxCropped.translate(0, IMAGE_SIZE);
                    ctxCropped.scale(1, -1);
                }

                // Draw the cropped region, scaling to IMAGE_SIZE
                ctxCropped.drawImage(
                    img,
                    this.cropRect.x, this.cropRect.y,
                    this.cropRect.width, this.cropRect.height,
                    0, 0,
                    IMAGE_SIZE, IMAGE_SIZE
                );

                // Restore the cropped canvas state
                ctxCropped.restore();
            }
        };
        img.src = frame.imageUrl;

        // Show our actual processing FPS instead of camera FPS
        fpsCounter.textContent = `FPS: ${this.currentFps.toFixed(1)}`;

        try {
            // Only run prediction if the previous one is complete and we have a valid crop
            if (!this.isPredicting && this.cropRect.width > 0 && this.cropRect.height > 0) {
                this.isPredicting = true;
                // Use the cropped preview for predictions
                const predictions = await this.model.predict(previewCropped);

                // Apply One Euro Filter to the predictions
                const filteredPredictions = this.oneEuroFilter.filter(predictions, timestamp / 1000.0);

                // Update blendshapes with filtered predictions
                this.updateBlendshapes(filteredPredictions);
                this.isPredicting = false;
            }
        } catch (err) {
            console.error('Prediction error:', err);
            this.isPredicting = false;
        }

        // Schedule next frame if still connected using setTimeout instead of requestAnimationFrame
        // This ensures processing continues even when the tab loses focus
        if (this.isProcessingFrames && this.activeCamera.isConnected) {
            this.frameTimeoutId = setTimeout(() => this.processFrame(), this.frameInterval);
        }
    }

    startFrameProcessing() {
        this.isProcessingFrames = true;
        this.isPredicting = false;
        this.lastFrameTime = 0;
        this.currentFps = 0;
        // Start the processing loop with setTimeout instead of requestAnimationFrame
        this.frameTimeoutId = setTimeout(() => this.processFrame(), this.frameInterval);
    }

    stopFrameProcessing() {
        this.isProcessingFrames = false;
        this.isPredicting = false;
        this.currentFps = 0;
        // Clear any pending timeout to prevent memory leaks
        if (this.frameTimeoutId) {
            clearTimeout(this.frameTimeoutId);
            this.frameTimeoutId = null;
        }
    }

    async updateBlendshapes(predictions) {
        const blendshapesList = document.getElementById('blendshapesList');
        blendshapesList.innerHTML = '';

        // Create bars for each prediction
        predictions.forEach((value, index) => {
            // Get the blendshape name from the model class
            const blendshapeName = BabbleModel.blendshapeNames[index] || `Shape ${index}`;

            // Determine if the value is positive or negative
            const posValue = Math.max(value, 0);

            const bar = document.createElement('div');
            bar.className = 'blendshape-bar';
            bar.innerHTML = `
                <span class="label">${blendshapeName}</span>
                <div class="progress">
                    <div class="progress-bar" style="width: ${posValue * 100}%"></div>
                </div>
                <span class="value">${(posValue * 100).toFixed(1)}%</span>
            `;
            blendshapesList.appendChild(bar);
        });

        // Create blendshapes object
        const blendshapes = {};
        BabbleModel.blendshapeNames.forEach((name, index) => {
            blendshapes[name] = predictions[index];
        });

        this.logMessage(`Sending blendshapes...`);
        await emit('send_blendshapes', { data: blendshapes });
        this.logMessage(`Sent ${BabbleModel.blendshapeNames.length} blendshapes`);
    }

    updateFilter() {
        // Create a new filter with updated parameters
        this.oneEuroFilter = new MultiOneEuroFilter(
            BabbleModel.blendshapeNames.length,
            this.filterParams.minCutoff,
            this.filterParams.beta,
            this.filterParams.dCutoff
        );
    }
}

// Initialize the app when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new BabbleApp();
});
