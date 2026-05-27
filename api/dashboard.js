import { getDashboardData } from '../hubspot/dashboard.js'

export default async function handler(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const data = await getDashboardData(url.searchParams)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ message }))
  }
}
