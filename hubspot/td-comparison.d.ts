export function getTDComparisonData(params: URLSearchParams): Promise<{
  generatedAt: string
  filters: {
    bookedBy: string
    startDate: string
    endDate: string
    vehicleState: string
    userState: string
    interstate: string
    inferredInterstate: string
  }
  dailyBuckets: Array<{
    dateKey: string
    td: {
      booked: number
      conducted: number
      bc: number
    }
    vtd: {
      booked: number
      conducted: number
      bc: number
    }
  }>
  totals: {
    td: {
      booked: number
      conducted: number
      bc: number
    }
    vtd: {
      booked: number
      conducted: number
      bc: number
    }
  }
}>
