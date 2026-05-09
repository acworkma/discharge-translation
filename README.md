# Community Orbit

Community Orbit is a brand-new frontend application for managing community program operations.

## Design inspiration and adaptation

This app is visually inspired by the UI language of `acworkma/Malicious-File-Scanning`, especially:

- dark gradient shell and glassy panel surfaces
- compact spacing and high-density dashboard cards
- clear typography hierarchy with muted helper text
- rounded pills/badges for status communication
- subdued table/list rows with soft borders
- polished state styling for loading, empty, warning, error, and success
- responsive desktop-to-mobile layout behavior

How this app adapts those patterns while remaining original:

- **Different purpose:** community program operations and intake planning
- **Different flows:** dashboard review, records browsing, and intake draft creation
- **Different content/data:** sample program metrics and participant planning inputs
- **Different behavior:** no scanning, no malware/threat logic, no security workflows

## What is included

- reusable layout, card, button, badge, alert, empty, loading, modal, toast, and form control patterns
- dashboard section with status-rich metrics and upcoming actions
- records section with table/list UI and switchable UI states
- form section with inputs/selects/textareas, validation, and confirmation modal
- responsive styling suitable for mobile screens

## Run locally

```bash
npm install
npm run dev
```

Additional scripts:

- `npm run lint`
- `npm run build`
