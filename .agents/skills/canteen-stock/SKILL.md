---
name: canteen-stock
description: Use for MEKTEC canteen stock work including item master, receiving, issuing, transfers between Building 1 and Building 16, stock adjustments, lots, expiry dates, FEFO, low-stock alerts, stock transactions, and inventory data integrity. Use whenever a change can affect on-hand quantities or stock history.
---

# Canteen Stock

Use this skill for any task that can change or report inventory quantities.

## Required context

Before editing code:

1. Read `AGENTS.md`.
2. Read `PROJECT_CONTEXT.md`.
3. Read `TASKS.md` and `CHANGELOG.md`.
4. Read `docs/DATA_MODEL.md` when the task changes stock data structures.
5. Inspect the current implementation and storage schema. Do not infer behavior from filenames alone.

## Core invariants

- Stock is separated by location. Current supported business locations are Building 1 and Building 16.
- Never change an on-hand balance without a corresponding transaction or auditable history.
- Receiving, issuing, transferring, adjusting, and cancelling must record date/time and actor when actor identity is available.
- Do not allow negative stock by default. If a future approved workflow permits it, require an explicit authorization path and warning.
- Preserve units and unit conversions. Never add quantities with incompatible units.
- For items with lots and expiry dates, issue by FEFO unless the user explicitly chooses an approved exception.
- Prefer cancellation/reversal or soft delete for records that affect audit history.
- Never invent real stock quantities, prices, lot numbers, employee IDs, or approvals.
- Store timestamps consistently using the project timezone `Asia/Bangkok` for business-facing dates.

## Workflow by operation

### Receive

Validate item, location, quantity, unit, date, vendor/reference when available, and lot/expiry fields when applicable. Create the receipt transaction and update the correct location/lot balance atomically where the current architecture permits.

### Issue

Validate requested quantity against available stock. If lots exist, allocate FEFO from the earliest eligible expiry first. Create issue history before presenting success. Prevent duplicate submission.

### Transfer

Treat a transfer as one auditable business operation with source and destination. The source must decrease by exactly the amount the destination increases. A partial failure must not leave the two locations inconsistent.

### Adjust

Require a reason. Keep before/after values or equivalent transaction evidence. Do not silently overwrite the balance.

### Cancel or reverse

Preserve the original record. Use a reversal/cancellation transaction or status instead of erasing audit history.

## Offline and sync safety

The app is Offline-first. When work touches IndexedDB or sync:

- Preserve local data across refresh/reopen.
- Use stable IDs for transactions.
- Design writes to tolerate retries without duplicating stock movements where possible.
- Make sync status and failure visible to the user.
- Never report a remote sync as successful if only the local write succeeded.

## Validation and tests

Test at least the cases relevant to the change:

- Valid receive.
- Valid issue.
- Issue exactly the remaining quantity.
- Issue more than available stock.
- Zero, negative, blank, or non-numeric quantity.
- Transfer Building 1 → Building 16 and the reverse direction.
- Lot/expiry ordering and FEFO.
- Duplicate tap/submission.
- Offline save and later sync when the change touches sync.
- Refresh/reopen persistence.
- Mobile layout and Thai error/success messages.

## Completion

Before finishing:

1. Confirm stock history and balances remain consistent.
2. Run available checks and inspect the browser console for touched flows.
3. Update `TASKS.md` and `CHANGELOG.md` when required by `AGENTS.md`.
4. Summarize changed files, behavior, test coverage, risks, and any migration/rollback consideration in the Pull Request.
