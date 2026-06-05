import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { DashboardFilters, DashboardResponse, TDComparisonFilters, TDComparisonResponse } from './types'

// ── Tab 1 defaults ──────────────────────────────────────────────────────────
const DEFAULT_FILTERS: DashboardFilters = {
  bookedBy: 'all', startDate: '', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

// ── Tab 2 defaults ──────────────────────────────────────────────────────────
const DEFAULT_TD_FILTERS: TDComparisonFilters = {
  granularity: 'weekly', bookedBy: 'all',
  startDate: '2026-04-01', endDate: '',
  vehicleState: 'all', userState: 'all', interstate: 'all',
}

const PAGE_SIZE = 25

// ── Colour tokens ───────────────────────────────────────────────────────────
const SERIES_COLORS = {
  tdBooked:    '#64748b',
  tdConducted: '#0ea5e9',
  tdBc:        '#16a34a',
  vtdBooked:   '#dc2626',
  vtdConducted:'#d97706',
  vtdBc:       '#7c3aed',
}

// ── SVG grouped bar chart ───────────────────────────────────────────────────
type Bucket = TDComparisonResponse['buckets'][number]

function GroupedBarChart({ buckets }: { buckets: Bucket[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  if (!buckets.length) return <div className="empty-state">No data for selected period.</div>

  const H = 300
  const MARGIN = { top: 16, right: 16, bottom: 64, left: 36 }
  const BAR_GROUP_GAP = 8
  const BAR_GAP = 2
  const SERIES = 6

  // We compute width dynamically; use a % approach in SVG via viewBox
  const groupWidth = 80
  const totalW = MARGIN.left + buckets.length * (groupWidth + BAR_GROUP_GAP) + MARGIN.right
  const barW = (groupWidth - BAR_GAP * (SERIES - 1)) / SERIES

  const maxVal = Math.max(1, ...buckets.flatMap((b) => [
    b.td.booked, b.td.conducted, b.td.bc,
    b.vtd.booked, b.vtd.conducted, b.vtd.bc,
  ]))

  const chartH = H - MARGIN.top - MARGIN.bottom
  const scaleY = (v: number) => chartH - (v / maxVal) * chartH

  const series = [
    { key: 'tdBooked',    label: 'TD Booked',     color: SERIES_COLORS.tdBooked,    getValue: (b: Bucket) => b.td.booked },
    { key: 'tdConducted', label: 'TD Conducted',   color: SERIES_COLORS.tdConducted, getValue: (b: Bucket) => b.td.conducted },
    { key: 'tdBc',        label: 'TD BC',          color: SERIES_COLORS.tdBc,        getValue: (b: Bucket) => b.td.bc },
    { key: 'vtdBooked',   label: 'VTD Booked',     color: SERIES_COLORS.vtdBooked,   getValue: (b: Bucket) => b.vtd.booked },
    { key: 'vtdConducted',label: 'VTD Conducted',  color: SERIES_COLORS.vtdConducted,getValue: (b: Bucket) => b.vtd.conducted },
    { key: 'vtdBc',       label: 'VTD BC',         color: SERIES_COLORS.vtdBc,       getValue: (b: Bucket) => b.vtd.bc },
  ]

  // Y axis ticks
  const tickCount = 5
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxVal / tickCount) * i))

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${totalW} ${H}`}
        style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
      >
        {/* Y grid + ticks */}
        {ticks.map((tick) => {
          const cy = MARGIN.top + scaleY(tick)
          return (
            <g key={tick}>
              <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={cy} y2={cy} stroke="#f0f0ef" strokeWidth={1} />
              <text x={MARGIN.left - 4} y={cy + 4} textAnchor="end" fontSize={9} fill="#a8a29e">{tick}</text>
            </g>
          )
        })}

        {/* Bars */}
        {buckets.map((bucket, bi) => {
          const gx = MARGIN.left + bi * (groupWidth + BAR_GROUP_GAP)
          return (
            <g key={bucket.dateKey}>
              {series.map((s, si) => {
                const val = s.getValue(bucket)
                const bx = gx + si * (barW + BAR_GAP)
                const barH = (val / maxVal) * chartH
                const by = MARGIN.top + scaleY(val)
                return (
                  <rect
                    key={s.key}
                    x={bx} y={by}
                    width={barW} height={Math.max(0, barH)}
                    fill={s.color} rx={2}
                    style={{ cursor: 'default' }}
                    onMouseEnter={(e) => {
                      const svg = svgRef.current
                      if (!svg) return
                      const rect = svg.getBoundingClientRect()
                      setTooltip({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top - 8,
                        lines: [`${s.label}: ${val}`, bucket.label],
                      })
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
              {/* X label */}
              <text
                x={gx + groupWidth / 2}
                y={H - MARGIN.bottom + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#78716c"
                transform={`rotate(-35, ${gx + groupWidth / 2}, ${H - MARGIN.bottom + 14})`}
              >
                {bucket.label.split(' · ')[0]}
              </text>
            </g>
          )
        })}

        {/* Baseline */}
        <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={MARGIN.top + chartH} y2={MARGIN.top + chartH} stroke="#e7e5e4" strokeWidth={1} />
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute', left: tooltip.x + 8, top: tooltip.y,
          background: '#1c1917', color: 'white', borderRadius: 6,
          padding: '6px 10px', fontSize: 11, pointerEvents: 'none',
          whiteSpace: 'nowrap', zIndex: 10,
        }}>
          {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 12, paddingLeft: 4 }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#57534e' }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── App ─────────────────────────────────────────────────────────────────────
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
            <button
              type="button"
              className={`tab-btn ${activeTab === 'vtd' ? 'active' : ''}`}
              onClick={() => setActiveTab('vtd')}
            >
              VTD
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'comparison' ? 'active' : ''}`}
              onClick={() => setActiveTab('comparison')}
            >
              TD vs VTD
            </button>
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
  const [tableSearch, setTableSearch] = useState('')
  const [page, setPage] = useState(1)

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
      .then((body) => { setData(body); setPage(1) })
      .catch((e: Error) => { setError(e.message); setData(null) })
      .finally(() => setLoading(false))
  }

  const tableRows = useMemo(() => {
    const rows = data?.table ?? []
    const q = tableSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.dealId, r.type, r.contactEmail, r.bookedBy, r.vehicleState, r.userState].join(' ').toLowerCase().includes(q)
    )
  }, [data?.table, tableSearch])

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = tableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const t = data?.totals

  return (
    <>
      <div className="filters-bar">
        <span className="filter-label">Granularity</span>
        <div className="granularity-toggle">
          {(['daily','weekly','monthly'] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`gran-btn ${pendingFilters.granularity === g ? 'active' : ''}`}
              onClick={() => setPendingFilters((p) => ({ ...p, granularity: g }))}
            >
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
        <select className="filter-select" value={pendingFilters.interstate} onChange={(e) => setPendingFilters((p) => ({ ...p, interstate: e.target.value as TDComparisonFilters['interstate'] }))}>
          <option value="all">All — Interstate</option>
          <option value="yes">Interstate: Yes</option>
          <option value="no">Interstate: No</option>
        </select>
        <div className="filter-sep" />
        <button type="button" className="btn btn-primary" onClick={apply} disabled={loading}>
          {loading ? 'Loading…' : 'Apply'}
        </button>
        <button type="button" className="btn" onClick={() => { setPendingFilters(DEFAULT_TD_FILTERS); setData(null); setError('') }}>Clear</button>
      </div>

      <main className="main">
        {error ? <div className="error-box">{error}</div> : null}
        {!data && !loading && !error ? (
          <div className="info-box">Set your filters and click <strong>Apply</strong> to load TD vs VTD data.</div>
        ) : null}
        {loading ? <div className="info-box">Loading from HubSpot — this may take a moment…</div> : null}

        {data && (
          <>
            <div className="metrics-row metrics-row-6">
              <MetricCard color="c-slate" icon="🚗" value={t?.td.booked} label="TD Booked" desc="Physical TDs with slot date set" />
              <MetricCard color="c-blue" icon="✅" value={t?.td.conducted} label="TD Conducted" desc="TD Done or walk-in recorded" />
              <MetricCard color="c-green" icon="🎯" value={t?.td.bc} label="TD BCs" desc="TDs with booking confirm date" />
              <MetricCard color="c-red" icon="📹" value={t?.vtd.booked} label="VTD Booked" desc="Virtual TDs booked or completed" />
              <MetricCard color="c-amber" icon="✅" value={t?.vtd.conducted} label="VTD Conducted" desc="VTD completed or TD Done signal" />
              <MetricCard color="c-purple" icon="🎯" value={t?.vtd.bc} label="VTD BCs" desc="VTDs with booking confirm date" />
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <div>
                  <div className="card-title">TD vs VTD over time</div>
                  <div className="card-sub">
                    {data.granularity.charAt(0).toUpperCase() + data.granularity.slice(1)} view · from {data.filters.startDate || 'Apr 2026'}
                  </div>
                </div>
              </div>
              <div className="card-body" style={{ overflowX: 'auto' }}>
                <GroupedBarChart buckets={data.buckets} />
              </div>
            </div>

            <div className="card table-card">
              <div className="card-header">
                <div>
                  <div className="card-title">All Deals</div>
                  <div className="card-sub">TD and VTD combined · excl. cars24 & yopmail</div>
                </div>
                <input className="filter-input table-search" type="search" placeholder="Search deal / contact…" value={tableSearch} onChange={(e) => { setPage(1); setTableSearch(e.target.value) }} />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Deal</th><th>Type</th><th>Contact</th><th>Booked Date</th>
                      <th>Conducted</th><th>BC Date</th><th>Veh. State</th>
                      <th>User State</th><th>Interstate</th><th>Booked By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.length ? pagedRows.map((row, i) => (
                      <tr key={`${row.dealId}-${i}`}>
                        <td>{row.dealId}</td>
                        <td>
                          <span className={`type-badge ${row.type === 'TD' ? 'type-td' : 'type-vtd'}`}>{row.type}</span>
                        </td>
                        <td>{row.contactEmail || '–'}</td>
                        <td>{row.bookedDate || '–'}</td>
                        <td>{row.conducted ? 'Yes' : 'No'}</td>
                        <td>{row.bcDate || '–'}</td>
                        <td>{row.vehicleState}</td>
                        <td>{row.userState}</td>
                        <td>{row.interstate}</td>
                        <td style={{ fontSize: 11, color: '#78716c', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.bookedBy}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={10} className="empty-state">No rows match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={safePage} pageCount={pageCount} total={tableRows.length} pageSize={PAGE_SIZE} onPage={setPage} />
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
