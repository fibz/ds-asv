import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev proxy target: the scanner FastAPI. Override with VITE_API_PROXY_TARGET
// (e.g. when :8000 is occupied); defaults to localhost:8000.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

// https://vite.dev/config/
export default defineConfig({
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
