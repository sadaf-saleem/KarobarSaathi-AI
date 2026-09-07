# KarobarSaathi AI

**Apna Hisaab Samjho. Apna Karobar Barhao.**

AI-powered financial inclusion assistant for small shopkeepers and home-based businesses in Pakistan. Scan receipts, record transactions by voice or manual entry, and get data-driven business insights — all in English, Roman Urdu, or Urdu.

## Problem

Over 4 million small businesses in Pakistan — dukandars, home-based sellers, street vendors — manage their finances on paper. Sales, expenses, and profit are tracked mentally or in notebooks. Receipts pile up unread. There is no affordable, accessible digital tool designed for low-literacy users who may not read English fluently or type on a keyboard.

## Solution

KarobarSaathi AI brings digital bookkeeping to these businesses through the interfaces they already use:

- **Photo** — Point your phone at a receipt. OCR and AI extract vendor, date, items, total, and category automatically.
- **Multi-receipt-in-one-photo** — Photograph a single page containing multiple separate receipts. The app detects each one and extracts them independently, presenting each as its own reviewable card.
- **Voice** — Speak a transaction in Roman Urdu or English. The app transcribes, classifies (Sale or Expense), and extracts the amount.
- **Manual** — Type a transaction when no receipt is available.

Every transaction is stored locally and feeds a real-time dashboard with Sales, Expenses, Profit, and interactive charts. Business Insights are calculated from your actual data — no fabricated statistics.

## Key Features

- **Multi-engine OCR pipeline** — Tesseract.js + Windows.Media.Ocr with 5 threshold variants, rotation rescue, line-by-line ensemble analysis, and fuzzy label matching
- **Multi-receipt per image** — Detects and extracts multiple physically separate receipts from a single photo, each reviewed and saved as its own transaction
- **AI Vision fallback** — Google Gemini, OpenAI GPT-4o, or Groq (Qwen vision models) for handwritten or low-quality receipts that local OCR cannot read
- **Voice input** — Browser speech recognition with Sale/Expense classification and amount extraction (English + Roman Urdu)
- **Editable categories** — AI suggests a category; user can change it from a dropdown before saving
- **Sale/Expense classification** — Every receipt, voice entry, and manual entry is independently classified
- **Dashboard** — Total Sales, Total Expenses, Estimated Profit, transaction count, Sales vs Expenses bar chart, Expense category pie chart
- **Business Insights** — Data-driven statements about profit/loss, top expense category, average sale, and monthly trends
- **Three-language support** — English, Roman Urdu, and Urdu with full RTL layout
- **Demo data** — Pre-seeded sample transactions so judges and new users can explore immediately

## How It Works

### Receipt Scan (single photo, may contain multiple receipts)
```
Upload image → Preprocess (resize, grayscale, contrast, threshold variants)
→ Full-page OCR (Tesseract.js) + Windows OCR in parallel
→ Fast parse: if high confidence AND no signs of a second receipt → return result immediately
→ Otherwise: line-by-line ensemble analysis across threshold variants
→ If still unreliable: AI Vision fallback (Gemini/OpenAI/Groq) for a single-receipt read
→ Always followed by a multi-receipt check (Gemini/Groq) — a confident single-receipt
  read never rules out a second or third receipt in the same photo
→ If multiple receipts are found: each is extracted and reviewed independently
→ User reviews, edits, confirms Sale/Expense → Save → Dashboard updates
```

### Voice Entry
```
Click mic → Browser speech recognition → Transcript
→ Client-side parser: classify Sale/Expense, extract amounts, build description
→ User reviews, selects category, corrects fields → Save → Dashboard updates
```

### Manual Entry
```
Select Sale/Expense → Fill date, category, amount, vendor, items
→ Save → Dashboard updates
```

## Tech Stack

| Layer       | Technology                                  |
|-------------|---------------------------------------------|
| Frontend    | React 18, Vite 5, Tailwind CSS 3           |
| Charts      | Recharts                                    |
| Routing     | React Router v6                             |
| Backend     | Express.js 4                                |
| Database    | SQLite (better-sqlite3, WAL mode)           |
| File Upload | Multer                                      |
| OCR (local) | Tesseract.js 5 (English, LSTM engine)      |
| OCR (alt)   | Windows.Media.Ocr (handwriting, Windows only)|
| Imaging     | Jimp (preprocessing, region cropping)       |
| AI Vision   | Google Gemini 3.5 Flash / OpenAI GPT-4o / Groq (Qwen vision) |
| IDs         | uuid v10                                    |

## Project Structure

```
KarobarSaathi AI/
├── server/
│   ├── server.js          # Express API server (routes, database, seed data, insights)
│   ├── ai-service.js      # Multi-engine OCR pipeline + AI Vision + multi-receipt detection
│   └── winocr.ps1         # Windows.Media.Ocr bridge (optional second engine)
├── src/
│   ├── main.jsx           # React entry point
│   ├── App.jsx            # Router configuration
│   ├── index.css          # Tailwind + custom component styles
│   ├── i18n/
│   │   ├── translations.js    # All UI strings (en, roman, ur)
│   │   └── LanguageContext.jsx # Language state + RTL management
│   ├── lib/
│   │   └── api.js         # Frontend API client (receipt processing, timeout handling)
│   ├── components/
│   │   ├── Layout.jsx         # App shell with Navbar
│   │   ├── Navbar.jsx         # Responsive navigation
│   │   ├── LanguageSwitcher.jsx
│   │   ├── Charts.jsx         # Sales vs Expenses bar + Expense pie chart
│   │   └── TransactionCard.jsx # Transaction items + Stat cards
│   └── pages/
│       ├── Landing.jsx        # Landing/home page with demo data indicator
│       ├── Dashboard.jsx      # Business dashboard with charts
│       ├── ReceiptScan.jsx    # Receipt upload → OCR/AI → review (single or multi-receipt) → save
│       ├── Transactions.jsx   # Transaction history + inline edit/delete
│       ├── ManualEntry.jsx    # Manual transaction entry form
│       ├── VoiceEntry.jsx     # Voice-based transaction entry
│       └── Insights.jsx       # Data-driven business insights
├── data/                  # SQLite database (auto-created)
├── uploads/               # Receipt images (auto-created)
├── public/
│   └── favicon.svg
├── index.html             # Vite HTML entry point
├── package.json
├── postcss.config.js
├── vite.config.js
├── tailwind.config.js
└── .env.example
```

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable            | Default           | Description                                           |
|---------------------|-------------------|-------------------------------------------------------|
| `PORT`              | `3001`            | Server port                                           |
| `AI_PROVIDER`       | `ocr`             | `ocr` (local only), `openai`, `google`, or `groq`     |
| `OPENAI_API_KEY`    | —                 | OpenAI key (when `AI_PROVIDER=openai`)                |
| `OPENAI_MODEL`      | `gpt-4o`          | Optional model override for OpenAI                    |
| `GOOGLE_AI_API_KEY` | —                 | Gemini key (when `AI_PROVIDER=google`)                |
| `GEMINI_MODEL`      | `gemini-3.5-flash`| Optional model override (auto-fallback to alternate on 503) |
| `GROQ_API_KEY`      | —                 | Groq key (when `AI_PROVIDER=groq`)                    |
| `GROQ_MODEL`        | `qwen/qwen3.8-27b`| Optional vision model override (auto-fallback to `qwen/qwen3.6-27b`) |

## Receipt Processing

### Smart Staged Pipeline

Receipt extraction uses a multilingual OCR-first pipeline with quality-based AI Vision fallback:

0. **Image-level script detection** — The raw image file is scanned for embedded Urdu/Arabic Unicode text (EXIF/XMP metadata). If Urdu script is detected and a cloud AI provider is configured, the entire local OCR pipeline is skipped and the image is sent directly to AI Vision — English-only Tesseract cannot read Urdu script.
1. **Preprocessing** — resize to 1600px height, grayscale, contrast normalization, background cropping, 5 adaptive threshold variants, ruling-line removal.
2. **Full-page OCR** — Tesseract.js with block segmentation (PSM 6). Windows.Media.Ocr runs in parallel as a second opinion.
3. **Fast parse** — If OCR confidence ≥ 75% with valid total, vendor, date, and items, **and** the raw text shows no signs of a second receipt (e.g. no repeated "Total" line) → return result immediately (no further processing).
4. **Rotation rescue** — If very low text yield, test 90°/180°/270° rotations.
5. **Additional PSM modes** — Auto and sparse text modes for hard pages.
6. **Ensemble analysis** — Line-by-line re-OCR across threshold variants with early agreement stop, vendor region analysis, fuzzy label matching, digit-confusion correction, and Pakistani currency format parsing.
7. **Quality evaluation** — The extraction is checked for field completeness and confidence. If items are missing or flagged low-confidence, or if fewer than 3 of 4 critical fields (vendor, date, total, items) are confidently extracted, the result is considered unreliable.
8. **AI Vision fallback (single-receipt read)** — When local OCR extraction quality is insufficient, the **original receipt image** is sent to Gemini, GPT-4o, or Groq for cloud-based analysis. The AI receives the full image (not just OCR text) and independently extracts all fields. Supports English, Urdu script, Roman Urdu, and mixed-language receipts.
9. **Multi-receipt detection** — Always attempted next (via Gemini or Groq, whichever is configured) unless the OCR-only fast parse in step 3 already returned. This includes cases where step 8's single-receipt AI Vision call succeeded confidently — that call's prompt only ever looks for one receipt, so its confidence alone is never treated as proof the photo contains just one. If the image contains multiple separate receipts, each is extracted independently.
10. **Safety net** — If all critical fields remain empty after all pipeline stages, a final AI Vision attempt is made with the single-receipt prompt to ensure no receipt is returned completely unread when AI is available.

### Accuracy Guarantees

- Fields that cannot be read confidently are left **empty and flagged** for user review
- No values are fabricated — handwritten fields the OCR cannot read are honestly reported as missing
- Totals are validated against the sum of line items; mismatches are flagged as low-confidence
- When items cannot be extracted, the total is also flagged as unvalidated
- **AI Vision fallback triggers on extraction quality**, not just OCR confidence percentage — if critical fields are missing or unreliable, the original image is sent to AI Vision for re-extraction
- **A confident single-receipt AI Vision result never skips multi-receipt detection** — since that call's prompt only looks for one receipt, a second or third receipt in the same photo is always separately checked for
- The user always reviews and confirms data before saving

### Multilingual Receipt Support

The receipt extraction pipeline supports receipts in multiple languages:

- **English** — fully supported via local OCR and AI Vision
- **Roman Urdu** (Urdu in Latin script) — local OCR reads the Latin characters; the parser recognizes common Roman Urdu business terms such as *kul* (total), *jama* (total/collection), *tareekh* (date), *naqad* (cash), *udhaar* (credit), *bikri/becha* (sale), *kharcha/khareeda* (expense), and *dukan/dukaan* (shop). When local OCR produces weak or incomplete extraction, the receipt is automatically routed to AI Vision
- **Urdu script** — automatically detected via image metadata scanning and OCR output analysis, then routed to AI Vision (Gemini/OpenAI/Groq), which handles Urdu natively. When Urdu script is detected in the image file itself, local OCR is skipped entirely to save processing time. Local Tesseract OCR does not support Urdu script directly
- **Mixed language** — receipts containing both English/Roman Urdu and Urdu script are handled via the combined OCR + AI Vision pipeline

KarobarSaathi AI supports multilingual receipt extraction using local OCR with AI Vision fallback. When local OCR is uncertain or important fields cannot be reliably extracted, the original receipt image is processed using AI Vision and the extracted data is presented for user review.

The receipt language is independent of the application UI language — a user with the English UI can scan an Urdu receipt, and vice versa. Extracted data preserves the original receipt wording; no translation is performed. Uncertain fields are always flagged for user review.

## Data & Insights

All dashboard metrics and insights are calculated from recorded transactions in the SQLite database:

- **Total Sales** = sum of all Sale transactions
- **Total Expenses** = sum of all Expense transactions
- **Estimated Profit** = Total Sales − Total Expenses
- **Charts** — Monthly Sales vs Expenses (bar), Expense categories (pie)
- **Insights** — Profit/loss status, top expense category, average sale amount, monthly trends

No hardcoded numbers. No fabricated statistics. If there is insufficient data, the app says so.

## API Endpoints

| Method | Endpoint               | Description                          |
|--------|------------------------|--------------------------------------|
| GET    | `/api/dashboard`       | Dashboard metrics + chart data       |
| GET    | `/api/transactions`    | List transactions (filterable)       |
| GET    | `/api/transactions/:id`| Get single transaction               |
| POST   | `/api/transactions`    | Create transaction                   |
| PUT    | `/api/transactions/:id`| Update transaction                   |
| DELETE | `/api/transactions/:id`| Delete transaction                   |
| POST   | `/api/receipt/process` | Upload + process a receipt image (may return one receipt or several, if the photo contains multiple) |
| GET    | `/api/insights`        | Data-driven business insights        |
| GET    | `/api/categories`      | Available transaction categories     |
| POST   | `/api/seed`            | Re-seed demo data                    |

## Installation

```bash
# Clone the repository
git clone https://github.com/sadaf-saleem/KarobarSaathi-AI.git
cd KarobarSaathi-AI

# Install dependencies
npm install

# Set up environment variables (see Environment Variables section above)
# Local OCR works out of the box — API keys are optional
```

## Running Locally

```bash
# Start both backend and frontend concurrently
npm run dev
```

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3001/api
- **Landing page:** http://localhost:5173/

Demo data is automatically seeded on first run (~30 days of realistic Pakistani small-business transactions).

### Production Build

```bash
npm run build
npm start
```

This serves the built frontend from the Express server on port 3001.

### Troubleshooting

- **`invalid ELF header` / native module errors** (e.g. from `better-sqlite3`) — this means `node_modules` was installed on a different OS/architecture than the one you're running on. Fix with:
  ```bash
  npm rebuild better-sqlite3
  ```
  or, if that doesn't resolve it, delete `node_modules` and reinstall: `rm -rf node_modules && npm install`.
- **Rollup / Vite build errors about a missing `@rollup/rollup-*` package** — same cause as above (npm's optional-dependency resolution can miss the platform-specific binary). Fix with `npm install` again, or install the specific package named in the error.
- **`EADDRINUSE: address already in use :::3001`** — a previous server process is still running and holding the port. Find and stop it:
  ```bash
  netstat -ano | findstr :3001      # Windows — note the PID in the last column
  taskkill /PID <that-PID> /F       # Windows
  # or on macOS/Linux:
  lsof -ti:3001 | xargs kill -9
  ```
  Then run `npm run dev` again.

## Demo

For judges and new users:

1. **Landing page** → Note the "Demo" badge and sample data indicator
2. **Dashboard** → Explore Total Sales, Expenses, Profit, and interactive charts
3. **Language switch** → Switch to Roman Urdu or Urdu (with RTL layout)
4. **Scan Receipt** → Upload any receipt image → Watch OCR extraction → Edit fields → Save
5. **Multi-receipt photo** → Upload a single photo containing 2–3 separate receipts → each is detected and shown as its own reviewable card → Save All (each is saved as a separate transaction)
6. **Dashboard** → Verify the saved transaction(s) appear in updated totals
7. **Insights** → See data-driven insights calculated from your transactions
8. **Voice Entry** → Click the mic, speak a transaction (e.g., "Aaj 5000 ki sale hui") → Review → Save
9. **Manual Entry** → Add a transaction without a receipt
10. **Transactions** → View, filter, edit, or delete any transaction

## Limitations

- **OCR accuracy** — Heavily cursive handwriting or very blurry images may not be readable by local OCR. When local OCR extraction quality is insufficient (missing items, unreliable totals, or too few confident fields), the AI Vision fallback (Gemini/OpenAI/Groq) processes the original image. A cloud AI provider must be configured for this fallback.
- **Urdu script receipts** — Local OCR does not support Urdu script directly; these receipts are automatically detected and routed to AI Vision. Handwritten Urdu may still have lower accuracy. A cloud AI provider must be configured for Urdu receipt support.
- **AI provider quotas** — Free tiers differ by provider: Gemini and OpenAI enforce daily request limits, while Groq's free (`on_demand`) tier enforces a low output-tokens-per-minute (OTPM) cap — large or back-to-back requests can be rejected until the next minute. When a quota or rate limit is hit, AI Vision calls fail and the system falls back to local OCR results with fields flagged for manual review. For production use, a paid API plan is recommended.
- **Roman Urdu vocabulary** — The parser covers common receipt terms but may miss uncommon or regional vocabulary. Weak Roman Urdu OCR results are automatically routed to AI Vision when available.
- **Voice input** — Uses the Web Speech API, which requires Chrome/Edge and an internet connection for speech recognition.
- **Authentication** — No user accounts. Suitable for single-device use. Add auth for production deployment.
- **Database** — SQLite is local-only. Migrate to PostgreSQL for multi-user or cloud deployment.
- **Offline** — No PWA support yet. The app requires a running server.

## Future Improvements

- PWA/offline support for users with intermittent connectivity
- Multi-user authentication and cloud sync
- Receipt image cropping UI before OCR (manual region selection)
- Export transactions to CSV/PDF
- SMS-based transaction entry for feature phones
- Integration with Pakistani tax reporting formats

## License

MIT — Built for hackathon demonstration.