---
description: "Use for difficult backend defects before proposing a fix.
  Primary role: Backend Engineer."
name: systematic-debugging
---

# Systematic Debugging

## When to use

Use for difficult backend defects before proposing a fix.

Do **not** load this skill merely because the task belongs to Backend
Engineer. Load it when this exact capability is required.

## Required deliverable

Produce: **reproduction; timeline; logs/traces; narrowing; hypotheses;
experiments; root cause; regression test**.

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

-   Reproduce or establish strong production evidence.
-   Change one variable per diagnostic experiment.
-   Trace data across boundaries.
-   Add regression protection for confirmed root cause.

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

-   Do not shotgun-change multiple suspected causes.
-   Do not claim tests, measurements, reviews, or tool calls occurred
    when they did not.
-   Do not generate unrelated cleanup work.
-   Do not perform destructive or irreversible operations without
    explicit authority and a recovery path.

## Definition of done

The required deliverable exists; specialist checks are addressed;
verification is explicit; material risks are visible; and unresolved
work has a clear owner.
