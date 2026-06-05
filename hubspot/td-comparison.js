import {
  hubspotFetch,
  normalizeValue,
  normalizeKey,
  isExcludedEmail,
  isExcludedOrderId,
  readDealToContactAssociations,
  readContacts,
} from './shared.js'

// ── Constants ────────────────────────────────────────────────────────────────

const COMPLETED_TD_STATUSES = new Set(['TEST DRIVE DONE', 'COMPLETED'])
const CUSTOMER_VALUES = new Set(['CUSTOMER'])
const VTD_BOOKED_STATUSES = new Set(['BOOKED', 'COMPLETED'])
const VTD_CONDUCTED_STATUSES = new Set(['COMPLETED'])

// ── Filters ──────────────────────────────────────────────────────────────────

function parseFilters(params) {
  return {
    granularity: params.get('granularity') || 'weekly',
    bookedBy: params.get('bookedBy') || 'all',
    startDate: params.get('startDate') || '2026-04-01',
    endDate: params.get('endDate') || '',
    vehicleState: params.get('vehicleState') || 'all',
    userState: params.get('userState') || 'all',
    interstate: params.get('interstate') || 'all',
  }
}

// ── HubSpot fetchers ─────────────────────────────────────────────────────────

async function fetchTDDeals() {
  const properties = [
    'order_id',
    'dealname',
    'test_drive_type',
    'td_booking_slot_date',
    'td_booked_by',
    'test_drive_status',
    'check_inwalk_in_date',
    'test_drive_completed_date',
    'booking_confirm_date',
    'car_location_at_time_of_sale',
    'delivery_state',
    'interstate_sale_yesno',
  ]

  const deals = []
  let after

  do {
    const payload = {
      filterGroups: [{
        filters: [{
          propertyName: 'td_booking_slot_date',
          operator: 'HAS_PROPERTY',
        }],
      }],
      properties,
      limit: 100,
      after,
    }

    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    for (const row of data.results) {
      const p = row.properties
      deals.push({
        id: row.id,
        type: 'TD',
        orderId: normalizeValue(p.order_id),
        dealName: normalizeValue(p.dealname),
        bookedDate: normalizeValue(p.td_booking_slot_date),   // epoch ms string
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
    'order_id',
    'dealname',
    'test_drive_type',
    'virtual_test_drive_status',
    'virtual_test_drive_booked_by',
    'vtd_date_and_time',
    'test_drive_status',
    'booking_confirm_date',
    'car_location_at_time_of_sale',
    'delivery_state',
    'interstate_sale_yesno',
  ]

  const deals = []
  let after

  do {
    const payload = {
      filterGroups: [{
        filters: [{
          propertyName: 'virtual_test_drive_status',
          operator: 'HAS_PROPERTY',
        }],
      }],
      properties,
      limit: 100,
      after,
    }

    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    for (const row of data.results) {
      const p = row.properties
      deals.push({
        id: row.id,
        type: 'VTD',
        orderId: normalizeValue(p.order_id),
        dealName: normalizeValue(p.dealname),
        vtdStatus: normalizeValue(p.virtual_test_drive_status),
        bookedBy: normalizeValue(p.virtual_test_drive_booked_by),
        bookedDate: normalizeValue(p.vtd_date_and_time),       // "YYYY-MM-DD HHmm_HHmm" or "DD/MM/YYYY ..."
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

// ── Date helpers ─────────────────────────────────────────────────────────────

// Returns "YYYY-MM-DD" from whatever format the property stores
function toISODate(raw) {
  if (!raw) return null

  // Epoch ms (TD uses this)
  if (/^\d{10,}$/.test(raw)) {
    return new Date(Number(raw)).toISOString().slice(0, 10)
  }

  // "YYYY-MM-DD ..." or "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10)
  }

  // "DD/MM/YYYY ..."
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
    const [dd, mm, yyyy] = raw.slice(0, 10).split('/')
    return `${yyyy}-${mm}-${dd}`
  }

  return null
}

function getWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  // ISO week: Monday-based
  const day = d.getUTCDay() || 7
  const mon = new Date(d)
  mon.setUTCDate(d.getUTCDate() - day + 1)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)

  const monLabel = mon.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const sunLabel = sun.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })

  // ISO week number
  const jan4 = new Date(Date.UTC(mon.getUTCFullYear(), 0, 4))
  const weekNo = Math.ceil(((mon - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7)

  return {
    dateKey: mon.toISOString().slice(0, 10),
    label: `W${weekNo} · ${monLabel}–${sunLabel}`,
  }
}

function getBucket(isoDate, granularity) {
  if (granularity === 'daily') {
    const d = new Date(isoDate + 'T00:00:00Z')
    const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return { dateKey: isoDate, label }
  }
  if (granularity === 'weekly') {
    return getWeekLabel(isoDate)
  }
  // monthly
  const [yyyy, mm] = isoDate.split('-')
  const d = new Date(`${yyyy}-${mm}-01T00:00:00Z`)
  const label = d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { dateKey: `${yyyy}-${mm}-01`, label }
}

// ── Deal logic helpers ────────────────────────────────────────────────────────

function isTDConducted(deal, contact) {
  if (COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus))) return true
  if (deal.walkInDate) return true
  if (deal.completedDate) return true
  if (contact?.walkInDate) return true
  return false
}

function isVTDConducted(deal, contact) {
  if (VTD_CONDUCTED_STATUSES.has(normalizeKey(deal.vtdStatus))) return true
  if (COMPLETED_TD_STATUSES.has(normalizeKey(deal.testDriveStatus))) return true
  if (normalizeKey(deal.testDriveStatus) === 'CHECKED-IN') return true
  if (contact?.walkInDate) return true
  return false
}

function isAgentBookedBy(bookedBy) {
  const upper = normalizeKey(bookedBy)
  return Boolean(bookedBy) && !CUSTOMER_VALUES.has(upper)
}

// ── Filter matching ───────────────────────────────────────────────────────────

function matchesDateRange(isoDate, startDate, endDate) {
  if (!startDate && !endDate) return true
  if (!isoDate) return false
  if (startDate && isoDate < startDate) return false
  if (endDate && isoDate > endDate) return false
  return true
}

function matchesDealFilters(deal, isoDate, filters) {
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

// ── Bucket aggregation ────────────────────────────────────────────────────────

function makeBucketMap() {
  return new Map() // dateKey → { label, dateKey, td: {...}, vtd: {...} }
}

function ensureBucket(map, dateKey, label) {
  if (!map.has(dateKey)) {
    map.set(dateKey, {
      dateKey,
      label,
      td:  { booked: 0, conducted: 0, bc: 0 },
      vtd: { booked: 0, conducted: 0, bc: 0 },
    })
  }
  return map.get(dateKey)
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getTDComparisonData(params) {
  const filters = parseFilters(params)

  // Fetch both in parallel
  const [tdDeals, vtdDeals] = await Promise.all([fetchTDDeals(), fetchVTDDeals()])

  // Fetch contact associations + emails for exclusion / walk-in date
  const allIds = [...new Set([...tdDeals.map((d) => d.id), ...vtdDeals.map((d) => d.id)])]
  const associationMap = await readDealToContactAssociations(allIds)
  const uniqueContactIds = [...new Set([...associationMap.values()].flat())]
  const contactMap = await readContacts(uniqueContactIds)

  const bucketMap = makeBucketMap()
  const tableRows = []

  const totals = {
    td:  { booked: 0, conducted: 0, bc: 0 },
    vtd: { booked: 0, conducted: 0, bc: 0 },
  }

  // ── Process TD deals ──────────────────────────────────────────────────────
  for (const deal of tdDeals) {
    const isoDate = toISODate(deal.bookedDate)
    if (!matchesDealFilters(deal, isoDate, filters)) continue

    // Contact email check
    const contactIds = associationMap.get(deal.id) ?? []
    const contact = contactIds.map((id) => contactMap.get(id)).find((c) => c?.email && !isExcludedEmail(c.email))
    if (contactIds.length > 0 && !contact) continue  // has contacts but all excluded

    const conducted = isTDConducted(deal, contact)
    const hasBc = Boolean(deal.bookingConfirmDate)

    // Bucket
    if (isoDate) {
      const { dateKey, label } = getBucket(isoDate, filters.granularity)
      const bucket = ensureBucket(bucketMap, dateKey, label)
      bucket.td.booked++
      if (conducted) bucket.td.conducted++
      if (hasBc) bucket.td.bc++
    }

    totals.td.booked++
    if (conducted) totals.td.conducted++
    if (hasBc) totals.td.bc++

    tableRows.push({
      dealId: deal.orderId || deal.dealName || deal.id,
      type: 'TD',
      contactEmail: contact?.email || '',
      bookedDate: isoDate || '',
      conducted,
      bcDate: isoDate && hasBc ? new Date(Number(deal.bookingConfirmDate)).toISOString().slice(0, 10) : '',
      vehicleState: deal.vehicleState || 'Unknown',
      userState: deal.userState || 'Unknown',
      interstate: deal.interstate || 'Unknown',
      bookedBy: isAgentBookedBy(deal.bookedBy) ? deal.bookedBy : 'Customer',
    })
  }

  // ── Process VTD deals ─────────────────────────────────────────────────────
  for (const deal of vtdDeals) {
    const vtdUpper = normalizeKey(deal.vtdStatus)
    if (!VTD_BOOKED_STATUSES.has(vtdUpper)) continue  // skip cancelled etc

    const isoDate = toISODate(deal.bookedDate)
    if (!matchesDealFilters(deal, isoDate, filters)) continue

    const contactIds = associationMap.get(deal.id) ?? []
    const contact = contactIds.map((id) => contactMap.get(id)).find((c) => c?.email && !isExcludedEmail(c.email))
    if (contactIds.length > 0 && !contact) continue

    const conducted = isVTDConducted(deal, contact)
    const hasBc = Boolean(deal.bookingConfirmDate)

    if (isoDate) {
      const { dateKey, label } = getBucket(isoDate, filters.granularity)
      const bucket = ensureBucket(bucketMap, dateKey, label)
      bucket.vtd.booked++
      if (conducted) bucket.vtd.conducted++
      if (hasBc) bucket.vtd.bc++
    }

    totals.vtd.booked++
    if (conducted) totals.vtd.conducted++
    if (hasBc) totals.vtd.bc++

    tableRows.push({
      dealId: deal.orderId || deal.dealName || deal.id,
      type: 'VTD',
      contactEmail: contact?.email || '',
      bookedDate: isoDate || '',
      conducted,
      bcDate: hasBc ? new Date(Number(deal.bookingConfirmDate)).toISOString().slice(0, 10) : '',
      vehicleState: deal.vehicleState || 'Unknown',
      userState: deal.userState || 'Unknown',
      interstate: deal.interstate || 'Unknown',
      bookedBy: isAgentBookedBy(deal.bookedBy) ? deal.bookedBy : 'Customer',
    })
  }

  // Sort buckets chronologically
  const buckets = [...bucketMap.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  // Sort table by booked date desc
  tableRows.sort((a, b) => b.bookedDate.localeCompare(a.bookedDate))

  return {
    generatedAt: new Date().toISOString(),
    granularity: filters.granularity,
    filters,
    buckets,
    totals,
    table: tableRows,
  }
}
