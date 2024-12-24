import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg','@ffmpeg/util']
  }
});