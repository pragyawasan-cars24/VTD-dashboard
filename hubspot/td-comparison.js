import { hubspotFetch, normalizeValue, normalizeKey, isExcludedEmail, isExcludedOrderId, readDealToContactAssociations, readContacts } from './shared.js'

async function fetchTDDeals() {
  const deals = []
  let after

  do {
    const payload = {
      filterGroups: [{
        filters: [{
          propertyName: 'td_booking_slot_date',
          operator: 'GTE',
          value: String(new Date('2026-04-01').getTime()),
        }],
      }],
      properties: [
        'dealname','order_id','test_drive_type','td_booking_slot_date','td_booked_by',
        'test_drive_status','check_inwalk_in_date','test_drive_completed_date',
        'booking_confirm_date','car_location_at_time_of_sale','delivery_state','interstate_sale_yesno',
      ],
      limit: 100,
      after,
    }

    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    for (const row of data.results) {
      const p = row.properties
      // Parse anchor date from unix ms timestamp
      const rawTs = normalizeValue(p.td_booking_slot_date)
      let anchorDate = ''
      if (rawTs) {
        const n = Number(rawTs)
        anchorDate = isNaN(n) ? rawTs.slice(0, 10) : new Date(n).toISOString().slice(0, 10)
      }

      deals.push({
        id: row.id,
        type: 'TD',
        orderId: normalizeValue(p.order_id),
        dealName: normalizeValue(p.dealname),
        anchorDate,
        bookedBy: normalizeValue(p.td_booked_by),
        testDriveStatus: normalizeValue(p.test_drive_status),
        checkInWalkInDate: normalizeValue(p.check_inwalk_in_date),
        testDriveCompletedDate: normalizeValue(p.test_drive_completed_date),
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
      properties: [
        'dealname','order_id','virtual_test_drive_status','virtual_test_drive_booked_by',
        'vtd_date_and_time','test_drive_status','booking_confirm_date',
        'car_location_at_time_of_sale','delivery_state','interstate_sale_yesno',
      ],
      limit: 100,
      after,
    }

    const data = await hubspotFetch('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    for (const row of data.results) {
      const p = row.properties
      const raw = normalizeValue(p.vtd_date_and_time)
      let anchorDate = ''
      if (raw) {
        const part = raw.split(' ')[0]
        if (part.includes('/')) {
          const [dd, mm, yyyy] = part.split('/')
          anchorDate = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
        } else {
          anchorDate = part
        }
      }

      if (anchorDate && anchorDate < '2026-04-01') continue

      deals.push({
        id: row.id,
        type: 'VTD',
        orderId: normalizeValue(p.order_id),
        dealName: normalizeValue(p.dealname),
        anchorDate,
        vtdStatus: normalizeValue(p.virtual_test_drive_status),
        bookedBy: normalizeValue(p.virtual_test_drive_booked_by),
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

function isTDConducted(deal) {
  const s = normalizeKey(deal.testDriveStatus)
  return s === 'TEST DRIVE DONE' || s === 'COMPLETED' || Boolean(deal.checkInWalkInDate) || Boolean(deal.testDriveCompletedDate)
}

function isVTDBooked(deal) {
  const s = normalizeKey(deal.vtdStatus)
  return s === 'BOOKED' || s === 'COMPLETED'
}

function isVTDConducted(deal) {
  const vtd = normalizeKey(deal.vtdStatus)
  const td = normalizeKey(deal.testDriveStatus)
  return vtd === 'COMPLETED' || td === 'TEST DRIVE DONE' || td === 'COMPLETED' || td === 'CHECKED-IN'
}

function isAgentBookedBy(bookedBy) {
  const v = normalizeValue(bookedBy)
  return v !== '' && normalizeKey(v) !== 'CUSTOMER' && v.includes('@')
}

function bucketKey(dateStr, granularity) {
  if (!dateStr || dateStr < '2026-04-01') return null
  const d = new Date(dateStr + 'T00:00:00Z')
  if (isNaN(d)) return null
  if (granularity === 'daily') return dateStr
  if (granularity === 'weekly') {
    const day = d.getUTCDay() || 7
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - day + 1)
    return monday.toISOString().slice(0, 10)
  }
  return dateStr.slice(0, 7)
}

function bucketLabel(key, granularity) {
  if (!key) return '?'
  if (granularity === 'daily') {
    const d = new Date(key + 'T00:00:00Z')
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
  if (granularity === 'weekly') {
    const monday = new Date(key + 'T00:00:00Z')
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)
    const wStart = monday.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const wEnd = sunday.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const jan4 = new Date(Date.UTC(monday.getUTCFullYear(), 0, 4))
    const weekNum = Math.ceil(((monday - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7)
    return `W${weekNum} · ${wStart}–${wEnd}`
  }
  const [year, month] = key.split('-')
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1))
    .toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function matchesFilters(deal, email, filters) {
  if (isExcludedOrderId(deal.orderId)) return false
  if (email && isExcludedEmail(email)) return false
  if (filters.bookedBy !== 'all') {
    const agent = isAgentBookedBy(deal.bookedBy)
    if (filters.bookedBy === 'agent' && !agent) return false
    if (filters.bookedBy === 'customer' && agent) return false
  }
  if (filters.startDate && deal.anchorDate && deal.anchorDate < filters.startDate) return false
  if (filters.endDate && deal.anchorDate && deal.anchorDate > filters.endDate) return false
  if (filters.vehicleState !== 'all' && deal.vehicleState !== filters.vehicleState) return false
  if (filters.userState !== 'all' && deal.userState !== filters.userState) return false
  if (filters.interstate !== 'all') {
    const norm = normalizeKey(deal.interstate)
    if (filters.interstate === 'yes' && norm !== 'YES') return false
    if (filters.interstate === 'no' && norm !== 'NO') return false
  }
  return true
}

export async function getTDComparisonData(params) {
  const granularity = params.get('granularity') || 'weekly'
  const filters = {
    bookedBy: params.get('bookedBy') || 'all',
    startDate: params.get('startDate') || '2026-04-01',
    endDate: params.get('endDate') || '',
    vehicleState: params.get('vehicleState') || 'all',
    userState: params.get('userState') || 'all',
    interstate: params.get('interstate') || 'all',
  }

  const [tdDeals, vtdDeals] = await Promise.all([fetchTDDeals(), fetchVTDDeals()])
  const allDeals = [...tdDeals, ...vtdDeals]

  const associationMap = await readDealToContactAssociations(allDeals.map((d) => d.id))
  const uniqueContactIds = [...new Set([...associationMap.values()].flat())]
  const contactMap = await readContacts(uniqueContactIds)

  function getDealEmail(dealId) {
    const contactIds = associationMap.get(dealId) ?? []
    for (const cid of contactIds) {
      const c = contactMap.get(cid)
      if (c?.email) return c.email
    }
    return ''
  }

  const buckets = new Map()
  function getOrCreate(key) {
    if (!buckets.has(key)) {
      buckets.set(key, {
        dateKey: key,
        label: bucketLabel(key, granularity),
        td: { booked: 0, conducted: 0, bc: 0 },
        vtd: { booked: 0, conducted: 0, bc: 0 },
      })
    }
    return buckets.get(key)
  }

  const totals = { td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } }
  const tableRows = []

  for (const deal of tdDeals) {
    const email = getDealEmail(deal.id)
    if (!matchesFilters(deal, email, filters)) continue
    const bk = bucketKey(deal.anchorDate, granularity)
    if (!bk) continue

    const bucket = getOrCreate(bk)
    const conducted = isTDConducted(deal)
    const bc = Boolean(deal.bookingConfirmDate)

    bucket.td.booked++; totals.td.booked++
    if (conducted) { bucket.td.conducted++; totals.td.conducted++ }
    if (bc) { bucket.td.bc++; totals.td.bc++ }

    tableRows.push({
      dealId: deal.orderId || deal.dealName || deal.id,
      type: 'TD',
      contactEmail: email,
      bookedDate: deal.anchorDate,
      conducted,
      bcDate: deal.bookingConfirmDate ? (() => { const n = Number(deal.bookingConfirmDate); return isNaN(n) ? deal.bookingConfirmDate.slice(0,10) : new Date(n).toISOString().slice(0,10) })() : '',
      vehicleState: deal.vehicleState || 'Unknown',
      userState: deal.userState || 'Unknown',
      interstate: deal.interstate || 'Unknown',
      bookedBy: isAgentBookedBy(deal.bookedBy) ? deal.bookedBy : 'Customer',
    })
  }

  for (const deal of vtdDeals) {
    const email = getDealEmail(deal.id)
    if (!matchesFilters(deal, email, filters)) continue
    const bk = bucketKey(deal.anchorDate, granularity)
    if (!bk) continue

    const bucket = getOrCreate(bk)
    const booked = isVTDBooked(deal)
    const conducted = isVTDConducted(deal)
    const bc = Boolean(deal.bookingConfirmDate)

    if (booked) { bucket.vtd.booked++; totals.vtd.booked++ }
    if (conducted) { bucket.vtd.conducted++; totals.vtd.conducted++ }
    if (bc) { bucket.vtd.bc++; totals.vtd.bc++ }

    tableRows.push({
      dealId: deal.orderId || deal.dealName || deal.id,
      type: 'VTD',
      contactEmail: email,
      bookedDate: deal.anchorDate,
      conducted,
      bcDate: deal.bookingConfirmDate ? (() => { const n = Number(deal.bookingConfirmDate); return isNaN(n) ? deal.bookingConfirmDate.slice(0,10) : new Date(n).toISOString().slice(0,10) })() : '',
      vehicleState: deal.vehicleState || 'Unknown',
      userState: deal.userState || 'Unknown',
      interstate: deal.interstate || 'Unknown',
      bookedBy: isAgentBookedBy(deal.bookedBy) ? deal.bookedBy : 'Customer',
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    granularity,
    filters,
    buckets: [...buckets.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    totals,
    table: tableRows.sort((a, b) => b.bookedDate.localeCompare(a.bookedDate)),
  }
}
