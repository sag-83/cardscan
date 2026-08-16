// Shared sizing/quality knobs for card photos, used by both the scan flow
// (ScanScreen) and the Settings backfill tools, so the two never drift out
// of sync on what "small enough" means.
//
// Nothing in the app ever displays a card photo taller than ~180px
// (ContactDetail's CardImage caps at maxHeight: 180), so there is no
// accuracy reason to store or serve anything near OCR resolution.

/** What gets stored/uploaded/cached as the "full" card photo, post-OCR. */
export const STORE_MAX_WIDTH = 900
export const STORE_QUALITY = 0.72

/** Tiny copy used only for contact-list row thumbnails. */
export const THUMB_MAX_WIDTH = 280
export const THUMB_QUALITY = 0.6
