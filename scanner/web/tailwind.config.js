/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0B0F1A",
        panel: "#111726",
        raised: "#1A2236",
        edge: "#3D4A66",
        primary: "#E6ECF5",
        muted: "#8A95AD",
        accent: "#F5A524",
        pass: "#3DD68C",
        critical: "#E5484D",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "sans-serif"],
        ui: ["Inter", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
