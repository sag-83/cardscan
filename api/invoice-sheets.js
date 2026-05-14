export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const webhook =
    process.env.INVOICE_SHEETS_WEBHOOK_URL ||
    process.env.INVOICE_SHEETS_WEBHOOK

  if (!webhook) {
    return res.status(500).json({ error: 'Invoice Sheets webhook not configured — set INVOICE_SHEETS_WEBHOOK_URL in Vercel env vars' })
  }

  const rows = Array.isArray(req.body) ? req.body : []
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No invoice rows to send' })
  }

  const body = JSON.stringify(rows)

  const parseResult = (text) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return { ok: false, error: 'Empty response from Apps Script' }
    if (/<!doctype|<html|<script/i.test(trimmed)) {
      return { ok: false, error: 'Apps Script returned HTML — check webhook URL and deployment permissions.' }
    }
    try {
      const json = JSON.parse(trimmed)
      const ok =
        json.ok === true ||
        json.success === true ||
        String(json.status || '').toLowerCase() === 'success' ||
        String(json.result || '').toLowerCase() === 'success'
      if (ok) return { ok: true, sent: Number(json.sent ?? json.rows ?? rows.length) }
      return { ok: false, error: json.error || json.message || 'Apps Script did not return success' }
    } catch {
      const lowered = trimmed.toLowerCase()
      if (['ok', 'success', 'done', 'sent', 'saved'].includes(lowered) || lowered.startsWith('ok ') || lowered.startsWith('success') || lowered.startsWith('saved') || lowered.startsWith('sent')) {
        return { ok: true, sent: rows.length }
      }
      return { ok: false, error: `Unexpected Apps Script response: ${trimmed.slice(0, 160)}` }
    }
  }

  try {
    const r1 = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    })

    let text
    if (r1.status >= 300 && r1.status < 400) {
      const location = r1.headers.get('location')
      if (!location) return res.status(502).json({ error: 'Redirect with no location header' })
      const r2 = await fetch(location, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })
      text = await r2.text()
    } else {
      text = await r1.text()
    }

    const result = parseResult(text)
    if (!result.ok) return res.status(502).json({ error: result.error })
    res.status(200).json({ ok: true, sent: result.sent ?? rows.length })
  } catch (err) {
    res.status(502).json({ error: err?.message || String(err) })
  }
}
