---
name: RetailBooks Web Application
description: The RetailFlow operational design language adapted to a global accounting workbench.
colors:
  workspace: 'hsl(210 20% 98%)'
  surface: 'hsl(0 0% 100%)'
  foreground: 'hsl(217 82% 13%)'
  muted-foreground: 'hsl(215 16% 47%)'
  border: 'hsl(214 28% 91%)'
  brand-navy: 'hsl(217 82% 13%)'
  primary-cyan: 'hsl(194 82% 50%)'
  primary-blue: 'hsl(207 82% 48%)'
  primary-glow: 'hsl(228 73% 48%)'
  success: 'hsl(153 66% 38%)'
  warning: 'hsl(38 92% 45%)'
  danger: 'hsl(0 72% 51%)'
  info: 'hsl(217 91% 60%)'
typography:
  headline:
    fontFamily: 'Urbanist, ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(1.75rem, 2.25vw, 2rem)'
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: '-0.02em'
  title:
    fontFamily: 'Urbanist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: '-0.01em'
  body:
    fontFamily: 'Urbanist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Urbanist, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0.025em'
rounded:
  sm: '0.375rem'
  md: '0.625rem'
  lg: '0.75rem'
  full: '999px'
spacing:
  xs: '0.25rem'
  sm: '0.5rem'
  md: '1rem'
  lg: '1.5rem'
  xl: '2rem'
  2xl: '2.5rem'
layout:
  sidebar-width: '16rem'
  sidebar-collapsed-width: '4rem'
  topbar-height: '3.5rem'
  content-max: '100rem'
components:
  button-primary:
    backgroundColor: '{colors.primary-blue}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '0 1rem'
    height: '2.5rem'
  button-outline:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 1rem'
    height: '2.5rem'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '1.5rem'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: '0 0.75rem'
    height: '2.5rem'
  status-badge:
    rounded: '{rounded.sm}'
    padding: '0.125rem 0.5rem'
---

# Design System: RetailBooks Web Application

**Derived from the implemented interface.** Tokens in the front matter above mirror
`packages/ui/src/tokens.css`, which is the single source of truth — this file describes it, it does
not define it. Component guidance below cites the components it was read from. Last reconciled
against the code on 2026-09-02, covering Phases 1–6 (~75 routes, 21 module workbenches).

## Overview

**Creative North Star: "The Accounting Workbench"**

RetailBooks feels like the RetailFlow operating desk evolved for careful financial work: fast to
scan, calm under dense information, and explicit about state. A deep navy navigation frame holds a
bright, cool workspace where cyan action signals, precise tables, and tabular figures guide the eye.

The system is operational rather than promotional. Brand character appears through exact geometry,
compact rhythm, crisp status treatment, and disciplined action color. Accounting content may change
the information architecture, but it does not loosen the RetailFlow visual grammar.

**Key Characteristics:**

- Deep navy structural frame with a bright, cool working canvas
- Compact operational density and clear financial-number alignment
- Cyan-to-blue emphasis reserved for primary action
- Restrained bordered surfaces with low ambient depth
- Honest loading, empty, error, disabled, and upcoming states
- Responsive collapse on tablet and a focused navigation drawer on mobile

## Colors

The palette combines a dependable navy frame with one clear cyan action voice and quiet semantic
surfaces.

### Primary

- **Ledger Navy:** owns navigation, primary text, and the strongest structural contrast.
- **Action Cyan:** identifies the current destination, live system signals, and the start of primary
  action emphasis.
- **Action Blue:** carries primary controls and focus affordances.
- **Action Glow:** completes the established action gradient; it is not used for decorative text.

### Secondary

- **Control Green:** confirms complete, active, balanced, and healthy states.
- **Review Amber:** flags pending review, approaching deadlines, and period caution.
- **Risk Red:** marks destructive actions, failures, reversals, and locked risks.
- **Inquiry Blue:** distinguishes informative states and secondary data emphasis.

### Neutral

- **Cool Workspace:** separates the working plane from white operational surfaces.
- **White Surface:** holds cards, tables, menus, forms, and dialogs.
- **Ledger Foreground:** carries headings, values, and core control labels.
- **Muted Ink:** carries descriptions, metadata, placeholders, and table headings.
- **Quiet Rule:** separates structure without becoming a visual subject.

**The One Action Voice Rule.** The cyan-to-blue treatment belongs to primary actions and the
provisional mark. It never becomes gradient text or ambient decoration.

## Typography

**Display Font:** Urbanist with system sans-serif fallbacks
**Body Font:** Urbanist with system sans-serif fallbacks

**Character:** Urbanist keeps the interface contemporary and approachable while its clean numeric
forms support accounting density. Hierarchy comes from weight, size, and spacing—not stylistic font
switching.

### Hierarchy

- **Headline** (700, responsive 28–32px, 1.15): page titles and the most important workspace labels.
- **Title** (700, 16px, 1.3): section and panel headings.
- **Body** (400–500, 15px, 1.5): product explanation and operational content, normally no wider than
  72 characters.
- **Label** (600–700, 12px): field labels, badges, metadata, table headings, and navigation groups.
- **Financial values:** always use tabular numerals and right alignment inside tables.

**The Financial Alignment Rule.** Amounts and counts align by their least ambiguous reading edge;
tables use right-aligned tabular numerals.

## Layout

The shell uses a 256px expanded sidebar, a 64px collapsed sidebar, a 56px top bar, and a 1600px
maximum content plane. Desktop pages use 32px insets; compact screens step through 24px and 16px.
The spacing rhythm is built from 4px increments, with 8, 16, 24, 32, and 40px carrying most groups.

At tablet widths the sidebar reduces to icons before content becomes cramped. At mobile widths it
becomes a left drawer, top-bar search recedes, page actions wrap, metric grids collapse, and tables
hide secondary columns while retaining semantic markup.

## Elevation & Depth

Depth is quiet and structural. Resting surfaces use a subtle border with a low offset shadow already
present in the RetailFlow reference. Menus, dialogs, drawers, and toasts receive the stronger ambient
shadow because they cross layers. Focus uses an explicit blue ring rather than a decorative glow.

### Shadow Vocabulary

- **Surface low:** a 2px downward offset and 3px soft blur at very low navy opacity.
- **Overlay:** a 10px downward offset and 30px soft blur for menus, dialogs, drawers, and toasts.
- **Action lift:** a 6px downward offset and 16px soft blue shadow on primary actions.

**The Quiet Depth Rule.** A stronger shadow must explain a layer change, not decorate a static card.

## Shapes

Controls use gently curved 10px corners; larger panels use 12px corners. Compact statuses keep 6px
corners so they read as labels rather than standalone controls. Full pills are limited to avatars,
live indicators, and genuinely circular marks. One-pixel borders provide the system’s ledger-like
precision.

## Page composition — the module workbench

Phases 2–6 converged on one page shape, and twenty-one modules now use it (`*-workbench.tsx` in
`apps/web/src/components/`). It is the default for any new module surface; a screen that departs
from it should have a reason.

The shape, in order:

1. **Permission gate first.** A workbench whose view permission is not universal returns
   `ForbiddenState` before rendering anything else, once loading has settled and an organization is
   resolved. Twenty-three components do this today.
2. **`PageHeader`** — title, one-line description, and the primary action in `actions`. The action
   is rendered conditionally on the manage permission, so a viewer sees the page without a control
   that would only fail.
3. **A single vertical stack** (`rb-ledger-stack`, a 1rem grid) holding, in order: an inline error
   region (`role="alert"`), an inline notice region (`role="status"`), an optional inline form card,
   and the data table.
4. **Inline create/edit, not a modal.** The form opens as a `Card` inside the stack rather than a
   dialog, using `rb-field-grid` — two columns that collapse to one below tablet. A dialog is
   reserved for a destructive confirmation or a task that genuinely needs protected focus.
5. **`DataTable`** as the terminal element, with its own loading and empty handling.

**The Self-Gating Page Rule.** Navigation items are unconditional; the page decides. Hiding a nav
item on a permission the user might legitimately be granted makes the product feel broken and hides
the existence of a capability. Show the destination, and let it explain the boundary.

## Components

### Buttons

- **Shape:** gently curved controls at three heights — 36px compact, 40px default, 46px large — plus
  a square icon-only variant.
- **Primary:** white type on the established cyan-to-blue action treatment with restrained action
  lift.
- **Hover / Focus:** modest brightness change and a visible blue focus ring; disabled and loading
  states preserve the accessible name.
- **Outline / Secondary / Ghost / Danger:** separate hierarchy levels with the same geometry and
  explicit state behavior.

### Status Badges

- **Style:** compact label with a one-pixel semantic border, pale tonal surface, readable colored
  text, and a redundant state dot.
- **State:** posted, complete, active, pending, review, locked, reversed, and unknown values map to
  stable semantic tones.

### Cards / Containers

- **Corner Style:** gently curved large surface.
- **Background:** white surface against the cool workspace.
- **Shadow Strategy:** low ambient surface depth; stronger depth is reserved for overlays.
- **Internal Padding:** normally 20–24px, with 16px on compact mobile panels.

### Inputs / Fields

- **Style:** white 40px field, quiet one-pixel stroke, and the shared control radius.
- **Focus:** blue border shift with a visible three-pixel focus ring.
- **Error / Disabled:** red border plus recovery copy for errors; muted surface and not-allowed cursor
  for disabled controls.

### Navigation

The navy sidebar uses muted default labels, white hover labels, a darker navy active surface, and a
cyan active icon. Group headers are compact uppercase controls. Mobile navigation is presented in a
focus-trapped drawer with an explicit overlay and keyboard dismissal.

### Data Tables

Tables use compact body text, uppercase 12px column headings, quiet horizontal rules, tabular numeric
alignment, semantic captions, loading feedback, and full empty-state recovery guidance. Secondary
columns disappear progressively rather than forcing an unreadable mobile table.

`DataTable` (`packages/ui/src/data-table.tsx`) owns all of that so a module does not re-implement
it: a column declares `align` and `hideBelow: 'tablet' | 'desktop'`, and the component supplies the
visually-hidden `<caption>`, the horizontal scroll container, the loading spinner, and the empty
state. Twenty-five components use it. A table that renders raw `<table>` markup is a defect unless
it has a structural reason a column list cannot express.

### Page Header

`PageHeader` carries the page title, an optional one-line description, and an `actions` slot. It is
the only place a page title is rendered, which keeps heading level and spacing consistent across
twenty-six surfaces without each one restating them.

### Stat Cards

`StatCard` presents a single labelled figure with an icon and an optional hint, toned
`primary | info | success | warning | danger`. It is a summary affordance, not a decoration: use it
for a figure the user would otherwise compute by reading the table below it.

### Empty, Forbidden, and Error States

`EmptyState` carries an icon, a title, a description, and an action — the action is what makes it a
recovery rather than a dead end. `ForbiddenState` is `EmptyState` with a lock and honest default
copy; pass `description` to name the roles that can grant access, so the user knows who to ask.

Inline page-level feedback uses two live regions inside the workbench stack: errors with
`role="alert"`, confirmations with `role="status"`. A notice that survives a route change is carried
across in a short-lived `sessionStorage` flash key rather than set in local state before navigating,
which would unmount it before it rendered.

### Money and Currency

Financial entry uses `MoneyInput`, which shows the currency symbol as an affordance and returns the
user's decimal string unchanged — callers convert to integer minor units at the domain boundary.
No money value passes through a JavaScript float anywhere in the product, and the UI does not
become the exception. `CurrencySelect` lists code, name, and symbol together so an ambiguous symbol
is never the only identifier. Displayed figures carry `.rb-num` for tabular numerals.

### Dialogs, Drawers, Menus, and Toasts

All overlays use accessible Radix primitives for labeling, focus containment, keyboard dismissal,
and portal layering. Motion is brief and functional and is removed when reduced motion is requested.

## Do's and Don'ts

### Do:

- **Do** preserve the 256/64px sidebar, 56px top bar, and 1600px content cap.
- **Do** use Urbanist and tabular numerals for financial values.
- **Do** align amounts consistently and expose accounting status in text as well as color.
- **Do** provide a useful next action for empty and error states.
- **Do** preserve visible keyboard focus and semantic table structure at every breakpoint.
- **Do** build a new module surface as a workbench, on `PageHeader` + `DataTable` + the shared
  states, before reaching for a bespoke layout.
- **Do** gate the page, not the navigation item, and say which roles can grant access.

### Don't:

- **Don't** reuse the RetailFlow logo; RetailBooks owns a separate book/ledger mark.
- **Don't** use gradient text, decorative glass, ornamental glow, or marketing-page scale inside the
  application.
- **Don't** imply Kenya defaults are universal or certified.
- **Don't** create broken navigation to unfinished modules; label upcoming capability honestly.
- **Don't** use a modal for ordinary navigation or a task that does not require protected focus.
- **Don't** hand-roll a table, an empty state, or a money input when `packages/ui` already exports
  one — twenty-five workbenches share `DataTable`, and the twenty-sixth diverging is how a design
  system stops being one.

## Where this drifts next

Phases 7–9 add roughly twenty screens. Two of them will strain this document:

- **Phase 9's shared report shell** (filters, comparison periods, drill-down, export) is a second
  page archetype alongside the workbench. It is built once, before the first report, and documented
  here when it exists — not inferred thirty reports later.
- **Phase 8's locale/language switcher** only appears once a string catalog exists behind it. Until
  then there is nothing to switch, and a control that implies otherwise is the same dishonesty as
  an uncertified compliance claim.
