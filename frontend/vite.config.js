import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The PHP backend runs separately (php -S localhost:8000).
      // Proxying means the browser only ever talks to :5173, so
      // session cookies work with zero CORS configuration needed.
      '/api.php': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/export_csv.php': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/export_xlsx.php': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
