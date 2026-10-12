import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
export default defineConfig({
  define: { 'import.meta.env.SITE_URL': JSON.stringify(process.env['SITE_URL'] ?? 'http://localhost:3000') },
  plugins: [fumadocsMdx(), tailwindcss(), reactRouter()],
  resolve: { tsconfigPaths: true },
})
