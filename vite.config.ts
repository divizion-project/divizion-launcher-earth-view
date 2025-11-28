import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [cesium()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
