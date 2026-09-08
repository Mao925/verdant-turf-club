import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The shared WebGL engine is ~505 kB before gzip (~127 kB transferred).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
