import * as ort from 'onnxruntime-web';

const IMAGE_SIZE = 224;

export class BabbleModel {
    static blendshapeNames = [
        'cheekPuffLeft', 'cheekPuffRight',
        'cheekSuckLeft', 'cheekSuckRight',
        'jawOpen', 'jawForward', 'jawLeft', 'jawRight',
        'noseSneerLeft', 'noseSneerRight',
        'mouthFunnel', 'mouthPucker',
        'mouthLeft', 'mouthRight',
        'mouthRollUpper', 'mouthRollLower',
        'mouthShrugUpper', 'mouthShrugLower',
        'mouthClose',
        'mouthSmileLeft', 'mouthSmileRight',
        'mouthFrownLeft', 'mouthFrownRight',
        'mouthDimpleLeft', 'mouthDimpleRight',
        'mouthUpperUpLeft', 'mouthUpperUpRight',
        'mouthLowerDownLeft', 'mouthLowerDownRight',
        'mouthPressLeft', 'mouthPressRight',
        'mouthStretchLeft', 'mouthStretchRight',
        'tongueOut', 'tongueUp', 'tongueDown',
        'tongueLeft', 'tongueRight',
        'tongueRoll', 'tongueBendDown',
        'tongueCurlUp', 'tongueSquish',
        'tongueFlat', 'tongueTwistLeft', 'tongueTwistRight'
    ];

    constructor() {
        this.IMAGE_SIZE = IMAGE_SIZE;
        this.session = null;
        this.inputName = null;
        this.outputName = null;
        this.canvas = document.createElement('canvas');
        this.canvas.width = IMAGE_SIZE;
        this.canvas.height = IMAGE_SIZE;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }

    async initialize(modelUrl) {
        try {
            console.log('Loading model...');
            this.session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['webgpu', 'webgl', 'wasm', 'cpu']
            });
            this.inputName = this.session.inputNames[0];
            this.outputName = this.session.outputNames[0];
            console.log('Model loaded successfully');
        } catch (error) {
            console.error('Failed to initialize model:', error);
            throw error;
        }
    }

    /**
     * Preprocesses an image by converting it to grayscale and normalizing values.
     * @param {CanvasImageSource} srcCanvas - The canvas or image element to preprocess
     * @returns {Promise<Float32Array>} Preprocessed image data as a Float32Array normalized to [0,1]
     * @throws {Error} If there is an error preprocessing the image
     */
    async preprocessImage(srcCanvas) {
        try {
            // Clear canvas and draw the image
            this.ctx.clearRect(0, 0, this.IMAGE_SIZE, this.IMAGE_SIZE);
            this.ctx.drawImage(srcCanvas, 0, 0, this.IMAGE_SIZE, this.IMAGE_SIZE);

            // Get grayscale pixel data
            const imageDataObj = this.ctx.getImageData(0, 0, this.IMAGE_SIZE, this.IMAGE_SIZE);
            const data = imageDataObj.data;

            // Convert to grayscale and normalize to [0, 1]
            const float32Data = new Float32Array(this.IMAGE_SIZE * this.IMAGE_SIZE);
            for (let i = 0; i < data.length; i += 4) {
                // Convert RGB to grayscale using standard weights
                const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                float32Data[i / 4] = gray / 255; // Normalize to [0, 1]
            }

            return float32Data;
        } catch (error) {
            console.error('Error preprocessing image:', error);
            throw error;
        }
    }
    /**
     * Preprocesses an image for model input by converting it to grayscale and normalizing values.
     * @param {HTMLCanvasElement} canvas - The canvas element containing the image to preprocess
     * @returns {Promise<Float32Array>} Preprocessed image data as a Float32Array normalized to [0,1]
     * @throws {Error} If there is an error preprocessing the image
     */
    async predict(canvas) {
        if (!this.session) {
            throw new Error('Model not initialized. Call initialize() first.');
        }
        try {
            // Preprocess the image
            const preprocessedData = await this.preprocessImage(canvas);

            // Create input tensor [1, 1, 224, 224] for batch_size=1, channels=1
            const tensor = new ort.Tensor('float32', preprocessedData, [1, 1, this.IMAGE_SIZE, this.IMAGE_SIZE]);

            // Run inference
            const feeds = { [this.inputName]: tensor };
            const results = await this.session.run(feeds);

            // Get results
            const outputData = results[this.outputName].data;

            return outputData;
        } catch (error) {
            console.error('Error running prediction:', error);
            throw error;
        }
    }
} 