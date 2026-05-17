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
