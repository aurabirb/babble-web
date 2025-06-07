import { load } from '@tauri-apps/plugin-store';

/**
 * Configuration store for BabbleApp
 * Handles saving and loading user settings using Tauri Store plugin
 */
export class ConfigStore {
    constructor() {
        this.store = null;
        this.storePath = 'babble-config.json';
        this.defaultConfig = {
            // Camera settings
            cameraSource: 'serial',
            selectedSerialPort: '',
            isVerticallyFlipped: false,
            isHorizontallyFlipped: false,
            
            // OSC settings
            udpPort: 8888,
            
            // Filter parameters
            filterParams: {
                minCutoff: 3.0,
                beta: 0.9,
                dCutoff: 1.0
            },
            isFilterEnabled: true,
            
            // Calibration settings
            calibrationToggleEnabled: true,
            blendshapeRanges: {},
            isCalibrated: false,
            
            // Crop rectangle
            cropRect: {
                x: 0,
                y: 0,
                width: 224,
                height: 224
            },
            
            // Performance settings
            targetFps: 90
        };
    }

    /**
     * Initialize the store
     */
    async initialize() {
        try {
            this.store = await load(this.storePath, { autoSave: false });
            console.log('Configuration store initialized');
        } catch (error) {
            console.error('Failed to initialize configuration store:', error);
            throw error;
        }
    }

    /**
     * Load configuration from store
     * @returns {Object} Configuration object
     */
    async loadConfig() {
        if (!this.store) {
            await this.initialize();
        }

        try {
            const config = await this.store.get('config');
            if (config) {
                console.log('Configuration loaded from store');
                // Merge with defaults to ensure new properties are included
                return { ...this.defaultConfig, ...config };
            } else {
                console.log('No existing configuration found, using defaults');
                return { ...this.defaultConfig };
            }
        } catch (error) {
            console.error('Failed to load configuration:', error);
            return { ...this.defaultConfig };
        }
    }

    /**
     * Save configuration to store
     * @param {Object} config - Configuration object to save
     */
    async saveConfig(config) {
        if (!this.store) {
            await this.initialize();
        }

        try {
            await this.store.set('config', config);
            await this.store.save();
            console.log('Configuration saved to store');
        } catch (error) {
            console.error('Failed to save configuration:', error);
        }
    }

    /**
     * Get a specific configuration value
     * @param {string} key - Configuration key
     * @returns {any} Configuration value
     */
    async getConfigValue(key) {
        const config = await this.loadConfig();
        return this.getNestedValue(config, key);
    }

    /**
     * Set a specific configuration value
     * @param {string} key - Configuration key
     * @param {any} value - Value to set
     */
    async setConfigValue(key, value) {
        const config = await this.loadConfig();
        this.setNestedValue(config, key, value);
        await this.saveConfig(config);
    }

    /**
     * Helper method to get nested object values using dot notation
     * @param {Object} obj - Object to search
     * @param {string} path - Dot-separated path (e.g., 'filterParams.minCutoff')
     * @returns {any} Value at path
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    /**
     * Helper method to set nested object values using dot notation
     * @param {Object} obj - Object to modify
     * @param {string} path - Dot-separated path (e.g., 'filterParams.minCutoff')
     * @param {any} value - Value to set
     */
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            return current[key];
        }, obj);
        target[lastKey] = value;
    }

    /**
     * Reset configuration to defaults
     */
    async resetConfig() {
        await this.saveConfig({ ...this.defaultConfig });
        console.log('Configuration reset to defaults');
    }
}
