import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const webRoot = fileURLToPath(new URL("./web", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webRoot, "");
  return {
    root: webRoot,
    envDir: webRoot,
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // マップは生成するが公開しない(S3 にはデプロイしない)
      sourcemap: "hidden",
    },
    server: {
      // 開発時はデプロイ済みの CloudFront に /api を転送する(web/.env.local の DEV_API_ORIGIN)
      proxy: env.DEV_API_ORIGIN
        ? { "/api": { target: env.DEV_API_ORIGIN, changeOrigin: true, secure: true } }
        : undefined,
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icons/apple-touch-icon.png", "icons/icon.svg"],
        manifest: {
          name: "marginalia",
          short_name: "marginalia",
          description: "読んだあとに、問いを1つ。",
          lang: "ja",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#f7f4ee",
          theme_color: "#f7f4ee",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          navigateFallback: "/index.html",
          // API と設定ファイルは Service Worker でキャッシュしない
          navigateFallbackDenylist: [/^\/api\//],
          globIgnores: ["config.json"],
          runtimeCaching: [],
        },
      }),
    ],
  };
});
