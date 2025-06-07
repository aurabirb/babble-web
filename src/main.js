import { WebSerialCamera } from './serial-camera';
import { TauriSerialCamera } from './tauri-serial-camera';
import { WebcamCamera } from './webcam-camera';
import { OSCClient } from './osc-client.js';
import { BabbleModel } from './babble-model';
import './style.css';
import { MultiOneEuroFilter } from './one-euro-filter.js';

// for events: https://v2.tauri.app/develop/calling-rust/
import { listen, emit } from '@tauri-apps/api/event';
// for commands
// import { invoke } from '@tauri-apps/api/core';

const modelUrl = window.__TAURI__ ? '/model.onnx' : '/babble-web/model.onnx';
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
        this.targetFps = 90;
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

        // Filter state
        this.isFilterEnabled = true;

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
        this.refreshSerialPorts();
        this.reconnectOSC();
        this.updateFilter();
        console.log('Babble Web App initialized');
    }

    async reconnectOSC() {
        if (this.isTauriEnvironment) {
            return;
        }
        const udpPortInput = document.getElementById('udpPort');
        const udpPort = parseInt(udpPortInput.value) || 8883;
        const udpStatus = document.querySelector('#udpStatus');

        if (this.oscClient) this.oscClient.disconnect();

        // Create OSC client
        this.oscClient = new OSCClient(udpPort);
        try {
            await this.oscClient.connect();
            udpStatus.textContent = 'WS';
        } catch (err) {
            console.error('Failed to connect OSC client:', err);
            this.logMessage('Failed to connect OSC client: ' + err.message);
            udpStatus.textContent = 'WS ERR';
        }
    }

    async refreshSerialPorts() {
        const cameraSource = document.getElementById('cameraSource');
        const serialPortSelection = document.getElementById('serialPortSelection');
        const serialPortSelect = document.getElementById('serialPortSelect');

        if (cameraSource.value === 'serial' && this.serialCamera?.getAvailablePorts) {
            serialPortSelection.style.display = 'block';
        } else {
            serialPortSelection.style.display = 'none';
            serialPortSelect.value = '';
            return;
        }

        try {
            const ports = await this.serialCamera.getAvailablePorts();
            const portNames = Object.keys(ports);

            // Clear existing options except the first one
            serialPortSelect.innerHTML = '<option value="">Select a port...</option>';

            // Add available ports
            portNames.forEach(portName => {
                const option = document.createElement('option');
                option.value = portName;
                option.textContent = `${portName} - ${ports[portName]?.product_name || 'Unknown Device'}`;
                serialPortSelect.appendChild(option);
            });
        } catch (err) {
            this.logMessage('Failed to refresh serial ports: ' + err.message);
        }
    }

    logMessage(message) {
        console.log(message);
        const logElement = document.querySelector('#log');
        if (!logElement) return; // the app has not been initialized yet
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
        const connType = this.oscClient ? 'WS' : 'UDP';
        app.innerHTML = `
            <div class="container">
                <div class="header">
                    <a href="http://aurabirb.github.io/babble-web/" target="_blank" rel="noopener noreferrer"><h1>Blubber Web</h1></a>
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
                    <div class="udp-controls">
                        <label for="udpPort">OSC Port:</label>
                        <input type="number" id="udpPort" min="1" max="65535" value="8883" placeholder="8883">
                        <span id="udpStatus" class="udpStatus">${connType}</span>
                        <div id="serialPortSelection" style="display: none;">
                            <select id="serialPortSelect">
                                <option value="">Select a port...</option>
                            </select>
                            <button id="refreshPortsBtn" class="udpStatus">Refresh Ports</button>
                        </div>
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
                        <button id="filterToggleBtn" class="filter-toggle">Filter: On</button>
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
        const serialPortSelection = document.getElementById('serialPortSelection');
        const serialPortSelect = document.getElementById('serialPortSelect');
        const refreshPortsBtn = document.getElementById('refreshPortsBtn');
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
        const filterToggleBtn = document.getElementById('filterToggleBtn');

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

        // Filter toggle button event listener
        filterToggleBtn.addEventListener('click', () => {
            this.isFilterEnabled = !this.isFilterEnabled;
            filterToggleBtn.textContent = `Filter: ${this.isFilterEnabled ? 'On' : 'Off'}`;
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

            // Show/hide serial port selection based on camera source and environment
            this.refreshSerialPorts();
        });

        // Handle refresh ports button
        refreshPortsBtn.addEventListener('click', async () => {
            await this.refreshSerialPorts();
        });

        connectBtn.addEventListener('click', async () => {
            this.reconnectOSC();
            const selectedSource = cameraSource.value;
            // Check if serial communication is supported for serial camera
            if (selectedSource === 'serial' && !this.serialCamera) {
                this.logMessage('Serial communication is not supported in this browser. Please use a browser that supports WebSerial API (Chrome, Edge) or use the Blubber dektop app.');
            }

            const camera = selectedSource === 'webcam' ? this.webcamCamera : this.serialCamera;

            if (!camera || !camera.isConnected) {
                console.log(`Connecting to ${selectedSource} camera...`);
                if (camera && await camera.requestPort(serialPortSelect?.value)) {
                    await camera.connect();
                    this.activeCamera = camera;
                    connectBtn.textContent = 'Disconnect';

                    // Block port selector and camera source when connected
                    this.updatePortSelectorState(false);

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

                // Unblock port selector and camera source when disconnected
                this.updatePortSelectorState(true);
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
                const unfilteredPredictions = await this.model.predict(previewCropped);

                // Apply One Euro Filter to the predictions
                const filteredPredictions = this.oneEuroFilter.filter(unfilteredPredictions, timestamp / 1000.0);

                // Update blendshapes with both predictions for display
                this.updateBlendshapes(unfilteredPredictions, filteredPredictions, this.isFilterEnabled);
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

    async updateBlendshapes(unfilteredPredictions, filteredPredictions, isFilterEnabled) {
        const outputPredictions = isFilterEnabled ? filteredPredictions : unfilteredPredictions;

        const blendshapesList = document.getElementById('blendshapesList');
        blendshapesList.innerHTML = '';

        // Create bars for each prediction
        unfilteredPredictions.forEach((_, index) => {
            // Get the blendshape name from the model class
            const blendshapeName = BabbleModel.blendshapeNames[index] || `Shape ${index}`;

            // Get corresponding filtered value
            const unfilteredValue = unfilteredPredictions[index];
            const filteredValue = filteredPredictions[index];
            const outputValue = outputPredictions[index];

            // Determine if the values are positive or negative
            const unfilteredPosValue = Math.max(unfilteredValue, 0);
            const filteredPosValue = Math.max(filteredValue, 0);
            const outputPosValue = Math.max(outputValue, 0);

            const bar = document.createElement('div');
            bar.className = 'blendshape-bar';
            bar.innerHTML = `
                <span class="label">${blendshapeName}</span>
                <div class="progress">
                    <div class="progress-bar unfiltered" style="width: ${unfilteredPosValue * 100}%;"></div>
                    <div class="progress-bar filtered" style="width: ${outputPosValue * 100}%;"></div>
                </div>
                <span class="value">${(outputPosValue * 100).toFixed(1)}%</span>
            `;
            blendshapesList.appendChild(bar);
        });

        // Get the selected UDP port
        const udpPortInput = document.getElementById('udpPort');
        const udpPort = parseInt(udpPortInput.value) || 8883;

        // Create blendshapes object using output predictions
        const blendshapes = {};
        BabbleModel.blendshapeNames.forEach((name, index) => {
            blendshapes[name] = outputPredictions[index];
        });

        const udpStatus = document.querySelector('#udpStatus');
        if (this.isTauriEnvironment) {
            console.log(`Sending OSC blendshapes to UDP port ${udpPort}...`);
            await emit('send_blendshapes', { data: blendshapes, port: udpPort });
            this.logMessage(`Sent ${BabbleModel.blendshapeNames.length} blendshapes to port ${udpPort}`);
            udpStatus.textContent = 'UDP';
        } else if (this.oscClient) {
            if (this.oscClient.port !== udpPort) {
                console.warn(`OSC client port mismatch: was ${this.oscClient.port}, using ${udpPort}`);
                this.reconnectOSC();
            }
            // send blendshapes via OSC websocket
            console.log(`Sending OSC blendshapes to Websocket on port ${this.oscClient.port}...`);
            this.oscClient.sendBlendshapes(blendshapes);
            udpStatus.textContent = (this.oscClient.osc.status() == this.oscClient.STATUS.IS_OPEN) ? 'WS' : 'WS ERR';
        } else {
            this.logMessage('No OSC client available to send blendshapes');
        }
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

    updatePortSelectorState(enabled) {
        // Get the relevant elements
        const cameraSource = document.getElementById('cameraSource');
        const serialPortSelect = document.getElementById('serialPortSelect');

        // Enable/disable camera source selector
        cameraSource.disabled = !enabled;

        // Enable/disable serial port selector elements
        if (serialPortSelect) {
            serialPortSelect.disabled = !enabled;
        }
    }
}
// Initialize the app when the page loads
function initializeApp() {
    console.log('Starting BabbleApp...');
    new BabbleApp();
}

// Check if DOM is already loaded, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already loaded, initialize immediately
    initializeApp();
}
