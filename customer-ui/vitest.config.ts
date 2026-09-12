import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Only the unit/component suite under src/. The Playwright spec in e2e/
    // is a browser test and must not be picked up (and failed) by Vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
