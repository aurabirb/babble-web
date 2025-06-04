import { defineConfig } from 'vite';
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation';

export default defineConfig({
    base: '/babble-web/',
    plugins: [crossOriginIsolation()],
    server: {
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    optimizeDeps: {
        exclude: ['onnxruntime-web']
    },
    build: {
        target: 'esnext',
        outDir: 'dist'
    }
}); 