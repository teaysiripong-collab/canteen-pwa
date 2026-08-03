---
name: purchasing
description: Use for MEKTEC canteen purchasing workflows including Vendor Master, purchase planning, recommended order quantities, order and receive dates, vendor-separated purchase documents, price updates, pack or purchase units, and Excel/CSV export. Use whenever a task calculates, creates, changes, or exports purchasing requirements.
---

# Purchasing

Use this skill for purchasing plans and vendor-facing/export workflows.

## Required context

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASKS.md`, and `CHANGELOG.md`.
2. Read `docs/DATA_MODEL.md` when changing vendor, item purchasing, or Purchase Plan structures.
3. Inspect current stock/menu/recipe integrations before changing purchasing calculations.

## Source-of-truth rules

- Purchase demand must be traceable to approved inputs such as menu demand, current stock, approved buffer rules, open orders, purchase units, and vendor configuration.
- Never invent real vendor prices, delivery dates, pack sizes, item mappings, or purchasing approvals.
- Price is time-sensitive. Preserve the price used on a transaction/document rather than assuming the current master price was always valid historically.
- Keep usage unit and purchase unit distinct. Convert only with an explicit conversion rate.
- Keep order date, requested receive date, actual receive date, and receiving transaction separate when the workflow supports them.

## Recommended-order workflow

When calculating a recommendation:

1. Resolve approved ingredient demand.
2. Read available stock for the relevant location/scope.
3. Account for committed/open quantities only if that data is reliable and represented in the system.
4. Calculate the net requirement.
5. Convert to purchase unit using known conversion data.
6. Apply pack-size rounding only from configured values.
7. Prevent negative recommendations; show zero when no purchase is needed.
8. Present the inputs and calculation so the user can audit the recommendation.

Do not turn a recommendation into an approved purchase automatically unless an explicit approval workflow exists.

## Vendor handling

- Use Vendor Master identities rather than free-text duplication when available.
- Group purchase documents by vendor and receiving date when required by the business flow.
- Handle an item with no vendor or no current price as an exception requiring review, not as a reason to fabricate data.
- If multiple vendors become supported, keep vendor selection explicit and preserve which vendor was chosen for each purchase line.

## Export rules

For Excel/CSV/export work:

- Export stable columns with clear Thai labels when intended for operations.
- Include item identity, quantity, unit, vendor, relevant dates, and status/reference fields required by the workflow.
- Keep numeric values as numeric data where possible, not formatted text.
- Do not silently discard rows with missing price/vendor; flag them clearly for review.
- Ensure totals do not mix incompatible units.

## Validation and tests

Test relevant cases:

- Demand greater than stock.
- Stock exactly covers demand.
- Stock exceeds demand.
- Missing vendor.
- Missing or stale price.
- Missing unit conversion.
- Pack-size rounding.
- Decimal quantities.
- Separate vendors and receive dates.
- Re-export of the same plan without duplicate purchasing transactions.
- Mobile review screen and Thai error/status messages.

## Completion

Before finishing, verify at least one recommendation calculation by hand using non-sensitive sample data. Update `TASKS.md` and `CHANGELOG.md` as required. In the Pull Request, document the calculation, affected data fields, export format changes, test cases, risks, and any assumptions that still require a business decision.
