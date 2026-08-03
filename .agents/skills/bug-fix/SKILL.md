---
name: bug-fix
description: Use for debugging and fixing defects in the MEKTEC canteen PWA, including broken buttons, incorrect calculations, IndexedDB problems, sync issues, Service Worker or offline failures, barcode scanning errors, regressions, duplicate submissions, and data-integrity bugs. Use whenever the user reports that something is wrong, broken, inconsistent, or worked before and now fails.
---

# Bug Fix

Use this skill for defect investigation and repair. Prefer a small verified fix over a broad rewrite.

## Required context

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASKS.md`, and `CHANGELOG.md`.
2. Load another matching domain skill as well when the defect affects stock, recipes, purchasing, or UI/UX.
3. Inspect the current code path and relevant persisted data/schema before editing.
4. Check recent changes when a regression is suspected.

## Investigation workflow

### 1. Define the failure

Identify:

- Expected behavior.
- Actual behavior.
- Reproduction steps.
- Device/browser/offline state when relevant.
- Whether the problem affects data correctness, only presentation, or both.

If exact reproduction information is unavailable, make the safest reversible investigation possible and record assumptions.

### 2. Trace before changing

Follow the data/event path from user action to storage/sync/rendering. Look for the earliest point where actual behavior diverges from expected behavior.

Do not fix only the visible symptom when the root cause is known to be elsewhere.

### 3. Assess data risk

Treat these as high-risk defects:

- Incorrect stock balance.
- Missing/duplicate transaction history.
- Cross-location transfer mismatch.
- Incorrect recipe or purchasing calculations.
- Data loss during migration/import/sync.
- Duplicate submissions.

For high-risk defects, preserve existing data, avoid destructive cleanup, and document recovery/rollback considerations.

### 4. Make the smallest safe patch

- Limit changes to the root cause and necessary safeguards.
- Preserve public behavior that is unrelated to the defect.
- Avoid unrelated refactors in the same fix.
- Do not change storage schema unless the defect requires it.
- If schema change is required, include migration and rollback handling.

### 5. Add regression protection

Where the repository supports automated tests, add or update a regression test. Otherwise provide a precise manual test case that would have failed before and succeeds after the patch.

## Common checks for this PWA

When relevant, inspect:

- Event listeners and duplicate binding.
- Form validation and numeric parsing.
- IndexedDB transaction boundaries and upgrade behavior.
- Stable IDs and duplicate writes.
- Local vs remote sync status.
- Service Worker cache version and stale assets.
- Online/offline transitions.
- Barcode API availability and permissions.
- Import validation before writing data.
- Location and unit handling.
- Async errors hidden by broad `catch` blocks.

## Validation

After the fix:

1. Re-run the original reproduction steps.
2. Test one nearby normal path to check for regression.
3. Test the relevant failure/edge case.
4. Refresh/reopen when persistence is involved.
5. Test offline/online transitions when sync or Service Worker is involved.
6. Check browser console for new errors.
7. Verify stock/calculation history manually when data correctness is involved.

## Pull Request requirements

Document:

- Symptom.
- Root cause.
- What changed.
- Why the fix is scoped safely.
- Reproduction before and validation after.
- Data/migration/rollback risk.
- Files changed.

Update `TASKS.md` and `CHANGELOG.md` as required by `AGENTS.md`.
