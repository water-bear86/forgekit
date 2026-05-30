import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["node_modules/**", "dist/**", "functions/**"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: [],
  },
});
