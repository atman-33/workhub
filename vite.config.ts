import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        // Ink screen-annotation overlay window (see src-tauri/src/ink/).
        overlay: path.resolve(__dirname, "overlay.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
