# Admin Dashboard Mobile-First UX Overhaul — Design Spec

Date: 2026-08-08
Status: Approved (brainstormed + approved in session)

## Problem

The admin SPA (`admin/`) was designed desktop/print-first, while real usage is ~50/50 phone/desktop and the top daily tasks are **recording orders/bills** and **looking up orders/customers**:

- Navigation is 10 flat sidebar links; below 820px it becomes a horizontally scrolling text strip with most destinations off-screen. No app bar, no bottom nav, no search anywhere.
- Inputs are 14.7px (iOS Safari auto-zooms on focus), filter chips ~24px tall (44px minimum needed), labels 9.6px.
- No component library: the label+input pattern is hand-written ~45 times, five button styles coexist, and identical choices use chips on one screen and native selects on another.
- Wrong input elements in key flows: alpha keyboard for PIN codes, `type=number` for qty/stock, `inputMode="numeric"` on decimal rupee fields (hides the decimal key on iOS), a status `<select>` that saves on iOS wheel-scroll commit.
- Long forms show one error at a time in a banner two screens above the submit button.
- The Deliveries page is the exception — card-first, 44px pills, one-tap tel:/WhatsApp/status actions — and is the internal model for the rest.

## Goals

1. Phone and desktop both first-class; the phone gets a real app shell.
2. Keep the celadon/gold couture brand identity; tune it for utility (≥16px inputs, ≥44px targets, 150ms control transitions, stronger hierarchy).
3. One consistent input-element ruleset across all forms.
4. Top tasks one tap away; order/customer lookup instant.
5. No new npm dependencies; hand-rolled CSS on existing brand tokens. `brand.css` untouched.

## Design

### Navigation

**Desktop sidebar** (kept, grouped):
- Overview — Dashboard
- Capture — New Order, Scan Bill (prominent action buttons at the top of the sidebar)
- Sell — Orders, Deliveries, Payments
- Catalog — Products
- People — Customers (renamed from "Users"; route `/users` unchanged)
- Insights — Analytics, Socials

**Phone (<820px)**: top app bar (page title + search on list pages) and a bottom tab bar: Home · Orders · ⊕ · Deliveries · More. The center ⊕ opens a sheet (New Order / Scan Bill). "More" opens a sheet (Products, Payments, Customers, Socials, Analytics, Sign out). Safe-area insets respected (`viewport-fit=cover`).

### UI kit (`admin/src/components/ui/`)

Button, Field (label + control + inline error), Input/Textarea/Select wrappers, SegmentedControl (radiogroup, 44px), Stepper (−/+), Sheet (bottom sheet on phone / modal on desktop; focus trap, Escape/backdrop dismiss, scroll lock), ListCard (generalizes the Deliveries card), StickyBar (sticky submit + error summary), FilterChips, Skeleton. Supporting `useMediaQuery` and `formErrors` (per-field validation + scroll-to-first-error) helpers.

### Input-element ruleset

- Money → text input, `inputMode="decimal"`, ₹ prefix
- PIN → `inputMode="numeric"`, maxLength 6
- Quantity / stock counts → Stepper (no keyboard)
- 2–4 options → SegmentedControl; 5+ options → native select
- Dates → native date input + quick-set chips (+7/+14/+21 days)
- Status transitions → one-tap "→ next stage" with undo toast (deferred commit — the status machine is forward-only, so undo cancels the pending PATCH rather than reversing it)
- Errors inline per field, summarized on the sticky submit bar, scroll-to-first-error on submit
- All text controls ≥16px computed; all touch targets ≥44px

### Screens

- **Orders**: search (name/phone/order no, client-side), single Filters button → bottom sheet (status/channel/bill type), card list on phone, table on desktop; rows navigate to a **new dedicated `/orders/:id` detail page** (items, customer + WhatsApp, documents/receipts, record payment, delivery due with explicit Save, status advance + undo). Data via navigation state with list-fetch fallback — no backend changes.
- **New Order** (`/orders/new`): stays a single scrolling form with section headers; sticky bar carries running total, Save, and error count. Steppers, segmented controls, decimal/PIN keyboard fixes, styled customer-match rows, measurement-name datalist. `OrderIntakeForm`'s public contract is frozen (BillIntake embeds it).
- **Scan Bill** (`/intake`): keeps its 3-step wizard; the review step's photo peek strip folds into a thumbnail toggle on the sticky bar.
- **Deliveries**: keeps its design; gains undo on status advance and a record-payment quick action; sticky totals seam fixed.
- **Products / Product edit**: search, confirm sheet instead of `window.confirm`, stock steppers, flag + dupatta/jacket tri-state segmented controls (Not in set / Included free / Priced ₹N ↔ `null | 0 | paise`), camera capture on photo input.
- **Secondary pages** (Payments, Customers, Socials, Analytics, Dashboard, Login): new shell + component swap + search where relevant; no deep redesign.

## Out of scope

- Backend changes (no new endpoints; existing zod schemas stay server-side)
- Global omni-search (per-list search only)
- The two admin e2e specs failing on main (pre-existing)
- Storefront (`frontend/`) — its stylesheets are separate copies and are not touched

## Verification

Unit tests + build per phase; Playwright e2e vs the pre-change baseline (only the two known specs may fail); phone-viewport checks via Playwright bundled engines (Pixel 7 + iPhone-13 WebKit): no input zoom, 44px targets, tab bar + safe area, sheets' focus behavior, `/orders/:id` deep-link refresh, sticky stacking on BillIntake review.
