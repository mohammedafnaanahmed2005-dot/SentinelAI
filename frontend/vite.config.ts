import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// Proxy /api requests to the FastAPI backend.
// Uses port 8000 (default). If run.py falls back to 8001 due to port conflict,
// update the target here or restart after the old process is fully killed.
const BACKEND = 'http://127.0.0.1:8000'

const apiProxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: true,
    // Increase timeout — face-match login requests take up to 3s on slower CPUs
    proxyTimeout: 15000,
    timeout: 15000,
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  server: {
    proxy: apiProxy
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    proxy: apiProxy
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index:     'index.html',
        signin:    'signin.html',
        dashboard: 'dashboard.html',
        admin:     'admin.html',
      }
    }
  }
})
