import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow the app to be served through an ngrok tunnel (for testing inside
    // the real Telegram client). Vite otherwise rejects any Host header that
    // isn't localhost with "Blocked request. This host is not allowed."
    // Dev-server only — has no effect on the production `vite build` output.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io', '.ngrok.app'],
    proxy: {
      // Mirrors nginx's production reverse-proxy (see
      // docs/deploy/nginx.split.conf.sample) so `npm run dev` talks to the
      // local server workspace without CORS or a hardcoded VITE_API_BASE.
      // No path rewrite — matches the server's routes, which already live
      // at `/api/*` (see server/src/index.ts).
      '/api': {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
