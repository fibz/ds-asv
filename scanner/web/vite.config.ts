import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev proxy target: the scanner FastAPI. Override with VITE_API_PROXY_TARGET
// (e.g. when :8000 is occupied); defaults to localhost:8000.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

// https://vite.dev/config/
export default defineConfig({
  // Served under /scanner/ on the production edge (same origin as the portal,
  // which owns /, and the customer UI at /app/). The router takes its basename
  // from this, so internal links resolve under the same prefix.
  base: "/scanner/",
  plugins: [react()],
  server: {
    proxy: {
      "/v1": apiTarget,
      "/portal": apiTarget,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    css: false,
  },
});
