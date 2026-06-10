export function getDashboardData(params: URLSearchParams): Promise<{
  generatedAt: string
  totalDeals: number
  totalContacts: number
  filters: {
    bookedBy: string
    startDate: string
    endDate: string
    vehicleState: string
    userState: string
    interstate: string
    inferredInterstate: string
  }
  summary: {
    booked: number
    completed: number
    bcs: number
    cancelledReturned: number
    conversionRate: number
  }
  options: {
    vehicleStates: Array<{ label: string; value: string }>
    userStates: Array<{ label: string; value: string }>
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
    vtdBookedDate: string
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
}>
