import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "ThreadFlow OS",
    description: "Codex 기반 품질 중심 Threads 글쓰기 사이드 패널",
    version: "0.1.0",
    permissions: ["sidePanel", "storage", "contextMenus"],
    host_permissions: ["https://www.threads.com/*", "https://threads.com/*"],
    optional_host_permissions: ["http://127.0.0.1:8787/*"],
    action: { default_title: "ThreadFlow OS 열기" },
    side_panel: { default_path: "sidepanel.html" },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
});
