import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // Third arg '' loads every key from .env, not just the VITE_ prefixed ones,
  // so BACKEND_URL below is readable here. Only VITE_* keys are ever exposed
  // to client code via import.meta.env.
  const env = loadEnv(mode, process.cwd(), '');

  // Where the FastAPI backend in ../Backend is listening.
  const backendUrl = env.BACKEND_URL || 'http://127.0.0.1:8000';

  // HMR is disabled in AI Studio via the DISABLE_HMR env var.
  const disableHmr = env.DISABLE_HMR === 'true';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      // Forward every /api call to the Python backend, so the browser only
      // ever talks to one origin and CORS stays out of the way in dev.
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
      hmr: !disableHmr,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: disableHmr ? null : {},
    },
  };
});
