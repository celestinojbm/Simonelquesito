import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./src/db/load-env.ts"],
    // Los tests de integración comparten la BD de desarrollo;
    // se ejecutan en serie para evitar interferencias de inventario.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
