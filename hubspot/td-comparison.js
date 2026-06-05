import {
  hubspotFetch,
  normalizeValue,
  normalizeKey,
  isExcludedEmail,
  isExcludedOrderId,
  readDealToContactAssociations,
  readContacts,
} from './shared.js'

const COMPLETED_TD_STATUSES = new Set(['TEST DRIVE DONE', 'COMPLETED'])
const CUSTOMER_VALUES = new Set(['CUSTOMER'])
const VTD_CONDUCTED_STATUSES = new Set(['COMPLETED'])
const DEFAULT_START_DATE = '2026-05-18'
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_LIMIT = 8
const rawDataCache = new Map()

function parseFilters(params) {
  return {
    bookedBy: params.get('bookedBy') || 'all',
    startDate: params.get('startDate') || DEFAULT_START_DATE,
    endDate: params.get('endDate') || '',
    vehicleState: params.get('vehicleState') || 'all',
    userState: params.get('userState') || 'all',
    interstate: params.get('interstate') || 'all',
    inferredInterstate: params.get('inferredInterstate') || 'all',
  }
}

function dateToEpochMs(isoDate) {
  if (!isoDate) return Date.parse(DEFAULT_START_DATE + 'T00:00:00Z')
  return new Date(isoDate + 'T00:00:00Z').getTime()
}

function dateToEndEpochMs(isoDate) {
  if (!isoDate) return null
  return new Date(isoDate + 'T23:59:59.999Z').getTime()
}

function buildDateRangeFilters(propertyName, startEpochMs, endEpochMs) {
  const filters = [{ propertyName, operator: 'GTE', value: String(startEpochMs) }]
  if (endEpochMs) filters.push({ propertyName, operator: 'LTE', value: String(endEpochMs) })
  return filters
}

function cacheKeyFor(filters) {
  return `${filters.startDate || DEFAULT_START_DATE}|${filters.endDate || ''}`
}

function getCachedRawData(filters) {
  const key = cacheKeyFor(filters)
  const cached = rawDataCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    rawDataCache.delete(key)
    return null
  }
  return cached.value
}

function setCachedRawData(filters, value) {
  const key = cacheKeyFor(filters)
  rawDataCache.set(key, { timestamp: Date.now(), value })
  while (rawDataCache.size > CACHE_LIMIT) {
    rawDataCache.delete(rawDataCache.keys().next().value)
  }
}

// ── Fetchers (200/page for speed) ────────────────────────────────────────────
async function fetchTDDeals(startEpochMs, endEpochMs) {
  const properties = [
    'order_id', 'td_booking_slot_date', 'td_booked_by',
    'test_drive_status', 'test_drive_completed_date',
    'booking_confirm_date', 'car_location_at_time_of_sale',
    'delivery_state', 'interstate_sale_yesno',
  ]
  const deals = []
  let after
  do {
    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          ...buildDateRangeFilters('td_booking_slot_date', startEpochMs, endEpochMs),
          { propertyName: 'test_drive_type', operator: 'EQ', value: 'TD' },
        ]}],
        properties, limit: 200, after,
      }),
    })
    for (const row of data.results) {
      const p = row.properties
      deals.push({
        id: row.id,
        orderId: normalizeValue(p.order_id),
        bookedDateRaw: normalizeValue(p.td_booking_slot_date),
        bookedBy: normalizeValue(p.td_booked_by),
        testDriveStatus: normalizeValue(p.test_drive_status),
        completedDate: normalizeValue(p.test_drive_completed_date),
        bookingConfirmDate: normalizeValue(p.booking_confirm_date),
        vehicleState: normalizeValue(p.car_location_at_time_of_sale),
        userState: normalizeValue(p.delivery_state),
        interstate: normalizeValue(p.interstate_sale_yesno),
      })
    }
    after = data.paging?.next?.after
  } while (after)
  return deals
}

async function fetchVTDDeals(startEpochMs, endEpochMs) {
  const properties = [
    'order_id', 'virtual_test_drive_status', 'virtual_test_drive_booked_by',
    'vtd_date_and_time', 'test_drive_status', 'booking_confirm_date',
    'car_location_at_time_of_sale', 'delivery_state', 'interstate_sale_yesno',
  ]
  const deals = []
  let after
  do {
    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          ...buildDateRangeFilters('vtd_date_and_time', startEpochMs, endEpochMs),
          { propertyName: 'virtual_test_drive_status', operator: 'IN', values: ['BOOKED', 'COMPLETED'] },
        ]}],
        properties, limit: 200, after,
      }),
    })
    for (const row of data.results) {
      const p = row.properties
      deals.push({
        id: row.id,
        orderId: normalizeValue(p.order_id),
        vtdStatus: normalizeValue(p.virtual_test_drive_status),
        bookedBy: normalizeValue(p.virtual_test_drive_booked_by),
        bookedDateRaw: normalizeValue(p.vtd_date_and_time),
        testDriveStatus: normalizeValue(p.test_drive_status),
        bookingConfirmDate: normalizeValue(p.booking_confirm_date),
        vehicleState: normalizeValue(p.car_location_at_time_of_sale),
        userState: normalizeValue(p.delivery_state),
        interstate: normalizeValue(p.interstate_sale_yesno),
      })
    }
    after = data.paging?.next?.after
  } while (after)
  return deals
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toISODate(raw) {
  if (!raw) return null
  if (/^\d{10,}$/.test(raw)) return new Date(Number(raw)).toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
    const [dd, mm, yyyy] = raw.slice(0, 10).split('/')
    return `${yyyy}-${mm}-${dd}`
  }
  return null
}

// ── Filters ───────────────────────────────────────────────────────────────────
function isAgentBookedBy(v) {
  return Boolean(v) && !CUSTOMER_VALUES.has(normalizeKey(v))
}

function inferInterstate(userState, vehicleState) {
  if (!userState || !vehicleState || userState === 'Unknown' || vehicleState === 'Unknown') return 'Unknown'
  return userState.toUpperCase() === vehicleState.toUpperCase() ? 'No' : 'Yes'
}

function matchesDeal(deal, isoDate, filters) {
  if (isExcludedOrderId(deal.orderId)) return false
  if (filters.startDate && isoDate && isoDate < filters.startDate) return false
  if (filters.endDate && isoDate && isoDate > filters.endDate) return false
  if (!isoDate) return false
  if (filters.bookedBy !== 'all') {
    const agent = isAgentBookedBy(deal.bookedBy)
    if (filters.bookedBy === 'agent' && !agent) return false
    if (filters.bookedBy === 'customer' && agent) return false
  }
  if (filters.vehicleState !== 'all' && deal.vehicleState !== filters.vehicleState) return false
  if (filters.userState !== 'all' && deal.userState !== filters.userState) return false
  if (filters.interstate !== 'all') {
    const u = normalizeKey(deal.interstate)
    if (filters.interstate === 'yes' && u !== 'YES') return false
    if (filters.interstate === 'no' && u !== 'NO') return false
  }
  if (filters.inferredInterstate !== 'all') {
    const inf = inferInterstate(deal.userState, deal.vehicleState)
    if (filters.inferredInterstate === 'yes' && inf !== 'Yes') return false
    if (filters.inferredInterstate === 'no' && inf !== 'No') return false
  }
  return true
}

function ensureDay(map, isoDate) {
  if (!map.has(isoDate)) {
    map.set(isoDate, { dateKey: isoDate, td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } })
  }
  return map.get(isoDate)
}

async function getRawComparisonData(filters) {
  const cached = getCachedRawData(filters)
  if (cached) return cached

  const startEpochMs = dateToEpochMs(filters.startDate)
  const endEpochMs = dateToEndEpochMs(filters.endDate)
  const [tdDeals, fetchedVtdDeals] = await Promise.all([
    fetchTDDeals(startEpochMs, endEpochMs),
    fetchVTDDeals(startEpochMs, endEpochMs),
  ])
  const vtdDeals = fetchedVtdDeals.filter((deal) => {
    const isoDate = toISODate(deal.bookedDateRaw)
    return isoDate && !isExcludedOrderId(deal.orderId)
  })
  const vtdIds = vtdDeals.map((d) => d.id)
  const vtdAssocMap = await readDealToContactAssociations(vtdIds)
  const uniqueContactIds = [...new Set([...vtdAssocMap.values()].flat())]
  const contactMap = await readContacts(uniqueContactIds)
  const rawData = { tdDeals, vtdDeals, vtdAssocMap, contactMap }

  setCachedRawData(filters, rawData)
  return rawData
}

// ── Main ──────────────────────────────────────────────────────────────────────
export async function getTDComparisonData(params) {
  const filters = parseFilters(params)
  const { tdDeals, vtdDeals, vtdAssocMap, contactMap } = await getRawComparisonData(filters)

  // Daily buckets map (we always store daily; client aggregates to weekly/monthly)
  const dayMap = new Map()
  const totals = { td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } }

  // ── TD (deal-level, no contact join) ──
  for (const deal of tdDeals) {
    const isoDate = toISODate(deal.bookedDateRaw)
    if (!matchesDeal(deal, isoDate, filters)) continue

    const conducted = COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus)) || Boolean(deal.completedDate)
    const hasBc = Boolean(deal.bookingConfirmDate)

    totals.td.booked++
    if (conducted) totals.td.conducted++
    if (hasBc) totals.td.bc++

    const b = ensureDay(dayMap, isoDate)
    b.td.booked++
    if (conducted) b.td.conducted++
    if (hasBc) b.td.bc++
  }

  // ── VTD (contact-level BC) ──
  const vtdContactBooked = new Map() // contactId → { isoDate, conducted }
  const vtdContactBc = new Set()

  for (const deal of vtdDeals) {
    const isoDate = toISODate(deal.bookedDateRaw)
    if (!matchesDeal(deal, isoDate, filters)) continue

    const contactIds = vtdAssocMap.get(deal.id) ?? []
    for (const contactId of contactIds) {
      const contact = contactMap.get(contactId)
      if (!contact?.email || isExcludedEmail(contact.email)) continue

      const conducted = VTD_CONDUCTED_STATUSES.has(normalizeKey(deal.vtdStatus)) ||
        COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus)) ||
        normalizeKey(deal.testDriveStatus) === 'CHECKED-IN' ||
        Boolean(contact.walkInDate)

      if (!vtdContactBooked.has(contactId)) {
        vtdContactBooked.set(contactId, { isoDate, conducted: false })
      }
      if (conducted) vtdContactBooked.get(contactId).conducted = true
      if (deal.bookingConfirmDate) vtdContactBc.add(contactId)
    }
  }

  for (const [contactId, info] of vtdContactBooked) {
    const hasBc = vtdContactBc.has(contactId)
    totals.vtd.booked++
    if (info.conducted) totals.vtd.conducted++
    if (hasBc) totals.vtd.bc++

    if (info.isoDate) {
      const b = ensureDay(dayMap, info.isoDate)
      b.vtd.booked++
      if (info.conducted) b.vtd.conducted++
      if (hasBc) b.vtd.bc++
    }
  }

  // Return sorted daily buckets — client handles weekly/monthly aggregation
  const dailyBuckets = [...dayMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  return {
    generatedAt: new Date().toISOString(),
    filters,
    dailyBuckets,
    totals,
  }
}
