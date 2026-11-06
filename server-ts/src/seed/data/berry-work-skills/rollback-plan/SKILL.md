---
name: rollback-plan
description: "Use when a release needs a tested plan to undo it."
---

# Rollback Plan

## When to use

Use when a release needs a tested plan to undo it.

Load this skill when this exact piece of work is needed, not merely because the task belongs to the Release Manager.

## Gather first

- Release contents.
- Deployment method.

## Deliverable

Produce a rollback plan: triggers, steps, data considerations, owner, time estimate, communication, and when it was rehearsed.

## Steps

1. Define rollback triggers.
2. Write steps.
3. Address data changes.
4. Rehearse if possible.

## Quality checks

- Data changes are addressed.
- Owner is named.

## Stop and hand to a person when

- A release must go out with a failed gate.

## Avoid

- Do not assume rollback is trivial.
- Never release or merge anything; a person does.

## Ground rules

- Work from what the workspace holds: the task, its comments and files, the project's resources and linked goals. When something essential is missing, ask in a comment instead of guessing.
- Write the deliverable as a file on the task (or in the project, when the task has one), named for what it is.
- Keep every source next to the claim it supports, and label every assumption as one.
- You draft; a person sends, publishes, posts, pays, signs, books and decides.
- Use personal data only as far as the task needs it, and never repeat it elsewhere.

## Hand back

End with a short note on the task: what you produced and where it is, what you checked, what you assumed, and what a person must decide or verify before it is used.

## Done when

The release can be undone safely.
