---
description: "Use when work is stuck and someone must unblock it. Primary role: Engineering Manager."
name: blocker-resolution
---

# Blocker Resolution

## When to use

Use when work is stuck and someone must unblock it.

Do **not** load this skill merely because the task belongs to Engineering Manager. Load it when this exact capability is required.

## Required deliverable

Produce: **blocked items; cause; options to unblock; owner; deadline; escalation**.

## Procedure

### 1. Establish scope and evidence

-   Identify the concrete objective and completion condition.
-   Inspect relevant repository files, runtime/configuration, project
    artifacts, telemetry, requirements, or provider documentation before
    acting.
-   Record what is verified, inferred, and unknown.
-   Identify blast radius across users, tenants, data, APIs, jobs,
    infrastructure, integrations, and operations.

### 2. Specialist checks

-   Find the real cause of the block.
-   List options with their cost.
-   Assign an owner to unblock.
-   Escalate if not resolved by a set time.

### 3. Design the intervention

-   Prefer the smallest coherent intervention that satisfies the
    objective.
-   Preserve existing contracts unless changing them is explicitly
    approved.
-   For consequential decisions, compare viable approaches and state why
    the selected approach wins.
-   Identify migration, compatibility, rollout, rollback, and
    observability requirements when applicable.
-   Never silently turn an unresolved product/business decision into an
    engineering assumption.

### 4. Verification

Use evidence appropriate to this capability: targeted tests,
type/lint/build checks, query plans, traces, metrics, screenshots,
accessibility inspection, security reproduction, provider sandbox calls,
architecture traces, or acceptance-criteria review.

For each verification record the check, expected result, actual result,
evidence location, and anything not verified.

### 5. Handoff

Return:

``` yaml
status: complete | blocked | needs-review
summary: ...
evidence:
  - ...
changes_or_recommendations:
  - ...
verification:
  - check: ...
    result: ...
risks:
  - severity: low | medium | high | critical
    item: ...
open_decisions:
  - ...
dependencies:
  - ...
required_reviewers:
  - ...
follow_up:
  - owner: ...
    action: ...
```

## Escalation rules

-   Product behavior/scope ambiguity → Product Lead or Business Analyst.
-   Durable service/data ownership or system-boundary change → Software
    Architect.
-   Credentials, tenant isolation, sensitive data, authorization, or
    exploitability → Security Engineer.
-   Production availability, durability, recovery, or incidents → Site
    Reliability Engineer.
-   Conflicting multi-agent dependencies/ownership → Engineering
    Manager.
-   Company-wide, expensive-to-reverse, strategic platform/vendor
    decision → CTO.

## Anti-patterns

-   Do not let blocked work sit without an owner.
-   Do not claim tests, measurements, reviews, or tool calls occurred
    when they did not.
-   Do not generate unrelated cleanup work.
-   Do not perform destructive or irreversible operations without
    explicit authority and a recovery path.

## Definition of done

The required deliverable exists; specialist checks are addressed;
verification is explicit; material risks are visible; and unresolved
work has a clear owner.
