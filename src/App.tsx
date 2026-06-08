import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { DashboardFilters, DashboardResponse, TDComparisonFilters, TDComparisonResponse, TDBucket } from './types'

const DEFAULT_FILTERS: DashboardFilters = {
  bookedBy: 'all', startDate: '', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const DEFAULT_TD_FILTERS: TDComparisonFilters = {
  bookedBy: 'all', startDate: '2026-05-18', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const PAGE_SIZE = 25

// ── Client-side aggregation (no refetch on granularity change) ────────────────
type Granularity = 'daily' | 'weekly' | 'monthly'

function getWeekKey(isoDate: string): { dateKey: string; label: string } {
  const d = new Date(isoDate + 'T00:00:00Z')
  const day = d.getUTCDay() || 7
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day + 1)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  const fmt = (dt: Date) => dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return { dateKey: mon.toISOString().slice(0, 10), label: `${fmt(mon)} – ${fmt(sun)}` }
}

function aggregateBuckets(daily: TDBucket[], granularity: Granularity): (TDBucket & { label: string })[] {
  const map = new Map<string, TDBucket & { label: string }>()
  for (const day of daily) {
    let key: string; let label: string
    if (granularity === 'daily') {
      key = day.dateKey
      label = new Date(day.dateKey + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    } else if (granularity === 'weekly') {
      const w = getWeekKey(day.dateKey); key = w.dateKey; label = w.label
    } else {
      key = day.dateKey.slice(0, 7)
      label = new Date(day.dateKey.slice(0, 7) + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    if (!map.has(key)) map.set(key, { dateKey: key, label, td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } })
    const b = map.get(key)!
    b.td.booked += day.td.booked; b.td.conducted += day.td.conducted; b.td.bc += day.td.bc
    b.vtd.booked += day.vtd.booked; b.vtd.conducted += day.vtd.conducted; b.vtd.bc += day.vtd.bc
  }
  return [...map.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
type ChartBucket = TDBucket & { label: string }

function getNiceStep(rawStep: number) {
  if (rawStep <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const fraction = rawStep / magnitude
  const niceFraction =
    fraction <= 1 ? 1 :
      fraction <= 2 ? 2 :
        fraction <= 2.5 ? 2.5 :
          fraction <= 5 ? 5 :
            fraction <= 7.5 ? 7.5 : 10
  return niceFraction * magnitude
}

function formatTick(value: number) {
  return new Intl.NumberFormat('en-AU', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatBarValue(value: number) {
  return new Intl.NumberFormat('en-AU').format(value)
}

function MiniBarChart({ buckets, getTD, getVTD, tdColor, vtdColor, tdLabel, vtdLabel }: {
  buckets: ChartBucket[]
  getTD: (b: ChartBucket) => number
  getVTD: (b: ChartBucket) => number
  tdColor: string; vtdColor: string; tdLabel: string; vtdLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [containerWidth, setContainerWidth] = useState(520)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const updateWidth = () => setContainerWidth(Math.max(320, Math.floor(node.clientWidth)))
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  if (!buckets.length) return <div className="empty-state">No data.</div>
  const H = 260, MARGIN = { top: 30, right: 14, bottom: 58, left: 44 }
  const minBucketStep = buckets.length > 36 ? 22 : buckets.length > 14 ? 30 : 42
  const availablePlotW = Math.max(1, containerWidth - MARGIN.left - MARGIN.right)
  const plotW = Math.max(availablePlotW, buckets.length * minBucketStep)
  const totalW = Math.ceil(MARGIN.left + plotW + MARGIN.right)
  const bucketStep = plotW / buckets.length
  const barGap = Math.max(2, Math.min(5, bucketStep * 0.08))
  const BAR_W = Math.max(5, Math.min(22, (bucketStep - barGap) * 0.32))
  const PAIR_W = BAR_W * 2 + barGap
  const chartH = H - MARGIN.top - MARGIN.bottom
  const maxVal = Math.max(1, ...buckets.flatMap((b) => [getTD(b), getVTD(b)]))
  const tickStep = getNiceStep(maxVal / 4)
  const axisMax = Math.max(tickStep * 4, maxVal)
  const scaleY = (v: number) => chartH - (v / axisMax) * chartH
  const ticks = Array.from({ length: 5 }, (_, i) => tickStep * i)
  const labelInterval = buckets.length > 34 ? Math.ceil(buckets.length / 12) : buckets.length > 18 ? 2 : 1
  return (
    <div ref={containerRef} className="comparison-chart">
      <svg ref={svgRef} width={totalW} height={H} viewBox={`0 0 ${totalW} ${H}`} className="comparison-chart-svg">
        {ticks.map((tick) => {
          const cy = MARGIN.top + scaleY(tick)
          return <g key={tick}>
            <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={cy} y2={cy} stroke="#f0f0ef" strokeWidth={1} />
            <text x={MARGIN.left - 7} y={cy + 4} textAnchor="end" fontSize={10} fill="#8c8580">{formatTick(tick)}</text>
          </g>
        })}
        {buckets.map((bucket, bi) => {
          const bucketCenter = MARGIN.left + bi * bucketStep + bucketStep / 2
          const bx = bucketCenter - PAIR_W / 2
          const tdVal = getTD(bucket), vtdVal = getVTD(bucket)
          const tdValueLabel = formatBarValue(tdVal)
          const vtdValueLabel = formatBarValue(vtdVal)
          const tooltipLines = [
            `${tdLabel}: ${tdValueLabel}`,
            `${vtdLabel}: ${vtdValueLabel}`,
            bucket.label,
          ]
          const valueY = Math.max(13, MARGIN.top + Math.min(scaleY(tdVal), scaleY(vtdVal)) - 15)
          const valueFontSize = bucketStep < 28 ? 8 : 9
          const showLabel = bi % labelInterval === 0 || bi === buckets.length - 1
          return <g key={bucket.dateKey}>
            <rect x={bx} y={MARGIN.top + scaleY(tdVal)} width={BAR_W} height={Math.max(0, (tdVal / axisMax) * chartH)} fill={tdColor} rx={1}
              onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (r) setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: tooltipLines }) }}
              onMouseLeave={() => setTooltip(null)} />
            <rect x={bx + BAR_W + barGap} y={MARGIN.top + scaleY(vtdVal)} width={BAR_W} height={Math.max(0, (vtdVal / axisMax) * chartH)} fill={vtdColor} rx={1}
              onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (r) setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: tooltipLines }) }}
              onMouseLeave={() => setTooltip(null)} />
            <text className="comparison-chart-value-label" x={bucketCenter} y={valueY} textAnchor="middle" fontSize={valueFontSize} fontWeight={700}>
              <tspan fill={tdColor}>{tdValueLabel}</tspan>
              <tspan x={bucketCenter} dy={valueFontSize + 1} fill={vtdColor}>{vtdValueLabel}</tspan>
            </text>
            {showLabel && (
              <text x={bucketCenter} y={H - MARGIN.bottom + 22} textAnchor="end" fontSize={10} fill="#6f6761"
                transform={`rotate(-35, ${bucketCenter}, ${H - MARGIN.bottom + 22})`}>
                {bucket.label.split(' – ')[0]}
              </text>
            )}
          </g>
        })}
        <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={MARGIN.top + chartH} y2={MARGIN.top + chartH} stroke="#e7e5e4" strokeWidth={1} />
      </svg>
      {tooltip && (
        <div className="comparison-chart-tooltip" style={{ left: tooltip.x + 8, top: tooltip.y }}>
          {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <div className="comparison-chart-legend">
        {[{ label: tdLabel, color: tdColor }, { label: vtdLabel, color: vtdColor }].map((s) => (
          <div key={s.label} className="comparison-chart-legend-item">
            <div className="comparison-chart-legend-swatch" style={{ background: s.color }} />{s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chart row: 3 charts (Booked / Conducted / BCs) for one granularity ───────
function ChartRow({ title, buckets }: { title: string; buckets: ChartBucket[] }) {
  return (
    <div className="comparison-section">
      <div className="comparison-section-title">{title}</div>
      <div className="comparison-chart-grid">
        <div className="card">
          <div className="card-header"><div className="card-title">Booked</div></div>
          <div className="card-body comparison-card-body">
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.booked} getVTD={(b) => b.vtd.booked} tdColor="#64748b" vtdColor="#dc2626" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Conducted</div></div>
          <div className="card-body comparison-card-body">
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.conducted} getVTD={(b) => b.vtd.conducted} tdColor="#0ea5e9" vtdColor="#d97706" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Booking Confirmations</div></div>
          <div className="card-body comparison-card-body">
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.bc} getVTD={(b) => b.vtd.bc} tdColor="#16a34a" vtdColor="#7c3aed" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState<'vtd' | 'comparison'>('vtd')
  return (
    <div className="dashboard-page">
      <header className="header">
        <div className="header-left">
          <div className="logo-mark">C24</div>
          <div>
            <div className="header-title">VTD Dashboard</div>
            <div className="header-sub">Virtual Test Drive Analytics</div>
          </div>
        </div>
        <div className="header-right">
          <div className="tab-switcher">
            <button type="button" className={`tab-btn ${activeTab === 'vtd' ? 'active' : ''}`} onClick={() => setActiveTab('vtd')}>VTD</button>
            <button type="button" className={`tab-btn ${activeTab === 'comparison' ? 'active' : ''}`} onClick={() => setActiveTab('comparison')}>TD vs VTD</button>
          </div>
        </div>
      </header>
      {activeTab === 'vtd' ? <VTDTab /> : <ComparisonTab />}
    </div>
  )
}

// ── Tab 1: VTD ────────────────────────────────────────────────────────────────
function VTDTab() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)
  const [pendingFilters, setPendingFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [tableSearch, setTableSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== 'all') params.set(key, value)
    }
    let active = true
    fetch(`/api/dashboard?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? 'Request failed.') }; return r.json() as Promise<DashboardResponse> })
      .then((body) => { if (active) { setData(body); setError('') } })
      .catch((e: Error) => { if (active) { setError(e.message); setData(null) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, refreshTick])

  const generatedAt = data?.generatedAt ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt)) : 'Waiting for data'
  const statusTone = error ? 'error' : loading ? 'loading' : 'live'
  const statusText = error ? 'Error loading data' : loading ? 'Loading…' : 'Live from HubSpot'

  const tableRows = useMemo(() => {
    const rows = data?.table ?? []
    const q = tableSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => [r.dealId, r.contactEmail, r.bookedBy, r.vtdStatus, r.tdStatus, r.vehicleState, r.userState, r.inferredInterstate].join(' ').toLowerCase().includes(q))
  }, [data?.table, tableSearch])

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = tableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <>
      <div className="filters-bar">
        <span className="filter-label">Filters</span>
        <select className="filter-select" value={pendingFilters.bookedBy} onChange={(e) => setPendingFilters((p) => ({ ...p, bookedBy: e.target.value as DashboardFilters['bookedBy'] }))}>
          <option value="all">All — Booked By</option><option value="agent">Agent</option><option value="customer">Customer</option>
        </select>
        <input className="filter-input" type="date" value={pendingFilters.startDate} onChange={(e) => setPendingFilters((p) => ({ ...p, startDate: e.target.value }))} />
        <span className="range-sep">–</span>
        <input className="filter-input" type="date" value={pendingFilters.endDate} onChange={(e) => setPendingFilters((p) => ({ ...p, endDate: e.target.value }))} />
        <div className="filter-sep" />
        <select className="filter-select" value={pendingFilters.vehicleState} onChange={(e) => setPendingFilters((p) => ({ ...p, vehicleState: e.target.value }))}>
          <option value="all">All — Vehicle State</option>
          {data?.options.vehicleStates.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-select" value={pendingFilters.userState} onChange={(e) => setPendingFilters((p) => ({ ...p, userState: e.target.value }))}>
          <option value="all">All — User State</option>
          {data?.options.userStates.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-select" value={pendingFilters.interstate} onChange={(e) => setPendingFilters((p) => ({ ...p, interstate: e.target.value as DashboardFilters['interstate'] }))}>
          <option value="all">All — Interstate</option><option value="yes">Interstate: Yes</option><option value="no">Interstate: No</option>
        </select>
        <select className="filter-select" value={pendingFilters.inferredInterstate} onChange={(e) => setPendingFilters((p) => ({ ...p, inferredInterstate: e.target.value as DashboardFilters['inferredInterstate'] }))}>
          <option value="all">All — Inferred Interstate</option><option value="yes">Inferred: Yes</option><option value="no">Inferred: No</option>
        </select>
        <div className="filter-sep" />
        <button type="button" className="btn btn-primary" onClick={() => { setLoading(true); setPage(1); setFilters(pendingFilters); setRefreshTick((t) => t + 1) }}>Apply</button>
        <button type="button" className="btn" onClick={() => { setLoading(true); setPendingFilters(DEFAULT_FILTERS); setFilters(DEFAULT_FILTERS); setTableSearch(''); setPage(1) }}>Clear</button>
        <div className="filter-sep" />
        <div className="status-pill"><div className={`dot ${statusTone}`} /><span>{statusText}</span></div>
        <span className="updated-text">Updated {generatedAt}</span>
        <button type="button" className="btn" onClick={() => { setLoading(true); setRefreshTick((t) => t + 1) }}>↻ Refresh</button>
      </div>
      <main className="main">
        {error ? <div className="error-box">{error}</div> : null}
        {loading ? <div className="info-box">Loading from HubSpot…</div> : null}
        <div className="metrics-row">
          <MetricCard color="c-red" icon="📋" value={data?.summary.booked} label="VTD Booked" desc="Unique users with VTD booked" />
          <MetricCard color="c-blue" icon="✅" value={data?.summary.completed} label="VTD Completed" desc="TD Done or walk-in/check-in signal" />
          <MetricCard color="c-green" icon="🎯" value={data?.summary.bcs} label="Booking Confirmations" desc="Deals with booking confirm date set" />
          <MetricCard color="c-amber" icon="↩" value={data?.summary.cancelledReturned} label="Cancelled / Returned" desc="Deals with cancel or return date set" />
          <MetricCard color="c-purple" icon="📊" value={data ? `${data.summary.conversionRate}%` : undefined} label="BC Conversion" desc="BCs ÷ completed VTDs" />
        </div>
        <div className="content-grid">
          <BreakdownCard title="Booked By" subtitle="Agent vs customer-initiated" items={data?.breakdowns.bookedBy ?? []} />
          <BreakdownCard title="Vehicle State" subtitle="By car location / state" items={data?.breakdowns.vehicleState ?? []} />
          <BreakdownCard title="Test Drive Status" subtitle="Signal distribution across deals" items={data?.breakdowns.testDriveStatus ?? []} />
          <BreakdownCard title="Interstate vs Local" subtitle="Sale type distribution" items={data?.breakdowns.interstate ?? []} />
          <BreakdownCard title="Inferred Interstate" subtitle="Delivery state vs vehicle state" items={data?.breakdowns.inferredInterstate ?? []} />
        </div>
        <div className="card table-card">
          <div className="card-header">
            <div><div className="card-title">Deal Records</div><div className="card-sub">Excluding cars24 and yopmail accounts</div></div>
            <input className="filter-input table-search" type="search" placeholder="Search deal / contact / status" value={tableSearch} onChange={(e) => { setPage(1); setTableSearch(e.target.value) }} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Deal</th><th>Contact</th><th>VTD Status</th><th>Booked By</th><th>TD Status</th><th>Completed</th><th>BC Date</th><th>Cancel/Return</th><th>Veh. State</th><th>User State</th><th>Interstate</th><th>Inferred</th></tr></thead>
              <tbody>
                {pagedRows.length ? pagedRows.map((row) => (
                  <tr key={`${row.dealId}-${row.contactEmail}`}>
                    <td>{row.dealId}</td><td>{row.contactEmail}</td><td>{row.vtdStatus}</td><td>{row.bookedBy}</td>
                    <td>{row.tdStatus}</td><td>{row.completed ? 'Yes' : 'No'}</td><td>{row.bcDate || '–'}</td><td>{row.cancelReturnDate || '–'}</td>
                    <td>{row.vehicleState}</td><td>{row.userState}</td><td>{row.interstate}</td><td>{row.inferredInterstate}</td>
                  </tr>
                )) : <tr><td colSpan={12} className="empty-state">No rows match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} pageCount={pageCount} total={tableRows.length} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      </main>
    </>
  )
}

// ── Tab 2: TD vs VTD ─────────────────────────────────────────────────────────
function ComparisonTab() {
  const [pendingFilters, setPendingFilters] = useState<TDComparisonFilters>(DEFAULT_TD_FILTERS)
  const [data, setData] = useState<TDComparisonResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function apply() {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(pendingFilters)) {
      if (value && value !== 'all') params.set(key, value)
    }
    setLoading(true); setError('')
    fetch(`/api/td-comparison?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? 'Request failed.') }; return r.json() as Promise<TDComparisonResponse> })
      .then((body) => setData(body))
      .catch((e: Error) => { setError(e.message); setData(null) })
      .finally(() => setLoading(false))
  }

  // All 3 granularities computed instantly client-side from the same fetched data
  const monthly = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'monthly') : [], [data])
  const weekly  = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'weekly')  : [], [data])
  const daily   = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'daily')   : [], [data])

  const t = data?.totals
  const pct = (num?: number, den?: number) => den ? `${Math.round((num ?? 0) / den * 100)}%` : '–'

  return (
    <>
      <div className="filters-bar">
        <span className="filter-label">Filters</span>
        <select className="filter-select" value={pendingFilters.bookedBy} onChange={(e) => setPendingFilters((p) => ({ ...p, bookedBy: e.target.value as TDComparisonFilters['bookedBy'] }))}>
          <option value="all">All — Booked By</option><option value="agent">Agent</option><option value="customer">Customer</option>
        </select>
        <input className="filter-input" type="date" value={pendingFilters.startDate} onChange={(e) => setPendingFilters((p) => ({ ...p, startDate: e.target.value }))} />
        <span className="range-sep">–</span>
        <input className="filter-input" type="date" value={pendingFilters.endDate} onChange={(e) => setPendingFilters((p) => ({ ...p, endDate: e.target.value }))} />
        <div className="filter-sep" />
        <select className="filter-select" value={pendingFilters.vehicleState} onChange={(e) => setPendingFilters((p) => ({ ...p, vehicleState: e.target.value }))}>
          <option value="all">All — Vehicle State</option>
          {['VIC','NSW','QLD','SA','WA','ACT','TAS','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={pendingFilters.userState} onChange={(e) => setPendingFilters((p) => ({ ...p, userState: e.target.value }))}>
          <option value="all">All — User State</option>
          {['Victoria','New South Wales','Queensland','South Australia','Western Australia','Australian Capital Territory','Tasmania','Northern Territory'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={pendingFilters.interstate} onChange={(e) => setPendingFilters((p) => ({ ...p, interstate: e.target.value as TDComparisonFilters['interstate'] }))}>
          <option value="all">All — Interstate</option><option value="yes">Interstate: Yes</option><option value="no">Interstate: No</option>
        </select>
        <select className="filter-select" value={pendingFilters.inferredInterstate} onChange={(e) => setPendingFilters((p) => ({ ...p, inferredInterstate: e.target.value as TDComparisonFilters['inferredInterstate'] }))}>
          <option value="all">All — Inferred Interstate</option><option value="yes">Inferred: Yes</option><option value="no">Inferred: No</option>
        </select>
        <div className="filter-sep" />
        <button type="button" className="btn btn-primary" onClick={apply} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
        <button type="button" className="btn" onClick={() => { setPendingFilters(DEFAULT_TD_FILTERS); setData(null); setError('') }}>Clear</button>
      </div>

      <main className="main">
        {error ? <div className="error-box">{error}</div> : null}
        {!data && !loading && !error ? <div className="info-box">Set filters and click <strong>Apply</strong> to load TD vs VTD data.</div> : null}
        {loading ? <div className="info-box">Loading from HubSpot…</div> : null}

        {data && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div><div className="card-title">Summary</div><div className="card-sub">TD vs VTD · from {data.filters.startDate || 'Apr 2026'} · excl. cars24 &amp; yopmail</div></div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Metric</th><th style={{ color: '#64748b' }}>TD</th><th style={{ color: '#dc2626' }}>VTD</th></tr></thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Booked</td>
                      <td><strong style={{ fontSize: 18 }}>{t?.td.booked ?? '–'}</strong></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.booked ?? '–'}</strong></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Conducted <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>% of booked</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.td.conducted ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.conducted, t?.td.booked)}</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.conducted ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.conducted, t?.vtd.booked)}</span></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>BCs <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>% of conducted</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.td.bc ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.bc, t?.td.conducted)}</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.bc ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.bc, t?.vtd.conducted)}</span></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Booked to BC <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>BCs % of booked</span></td>
                      <td><strong style={{ fontSize: 18 }}>{pct(t?.td.bc, t?.td.booked)}</strong></td>
                      <td><strong style={{ fontSize: 18 }}>{pct(t?.vtd.bc, t?.vtd.booked)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <ChartRow title="Monthly" buckets={monthly} />
            <ChartRow title="Weekly" buckets={weekly} />
            <ChartRow title="Daily" buckets={daily} />
          </>
        )}
      </main>
    </>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────
function MetricCard({ color, icon, value, label, desc }: { color: string; icon: string; value?: number | string; label: string; desc: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${color}`}>{icon}</div>
      <div className={`metric-value ${color}`}>{value ?? '–'}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-desc">{desc}</div>
    </div>
  )
}

function BreakdownCard({ title, subtitle, items }: { title: string; subtitle: string; items: Array<{ label: string; value: number }> }) {
  const max = items[0]?.value ?? 1
  return (
    <div className="card">
      <div className="card-header"><div><div className="card-title">{title}</div><div className="card-sub">{subtitle}</div></div></div>
      <div className="card-body">
        <div className="bar-list">
          {items.length ? items.slice(0, 8).map((item) => (
            <div className="bar-row" key={item.label}>
              <div className="bar-label-line"><span>{item.label}</span><strong>{item.value}</strong></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }} /></div>
            </div>
          )) : <div className="empty-state">No data yet.</div>}
        </div>
      </div>
    </div>
  )
}

function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  return (
    <div className="pagination">
      <div>Showing {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</div>
      <div className="page-btns">
        <button type="button" className="btn" disabled={page === 1} onClick={() => onPage(Math.max(1, page - 1))}>Prev</button>
        <span className="page-chip">Page {page} / {pageCount}</span>
        <button type="button" className="btn" disabled={page === pageCount} onClick={() => onPage(Math.min(pageCount, page + 1))}>Next</button>
      </div>
    </div>
  )
}

export default App
