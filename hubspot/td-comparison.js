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
const DEFAULT_START_EPOCH_MS = 1775001600000 // 2026-04-01 UTC

function parseFilters(params) {
  return {
    granularity: params.get('granularity') || 'weekly',
    bookedBy: params.get('bookedBy') || 'all',
    startDate: params.get('startDate') || '2026-04-01',
    endDate: params.get('endDate') || '',
    vehicleState: params.get('vehicleState') || 'all',
    userState: params.get('userState') || 'all',
    interstate: params.get('interstate') || 'all',
    inferredInterstate: params.get('inferredInterstate') || 'all',
  }
}

function dateToEpochMs(isoDate) {
  if (!isoDate) return DEFAULT_START_EPOCH_MS
  return new Date(isoDate + 'T00:00:00Z').getTime()
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchTDDeals(startEpochMs) {
  const properties = [
    'order_id', 'dealname', 'td_booking_slot_date', 'td_booked_by',
    'test_drive_status', 'check_inwalk_in_date', 'test_drive_completed_date',
    'booking_confirm_date', 'car_location_at_time_of_sale', 'delivery_state',
    'interstate_sale_yesno',
  ]
  const deals = []
  let after
  do {
    const payload = {
      filterGroups: [{ filters: [
        { propertyName: 'td_booking_slot_date', operator: 'GTE', value: String(startEpochMs) },
        { propertyName: 'test_drive_type', operator: 'EQ', value: 'TD' },
      ] }],
      properties, limit: 100, after,
    }
    const data = await hubspotFetch('/crm/v3/objects/deals/search', { method: 'POST', body: JSON.stringify(payload) })
    for (const row of data.results) {
      const p = row.properties
      deals.push({
        id: row.id,
        orderId: normalizeValue(p.order_id),
        bookedDateRaw: normalizeValue(p.td_booking_slot_date),
        bookedBy: normalizeValue(p.td_booked_by),
        testDriveStatus: normalizeValue(p.test_drive_status),
        walkInDate: normalizeValue(p.check_inwalk_in_date),
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

async function fetchVTDDeals() {
  const properties = [
    'order_id', 'dealname', 'virtual_test_drive_status', 'virtual_test_drive_booked_by',
    'vtd_date_and_time', 'test_drive_status', 'booking_confirm_date',
    'car_location_at_time_of_sale', 'delivery_state', 'interstate_sale_yesno',
  ]
  const deals = []
  let after
  do {
    const payload = {
      filterGroups: [{ filters: [{ propertyName: 'virtual_test_drive_status', operator: 'IN', values: ['BOOKED', 'COMPLETED'] }] }],
      properties, limit: 100, after,
    }
    const data = await hubspotFetch('/crm/v3/objects/deals/search', { method: 'POST', body: JSON.stringify(payload) })
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function getBucket(isoDate, granularity) {
  if (granularity === 'daily') {
    const d = new Date(isoDate + 'T00:00:00Z')
    return { dateKey: isoDate, label: d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }
  }
  if (granularity === 'weekly') {
    const d = new Date(isoDate + 'T00:00:00Z')
    const day = d.getUTCDay() || 7
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day + 1)
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
    const fmt = (dt) => dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const jan4 = new Date(Date.UTC(mon.getUTCFullYear(), 0, 4))
    const weekNo = Math.ceil(((mon - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7)
    return { dateKey: mon.toISOString().slice(0, 10), label: `W${weekNo} · ${fmt(mon)}–${fmt(sun)}` }
  }
  const [yyyy, mm] = isoDate.split('-')
  const d = new Date(`${yyyy}-${mm}-01T00:00:00Z`)
  return { dateKey: `${yyyy}-${mm}-01`, label: d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
}

function isAgentBookedBy(bookedBy) {
  return Boolean(bookedBy) && !CUSTOMER_VALUES.has(normalizeKey(bookedBy))
}

function inferInterstate(userState, vehicleState) {
  if (!userState || !vehicleState || userState === 'Unknown' || vehicleState === 'Unknown') return 'Unknown'
  return userState.toUpperCase() === vehicleState.toUpperCase() ? 'No' : 'Yes'
}

function matchesDateRange(isoDate, startDate, endDate) {
  if (!startDate && !endDate) return true
  if (!isoDate) return false
  if (startDate && isoDate < startDate) return false
  if (endDate && isoDate > endDate) return false
  return true
}

function matchesDeal(deal, isoDate, filters) {
  if (isExcludedOrderId(deal.orderId)) return false
  if (!matchesDateRange(isoDate, filters.startDate, filters.endDate)) return false
  if (filters.bookedBy !== 'all') {
    const agent = isAgentBookedBy(deal.bookedBy)
    if (filters.bookedBy === 'agent' && !agent) return false
    if (filters.bookedBy === 'customer' && agent) return false
  }
  if (filters.vehicleState !== 'all' && deal.vehicleState !== filters.vehicleState) return false
  if (filters.userState !== 'all' && deal.userState !== filters.userState) return false
  if (filters.interstate !== 'all') {
    const upper = normalizeKey(deal.interstate)
    if (filters.interstate === 'yes' && upper !== 'YES') return false
    if (filters.interstate === 'no' && upper !== 'NO') return false
  }
  return true
}

function matchesInferredInterstate(inferred, filters) {
  if (filters.inferredInterstate === 'all') return true
  if (filters.inferredInterstate === 'yes') return inferred === 'Yes'
  return inferred === 'No'
}

function ensureBucket(map, dateKey, label) {
  if (!map.has(dateKey)) {
    map.set(dateKey, { dateKey, label, td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } })
  }
  return map.get(dateKey)
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function getTDComparisonData(params) {
  const filters = parseFilters(params)
  const startEpochMs = dateToEpochMs(filters.startDate)

  // Fetch both deal sets in parallel
  const [tdDeals, vtdDeals] = await Promise.all([fetchTDDeals(startEpochMs), fetchVTDDeals()])

  // Only fetch contact associations for VTD deals (for email exclusion + BC contact-level logic)
  // TD deals: use deal-level data only (too many deals to batch contacts)
  const vtdIds = vtdDeals.map((d) => d.id)
  const vtdAssocMap = await readDealToContactAssociations(vtdIds)
  const uniqueContactIds = [...new Set([...vtdAssocMap.values()].flat())]
  const contactMap = await readContacts(uniqueContactIds)

  const bucketMap = new Map()
  const totals = { td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } }

  // ── TD: deal-level aggregation ──
  // BC = deal has booking_confirm_date (deal-level, no contact join needed for TD)
  for (const deal of tdDeals) {
    const isoDate = toISODate(deal.bookedDateRaw)
    const inferred = inferInterstate(deal.userState, deal.vehicleState)
    if (!matchesDeal(deal, isoDate, filters)) continue
    if (!matchesInferredInterstate(inferred, filters)) continue

    const conducted = COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus)) || Boolean(deal.walkInDate) || Boolean(deal.completedDate)
    const hasBc = Boolean(deal.bookingConfirmDate)

    totals.td.booked++
    if (conducted) totals.td.conducted++
    if (hasBc) totals.td.bc++

    if (isoDate) {
      const { dateKey, label } = getBucket(isoDate, filters.granularity)
      const b = ensureBucket(bucketMap, dateKey, label)
      b.td.booked++
      if (conducted) b.td.conducted++
      if (hasBc) b.td.bc++
    }
  }

  // ── VTD: contact-level aggregation (same logic as Tab 1) ──
  // Booked contacts = unique contacts on VTD deals
  // BC = booked contact has at least one associated deal with booking_confirm_date
  // Group by deal's vtd_date_and_time for the chart bucket
  const vtdContactBooked = new Map()   // contactId → { isoDate, conducted, deals[] }
  const vtdContactBcDeals = new Map()  // contactId → Set of dealIds with BC

  for (const deal of vtdDeals) {
    const isoDate = toISODate(deal.bookedDateRaw)
    const inferred = inferInterstate(deal.userState, deal.vehicleState)
    if (!matchesDeal(deal, isoDate, filters)) continue
    if (!matchesInferredInterstate(inferred, filters)) continue

    const contactIds = vtdAssocMap.get(deal.id) ?? []
    for (const contactId of contactIds) {
      const contact = contactMap.get(contactId)
      if (!contact?.email || isExcludedEmail(contact.email)) continue

      const conducted = VTD_CONDUCTED_STATUSES.has(normalizeKey(deal.vtdStatus)) ||
        COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus)) ||
        normalizeKey(deal.testDriveStatus) === 'CHECKED-IN' ||
        Boolean(contact.walkInDate)

      if (!vtdContactBooked.has(contactId)) {
        vtdContactBooked.set(contactId, { isoDate, conducted: false, dealId: deal.id })
      }
      const existing = vtdContactBooked.get(contactId)
      if (conducted) existing.conducted = true

      if (deal.bookingConfirmDate) {
        if (!vtdContactBcDeals.has(contactId)) vtdContactBcDeals.set(contactId, new Set())
        vtdContactBcDeals.get(contactId).add(deal.id)
      }
    }
  }

  // Aggregate VTD contact-level into buckets
  for (const [contactId, info] of vtdContactBooked) {
    const hasBc = vtdContactBcDeals.has(contactId)

    totals.vtd.booked++
    if (info.conducted) totals.vtd.conducted++
    if (hasBc) totals.vtd.bc++

    if (info.isoDate) {
      const { dateKey, label } = getBucket(info.isoDate, filters.granularity)
      const b = ensureBucket(bucketMap, dateKey, label)
      b.vtd.booked++
      if (info.conducted) b.vtd.conducted++
      if (hasBc) b.vtd.bc++
    }
  }

  const buckets = [...bucketMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  return {
    generatedAt: new Date().toISOString(),
    granularity: filters.granularity,
    filters,
    buckets,
    totals,
  }
}
