import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { reactRouterHonoServer } from 'react-router-hono-server/dev'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouterHonoServer({ runtime: 'bun', serverEntryPoint: './server/index.ts' }),
    reactRouter(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // Bun ネイティブモジュール群は SSR build で bundle せず実行時に解決する
  ssr: {
    external: [
      '@node-rs/argon2',
      '@huggingface/transformers',
      'sqlite-vec',
      'simple-git',
      'gray-matter',
    ],
    noExternal: [/^@minakata\//],
  },
})
