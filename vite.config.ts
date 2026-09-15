import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Viteの設定: https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
});
