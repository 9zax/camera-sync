import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // WEDSYNC_DEV_API lets you point the dev server at another hub/serve
      // instance (e.g. a test build on another port) without editing this file
      "/api": {
        target: process.env.WEDSYNC_DEV_API ?? "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
})
