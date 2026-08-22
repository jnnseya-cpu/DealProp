import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig paths. Longest prefix first: "@/" would otherwise
      // swallow "@shared/" and "@backend/".
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@backend": fileURLToPath(new URL("./src/backend", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
