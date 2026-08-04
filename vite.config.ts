import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the project at /<repo>/ — override with BASE_PATH when
// hosting at a domain root.
const base = process.env.BASE_PATH ?? '/deep-cosmos-studio/'

export default defineConfig({
  base,
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
