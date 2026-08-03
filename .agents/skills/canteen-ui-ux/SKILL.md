---
name: canteen-ui-ux
description: Use for MEKTEC canteen UI and UX work including mobile-first screens, Thai operational copy, forms, tables, dashboards, navigation, loading and error states, accessibility, barcode fallback UX, and simplifying workflows for non-technical canteen staff. Use whenever a task changes what users see, tap, read, or navigate.
---

# Canteen UI and UX

Use this skill whenever a change affects the user interface or operational flow.

## Required context

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASKS.md`, and `CHANGELOG.md`.
2. Inspect the current screen and the code that drives it before redesigning.
3. Preserve working business functions unless the task explicitly changes them.

## Design priorities

Prioritize in this order:

1. Correctness of the operation.
2. Prevention of costly or irreversible mistakes.
3. Fast use on a phone during canteen operations.
4. Clear Thai language for users who may not be technical.
5. Consistent visual hierarchy and clean appearance.

Do not trade clarity for decoration.

## Mobile-first rules

- Design the narrow mobile layout first, then expand for desktop.
- Primary actions must be easy to reach and tap.
- Avoid dense multi-column forms on small screens.
- Break long forms into logical groups or steps when it reduces errors.
- Keep important totals, statuses, location, and date context visible near the action they affect.
- Prevent accidental double submission on important actions.

## Language and status

- Operational UI copy should be Thai-first unless there is a specific requirement otherwise.
- Use short, concrete labels that describe the action, not internal developer terminology.
- Show explicit Loading, Success, Warning, Error, Empty, and Offline/Sync states where relevant.
- Error messages should tell the user what happened and what they can do next.

## Accessibility and visual semantics

- Do not communicate meaning by color alone; pair color with text, icon, label, or status.
- Maintain readable contrast and text size.
- Inputs need visible labels; placeholders are not a substitute for labels.
- Keyboard/focus behavior should remain sensible on desktop where applicable.
- Buttons with icons only need accessible names.

## Operational patterns

### Stock and transactions

Before final submit, make item, quantity, unit, location, and transaction type easy to review. Destructive/corrective actions need stronger confirmation than ordinary navigation.

### Tables and lists

For larger datasets, provide search/filter where useful. On mobile, prefer cards, responsive rows, or prioritized columns instead of forcing unreadable wide tables.

### Barcode scanning

If `BarcodeDetector` or camera access is unavailable, give a manual-entry fallback and explain the state without blocking the rest of the app.

### Offline-first

Users must be able to tell whether data is saved locally, synced remotely, pending sync, or failed. Do not use a generic success message that hides a sync failure.

## Change discipline

- Reuse existing components/styles before adding a parallel design system.
- Avoid large visual rewrites in the same PR as risky data-model changes unless necessary.
- Keep CSS and DOM changes scoped to the requested workflow.
- Do not remove controls merely to make a screen look cleaner if they are required for operations.

## Validation and tests

For UI changes, test the relevant flow at narrow phone width and desktop width. Verify:

- Main action is obvious.
- Thai labels fit without clipping.
- Validation is visible near the problem.
- Loading/error/offline states do not trap the user.
- Double taps do not duplicate important writes.
- Empty and long-data cases remain usable.
- Existing navigation still works.
- Console has no new errors from the changed flow.

Include screenshots in the Pull Request when the environment makes them available.

## Completion

Update `TASKS.md` and `CHANGELOG.md` as required. Summarize the user-flow change, files changed, mobile checks, accessibility considerations, error/offline states tested, screenshots if available, and any UX tradeoffs in the Pull Request.
