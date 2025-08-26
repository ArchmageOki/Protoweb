import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    proxy: {
      // Redirige llamadas API al backend Express (puerto 4002 por defecto)
      '/data': {
        target: 'http://localhost:4002',
        changeOrigin: true,
        secure: false,
      },
      '/auth': {
        target: 'http://localhost:4002',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [tailwindcss()],
})
