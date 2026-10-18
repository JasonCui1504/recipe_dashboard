import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.COOKBOOK_API_PORT ?? 5174);

// The dev server binds to loopback only, so the app is never reachable from other devices.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  preview: { host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true },
});
