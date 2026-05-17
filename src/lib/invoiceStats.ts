/** Shared invoice date helpers for revenue stats and charts. */

export function parseInvoiceDate(date: string): Date {
  if (!date) return new Date(NaN)
  return new Date(`${date}T12:00:00`)
}

/** True when invoice `date` falls in the same calendar month as `ref` (default: today). */
export function isInvoiceInCalendarMonth(date: string, ref: Date = new Date()): boolean {
  const d = parseInvoiceDate(date)
  if (Number.isNaN(d.getTime())) return false
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
}

/** "2026-03" → "Mar 2026" (avoid "Mar 26" looking like a day). */
export function formatInvoiceMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-')
  if (!y || !m) return yearMonth
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

export function invoiceYearMonth(date: string): string {
  return date?.slice(0, 7) || ''
}

export type DashboardPeriod = '7d' | '30d' | '90d' | '6m' | '1y' | 'all'

const PERIOD_DAYS: Record<Exclude<DashboardPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6m': 182,
  '1y': 365,
}

/** Start of rolling window; null = all time. */
export function getPeriodStart(period: DashboardPeriod): Date | null {
  if (period === 'all') return null
  const now = new Date()
  return new Date(now.getTime() - PERIOD_DAYS[period] * 86_400_000)
}

export function getPeriodLabel(period: DashboardPeriod): string {
  const labels: Record<DashboardPeriod, string> = {
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    '6m': '6 months',
    '1y': '1 year',
    all: 'all time',
  }
  return labels[period]
}

export function isWithinPeriod(dateStr: string, periodStart: Date | null): boolean {
  if (!periodStart) return true
  const d = parseInvoiceDate(dateStr)
  if (Number.isNaN(d.getTime())) return false
  const start = new Date(periodStart)
  start.setHours(0, 0, 0, 0)
  return d >= start
}

export type RevenueTrendBucket = 'day' | 'week' | 'month'

export type RevenueTrendPoint = {
  key: string
  label: string
  totalBilled: number
  collected: number
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday of the week containing `date` (local). */
export function weekStartKey(date: string): string {
  const d = parseInvoiceDate(date)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return formatYmd(monday)
}

export function bucketInvoiceDate(date: string, bucket: RevenueTrendBucket): string {
  if (!date) return ''
  if (bucket === 'day') return date.slice(0, 10)
  if (bucket === 'week') return weekStartKey(date)
  return date.slice(0, 7)
}

export function formatRevenueTrendLabel(key: string, bucket: RevenueTrendBucket): string {
  if (bucket === 'month') return formatInvoiceMonthLabel(key)
  const d = parseInvoiceDate(key.length === 7 ? `${key}-01` : key)
  if (Number.isNaN(d.getTime())) return key
  if (bucket === 'week') {
    return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function addDaysYmd(key: string, days: number): string {
  const d = parseInvoiceDate(key)
  d.setDate(d.getDate() + days)
  return formatYmd(d)
}

function addMonthsYm(ym: string, months: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + months, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function enumerateBucketKeys(start: string, end: string, bucket: RevenueTrendBucket): string[] {
  const keys: string[] = []
  let cur = bucket === 'month' ? start.slice(0, 7) : start
  const endKey = bucket === 'month' ? end.slice(0, 7) : end
  while (cur <= endKey) {
    keys.push(cur)
    if (bucket === 'day') cur = addDaysYmd(cur, 1)
    else if (bucket === 'week') cur = addDaysYmd(cur, 7)
    else cur = addMonthsYm(cur, 1)
  }
  return keys
}

export function dateSpanDays(invoices: { date: string }[]): number {
  const times = invoices
    .map((i) => parseInvoiceDate(i.date).getTime())
    .filter((t) => !Number.isNaN(t))
  if (!times.length) return 0
  const min = Math.min(...times)
  const max = Math.max(...times)
  return Math.max(1, Math.ceil((max - min) / 86_400_000) + 1)
}

/** Pick granularity so the chart has enough points to show variation without overcrowding. */
export function pickRevenueTrendBucket(
  invoices: { date: string }[],
  period: '7d' | '30d' | '90d' | '6m' | '1y' | 'all',
): RevenueTrendBucket {
  if (period === '7d' || period === '30d') return 'day'
  if (period === '90d' || period === '6m' || period === '1y') return 'week'
  const span = dateSpanDays(invoices)
  if (span <= 45) return 'day'
  if (span <= 400) return 'week'
  return 'month'
}

export function revenueTrendBucketDescription(bucket: RevenueTrendBucket): string {
  if (bucket === 'day') return 'Daily totals by invoice date (including days with $0)'
  if (bucket === 'week') return 'Weekly totals by invoice date (weeks with no invoices show $0)'
  return 'Monthly totals by invoice date'
}

export function buildRevenueTrendSeries(
  invoices: { date: string; total: number; paidBy: string; docKind?: string }[],
  bucket: RevenueTrendBucket,
): RevenueTrendPoint[] {
  const map = new Map<string, { t: number; c: number }>()
  for (const inv of invoices) {
    const k = bucketInvoiceDate(inv.date, bucket)
    if (!k) continue
    const row = map.get(k) ?? { t: 0, c: 0 }
    row.t += inv.total
    if (inv.paidBy !== 'pending' && inv.docKind !== 'memo') row.c += inv.total
    map.set(k, row)
  }

  const sorted = Array.from(map.keys()).sort()
  if (!sorted.length) return []

  const keys = enumerateBucketKeys(sorted[0], sorted[sorted.length - 1], bucket)

  return keys.map((k) => ({
    key: k,
    label: formatRevenueTrendLabel(k, bucket),
    totalBilled: Math.round(map.get(k)?.t ?? 0),
    collected: Math.round(map.get(k)?.c ?? 0),
  }))
}
