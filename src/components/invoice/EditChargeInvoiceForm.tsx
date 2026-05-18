import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Contact } from '../../types/contact'
import type { ChargeInvoice } from '../../types/chargeAccount'
import { uid } from '../../lib/invoiceFormUtils'
import { money } from '../../lib/invoiceFormUtils'
import { dashboardInputClass, dashboardLabelClass } from '../../lib/dashboardStyles'
import { cn } from '../../lib/utils'

const inputClass = dashboardInputClass.replace('mt-1 ', '')
const labelClass = dashboardLabelClass.replace('block ', '') + ' !mt-0'

type LineRow = {
  id: string
  item_name: string
  quantity: string
  unit_price: string
}

function blankLine(): LineRow {
  return { id: uid(), item_name: '', quantity: '1', unit_price: '' }
}

function num(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

type Props = {
  contact: Contact
  invoice: ChargeInvoice
  saving?: boolean
  onCancel: () => void
  onSubmit: (payload: {
    date: string
    note: string
    items: { item_name: string; quantity: number; unit_price: number }[]
  }) => void
}

export function EditChargeInvoiceForm({ contact, invoice, saving = false, onCancel, onSubmit }: Props) {
  const [invoiceDate, setInvoiceDate] = useState(invoice.date)
  const [note, setNote] = useState(invoice.note || '')
  const [lines, setLines] = useState<LineRow[]>(() =>
    invoice.items?.length
      ? invoice.items.map((it) => ({
          id: it.id,
          item_name: it.item_name,
          quantity: String(it.quantity),
          unit_price: String(it.unit_price),
        }))
      : [blankLine()],
  )

  useEffect(() => {
    setInvoiceDate(invoice.date)
    setNote(invoice.note || '')
    setLines(
      invoice.items?.length
        ? invoice.items.map((it) => ({
            id: it.id,
            item_name: it.item_name,
            quantity: String(it.quantity),
            unit_price: String(it.unit_price),
          }))
        : [blankLine()],
    )
  }, [invoice.id])

  const total = useMemo(
    () => lines.reduce((sum, row) => sum + num(row.quantity) * num(row.unit_price), 0),
    [lines],
  )

  const customer = contact.company || contact.name || 'Customer'

  const updateLine = (id: string, patch: Partial<LineRow>) => {
    setLines((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const handleSubmit = () => {
    const items = lines
      .filter((r) => r.item_name.trim())
      .map((r) => ({
        item_name: r.item_name.trim(),
        quantity: num(r.quantity) || 1,
        unit_price: num(r.unit_price),
      }))
    if (!items.length && total <= 0) return
    onSubmit({
      date: invoiceDate,
      note,
      items: items.length ? items : [{ item_name: 'Line item', quantity: 1, unit_price: total }],
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className={labelClass}>Customer</p>
        <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{customer}</p>
      </div>

      <label className="block">
        <span className={labelClass}>Date</span>
        <input
          type="date"
          value={invoiceDate}
          onChange={(e) => setInvoiceDate(e.target.value)}
          className={cn(inputClass, 'mt-1')}
        />
      </label>

      <div>
        <p className={cn(labelClass, 'mb-2')}>Line items</p>
        <div className="space-y-3">
          {lines.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            >
              <input
                value={row.item_name}
                onChange={(e) => updateLine(row.id, { item_name: e.target.value })}
                placeholder="Description"
                className={cn(inputClass, 'mb-2 w-full')}
              />
              <div className="grid grid-cols-12 gap-2">
                <input
                  value={row.quantity}
                  onChange={(e) => updateLine(row.id, { quantity: e.target.value.replace(/[^\d.]/g, '') })}
                  placeholder="Qty"
                  inputMode="decimal"
                  className={cn(inputClass, 'col-span-4')}
                />
                <input
                  value={row.unit_price}
                  onChange={(e) => updateLine(row.id, { unit_price: e.target.value })}
                  placeholder="Unit price"
                  inputMode="decimal"
                  className={cn(inputClass, 'col-span-7')}
                />
                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== row.id)))
                  }
                  className="col-span-1 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-500 dark:border-slate-700"
                  aria-label="Remove line"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1.5 text-right text-xs text-slate-400">
                Line total: {money(num(row.quantity) * num(row.unit_price))}
              </p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, blankLine()])}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400"
        >
          <Plus className="size-3.5" aria-hidden />
          Add line
        </button>
      </div>

      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={cn(inputClass, 'mt-1 resize-y w-full')}
        />
      </label>

      <p className="text-right text-lg font-extrabold text-slate-900 dark:text-white">
        Total: {money(total)}
      </p>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || total <= 0}
          onClick={handleSubmit}
          className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
