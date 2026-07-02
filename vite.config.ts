import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 6981,
    watch: {
      ignored: [
        "**/.forart-data/**",
        "**/CanvasAssests/**",
        "**/dist/**",
        "**/node_modules/**",
        "**/server/node_modules/**",
      ],
    },
    proxy: {
      "/api": "http://127.0.0.1:6980",
    },
  },
});
