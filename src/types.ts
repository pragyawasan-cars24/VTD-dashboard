export type BookedByFilter = 'all' | 'agent' | 'customer'
export type InterstateFilter = 'all' | 'yes' | 'no'

export type DashboardFilters = {
  bookedBy: BookedByFilter
  startDate: string
  endDate: string
  vehicleState: string
  userState: string
  interstate: InterstateFilter
  inferredInterstate: InterstateFilter
}

export type DashboardSummary = {
  booked: number
  completed: number
  bcs: number
  cancelledReturned: number
  conversionRate: number
}

export type FilterOption = {
  label: string
  value: string
}

export type DashboardResponse = {
  generatedAt: string
  totalDeals: number
  totalContacts: number
  filters: DashboardFilters
  summary: DashboardSummary
  options: {
    vehicleStates: FilterOption[]
    userStates: FilterOption[]
  }
  breakdowns: {
    bookedBy: Array<{ label: string; value: number }>
    vehicleState: Array<{ label: string; value: number }>
    testDriveStatus: Array<{ label: string; value: number }>
    interstate: Array<{ label: string; value: number }>
    inferredInterstate: Array<{ label: string; value: number }>
  }
  table: Array<{
    dealId: string
    contactEmail: string
    vtdStatus: string
    bookedBy: string
    tdStatus: string
    completed: boolean
    bcDate: string
    cancelReturnDate: string
    vehicleState: string
    userState: string
    interstate: string
    inferredInterstate: string
  }>
  assumptions: string[]
}
