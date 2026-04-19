# CardScan AI — React + TypeScript

A mobile-first business card scanner powered by Gemini AI. Rebuilt from a single HTML file into a proper full-stack React project.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript** | Component model, type safety |
| Build tool | **Vite** | Instant dev server, fast HMR |
| State | **Zustand** | Simple, no boilerplate, persists to localStorage |
| Styling | **Tailwind CSS + CSS variables** | Utility classes + theme-aware variables |
| Cloud | **Supabase** | Optional Postgres sync |
| AI | **Gemini 2.5 Flash** | OCR extraction via Google AI |

## Project Structure

```
src/
├── types/
│   └── contact.ts          # Contact interface, Screen type
├── store/
│   └── useStore.ts         # Zustand global store (contacts, settings, UI state)
├── lib/
│   ├── utils.ts            # Pure helpers: uid, norm, formatDate, initials…
│   ├── gemini.ts           # Gemini API calls + image resize
│   ├── supabase.ts         # DB client, CRUD, schema SQL
│   ├── vcard.ts            # .vcf download
│   └── export.ts           # CSV, Google Sheets, JSON backup/restore
├── hooks/
│   └── useTheme.ts         # Applies light/dark theme to <html>
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

1. Get a **free Gemini API key** at https://aistudio.google.com/apikey
2. Open the app → **Settings** → paste your key under "Gemini API Key"
3. (Optional) Set up Supabase for cloud sync:
   - Create a project at https://supabase.com
   - Run the SQL schema shown in Settings → "SQL" section
   - Add your project URL and anon key

## Supabase Schema

Run this once in your Supabase SQL Editor (also shown in-app under Settings):

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT, title TEXT, company TEXT, email TEXT,
  phone_mobile TEXT, phone_work TEXT, phone_fax TEXT,
  website TEXT, address TEXT, city TEXT,
  state TEXT, zip TEXT, country TEXT,
  notes TEXT, user_notes TEXT, back_notes TEXT,
  stars INT DEFAULT 0, scanned_at TEXT,
  front_image TEXT, back_image TEXT,
  front_image_url TEXT, back_image_url TEXT,
  sent_to_sheets BOOL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all" ON contacts FOR ALL USING (true) WITH CHECK (true);
```

> **Note:** Card images (base64) are stored locally only — they are stripped before Supabase sync since they can be several MB each.

## Build for Production

```bash
npm run build
# Output goes to dist/
```
