# RetailBooks UI

`@retailbooks/ui` is the shared implementation of the RetailFlow-derived design language. It owns
the visual tokens, accessible primitives, and composed components used by the web application.

## Use

Load the global layers once in the application layout:

```tsx
import '@retailbooks/ui/tokens.css';
import '@retailbooks/ui/styles.css';
```

Then import components from the package root:

```tsx
import { Button, Card, DataTable, PageHeader, StatCard } from '@retailbooks/ui';
```

The live component-development surface is available at `/design-system`. It demonstrates component
variants, form states, overlays, loading states, empty states, error states, and responsive table
behavior.

## Conventions

- Use semantic token variables from `tokens.css`; do not add page-local brand colors.
- Use the shared primitives before creating a one-off interaction pattern.
- Keep destructive actions explicit and visually distinct.
- Every icon-only control needs an accessible name and a visible focus state.
- Empty, loading, error, disabled, and validation states are part of each feature's definition of
  done.

Run `npm test --workspace @retailbooks/ui` for component accessibility coverage.
