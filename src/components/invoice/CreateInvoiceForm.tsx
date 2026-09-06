import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Contact } from '../../types/contact'
import type { SavedInvoice } from '../../types/invoice'
import {
  blankInvoiceItem,
  buildSavedInvoice,
  buildSavedInvoiceUpdate,
  DIRECTION_OPTIONS,
  money,
  num,
  roundOffFromInvoice,
  rowTotal,
  savedItemToFormItem,
  SIZE_PREFIX_OPTIONS,
  type DocKind,
  type InvoiceDirection,
  type InvoiceFormItem,
  type PaidBy,
} from '../../lib/invoiceFormUtils'
import { dueDateLabel, normalizeTermsDays, PRE_DUE_DAYS, TERMS_PRESETS } from '../../lib/invoiceTerms'
import { dashboardInputClass, dashboardLabelClass } from '../../lib/dashboardStyles'
import { cn } from '../../lib/utils'

const inputClass = dashboardInputClass.replace('mt-1 ', '')
const labelClass = dashboardLabelClass.replace('block ', '') + ' !mt-0'

type Props = {
  contact: Contact
  initialInvoice?: SavedInvoice
  /** Existing invoices, used to pick the next number in the Sale/Purchase series. */
  existingInvoices?: SavedInvoice[]
  saving?: boolean
  submitLabel?: string
  onCancel: () => void
  onSubmit: (invoice: SavedInvoice) => void
}

function formStateFromInvoice(invoice: SavedInvoice) {
  return {
    docKind: invoice.docKind,
    direction: invoice.direction ?? 'sale',
    invoiceDate: invoice.date,
    paidBy: invoice.paidBy,
    termsDays: normalizeTermsDays(invoice.termsDays),
    notes: invoice.notes || '',
    shipping: invoice.shipping ? String(invoice.shipping) : '',
    roundOff: roundOffFromInvoice(invoice),
    items:
      invoice.items?.length > 0
        ? invoice.items.map(savedItemToFormItem)
        : [blankInvoiceItem()],
  }
}

export function CreateInvoiceForm({
  contact,
  initialInvoice,
  existingInvoices = [],
  saving = false,
  submitLabel = 'Save invoice',
  onCancel,
  onSubmit,
}: Props) {
  const [docKind, setDocKind] = useState<DocKind>(() => initialInvoice?.docKind ?? 'invoice')
  const [direction, setDirection] = useState<InvoiceDirection>(() => initialInvoice?.direction ?? 'sale')
  const [invoiceDate, setInvoiceDate] = useState(
    () => initialInvoice?.date ?? new Date().toISOString().slice(0, 10),
  )
  const [paidBy, setPaidBy] = useState<PaidBy>(() => initialInvoice?.paidBy ?? 'pending')
  const [termsDays, setTermsDays] = useState(() => normalizeTermsDays(initialInvoice?.termsDays))
  const [customTerms, setCustomTerms] = useState(() => {
    const days = normalizeTermsDays(initialInvoice?.termsDays)
    return days > 0 && !TERMS_PRESETS.includes(days)
  })
  const [notes, setNotes] = useState(() => initialInvoice?.notes ?? '')
  const [shipping, setShipping] = useState(() => (initialInvoice?.shipping ? String(initialInvoice.shipping) : ''))
  const [roundOff, setRoundOff] = useState(
    () => (initialInvoice ? roundOffFromInvoice(initialInvoice) : ''),
  )
  const [items, setItems] = useState<InvoiceFormItem[]>(() =>
    initialInvoice?.items?.length
      ? initialInvoice.items.map(savedItemToFormItem)
      : [blankInvoiceItem()],
  )

  useEffect(() => {
    if (initialInvoice) {
      const s = formStateFromInvoice(initialInvoice)
      setDocKind(s.docKind)
      setDirection(s.direction)
      setInvoiceDate(s.invoiceDate)
      setPaidBy(s.paidBy)
      setTermsDays(s.termsDays)
      setCustomTerms(s.termsDays > 0 && !TERMS_PRESETS.includes(s.termsDays))
      setNotes(s.notes)
      setShipping(s.shipping)
      setRoundOff(s.roundOff)
      setItems(s.items)
      return
    }
    setDocKind('invoice')
    setDirection('sale')
    setInvoiceDate(new Date().toISOString().slice(0, 10))
    setPaidBy('pending')
    setTermsDays(0)
    setCustomTerms(false)
    setNotes('')
    setShipping('')
    setRoundOff('')
    setItems([blankInvoiceItem()])
  }, [contact.id, initialInvoice?.id])

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + rowTotal(item), 0), [items])
  const shippingAmount = num(shipping)
  const finalTotal = subtotal + shippingAmount + num(roundOff)

  const customer = contact.company || contact.name || 'Customer'
  const customerAddress = [contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')

  const updateItem = (id: string, patch: Partial<InvoiceFormItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)))
  }

  const dueLabel = useMemo(
    () => dueDateLabel({ date: invoiceDate, termsDays }),
    [invoiceDate, termsDays],
  )

  const handleSubmit = () => {
    if (finalTotal <= 0) return
    const input = { docKind, direction, invoiceDate, paidBy, termsDays, notes, items, shipping, roundOff }
    const invoice = initialInvoice
      ? buildSavedInvoiceUpdate(contact, initialInvoice, input)
      : buildSavedInvoice(contact, input, existingInvoices)
    onSubmit(invoice)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className={labelClass}>Customer</p>
        <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{customer}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{customerAddress || 'No address'}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Type</span>
          <select
            value={docKind}
            onChange={(e) => setDocKind(e.target.value as DocKind)}
            className={cn(inputClass, 'mt-1')}
          >
            <option value="invoice">Invoice</option>
            <option value="memo">Memo</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Date</span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={cn(inputClass, 'mt-1')}
          />
        </label>
        <label className="block col-span-2 sm:col-span-1">
          <span className={labelClass}>Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as InvoiceDirection)}
            className={cn(inputClass, 'mt-1')}
          >
            {DIRECTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      {docKind === 'invoice' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Paid by</span>
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value as PaidBy)}
                className={cn(inputClass, 'mt-1')}
              >
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="pending">Payment pending</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Terms (days)</span>
              <select
                value={customTerms ? 'custom' : String(termsDays)}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setCustomTerms(true)
                    return
                  }
                  setCustomTerms(false)
                  setTermsDays(Number(e.target.value))
                }}
                className={cn(inputClass, 'mt-1')}
              >
                <option value="0">COD</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="custom">Custom…</option>
              </select>
            </label>
          </div>

          {customTerms && (
            <label className="block">
              <span className={labelClass}>Custom terms (days)</span>
              <input
                value={termsDays || ''}
                onChange={(e) => setTermsDays(normalizeTermsDays(e.target.value.replace(/[^\d]/g, '')))}
                placeholder="e.g. 45"
                inputMode="numeric"
                className={cn(inputClass, 'mt-1')}
              />
            </label>
          )}

          {dueLabel && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Payment due {dueLabel}
              {paidBy === 'pending'
                ? ` · reminder ${PRE_DUE_DAYS} days before and on the due date`
                : ' · no reminder (already marked paid)'}
            </p>
          )}
        </div>
      )}

      <div>
        <p className={cn(labelClass, 'mb-2')}>Lines</p>
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/50"
            >
              <div className="grid grid-cols-12 gap-2">
                <select
                  value={item.prefix}
                  onChange={(e) => updateItem(item.id, { prefix: e.target.value as InvoiceFormItem['prefix'] })}
                  className={cn(inputClass, 'col-span-3')}
                >
                  {SIZE_PREFIX_OPTIONS.map((opt) => (
                    <option key={opt.value || 'empty'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <input
                  value={item.size}
                  onChange={(e) => updateItem(item.id, { size: e.target.value })}
                  placeholder="Size (e.g. 1.25VS)"
                  className={cn(inputClass, 'col-span-6')}
                />
                <input
                  value={item.pcs}
                  onChange={(e) => updateItem(item.id, { pcs: e.target.value.replace(/[^\d]/g, '') })}
                  placeholder="Pcs"
                  inputMode="numeric"
                  className={cn(inputClass, 'col-span-3')}
                />
              </div>
              <div className="mt-2 grid grid-cols-12 gap-2">
                <input
                  value={item.ct}
                  onChange={(e) => updateItem(item.id, { ct: e.target.value })}
                  placeholder="Ct"
                  inputMode="decimal"
                  className={cn(inputClass, 'col-span-3')}
                />
                <input
                  value={item.pct}
                  onChange={(e) => updateItem(item.id, { pct: e.target.value })}
                  placeholder="P/Ct"
                  inputMode="decimal"
                  className={cn(inputClass, 'col-span-3')}
                />
                <input
                  value={item.amount}
                  onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                  placeholder="Amount"
                  inputMode="decimal"
                  className={cn(inputClass, 'col-span-5')}
                />
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="col-span-1 flex items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-500 dark:border-slate-700"
                  aria-label="Remove line"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1.5 text-right text-xs text-slate-400">Line total: {money(rowTotal(item))}</p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, blankInvoiceItem()])}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400"
        >
          <Plus className="size-3.5" aria-hidden />
          Add line
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <label className="block w-28">
          <span className={labelClass}>Shipping</span>
          <input
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className={cn(inputClass, 'mt-1')}
          />
        </label>
        <label className="block w-36">
          <span className={labelClass}>Round off</span>
          <input
            value={roundOff}
            onChange={(e) => setRoundOff(e.target.value)}
            placeholder="+/- 0.00"
            inputMode="decimal"
            className={cn(inputClass, 'mt-1')}
          />
          <span className="mt-1 block text-xs text-slate-400">Manual adjustment</span>
        </label>
        <div className="ml-auto self-center text-right">
          <span className={labelClass}>Grand total</span>
          <p className="text-lg font-extrabold text-slate-900 dark:text-white">{money(finalTotal)}</p>
        </div>
      </div>

      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Payment terms or notes"
          className={cn(inputClass, 'mt-1 resize-y')}
        />
      </label>

      <div className="flex items-center gap-2 pt-1">
        <span className="mr-auto text-sm font-bold text-slate-500 dark:text-slate-400">
          Grand total {money(finalTotal)}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || finalTotal <= 0}
          onClick={handleSubmit}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
