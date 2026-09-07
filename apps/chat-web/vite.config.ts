import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const BACKEND = process.env.HERMES_DASHBOARD_URL ?? 'http://127.0.0.1:9119'

function proxyDashboardAuth(): Plugin {
  return {
    apply: 'serve',
    async transformIndexHtml() {
      try {
        const response = await fetch(BACKEND, { headers: { accept: 'text/html' } })
        const html = await response.text()
        const token = html.match(/window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/)?.[1]
        const authRequired = html.match(/window\.__HERMES_AUTH_REQUIRED__\s*=\s*(true|false)/)?.[1] ?? 'false'

        return [
          {
            children:
              `${token ? `window.__HERMES_SESSION_TOKEN__=${JSON.stringify(token)};` : ''}` +
              `window.__HERMES_AUTH_REQUIRED__=${authRequired};` +
              'window.__HERMES_BASE_PATH__="";',
            injectTo: 'head',
            tag: 'script'
          }
        ]
      } catch (error) {
        console.warn(`[hermes-chat-web] Dashboard unavailable: ${(error as Error).message}`)
      }
    },
    name: 'hermes:chat-web-dev-auth'
  }
}

export default defineConfig({
  base: '/chat-ui/',
  build: {
    emptyOutDir: true,
    outDir: '../../hermes_cli/chat_web_dist'
  },
  plugins: [react(), proxyDashboardAuth()],
  resolve: {
    alias: {
      '@hermes/shared': new URL('../shared/src', import.meta.url).pathname
    }
  },
  server: {
    proxy: {
      '/api': {
        target: BACKEND,
        ws: true
      }
    }
  }
})
