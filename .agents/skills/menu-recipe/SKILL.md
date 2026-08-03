---
name: menu-recipe
description: Use for MEKTEC canteen menu planning, Recipe Master, recipe ingredients, serving-based scaling, weekly menus, shift-based menus, ingredient requirement calculations, missing-recipe handling, and AI-assisted draft recipes. Use whenever a task changes menus, recipes, or calculated ingredient demand.
---

# Menu and Recipe

Use this skill for menu planning, recipe master data, and ingredient requirement calculations.

## Required context

1. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, `TASKS.md`, and `CHANGELOG.md`.
2. Read `docs/DATA_MODEL.md` when changing Recipe or Menu Plan structures.
3. Inspect existing menu/recipe code and persisted data before editing.

## Separate the concepts

Keep these business concepts distinct:

- **Recipe Master**: how a menu is prepared, standard serving size, ingredients, quantities, and units.
- **Daily ingredient requirement**: calculated quantities needed for a selected menu/date/shift.
- **Purchase requirement**: what should be ordered after considering stock, purchasing units, pack sizes, lead time, and other approved rules.

Do not store all three as one overloaded formula.

## Recipe rules

- Every recipe should identify the menu, standard serving quantity, ingredients, quantity, and unit.
- Scale quantities from the standard recipe using a transparent formula.
- Keep units compatible before arithmetic. Use explicit conversion rules rather than guessing.
- Preserve recipe revisions or status when changes can affect historical reports.
- Do not invent business-critical real quantities and silently save them as approved data.
- If AI proposes a missing recipe, mark it clearly as a **draft/suggestion** until a user approves it.
- AI-generated quantities must not automatically change stock or purchasing records.

## Menu planning rules

- Support the business week and shifts/meals defined by current requirements.
- A menu entry should retain date/day, shift or meal, menu identity, planned servings when used, and reserve quantity when used.
- Avoid duplicate menu entries unless the business workflow intentionally allows them.
- Historical menu plans should remain reproducible even after a recipe is later edited; use version/reference strategy when architecture supports it.

## Calculation workflow

When calculating ingredient demand:

1. Resolve the selected menu and approved recipe.
2. Determine the planned serving basis.
3. Calculate each ingredient from recipe quantity × scaling factor.
4. Apply unit conversion only from known conversion data.
5. Apply reserve/waste/rounding only when there is an explicit configured business rule.
6. Show the calculation inputs so the user can audit the result.
7. Flag missing recipe, missing conversion, or invalid quantity instead of fabricating a value.

## AI-assisted recipes

When implementing AI recipe assistance:

- Use existing approved recipes and item master as context when available.
- Prefer existing item names/units over creating near-duplicates.
- Return confidence/assumptions in a user-readable form.
- Require explicit approval before moving an AI suggestion to approved recipe status.
- Never claim an AI draft is the company's official recipe without approval.

## Validation and tests

Test relevant cases:

- Existing approved recipe.
- Missing recipe.
- Recipe with multiple ingredients.
- Scaling up and down.
- Decimal quantities.
- Missing/invalid unit conversion.
- Zero or missing serving input when serving input is required.
- Duplicate menu selection.
- Editing a recipe without corrupting historical plan/report behavior.
- AI draft → review → approval workflow when AI is included.
- Mobile readability and Thai status/error messages.

## Completion

Before finishing, verify calculations with at least one hand-checkable example using non-sensitive sample values. Update `TASKS.md` and `CHANGELOG.md` as required, and document assumptions, formulas, changed files, test cases, risks, and any data migration in the Pull Request.
