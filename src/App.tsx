import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { DashboardFilters, DashboardResponse, TDComparisonFilters, TDComparisonResponse } from './types'

const DEFAULT_FILTERS: DashboardFilters = {
  bookedBy: 'all', startDate: '', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const DEFAULT_TD_FILTERS: TDComparisonFilters = {
  granularity: 'weekly', bookedBy: 'all',
  startDate: '2026-04-01', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const PAGE_SIZE = 25

const SERIES_COLORS = {
  tdBooked:    '#64748b',
  tdConducted: '#0ea5e9',
  tdBc:        '#16a34a',
  vtdBooked:   '#dc2626',
  vtdConducted:'#d97706',
  vtdBc:       '#7c3aed',
}

// ── Paired bar chart ─────────────────────────────────────────────────────────
type Bucket = TDComparisonResponse['buckets'][number]

function PairedBarChart({ buckets }: { buckets: Bucket[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  if (!buckets.length) return <div className="empty-state">No data for selected period.</div>

  const H = 300
  const MARGIN = { top: 16, right: 16, bottom: 64, left: 40 }
  const GROUP_GAP = 12
  const BUCKET_GAP = 20
  const BAR_GAP = 2
  const BAR_W = 10
  const PAIR_W = BAR_W * 2 + BAR_GAP
  const BUCKET_W = PAIR_W * 3 + GROUP_GAP * 2
  const totalW = MARGIN.left + buckets.length * (BUCKET_W + BUCKET_GAP) + MARGIN.right
  const chartH = H - MARGIN.top - MARGIN.bottom
  const maxVal = Math.max(1, ...buckets.flatMap((b) => [
    b.td.booked, b.vtd.booked, b.td.conducted, b.vtd.conducted, b.td.bc, b.vtd.bc,
  ]))
  const scaleY = (v: number) => chartH - (v / maxVal) * chartH
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((maxVal / 5) * i))

  const pairs = [
    { key: 'booked',    label: 'Booked',    tdColor: SERIES_COLORS.tdBooked,    vtdColor: SERIES_COLORS.vtdBooked,    getTD: (b: Bucket) => b.td.booked,    getVTD: (b: Bucket) => b.vtd.booked },
    { key: 'conducted', label: 'Conducted',  tdColor: SERIES_COLORS.tdConducted, vtdColor: SERIES_COLORS.vtdConducted, getTD: (b: Bucket) => b.td.conducted, getVTD: (b: Bucket) => b.vtd.conducted },
    { key: 'bc',        label: 'BCs',        tdColor: SERIES_COLORS.tdBc,        vtdColor: SERIES_COLORS.vtdBc,        getTD: (b: Bucket) => b.td.bc,        getVTD: (b: Bucket) => b.vtd.bc },
  ]

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${totalW} ${H}`} style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}>
        {ticks.map((tick) => {
          const cy = MARGIN.top + scaleY(tick)
          return (
            <g key={tick}>
              <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={cy} y2={cy} stroke="#f0f0ef" strokeWidth={1} />
              <text x={MARGIN.left - 5} y={cy + 4} textAnchor="end" fontSize={9} fill="#a8a29e">{tick}</text>
            </g>
          )
        })}
        {buckets.map((bucket, bi) => {
          const bx = MARGIN.left + bi * (BUCKET_W + BUCKET_GAP)
          return (
            <g key={bucket.dateKey}>
              {pairs.map((pair, pi) => {
                const pairX = bx + pi * (PAIR_W + GROUP_GAP)
                const tdVal = pair.getTD(bucket)
                const vtdVal = pair.getVTD(bucket)
                return (
                  <g key={pair.key}>
                    <rect x={pairX} y={MARGIN.top + scaleY(tdVal)} width={BAR_W} height={Math.max(0, (tdVal / maxVal) * chartH)} fill={pair.tdColor} rx={2}
                      onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (!r) return; setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: [`TD ${pair.label}: ${tdVal}`, bucket.label] }) }}
                      onMouseLeave={() => setTooltip(null)} />
                    <rect x={pairX + BAR_W + BAR_GAP} y={MARGIN.top + scaleY(vtdVal)} width={BAR_W} height={Math.max(0, (vtdVal / maxVal) * chartH)} fill={pair.vtdColor} rx={2}
                      onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (!r) return; setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: [`VTD ${pair.label}: ${vtdVal}`, bucket.label] }) }}
                      onMouseLeave={() => setTooltip(null)} />
                    <text x={pairX + PAIR_W / 2} y={H - MARGIN.bottom + 10} textAnchor="middle" fontSize={8} fill="#a8a29e">{pair.label}</text>
                  </g>
                )
              })}
              <text x={bx + BUCKET_W / 2} y={H - MARGIN.bottom + 22} textAnchor="middle" fontSize={9} fill="#78716c"
                transform={`rotate(-30, ${bx + BUCKET_W / 2}, ${H - MARGIN.bottom + 22})`}>
                {bucket.label.split(' · ')[0]}
              </text>
              {bi > 0 && <line x1={bx - BUCKET_GAP / 2} x2={bx - BUCKET_GAP / 2} y1={MARGIN.top} y2={MARGIN.top + chartH} stroke="#f0f0ef" strokeWidth={1} />}
            </g>
          )
        })}
        <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={MARGIN.top + chartH} y2={MARGIN.top + chartH} stroke="#e7e5e4" strokeWidth={1} />
      </svg>
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x + 8, top: tooltip.y, background: '#1c1917', color: 'white', borderRadius: 6, padding: '6px 10px', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10 }}>
          {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 14, paddingLeft: 4 }}>
        {[
          { label: 'TD Booked', color: SERIES_COLORS.tdBooked },
          { label: 'VTD Booked', color: SERIES_COLORS.vtdBooked },
          { label: 'TD Conducted', color: SERIES_COLORS.tdConducted },
          { label: 'VTD Conducted', color: SERIES_COLORS.vtdConducted },
          { label: 'TD BCs', color: SERIES_COLORS.tdBc },
          { label: 'VTD BCs', color: SERIES_COLORS.vtdBc },
        ].map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#57534e' }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────────────
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

// ── Tab 1: VTD ───────────────────────────────────────────────────────────────
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
    setLoading(true)
    fetch(`/api/dashboard?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? 'Request failed.') }
        return r.json() as Promise<DashboardResponse>
      })
      .then((body) => { if (active) { setData(body); setError('') } })
      .catch((e: Error) => { if (active) { setError(e.message); setData(null) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters, refreshTick])

  const generatedAt = data?.generatedAt
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))
    : 'Waiting for data'

  const statusTone = error ? 'error' : loading ? 'loading' : 'live'
  const statusText = error ? 'Error loading data' : loading ? 'Loading…' : 'Live from HubSpot'

  const tableRows = useMemo(() => {
    const rows = data?.table ?? []
    const q = tableSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.dealId, r.contactEmail, r.bookedBy, r.vtdStatus, r.tdStatus, r.vehicleState, r.userState, r.inferredInterstate]
        .join(' ').toLowerCase().includes(q)
    )
  }, [data?.table, tableSearch])

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = tableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <>
      <div className="filters-bar">
        <span className="filter-label">Filters</span>
        <select className="filter-select" value={pendingFilters.bookedBy} onChange={(e) => setPendingFilters((p) => ({ ...p, bookedBy: e.target.value as DashboardFilters['bookedBy'] }))}>
          <option value="all">All — Booked By</option>
          <option value="agent">Agent</option>
          <option value="customer">Customer</option>
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
          <option value="all">All — Interstate</option>
          <option value="yes">Interstate: Yes</option>
          <option value="no">Interstate: No</option>
        </select>
        <select className="filter-select" value={pendingFilters.inferredInterstate} onChange={(e) => setPendingFilters((p) => ({ ...p, inferredInterstate: e.target.value as DashboardFilters['inferredInterstate'] }))}>
          <option value="all">All — Inferred Interstate</option>
          <option value="yes">Inferred: Yes</option>
          <option value="no">Inferred: No</option>
        </select>
        <div className="filter-sep" />
        <button type="button" className="btn btn-primary" onClick={() => { setPage(1); setFilters(pendingFilters); setRefreshTick((t) => t + 1) }}>Apply</button>
        <button type="button" className="btn" onClick={() => { setPendingFilters(DEFAULT_FILTERS); setFilters(DEFAULT_FILTERS); setTableSearch(''); setPage(1) }}>Clear</button>
        <div className="filter-sep" />
        <div className="status-pill">
          <div className={`dot ${statusTone}`} />
          <span>{statusText}</span>
        </div>
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
              <thead>
                <tr>
                  <th>Deal</th><th>Contact</th><th>VTD Status</th><th>Booked By</th>
                  <th>TD Status</th><th>Completed</th><th>BC Date</th><th>Cancel/Return</th>
                  <th>Veh. State</th><th>User State</th><th>Interstate</th><th>Inferred</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? pagedRows.map((row) => (
                  <tr key={`${row.dealId}-${row.contactEmail}`}>
                    <td>{row.dealId}</td><td>{row.contactEmail}</td><td>{row.vtdStatus}</td><td>{row.bookedBy}</td>
                    <td>{row.tdStatus}</td><td>{row.completed ? 'Yes' : 'No'}</td>
                    <td>{row.bcDate || '–'}</td><td>{row.cancelReturnDate || '–'}</td>
                    <td>{row.vehicleState}</td><td>{row.userState}</td><td>{row.interstate}</td><td>{row.inferredInterstate}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={12} className="empty-state">No rows match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} pageCount={pageCount} total={tableRows.length} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      </main>
    </>
  )
}

// ── Tab 2: TD vs VTD Comparison ──────────────────────────────────────────────
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
    setLoading(true)
    setError('')
    fetch(`/api/td-comparison?${params.toString()}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? 'Request failed.') }
        return r.json() as Promise<TDComparisonResponse>
      })
      .then((body) => { setData(body) })
      .catch((e: Error) => { setError(e.message); setData(null) })
      .finally(() => setLoading(false))
  }

  const t = data?.totals
  const pct = (num?: number, den?: number) => den ? `${Math.round((num ?? 0) / den * 100)}%` : '–'

  return (
    <>
      <div className="filters-bar">
        <span className="filter-label">Granularity</span>
        <div className="granularity-toggle">
          {(['daily', 'weekly', 'monthly'] as const).map((g) => (
            <button key={g} type="button" className={`gran-btn ${pendingFilters.granularity === g ? 'active' : ''}`}
              onClick={() => setPendingFilters((p) => ({ ...p, granularity: g }))}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        <div className="filter-sep" />
        <span className="filter-label">Filters</span>
        <select className="filter-select" value={pendingFilters.bookedBy} onChange={(e) => setPendingFilters((p) => ({ ...p, bookedBy: e.target.value as TDComparisonFilters['bookedBy'] }))}>
          <option value="all">All — Booked By</option>
          <option value="agent">Agent</option>
          <option value="customer">Customer</option>
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
          <option value="all">All — Interstate</option>
          <option value="yes">Interstate: Yes</option>
          <option value="no">Interstate: No</option>
        </select>
        <select className="filter-select" value={pendingFilters.inferredInterstate} onChange={(e) => setPendingFilters((p) => ({ ...p, inferredInterstate: e.target.value as TDComparisonFilters['inferredInterstate'] }))}>
          <option value="all">All — Inferred Interstate</option>
          <option value="yes">Inferred: Yes</option>
          <option value="no">Inferred: No</option>
        </select>
        <div className="filter-sep" />
        <button type="button" className="btn btn-primary" onClick={apply} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
        <button type="button" className="btn" onClick={() => { setPendingFilters(DEFAULT_TD_FILTERS); setData(null); setError('') }}>Clear</button>
      </div>

      <main className="main">
        {error ? <div className="error-box">{error}</div> : null}
        {!data && !loading && !error
          ? <div className="info-box">Set your filters and click <strong>Apply</strong> to load TD vs VTD data.</div>
          : null}
        {loading ? <div className="info-box">Loading from HubSpot — may take 20–30s…</div> : null}

        {data && (
          <>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">Summary</div>
                  <div className="card-sub">TD vs VTD · from {data.filters.startDate || 'Apr 2026'} · excl. cars24 &amp; yopmail</div>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th style={{ color: SERIES_COLORS.tdBooked }}>TD</th>
                      <th style={{ color: SERIES_COLORS.vtdBooked }}>VTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Booked</td>
                      <td><strong style={{ fontSize: 18 }}>{t?.td.booked ?? '–'}</strong></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.booked ?? '–'}</strong></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Conducted <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>% of booked</span></td>
                      <td>
                        <strong style={{ fontSize: 18 }}>{t?.td.conducted ?? '–'}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.conducted, t?.td.booked)}</span>
                      </td>
                      <td>
                        <strong style={{ fontSize: 18 }}>{t?.vtd.conducted ?? '–'}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.conducted, t?.vtd.booked)}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>BCs <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>% of conducted</span></td>
                      <td>
                        <strong style={{ fontSize: 18 }}>{t?.td.bc ?? '–'}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.bc, t?.td.conducted)}</span>
                      </td>
                      <td>
                        <strong style={{ fontSize: 18 }}>{t?.vtd.bc ?? '–'}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.bc, t?.vtd.conducted)}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">TD vs VTD over time</div>
                  <div className="card-sub">{data.granularity.charAt(0).toUpperCase() + data.granularity.slice(1)} view · each group = Booked / Conducted / BCs</div>
                </div>
              </div>
              <div className="card-body" style={{ overflowX: 'auto' }}>
                <PairedBarChart buckets={data.buckets} />
              </div>
            </div>
          </>
        )}
      </main>
    </>
  )
}

// ── Shared components ────────────────────────────────────────────────────────
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
      <div className="card-header">
        <div><div className="card-title">{title}</div><div className="card-sub">{subtitle}</div></div>
      </div>
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
