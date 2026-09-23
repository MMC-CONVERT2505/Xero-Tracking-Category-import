import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:7005', changeOrigin: true },
      // Full-page redirect flow (window.location.href = '/auth/xero'), not
      // an XHR - proxying it too means the browser never has to know the
      // backend runs on a different port during local dev.
      '/auth': { target: 'http://localhost:7005', changeOrigin: true },
    },
  },
});
