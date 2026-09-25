import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the Node API server runs on 127.0.0.1:3000 (PORT env var) and Vite
// proxies /api/* to it. In production the server itself serves dist/.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
