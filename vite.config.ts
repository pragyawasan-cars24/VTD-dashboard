import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getDashboardData } from './hubspot/dashboard.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.HUBSPOT_TOKEN ??= env.HUBSPOT_TOKEN
  process.env.HUBSPOT_DASHBOARD_CONFIG ??= env.HUBSPOT_DASHBOARD_CONFIG

  return {
    plugins: [
      react(),
      {
        name: 'local-dashboard-api',
        configureServer(server) {
          server.middlewares.use('/api/dashboard', async (req, res) => {
            try {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const data = await getDashboardData(url.searchParams)

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error'
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ message }))
            }
          })
        },
      },
    ],
  }
})
