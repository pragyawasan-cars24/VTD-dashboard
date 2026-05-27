const DEFAULT_CONFIG = {
  deal: {
    orderId: 'order_id',
    vehicleState: 'car_location_at_time_of_sale',
    vtdStatus: 'virtual_test_drive_status',
    bookedBy: 'virtual_test_drive_booked_by',
    testDriveStatus: 'test_drive_status',
    bookingConfirmDate: 'booking_confirm_date',
    cancelReturnDate: 'cancelled___return_date',
    userState: 'delivery_state',
    interstate: 'interstate_sale_yesno',
    filterDate: 'td_booking_slot_date',
  },
  contact: {
    email: 'email',
    walkInDate: 'check_in_walk_in_date',
    vehicleState: 'vehicle_state',
    fallbackUserState: 'state',
  },
  values: {
    vtdStatuses: ['BOOKED', 'COMPLETED'],
    completedTdStatuses: ['TEST DRIVE DONE', 'COMPLETED'],
    customerBookedByValues: ['CUSTOMER'],
    interstateYes: ['YES'],
    interstateNo: ['NO'],
  },
}

const HUBSPOT_BASE_URL = 'https://api.hubapi.com'
const EXCLUDED_EMAIL_PATTERNS = ['cars24', 'yopmail']
const EXCLUDED_EMAILS = new Set(['ss@mm.com'])
const EXCLUDED_ORDER_IDS = new Set(['WL46WF'])
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])
const MAX_RETRIES = 4

function normalizeValue(value) {
  return (value ?? '').trim()
}

function normalizeKey(value) {
  return normalizeValue(value).toUpperCase()
}

function mergeConfig() {
  const raw = process.env.HUBSPOT_DASHBOARD_CONFIG

  if (!raw) {
    return DEFAULT_CONFIG
  }

  try {
    const parsed = JSON.parse(raw)

    return {
      deal: { ...DEFAULT_CONFIG.deal, ...(parsed.deal ?? {}) },
      contact: { ...DEFAULT_CONFIG.contact, ...(parsed.contact ?? {}) },
      values: {
        ...DEFAULT_CONFIG.values,
        ...(parsed.values ?? {}),
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

async function hubspotFetch(path, init) {
  const token = process.env.HUBSPOT_TOKEN

  if (!token) {
    throw new Error('Missing HUBSPOT_TOKEN environment variable.')
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })

    if (response.ok) {
      return response.json()
    }

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

async function searchDeals(config) {
  const properties = Object.values(config.deal)
  const deals = []
  let after

  do {
    const payload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: config.deal.vtdStatus,
              operator: 'IN',
              values: config.values.vtdStatuses,
            },
          ],
        },
      ],
      properties,
      limit: 100,
      after,
    }

    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    for (const row of data.results) {
      deals.push({
        id: row.id,
        orderId: normalizeValue(row.properties[config.deal.orderId]),
        vehicleState: normalizeValue(row.properties[config.deal.vehicleState]),
        vtdStatus: normalizeValue(row.properties[config.deal.vtdStatus]),
        bookedBy: normalizeValue(row.properties[config.deal.bookedBy]),
        testDriveStatus: normalizeValue(row.properties[config.deal.testDriveStatus]),
        bookingConfirmDate: normalizeValue(row.properties[config.deal.bookingConfirmDate]),
        cancelReturnDate: normalizeValue(row.properties[config.deal.cancelReturnDate]),
        userState: normalizeValue(row.properties[config.deal.userState]),
        interstate: normalizeValue(row.properties[config.deal.interstate]),
        filterDate: normalizeValue(row.properties[config.deal.filterDate]),
      })
    }

    after = data.paging?.next?.after
  } while (after)

  return deals
}

async function readDealToContactAssociations(dealIds) {
  const map = new Map()

  for (let index = 0; index < dealIds.length; index += 100) {
    const inputs = dealIds.slice(index, index + 100).map((id) => ({ id }))
    const data = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    })

    for (const item of data.results) {
      map.set(
        item.from.id,
        item.to.map((entry) => String(entry.toObjectId)),
      )
    }
  }

  return map
}

async function readContacts(contactIds, config) {
  const map = new Map()
  const properties = Object.values(config.contact)

  for (let index = 0; index < contactIds.length; index += 100) {
    const inputs = contactIds.slice(index, index + 100).map((id) => ({
      id,
      properties,
    }))

    const data = await hubspotFetch('/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      body: JSON.stringify({ inputs, properties }),
    })

    for (const row of data.results) {
      map.set(row.id, {
        id: row.id,
        email: normalizeValue(row.properties[config.contact.email]),
        walkInDate: normalizeValue(row.properties[config.contact.walkInDate]),
        vehicleState: normalizeValue(row.properties[config.contact.vehicleState]),
        fallbackUserState: normalizeValue(row.properties[config.contact.fallbackUserState]),
      })
    }
  }

  return map
}

function parseFilters(params) {
  return {
    bookedBy: params.get('bookedBy') || 'all',
    startDate: params.get('startDate') ?? '',
    endDate: params.get('endDate') ?? '',
    vehicleState: params.get('vehicleState') ?? 'all',
    userState: params.get('userState') ?? 'all',
    interstate: params.get('interstate') || 'all',
    inferredInterstate: params.get('inferredInterstate') || 'all',
  }
}

function isExcludedEmail(email) {
  const lower = email.toLowerCase()
  return EXCLUDED_EMAILS.has(lower) || EXCLUDED_EMAIL_PATTERNS.some((pattern) => lower.includes(pattern))
}

function isExcludedOrderId(orderId) {
  return EXCLUDED_ORDER_IDS.has(normalizeValue(orderId))
}

function isCustomerBookedBy(bookedBy, config) {
  return config.values.customerBookedByValues.includes(normalizeKey(bookedBy))
}

function isCompletedTdStatus(status, config) {
  return config.values.completedTdStatuses.includes(normalizeKey(status))
}

function matchesInterstate(value, filters, config) {
  const normalized = normalizeKey(value)

  if (filters.interstate === 'all') {
    return true
  }

  if (filters.interstate === 'yes') {
    return config.values.interstateYes.includes(normalized)
  }

  return config.values.interstateNo.includes(normalized) || normalized === ''
}

function matchesDateRange(value, startDate, endDate) {
  if (!startDate && !endDate) {
    return true
  }

  if (!value) {
    return false
  }

  const isoDate = value.slice(0, 10)

  if (startDate && isoDate < startDate) {
    return false
  }

  if (endDate && isoDate > endDate) {
    return false
  }

  return true
}

function inferInterstate(userState, vehicleState) {
  if (!userState || !vehicleState || userState === 'Unknown' || vehicleState === 'Unknown') {
    return 'Unknown'
  }

  return userState === vehicleState ? 'No' : 'Yes'
}

function matchesInferredInterstate(value, filters) {
  if (filters.inferredInterstate === 'all') {
    return true
  }

  if (filters.inferredInterstate === 'yes') {
    return value === 'Yes'
  }

  return value === 'No'
}

function aggregateContacts(deals, associationMap, contactMap, filters, config) {
  const aggregates = new Map()

  for (const deal of deals) {
    if (isExcludedOrderId(deal.orderId)) {
      continue
    }

    if (!matchesDateRange(deal.filterDate, filters.startDate, filters.endDate)) {
      continue
    }

    if (filters.bookedBy !== 'all') {
      const isCustomer = isCustomerBookedBy(deal.bookedBy, config)
      if (filters.bookedBy === 'customer' && !isCustomer) {
        continue
      }
      if (filters.bookedBy === 'agent' && isCustomer) {
        continue
      }
    }

    if (!matchesInterstate(deal.interstate, filters, config)) {
      continue
    }

    const contactIds = associationMap.get(deal.id) ?? []

    for (const contactId of contactIds) {
      const contact = contactMap.get(contactId)
      if (!contact || !contact.email || isExcludedEmail(contact.email)) {
        continue
      }

      const vehicleState = deal.vehicleState || 'Unknown'
      const userState = deal.userState || contact.fallbackUserState || 'Unknown'
      const inferredInterstate = inferInterstate(userState, vehicleState)

      if (filters.vehicleState !== 'all' && vehicleState !== filters.vehicleState) {
        continue
      }

      if (filters.userState !== 'all' && userState !== filters.userState) {
        continue
      }

      if (!matchesInferredInterstate(inferredInterstate, filters)) {
        continue
      }

      const existing = aggregates.get(contactId) ?? {
        id: contactId,
        email: contact.email,
        vehicleState,
        userState,
        qualifiesBooked: false,
        qualifiesCompleted: false,
        qualifiesBc: false,
      }

      const walkInDone = Boolean(contact.walkInDate)
      const tdDone = isCompletedTdStatus(deal.testDriveStatus, config)
      const vtdBooked = config.values.vtdStatuses.includes(normalizeKey(deal.vtdStatus))

      existing.qualifiesBooked = existing.qualifiesBooked || vtdBooked
      existing.qualifiesCompleted = existing.qualifiesCompleted || (vtdBooked && (tdDone || walkInDone))
      existing.qualifiesBc = existing.qualifiesBc || (existing.qualifiesBooked && Boolean(deal.bookingConfirmDate))

      aggregates.set(contactId, existing)
    }
  }

  return [...aggregates.values()]
}

function toOptions(values) {
  return values
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ label: value, value }))
}

function groupCounts(items, getKey) {
  const counts = new Map()

  for (const item of items) {
    const key = getKey(item) || 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
}

export async function getDashboardData(params) {
  const filters = parseFilters(params)
  const config = mergeConfig()
  const deals = await searchDeals(config)
  const associationMap = await readDealToContactAssociations(deals.map((deal) => deal.id))
  const uniqueContactIds = [...new Set([...associationMap.values()].flat())]
  const contactMap = await readContacts(uniqueContactIds, config)
  const contacts = aggregateContacts(deals, associationMap, contactMap, filters, config)
  const table = []

  for (const deal of deals) {
    if (isExcludedOrderId(deal.orderId)) {
      continue
    }

    if (!matchesDateRange(deal.filterDate, filters.startDate, filters.endDate)) {
      continue
    }

    if (filters.bookedBy !== 'all') {
      const isCustomer = isCustomerBookedBy(deal.bookedBy, config)
      if (filters.bookedBy === 'customer' && !isCustomer) {
        continue
      }
      if (filters.bookedBy === 'agent' && isCustomer) {
        continue
      }
    }

    if (!matchesInterstate(deal.interstate, filters, config)) {
      continue
    }

    const contactIds = associationMap.get(deal.id) ?? []

    for (const contactId of contactIds) {
      const contact = contactMap.get(contactId)
      if (!contact || !contact.email || isExcludedEmail(contact.email)) {
        continue
      }

      const vehicleState = deal.vehicleState || 'Unknown'
      const userState = deal.userState || contact.fallbackUserState || 'Unknown'
      const inferredInterstate = inferInterstate(userState, vehicleState)

      if (filters.vehicleState !== 'all' && vehicleState !== filters.vehicleState) {
        continue
      }

      if (filters.userState !== 'all' && userState !== filters.userState) {
        continue
      }

      if (!matchesInferredInterstate(inferredInterstate, filters)) {
        continue
      }

      table.push({
        dealId: deal.orderId || deal.id,
        contactEmail: contact.email,
        vtdStatus: deal.vtdStatus || 'Unknown',
        bookedBy: deal.bookedBy || 'Unknown',
        tdStatus: deal.testDriveStatus || 'Unknown',
        completed: isCompletedTdStatus(deal.testDriveStatus, config) || Boolean(contact.walkInDate) || normalizeKey(deal.vtdStatus) === 'COMPLETED',
        bcDate: deal.bookingConfirmDate || '',
        cancelReturnDate: deal.cancelReturnDate || '',
        vehicleState,
        userState,
        interstate: deal.interstate || 'Unknown',
        inferredInterstate,
      })
    }
  }

  const completedCount = contacts.filter((contact) => contact.qualifiesCompleted).length
  const bcCount = contacts.filter((contact) => contact.qualifiesBc).length
  const cancelledReturnedCount = table.filter((row) => Boolean(row.cancelReturnDate)).length

  return {
    generatedAt: new Date().toISOString(),
    totalDeals: deals.length,
    totalContacts: contacts.length,
    filters,
    summary: {
      booked: contacts.filter((contact) => contact.qualifiesBooked).length,
      completed: completedCount,
      bcs: bcCount,
      cancelledReturned: cancelledReturnedCount,
      conversionRate: completedCount ? Number(((bcCount / completedCount) * 100).toFixed(1)) : 0,
    },
    options: {
      vehicleStates: toOptions([...new Set(contacts.map((contact) => contact.vehicleState))]),
      userStates: toOptions([...new Set(contacts.map((contact) => contact.userState))]),
    },
    breakdowns: {
      bookedBy: groupCounts(table, (row) => (isCustomerBookedBy(row.bookedBy, config) ? 'Customer' : 'Agent')),
      vehicleState: groupCounts(table, (row) => row.vehicleState),
      testDriveStatus: groupCounts(table, (row) => row.tdStatus),
      interstate: groupCounts(table, (row) => row.interstate),
      inferredInterstate: groupCounts(table, (row) => row.inferredInterstate),
    },
    table,
    assumptions: [
      'Booked users are unique associated contacts on deals where virtual_test_drive_status is BOOKED or COMPLETED.',
      'VTD completed is treated as a booked user with either test_drive_status showing Test Drive Done/COMPLETED or a contact check_in_walk_in_date.',
      'BCs are counted as unique filtered booked contacts that have at least one associated deal with booking_confirm_date.',
      'Cancelled/Returned counts rows where deal cancelled___return_date is available.',
      'cars24, yopmail, WL46WF, and ss@mm.com test data are excluded.',
      'Inferred interstate is Yes when delivery state and vehicle state differ, No when they match.',
    ],
  }
}
