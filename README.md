# VERIMERGE — Multi-Source Ingestion & Verifiable Document Synthesis

> **HackFest 2026 Production Edition**  
> Evidence-based document synthesis platform. Solves the challenge of multi-source document ingestion by extracting factual claims, matching verbatim source spans, exposing cross-document contradictions, and generating audit-ready synthesized documents with clickable citations.

---

## 1. Problem & Mission

In enterprise operations, legal diligence, technical research, and intelligence gathering, teams receive multiple overlapping, duplicate, or conflicting documents. Traditional AI summarizers hallucinate facts, blend contradictory budgets, and invent non-existent citations.

**Verimerge** solves this with an **8-stage deterministic verification pipeline**:

```
INGEST ──► EXTRACT ──► NORMALIZE ──► RESOLVE ──► VERIFY ──► SECURE ──► COMPOSE ──► EXPORT
```

- **Ingest**: Multi-file drag-and-drop supporting 11+ document formats with SHA-256 hash deduplication.
- **Extract**: Format-aware text extraction for PDF, DOCX, XLSX rows, CSV, Markdown, Text, Logs, JSON, XML, HTML, and Images (Tesseract OCR).
- **Normalize**: Standardizes entities, dates (e.g. `Q4 2026`), currency figures (e.g. `$4.2M`), and metrics.
- **Resolve**: Clusters references without destructive automatic merging.
- **Verify**: Verifies that every cited excerpt exists verbatim in extracted text. Prevents false "Verified" status on unverified claims.
- **Secure**: Per-user workspace isolation and `Internal` / `Restricted` security classifications.
- **Compose**: Synthesizes a structured document with clickable citations (`[^1]`), verbatim source excerpts, and explicit conflict callout boxes.
- **Export**: One-click download as PDF Report, Microsoft Word (`.docx`), CSV Evidence Ledger, Markdown (`.md`), and JSON.

---

## 2. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Three.js (interactive 3D document layer stack & verification engine visual).
- **Backend**: Node.js, Express 5, TypeScript (`tsx`).
- **Database**: Prisma ORM with **persistent local zero-config SQLite** (`dev.db`) fallback. Requires no external database daemon or credentials to run out-of-the-box. Fully configurable for PostgreSQL in production.
- **Document Extractors**: `pdf-parse`, `mammoth` (DOCX), `xlsx` (Excel/CSV), `tesseract.js` (OCR), `fast-xml-parser`.
- **Exporters**: `pdfkit` (PDF generation), `docx` (Word generation).
- **AI Engine**: Google Gemini API integration with offline deterministic keyword-search fallback (works 100% without an AI API key).

---

## 3. Quick Start (Windows PowerShell)

### Step 1: Install Dependencies
Open Windows PowerShell in the root project folder:

```powershell
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
cd ..
```

### Step 2: Initialize Database
The project uses SQLite for zero-config persistence:

```powershell
cd backend
npx prisma db push
npx prisma generate
cd ..
```

### Step 3: Run the Test Suite
Verify that all 11 automated verification tests pass:

```powershell
cd backend
npm test
cd ..
```

### Step 4: Start the Application

#### Terminal 1 — Backend (Port 3000):
```powershell
cd backend
npm run dev
```

#### Terminal 2 — Frontend (Port 5173):
```powershell
cd frontend
npm run dev
```

Open your browser to: **`http://localhost:5173`**

---

## 4. Local URLs & Endpoints

| Service | URL | Description |
| :--- | :--- | :--- |
| **Frontend Web App** | `http://localhost:5173` | Interactive 2D + 3D UI, Dashboard, Ingestion |
| **Backend API** | `http://localhost:3000` | REST API |
| **Health Check** | `http://localhost:3000/api/health` | Service status & operational ping |
| **Admin & System Status** | `http://localhost:3000/api/admin/status` | DB, storage, OCR, and AI readiness |

---

## 5. HackFest Demonstration Flow for Judges (2-Minute Walkthrough)

To quickly evaluate the core verification capabilities during judging:

1. **Visit `http://localhost:5173`** on your browser.
2. Click **"Launch Interactive Demo"** or **"Instant Demo Login (Judges)"** on the Auth page.
3. The system automatically signs in and populates the **Project Orion Demo Dataset** containing:
   - `Project_Orion_Charter.txt`: States total budget is **`$4.2M`**, Lead is **`Dr. Elena Vance`**, launch target is **`Q4 2026`**.
   - `Financial_Audit_Q3.xlsx`: Row 2 states budget is **`$5.8M`** (**Direct Contradiction detected!**), re-confirms **`Dr. Elena Vance`** (**Multi-source agreement!**).
   - `Engineering_Milestones_V2.md`: Re-states launch deadline is **`Q4 2026`** (**Multi-source agreement!**).
   - `Anonymous_Vendor_Memo.txt`: Unverified rumor regarding unapproved offshore vendor (**Unsupported claim!**).
   - `Scanned_Calibration_Receipt.png`: Degraded scan labeled with **Extraction Limitation notice** (requires manual review).
4. **Inspect Dashboard**: View the 3D Evidence Integrity core and the Trust Score.
5. **Inspect Contradictions Tab (`/dashboard/conflicts`)**: Notice the **`$4.2M` vs `$5.8M`** budget discrepancy displayed side-by-side with verbatim excerpts and locations without arbitrary winner selection.
6. **Inspect Combined Document Tab (`/dashboard/final`)**: View the synthesized document. Click any citation tag (`[^1]`) to open the **Source Evidence Inspector** showing physical location and exact text span.
7. **Export Document**: Download the verified output as a **PDF Report**, **Word document (.docx)**, or **CSV Evidence Ledger**.
8. **Test Evidence Chatbot (`/dashboard/chat`)**: Ask *"Who is the lead director of Project Orion?"* (retrieves Dr. Elena Vance with citations). Ask *"What is the budget?"* (highlights the conflict). Ask an unanswerable question like *"What is the Mars base code?"* (honestly states that authorized files lack evidence).

---

## 6. Real Application Screens Implemented

1. **Landing Page (`/`)**: Explains problem, solution, pipeline visual, and interactive 3D document layer stack with WebGL mouse tilt.
2. **Authentication (`/auth`)**: Secure JWT signup/login with fast-track demo account button.
3. **Command Center Dashboard (`/dashboard`)**: Live counts of documents, verified claims, active conflicts, items under review, and 3D trust score badge.
4. **Workspaces & Collections (`/dashboard/workspaces`)**: Create, switch, and delete document collections.
5. **Multi-Source Upload (`/dashboard/upload`)**: Drag-and-drop uploader supporting 11+ formats, classification tags (`Internal`, `Restricted`, `Public`), and duplicate SHA-256 detection.
6. **My Documents Library (`/dashboard/documents`)**: Search, filter, SHA-256 hash preview, extraction status, limitation notes, view extracted text, and delete.
7. **Document Details Modal**: Inspect full raw extracted text layer, word count, and checksum.
8. **Verification Workspace (`/dashboard/analysis`)**: Inspect claims table, status pills (`Verified`, `Conflicting`, `Needs Review`, `Unverified`), and run verification engine.
9. **Contradictions Page (`/dashboard/conflicts`)**: Side-by-side opposing evidence viewer with resolution notes.
10. **Combined Document Page (`/dashboard/final`)**: Verified synthesis with clickable citation pills (`[^1]`) and export toolbar.
11. **Evidence Viewer Modal**: Highlights exact source excerpt, page/row location, and verification rationale.
12. **Evidence Chatbot (`/dashboard/chat`)**: Grounded Q&A against authorized documents with attached clickable citations.
13. **Reports & Ledger History (`/dashboard/reports`)**: History of generated synthesis reports with 1-click download in 5 formats.
14. **System Status & Audit Log (`/dashboard/admin`)**: Real-time service availability, OCR engine status, and tamper-evident audit trail.

---

## 7. Automated Test Suite Results

Run `npm test` inside `backend/` to execute the full suite:

```
========================================
🧪 VERIMERGE FULL VERIFICATION TEST SUITE
========================================

✅ [PASS] Database Connection and Prisma Models
✅ [PASS] User Creation and Duplicate Prevention
✅ [PASS] Extraction of TXT and SHA-256 Hash Calculation
✅ [PASS] Unsupported Format Handling (Never Pretend)
✅ [PASS] HackFest Demo Workspace Generation & Verification Engine
✅ [PASS] Verbatim Excerpt Occurrence Verification
✅ [PASS] Evidence Chatbot Grounded Answers and Citations
✅ [PASS] Export Verification Report as PDF Buffer
✅ [PASS] Export Verification Report as DOCX Buffer
✅ [PASS] Export Evidence Ledger as CSV
✅ [PASS] Multi-User Ownership Isolation

========================================
🎉 TEST SUMMARY: 11 PASSED | 0 FAILED
========================================
```

---

## 8. Switching to PostgreSQL for Production

For production cloud deployment:
1. In `backend/prisma/schema.prisma`, update the datasource:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
2. In `backend/.env`, set your connection string:
   ```env
   DATABASE_URL="postgresql://user:password@your-postgres-host:5432/verimerge?schema=public"
   ```
3. Run `npx prisma db push` and `npx prisma generate`.

---

## 9. Security & Governance

- **Password Hashing**: Salted `bcryptjs` (10 rounds).
- **Session Security**: JWT tokens signed with server-side `JWT_SECRET` (7-day expiry).
- **Ownership Isolation**: Every query filters by `userId` and workspace authorization.
- **Path Traversal Protection**: Uploaded files sanitized with regex-safe names and UUID prefixes.
- **Audit Trail**: Every upload, verification run, export, and authentication event is logged to the database.
- **Rate Limiting**: `express-rate-limit` prevents brute-force login attacks.

---

&copy; 2026 Verimerge Team. Production HackFest Release.
