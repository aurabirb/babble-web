/**
 * Low-pass filter implementation
 */
class LowPassFilter {
    constructor(alpha) {
        this.alpha = alpha;
        this.initialized = false;
        this.hatxprev = 0;
    }

    filter(x) {
        if (!this.initialized) {
            this.hatxprev = x;
            this.initialized = true;
            return x;
        }
        const hatx = this.alpha * x + (1 - this.alpha) * this.hatxprev;
        this.hatxprev = hatx;
        return hatx;
    }
}

/**
 * One Euro Filter implementation
 * Based on the paper "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 */
export class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.xFilter = null;
        this.dxFilter = null;
        this.lastTime = null;
    }

    alpha(cutoff, t) {
        const r = 2 * Math.PI * cutoff * t;
        return r / (r + 1);
    }

    filter(x, timestamp = null) {
        if (timestamp === null) {
            timestamp = Date.now() / 1000.0;
        }

        if (this.xFilter === null) {
            this.xFilter = new LowPassFilter(this.alpha(this.minCutoff, 1.0));
            this.dxFilter = new LowPassFilter(this.alpha(this.dCutoff, 1.0));
            this.lastTime = timestamp;
            return x;
        }

        // Update the sampling frequency based on timestamps
        const dt = timestamp - this.lastTime;
        this.lastTime = timestamp;
        
        // Sanity check
        if (dt <= 0) return x;

        // The filtered derivative of the signal
        const dx = (x - this.xFilter.hatxprev) / dt;
        const edx = this.dxFilter.filter(dx);

        // Use it to update the cutoff frequency
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);

        // Filter the signal
        this.xFilter.alpha = this.alpha(cutoff, dt);
        return this.xFilter.filter(x);
    }
}

/**
 * Creates a One Euro Filter array for multiple values (e.g., blendshapes)
 */
export class MultiOneEuroFilter {
    constructor(size, minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
        this.filters = new Array(size).fill(null).map(() => 
            new OneEuroFilter(minCutoff, beta, dCutoff)
        );
    }

    filter(values, timestamp = null) {
        return values.map((value, index) => 
            this.filters[index].filter(value, timestamp)
        );
    }
} 