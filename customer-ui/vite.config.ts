import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
  build: {
    // "static", NOT the default "assets". The app has a route at /assets, and a
    // bundle directory of the same name under the web root makes nginx try to
    // serve a DIRECTORY where the route should render - a 403 on a full page
    // load, while client-side navigation still worked.
    assetsDir: "static",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
