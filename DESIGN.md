---
name: RetailBooks Web Application
description: The RetailFlow operational design language adapted to a global accounting workspace.
---

<!-- SEED: established with the user before implementation; re-run $impeccable document once there's code to capture the actual tokens and components. -->

# Design System

## Creative North Star

**The accounting workbench.** RetailBooks should feel like the RetailFlow operating desk evolved
for careful financial work: fast to scan, calm under dense information, and explicit about state.
Its character comes from a deep navy frame around a bright working canvas, cyan action signals,
precise tables, and generous breathing room between operational groups.

## Visual authority

The definitive reference is the RetailFlow web app in
`C:\Users\gmnyo\Desktop\Engineering projects\shop-ease-ke`, plus the dashboard and inventory
screenshots supplied by the user. Match its geometry, density, typography, component treatment,
interaction patterns, and responsive behavior. Accounting requirements may change information
architecture and content, but not the established visual grammar.

## Color

- **Workspace:** `hsl(210 20% 98%)` — cool near-white page background
- **Surface:** `hsl(0 0% 100%)` — cards, tables, menus, and inputs
- **Primary foreground:** `hsl(217 82% 13%)` — headings, key values, and navy controls
- **Muted foreground:** `hsl(215 20% 47%)` — supporting copy and metadata
- **Border:** `hsl(214 32% 91%)` — quiet structural separation
- **Primary cyan:** `hsl(194 82% 50%)` — main actions, active icons, and live states
- **Primary mid-blue:** `hsl(207 82% 48%)` — action gradients and secondary emphasis
- **Primary glow-blue:** `hsl(228 73% 48%)` — terminal point of primary gradients
- **Navigation:** `hsl(217 82% 13%)` — fixed sidebar
- **Navigation active:** a slightly lighter navy surface with cyan icon emphasis
- **Success:** green with a pale green surface; use for complete or healthy states
- **Warning:** amber with a pale amber surface; use for review and approaching deadlines
- **Danger:** red with a pale red surface; use for destructive actions, failures, and locked risks

Use the cyan-to-blue gradient only for primary action controls and the provisional brand mark. Text
stays solid-color. Status color never carries meaning alone.

## Typography

- **Family:** Urbanist, with a system sans-serif fallback while the web font loads
- **Page title:** 32px, 700 weight, tight but no tighter than `-0.02em`
- **Section title:** 24px, 600–700 weight
- **Card title / navigation:** 16–18px, 500–600 weight
- **Body:** 16px, 400–500 weight
- **Metadata / table heading:** 12–14px, 500–600 weight
- **Financial values:** tabular numbers, right aligned in tables, never abbreviated where precision
  matters

## Layout and spacing

- Expanded sidebar: `256px`; collapsed sidebar: `64px`
- Top bar: `56px`
- Main content maximum: `1600px`, centered on very wide screens
- Standard page inset: `32px` desktop, `20px` tablet, `16px` mobile
- Base spacing unit: `4px`; common gaps: `8`, `12`, `16`, `24`, `32`, and `40px`
- Standard radius: `10px` (`0.625rem`); large operational panels may use `12px`
- Use one structural treatment per surface: a subtle border or a soft offset shadow
- Tables and list rows remain compact enough for operational scanning, with clear focus states

## Interaction and responsive behavior

- The sidebar collapses before content becomes cramped and becomes a drawer on small screens.
- Tables retain semantic markup and progressively hide secondary columns; essential actions remain
  reachable without horizontal guessing.
- Every interactive control has visible hover, active, disabled, loading, error, and keyboard-focus
  states.
- Motion is brief and functional: navigation, disclosure, saving, and state changes. Respect
  reduced-motion preferences.
- Empty states explain why the surface is empty and name one useful next action.

## Do / Don’t

- **Do:** use plain accounting language, align amounts consistently, expose status clearly, and
  preserve the RetailFlow density.
- **Do:** use bordered white panels against the cool workspace and reserve navy for structure.
- **Do:** provide drill-down routes from summaries to source records.
- **Don’t:** use decorative gradients, glass effects, oversized marketing layouts, or dense nested
  cards.
- **Don’t:** imply Kenya-specific rules are universal or certified.
- **Don’t:** copy the RetailFlow logo; use the separate RetailBooks provisional mark.
