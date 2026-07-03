import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "vendor-react";
          if (id.includes("@tanstack/react-query") || id.includes("@tanstack/query-core")) return "vendor-query";
          if (id.includes("i18next") || id.includes("react-i18next")) return "vendor-i18n";
          if (id.includes("zustand") || id.includes("zundo")) return "vendor-store";
          if (id.includes("lucide-react")) return "vendor-icons";
        },
      },
    },
  },
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
