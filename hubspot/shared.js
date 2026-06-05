export const HUBSPOT_BASE_URL = 'https://api.hubapi.com'
export const EXCLUDED_EMAIL_PATTERNS = ['cars24', 'yopmail']
export const EXCLUDED_EMAILS = new Set(['ss@mm.com'])
export const EXCLUDED_ORDER_IDS = new Set(['WL46WF'])
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])
const MAX_RETRIES = 4

export function normalizeValue(value) {
  return (value ?? '').trim()
}

export function normalizeKey(value) {
  return normalizeValue(value).toUpperCase()
}

export function isExcludedEmail(email) {
  const lower = email.toLowerCase()
  return EXCLUDED_EMAILS.has(lower) || EXCLUDED_EMAIL_PATTERNS.some((p) => lower.includes(p))
}

export function isExcludedOrderId(orderId) {
  return EXCLUDED_ORDER_IDS.has(normalizeValue(orderId))
}

export async function hubspotFetch(path, init) {
  const token = normalizeValue(process.env.HUBSPOT_TOKEN)
  if (!token || token === 'undefined' || token === 'replace_me') {
    throw new Error('Missing HUBSPOT_TOKEN environment variable.')
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    if (response.ok) return response.json()

    const text = await response.text()
    const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES

    if (shouldRetry) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '0')
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : 750 * 2 ** attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    if (response.status >= 500) {
      throw new Error(`HubSpot is temporarily unavailable (${response.status}). Please try again in a minute.`)
    }

    throw new Error(`HubSpot API error (${response.status}): ${text}`)
  }

  throw new Error('HubSpot is temporarily unavailable. Please try again in a minute.')
}

export async function readDealToContactAssociations(dealIds) {
  const map = new Map()

  for (let index = 0; index < dealIds.length; index += 100) {
    const inputs = dealIds.slice(index, index + 100).map((id) => ({ id }))
    const data = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    })

    for (const item of data.results) {
      map.set(item.from.id, item.to.map((entry) => String(entry.toObjectId)))
    }
  }

  return map
}

export async function readContacts(contactIds) {
  const map = new Map()
  const properties = ['email', 'check_in_walk_in_date', 'vehicle_state', 'state']

  for (let index = 0; index < contactIds.length; index += 100) {
    const inputs = contactIds.slice(index, index + 100).map((id) => ({ id, properties }))
    const data = await hubspotFetch('/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      body: JSON.stringify({ inputs, properties }),
    })

    for (const row of data.results) {
      map.set(row.id, {
        id: row.id,
        email: normalizeValue(row.properties.email),
        walkInDate: normalizeValue(row.properties.check_in_walk_in_date),
        vehicleState: normalizeValue(row.properties.vehicle_state),
        fallbackUserState: normalizeValue(row.properties.state),
      })
    }
  }

  return map
}
