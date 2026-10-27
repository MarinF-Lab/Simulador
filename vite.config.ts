/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/** Pone una versión nueva en el caché del service worker en cada compilación. */
const swVersion = () => ({
  name: "kinetic-sw-version",
  closeBundle() {
    const f = "dist/sw.js";
    if (existsSync(f)) writeFileSync(f, readFileSync(f, "utf8").replace("__BUILD__", String(Date.now())));
  },
});

// Un solo HTML con JS y CSS en línea: así se publica como artefacto.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile(), swVersion()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
