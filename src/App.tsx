import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type { DashboardFilters, DashboardResponse } from './types'

const DEFAULT_FILTERS: DashboardFilters = {
  bookedBy: 'all',
  startDate: '',
  endDate: '',
  vehicleState: 'all',
  userState: 'all',
  interstate: 'all',
  inferredInterstate: 'all',
}

const PAGE_SIZE = 25

function App() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [tableSearch, setTableSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== 'all') {
        params.set(key, value)
      }
    }

    let active = true

    fetch(`/api/dashboard?${params.toString()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string }
          throw new Error(body.message ?? 'Dashboard request failed.')
        }

        return response.json() as Promise<DashboardResponse>
      })
      .then((body) => {
        if (active) {
          setData(body)
          setError('')
        }
      })
      .catch((fetchError: Error) => {
        if (active) {
          setError(fetchError.message)
          setData(null)
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [filters, refreshTick])

  const generatedAt = data?.generatedAt
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))
    : 'Waiting for data'

  const statusTone = error ? 'error' : loading ? 'loading' : 'live'
  const statusText = error ? 'Error loading data' : loading ? 'Refreshing live data…' : 'Live from HubSpot'

  const updateFilter = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => {
    setLoading(true)
    setPage(1)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const tableRows = useMemo(() => {
    const rows = data?.table ?? []
    const query = tableSearch.trim().toLowerCase()

    if (!query) {
      return rows
    }

    return rows.filter((row) =>
      [row.dealId, row.contactEmail, row.bookedBy, row.vtdStatus, row.tdStatus, row.vehicleState, row.userState]
        .concat(row.inferredInterstate)
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [data?.table, tableSearch])

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pagedRows = tableRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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
          <div className="status-pill">
            <div className={`dot ${statusTone}`}></div>
            <span>{statusText}</span>
          </div>
          <span className="updated-text">Updated {generatedAt}</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setLoading(true)
              setRefreshTick((current) => current + 1)
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="filters-bar">
        <span className="filter-label">Filters</span>
        <select className="filter-select" value={filters.bookedBy} onChange={(event) => updateFilter('bookedBy', event.target.value as DashboardFilters['bookedBy'])}>
          <option value="all">All - Booked By</option>
          <option value="agent">Agent</option>
          <option value="customer">Customer</option>
        </select>
        <input className="filter-input" type="date" value={filters.startDate} onChange={(event) => updateFilter('startDate', event.target.value)} />
        <span className="range-sep">-</span>
        <input className="filter-input" type="date" value={filters.endDate} onChange={(event) => updateFilter('endDate', event.target.value)} />
        <div className="filter-sep"></div>
        <select className="filter-select" value={filters.vehicleState} onChange={(event) => updateFilter('vehicleState', event.target.value)}>
          <option value="all">All - Vehicle State</option>
          {data?.options.vehicleStates.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select className="filter-select" value={filters.userState} onChange={(event) => updateFilter('userState', event.target.value)}>
          <option value="all">All - User State</option>
          {data?.options.userStates.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select className="filter-select" value={filters.interstate} onChange={(event) => updateFilter('interstate', event.target.value as DashboardFilters['interstate'])}>
          <option value="all">All - Interstate</option>
          <option value="yes">Interstate: Yes</option>
          <option value="no">Interstate: No</option>
        </select>
        <select className="filter-select" value={filters.inferredInterstate} onChange={(event) => updateFilter('inferredInterstate', event.target.value as DashboardFilters['inferredInterstate'])}>
          <option value="all">All - Inferred Interstate</option>
          <option value="yes">Inferred: Yes</option>
          <option value="no">Inferred: No</option>
        </select>
        <div className="filter-sep"></div>
        <button type="button" className="btn btn-primary" onClick={() => setRefreshTick((current) => current + 1)}>
          Apply
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLoading(true)
            setPage(1)
            setFilters(DEFAULT_FILTERS)
            setTableSearch('')
          }}
        >
          Clear
        </button>
      </div>

      <main className="main">
        {error ? <div className="error-box">{error}</div> : null}
        {loading ? <div className="info-box">Refreshing from HubSpot.</div> : null}

        <div className="metrics-row">
          <div className="metric-card c-red">
            <div className="metric-icon c-red">📋</div>
            <div className="metric-value c-red">{data?.summary.booked ?? '-'}</div>
            <div className="metric-label">VTD Booked</div>
            <div className="metric-desc">Unique users with VTD booked</div>
          </div>
          <div className="metric-card c-blue">
            <div className="metric-icon c-blue">✅</div>
            <div className="metric-value c-blue">{data?.summary.completed ?? '-'}</div>
            <div className="metric-label">VTD Completed</div>
            <div className="metric-desc">TD Done or walk-in/check-in signal</div>
          </div>
          <div className="metric-card c-green">
            <div className="metric-icon c-green">🎯</div>
            <div className="metric-value c-green">{data?.summary.bcs ?? '-'}</div>
            <div className="metric-label">Booking Confirmations</div>
            <div className="metric-desc">Deals with booking confirm date set</div>
          </div>
          <div className="metric-card c-amber">
            <div className="metric-icon c-amber">↩</div>
            <div className="metric-value c-amber">{data?.summary.cancelledReturned ?? '-'}</div>
            <div className="metric-label">Cancelled / Returned</div>
            <div className="metric-desc">Deals with cancel or return date set</div>
          </div>
          <div className="metric-card c-purple">
            <div className="metric-icon c-purple">📊</div>
            <div className="metric-value c-purple">{data ? `${data.summary.conversionRate}%` : '-'}</div>
            <div className="metric-label">BC Conversion</div>
            <div className="metric-desc">BCs divided by completed VTDs</div>
          </div>
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
            <div>
              <div className="card-title">Deal Records</div>
              <div className="card-sub">Excluding cars24 and yopmail accounts</div>
            </div>
            <input
              className="filter-input table-search"
              type="search"
              placeholder="Search deal / contact / status"
              value={tableSearch}
              onChange={(event) => {
                setPage(1)
                setTableSearch(event.target.value)
              }}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Contact</th>
                  <th>VTD Status</th>
                  <th>Booked By</th>
                  <th>TD Status</th>
                  <th>VTD Completed</th>
                  <th>BC Date</th>
                  <th>Cancel / Return Date</th>
                  <th>Veh. State</th>
                  <th>User State</th>
                  <th>Interstate</th>
                  <th>Inferred Interstate</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length ? (
                  pagedRows.map((row) => (
                    <tr key={`${row.dealId}-${row.contactEmail}`}>
                      <td>{row.dealId}</td>
                      <td>{row.contactEmail}</td>
                      <td>{row.vtdStatus}</td>
                      <td>{row.bookedBy}</td>
                      <td>{row.tdStatus}</td>
                      <td>{row.completed ? 'Yes' : 'No'}</td>
                      <td>{row.bcDate || '-'}</td>
                      <td>{row.cancelReturnDate || '-'}</td>
                      <td>{row.vehicleState}</td>
                      <td>{row.userState}</td>
                      <td>{row.interstate}</td>
                      <td>{row.inferredInterstate}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={12} className="empty-state">
                      No rows match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <div>
              Showing {tableRows.length ? (page - 1) * PAGE_SIZE + 1 : 0}-{Math.min(page * PAGE_SIZE, tableRows.length)} of {tableRows.length}
            </div>
            <div className="page-btns">
              <button type="button" className="btn" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Prev
              </button>
              <span className="page-chip">
                Page {safePage} / {pageCount}
              </span>
              <button type="button" className="btn" disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                Next
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function BreakdownCard({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle: string
  items: Array<{ label: string; value: number }>
}) {
  const max = items[0]?.value ?? 1

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-sub">{subtitle}</div>
        </div>
      </div>
      <div className="card-body">
        <div className="bar-list">
          {items.length ? (
            items.slice(0, 8).map((item) => (
              <div className="bar-row" key={item.label}>
                <div className="bar-label-line">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(item.value / max) * 100}%` }}></div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No data yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
