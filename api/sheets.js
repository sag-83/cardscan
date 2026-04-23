export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Accept either env var name (SHEETS_WEBHOOK or VITE_SHEETS_WEBHOOK)
  const webhook = process.env.SHEETS_WEBHOOK || process.env.VITE_SHEETS_WEBHOOK
  if (!webhook) return res.status(500).json({ error: 'Sheets webhook not configured — set SHEETS_WEBHOOK in Vercel env vars' })

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

    // Apps Script redirects POST → must follow manually to keep POST method
    const r1 = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
      redirect: 'manual',
    })

    let text
    if (r1.status >= 300 && r1.status < 400) {
      // Follow redirect as POST so the body reaches doPost(e)
      const location = r1.headers.get('location')
      if (!location) return res.status(502).json({ error: 'Redirect with no location' })
      const r2 = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
      })
      text = await r2.text()
    } else {
      text = await r1.text()
    }

    // Apps Script returns "Error: ..." with a 200 status when doPost throws
    if (text.toLowerCase().startsWith('error')) {
      return res.status(502).json({ error: text })
    }

    res.status(200).send(text)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
}
