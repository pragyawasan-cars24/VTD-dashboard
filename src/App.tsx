import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { DashboardFilters, DashboardResponse, TDComparisonFilters, TDComparisonResponse, TDBucket } from './types'

const DEFAULT_FILTERS: DashboardFilters = {
  bookedBy: 'all', startDate: '', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const DEFAULT_TD_FILTERS: TDComparisonFilters = {
  bookedBy: 'all', startDate: '2026-04-01', endDate: '',
  vehicleState: 'all', userState: 'all',
  interstate: 'all', inferredInterstate: 'all',
}

const PAGE_SIZE = 25

// ── Client-side aggregation ───────────────────────────────────────────────────
type Granularity = 'daily' | 'weekly' | 'monthly'

function getWeekKey(isoDate: string): { dateKey: string; label: string } {
  const d = new Date(isoDate + 'T00:00:00Z')
  const day = d.getUTCDay() || 7
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day + 1)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  const fmt = (dt: Date) => dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return {
    dateKey: mon.toISOString().slice(0, 10),
    label: `${fmt(mon)} – ${fmt(sun)}`,   // e.g. "14 Apr – 20 Apr"
  }
}

function aggregateBuckets(daily: TDBucket[], granularity: Granularity): (TDBucket & { label: string })[] {
  const map = new Map<string, TDBucket & { label: string }>()
  for (const day of daily) {
    let key: string; let label: string
    if (granularity === 'daily') {
      key = day.dateKey
      const d = new Date(day.dateKey + 'T00:00:00Z')
      label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    } else if (granularity === 'weekly') {
      const w = getWeekKey(day.dateKey); key = w.dateKey; label = w.label
    } else {
      key = day.dateKey.slice(0, 7)
      const d = new Date(day.dateKey.slice(0, 7) + '-01T00:00:00Z')
      label = d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    }
    if (!map.has(key)) map.set(key, { dateKey: key, label, td: { booked: 0, conducted: 0, bc: 0 }, vtd: { booked: 0, conducted: 0, bc: 0 } })
    const b = map.get(key)!
    b.td.booked += day.td.booked; b.td.conducted += day.td.conducted; b.td.bc += day.td.bc
    b.vtd.booked += day.vtd.booked; b.vtd.conducted += day.vtd.conducted; b.vtd.bc += day.vtd.bc
  }
  return [...map.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

// ── Single mini bar chart (TD vs VTD for one metric) ─────────────────────────
type ChartBucket = TDBucket & { label: string }

function MiniBarChart({ buckets, getTD, getVTD, tdColor, vtdColor, tdLabel, vtdLabel }: {
  buckets: ChartBucket[]
  getTD: (b: ChartBucket) => number
  getVTD: (b: ChartBucket) => number
  tdColor: string; vtdColor: string
  tdLabel: string; vtdLabel: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null)

  if (!buckets.length) return <div className="empty-state">No data.</div>

  const H = 160
  const MARGIN = { top: 10, right: 8, bottom: 48, left: 28 }
  const BAR_GAP = 2
  const BAR_W = 7
  const PAIR_W = BAR_W * 2 + BAR_GAP
  const BUCKET_GAP = 5
  const totalW = MARGIN.left + buckets.length * (PAIR_W + BUCKET_GAP) + MARGIN.right
  const chartH = H - MARGIN.top - MARGIN.bottom
  const maxVal = Math.max(1, ...buckets.flatMap((b) => [getTD(b), getVTD(b)]))
  const scaleY = (v: number) => chartH - (v / maxVal) * chartH
  const ticks = Array.from({ length: 4 }, (_, i) => Math.round((maxVal / 3) * i))

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${totalW} ${H}`} style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}>
        {ticks.map((tick) => {
          const cy = MARGIN.top + scaleY(tick)
          return (
            <g key={tick}>
              <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={cy} y2={cy} stroke="#f0f0ef" strokeWidth={1} />
              <text x={MARGIN.left - 3} y={cy + 3} textAnchor="end" fontSize={7} fill="#a8a29e">{tick}</text>
            </g>
          )
        })}
        {buckets.map((bucket, bi) => {
          const bx = MARGIN.left + bi * (PAIR_W + BUCKET_GAP)
          const tdVal = getTD(bucket); const vtdVal = getVTD(bucket)
          return (
            <g key={bucket.dateKey}>
              <rect x={bx} y={MARGIN.top + scaleY(tdVal)} width={BAR_W} height={Math.max(0, (tdVal / maxVal) * chartH)} fill={tdColor} rx={1}
                onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (!r) return; setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: [`${tdLabel}: ${tdVal}`, bucket.label] }) }}
                onMouseLeave={() => setTooltip(null)} />
              <rect x={bx + BAR_W + BAR_GAP} y={MARGIN.top + scaleY(vtdVal)} width={BAR_W} height={Math.max(0, (vtdVal / maxVal) * chartH)} fill={vtdColor} rx={1}
                onMouseEnter={(e) => { const r = svgRef.current?.getBoundingClientRect(); if (!r) return; setTooltip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, lines: [`${vtdLabel}: ${vtdVal}`, bucket.label] }) }}
                onMouseLeave={() => setTooltip(null)} />
              <text x={bx + PAIR_W / 2} y={H - MARGIN.bottom + 11} textAnchor="middle" fontSize={7} fill="#78716c"
                transform={`rotate(-45, ${bx + PAIR_W / 2}, ${H - MARGIN.bottom + 11})`}>
                {bucket.label.split(' – ')[0]}
              </text>
            </g>
          )
        })}
        <line x1={MARGIN.left} x2={totalW - MARGIN.right} y1={MARGIN.top + chartH} y2={MARGIN.top + chartH} stroke="#e7e5e4" strokeWidth={1} />
      </svg>
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x + 8, top: tooltip.y, background: '#1c1917', color: 'white', borderRadius: 6, padding: '5px 9px', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10 }}>
          {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 6, paddingLeft: 2 }}>
        {[{ label: tdLabel, color: tdColor }, { label: vtdLabel, color: vtdColor }].map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#57534e' }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />{s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 3-chart row for one granularity ──────────────────────────────────────────
function ChartRow({ title, buckets }: { title: string; buckets: ChartBucket[] }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#57534e', marginBottom: 10, paddingLeft: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-header"><div><div className="card-title">Booked</div></div></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.booked} getVTD={(b) => b.vtd.booked} tdColor="#64748b" vtdColor="#dc2626" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><div className="card-title">Conducted</div></div></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.conducted} getVTD={(b) => b.vtd.conducted} tdColor="#0ea5e9" vtdColor="#d97706" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><div className="card-title">BCs</div></div></div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <MiniBarChart buckets={buckets} getTD={(b) => b.td.bc} getVTD={(b) => b.vtd.bc} tdColor="#16a34a" vtdColor="#7c3aed" tdLabel="TD" vtdLabel="VTD" />
          </div>
        </div>
      </div>
    </div>
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

  // All 3 granularities computed client-side — no refetch
  const daily   = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'daily')   : [], [data])
  const weekly  = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'weekly')  : [], [data])
  const monthly = useMemo(() => data ? aggregateBuckets(data.dailyBuckets, 'monthly') : [], [data])

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
        {!data && !loading && !error ? <div className="info-box">Set filters and click <strong>Apply</strong> to load.</div> : null}
        {loading ? <div className="info-box">Loading from HubSpot…</div> : null}

        {data && (
          <>
            {/* Summary table */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header">
                <div><div className="card-title">Summary</div><div className="card-sub">TD vs VTD · from {data.filters.startDate || 'Apr 2026'} · excl. cars24 &amp; yopmail</div></div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th style={{ color: '#64748b' }}>TD</th>
                      <th style={{ color: '#dc2626' }}>VTD</th>
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
                      <td><strong style={{ fontSize: 18 }}>{t?.td.conducted ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.conducted, t?.td.booked)}</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.conducted ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.conducted, t?.vtd.booked)}</span></td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>BCs <span style={{ fontWeight: 400, color: '#78716c', fontSize: 11 }}>% of conducted</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.td.bc ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.td.bc, t?.td.conducted)}</span></td>
                      <td><strong style={{ fontSize: 18 }}>{t?.vtd.bc ?? '–'}</strong><span style={{ marginLeft: 8, fontSize: 12, color: '#78716c' }}>{pct(t?.vtd.bc, t?.vtd.conducted)}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* All 3 granularities on the page — no toggle, no refetch */}
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
