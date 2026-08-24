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

## Components

### Buttons

- **Shape:** gently curved controls with a 40px default height and compact 36px variant.
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

### Don't:

- **Don't** reuse the RetailFlow logo; RetailBooks owns a separate book/ledger mark.
- **Don't** use gradient text, decorative glass, ornamental glow, or marketing-page scale inside the
  application.
- **Don't** imply Kenya defaults are universal or certified.
- **Don't** create broken navigation to unfinished modules; label upcoming capability honestly.
- **Don't** use a modal for ordinary navigation or a task that does not require protected focus.
