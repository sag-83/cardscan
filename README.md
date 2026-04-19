# CardScan AI — React + TypeScript

A mobile-first business card scanner powered by Gemini AI. The public-demo-safe version uses Vercel API routes for OCR and Google Sheets export, plus Supabase auth + RLS for per-user data isolation.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript** | Component model, type safety |
| Build tool | **Vite** | Instant dev server, fast HMR |
| State | **Zustand** | Simple client state; only theme persists locally |
| Styling | **Tailwind CSS + CSS variables** | Utility classes + theme-aware variables |
| Cloud | **Supabase** | Optional Postgres sync |
| AI | **Gemini 2.5 Flash** | OCR extraction via Google AI |
| Server | **Vercel API Routes** | Keeps Gemini and Sheets secrets off the client |

## Project Structure

```
src/
├── types/
│   └── contact.ts          # Contact interface, Screen type
├── store/
│   └── useStore.ts         # Zustand global store (contacts, settings, UI state)
├── lib/
│   ├── utils.ts            # Pure helpers: uid, norm, formatDate, initials…
│   ├── gemini.ts           # Client -> /api/scan wrapper + image resize
│   ├── supabase.ts         # Auth-aware DB/storage client + secure schema SQL
│   ├── vcard.ts            # .vcf download
│   └── export.ts           # CSV, JSON backup/restore, /api/sheets wrapper
├── hooks/
│   └── useTheme.ts         # Applies light/dark theme to <html>
├── api/
│   ├── scan.js             # Server-side Gemini OCR + auth + rate limit
│   ├── sheets.js           # Server-side Sheets export + auth + rate limit
│   └── _shared.js          # Shared auth/rate-limit helpers
└── components/
    ├── Header.tsx           # Sticky top bar
    ├── NavBar.tsx           # Fixed bottom nav
    ├── Toast.tsx            # Global notification
    ├── ContactDetail.tsx    # Full-screen contact view
    ├── screens/
    │   ├── ScanScreen.tsx   # Camera → Gemini → preview → save
    │   ├── ContactsScreen.tsx  # Searchable, filterable list
    │   ├── BulkScreen.tsx   # CSV, Sheets, bulk message, delete
    │   └── SettingsScreen.tsx  # API key, Supabase, theme, backup
    └── modals/
        ├── EditModal.tsx        # Add / edit contact bottom sheet
        ├── ContactMenuModal.tsx # Context menu (view, edit, scan back, delete)
        └── BulkMessageModal.tsx # Compose bulk email or SMS
```

## Getting Started

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## First-time Setup

1. Copy `.env.example` into an untracked local env file.
2. Add client-safe Supabase values:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Add server-only values in Vercel or your local server env:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY` (and optional fallback keys)
   - `SHEETS_WEBHOOK_URL`
4. Create a Supabase project and apply the SQL shown in Settings.
5. Start a secure demo session from the app before scanning.

## Supabase Schema

Run the secure SQL shown in-app under Settings. It adds:

- `user_id` ownership on every contact row
- Row Level Security for select/insert/update/delete
- Private Supabase storage bucket policies for card photos
- Per-user storage paths and signed URL access

## Public Demo Checklist

- Keep Gemini and Google Sheets secrets in server-only env vars.
- Rotate any keys that were previously committed or bundled.
- Apply the secure Supabase SQL before deploying.
- Remove old `dist/` artifacts from git and rebuild after secrets are rotated.
- Deploy with Vercel so `/api/scan` and `/api/sheets` are available.

## Build for Production

```bash
npm run build
# Output goes to dist/
```
