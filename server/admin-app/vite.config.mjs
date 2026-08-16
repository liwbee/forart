import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/_admin/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../admin", import.meta.url)),
    emptyOutDir: true,
  },
});
