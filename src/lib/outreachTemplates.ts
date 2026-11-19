/** Editable bulk + call scripts — last edit wins, survives refresh. */

const EMAIL_SUBJECT_KEY = 'cs_bulk_email_subject_v1'
const EMAIL_BODY_KEY = 'cs_bulk_email_body_v1'
const SMS_BODY_KEY = 'cs_bulk_sms_body_v1'
/** v2 seeds the holiday LI pitch once; later edits still persist here. */
const CALL_SCRIPT_KEY = 'cs_call_script_v2'

export const DEFAULT_EMAIL_SUBJECT = 'AK Gems · Holiday collection follow-up'

export const DEFAULT_EMAIL_BODY = `Hi,

This is SG from AK Gems, the New York jewelry wholesaler that visited your store a while back. I'm following up on my call today.

We have some great holiday pieces at price points that sell fast. Our holiday brochure is attached so you can get a feel for what we carry.

We'll be visiting stores in your area over the coming weeks. Would you be open to scheduling a time for us to stop by and show you the collection in person? Just reply with a day that works, or call me at (862) 235-9224.

Best,
SG
AK Gems Inc · New York
(862) 235-9224 · akgemsinc.com`

export const DEFAULT_SMS_BODY = `Hi, this is SG from AK Gems (NY jewelry wholesaler). Following up on my call — we have holiday pieces at price points that sell fast. Brochure attached. Visiting your area soon — reply with a day that works, or call (862) 235-9224.`

export const DEFAULT_CALL_SCRIPT = `Hi [name], it's SG from AK Gems, the New York jewelry wholesaler that visited your store a while back.

I'm calling because we have some great holiday pieces at price points that sell fast. We're visiting stores on Long Island next week. So we wanted for a quick visit to show you the collection?`

function read(key: string, fallback: string): string {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null && stored.trim()) return stored
  } catch {
    /* private mode */
  }
  return fallback
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export function loadBulkEmailSubject(): string {
  return read(EMAIL_SUBJECT_KEY, DEFAULT_EMAIL_SUBJECT)
}

export function saveBulkEmailSubject(value: string) {
  write(EMAIL_SUBJECT_KEY, value)
}

export function loadBulkEmailBody(): string {
  return read(EMAIL_BODY_KEY, DEFAULT_EMAIL_BODY)
}

export function saveBulkEmailBody(value: string) {
  write(EMAIL_BODY_KEY, value)
}

export function loadBulkSmsBody(): string {
  return read(SMS_BODY_KEY, DEFAULT_SMS_BODY)
}

export function saveBulkSmsBody(value: string) {
  write(SMS_BODY_KEY, value)
}

export function loadCallScript(): string {
  return read(CALL_SCRIPT_KEY, DEFAULT_CALL_SCRIPT)
}

export function saveCallScript(value: string) {
  write(CALL_SCRIPT_KEY, value)
}
