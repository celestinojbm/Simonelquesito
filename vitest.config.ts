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
    // Orden importante: primero carga el entorno, luego la GUARDIA de BD local
    // (rechaza DATABASE_URL remota antes de que cualquier suite importe el pool).
    setupFiles: ["./src/db/load-env.ts", "./tests/setup-local-db-guard.ts"],
    // Los tests de integración comparten la BD de desarrollo;
    // se ejecutan en serie para evitar interferencias de inventario.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
