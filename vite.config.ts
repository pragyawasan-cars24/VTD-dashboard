import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { getDashboardData } from './hubspot/dashboard.js'
import { getTDComparisonData } from './hubspot/td-comparison.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (!process.env.HUBSPOT_TOKEN && env.HUBSPOT_TOKEN) {
    process.env.HUBSPOT_TOKEN = env.HUBSPOT_TOKEN
  }
  if (!process.env.HUBSPOT_DASHBOARD_CONFIG && env.HUBSPOT_DASHBOARD_CONFIG) {
    process.env.HUBSPOT_DASHBOARD_CONFIG = env.HUBSPOT_DASHBOARD_CONFIG
  }

  return {
    plugins: [
      react(),
      {
        name: 'local-dashboard-api',
        configureServer(server) {
          const sendJson = (res: import('node:http').ServerResponse, statusCode: number, body: unknown) => {
            res.statusCode = statusCode
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          }

          server.middlewares.use('/api/dashboard', async (req, res) => {
            try {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const data = await getDashboardData(url.searchParams)

              sendJson(res, 200, data)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error'
              sendJson(res, 500, { message })
            }
          })

          server.middlewares.use('/api/td-comparison', async (req, res) => {
            try {
              const url = new URL(req.url ?? '/', 'http://localhost')
              const data = await getTDComparisonData(url.searchParams)

              sendJson(res, 200, data)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error'
              sendJson(res, 500, { message })
            }
          })
        },
      },
    ],
  }
})
