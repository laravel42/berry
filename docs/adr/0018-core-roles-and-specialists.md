# ADR-0018: Five core roles by default; the rest are specialists a workspace adds

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Berry platform
- **Supersedes:** the roster part of [ADR-0015](0015-default-agent-organization.md)
  (contracts, autonomy ceilings, review selection and delegation checks all stand)
- **Related:** [ADR-0017](0017-kilo-gateway-model-tiers.md) (roles run on tiers)

## Context

ADR-0015 gave every workspace the Orchestrator plus 18 role agents. In the
field the roster did more harm than good on the projects Berry plans
(a site, an app, a service):

- **Hand-offs replaced work.** A planned build task routed to the Product Lead
  became a spec, then went to the Engineering Manager, who wrote a hand-off
  note and passed it on again. Five tasks in, no code existed; every hand-off
  was a paid run that started with less context than the one before.
- **Routing had to tell near-identical roles apart.** Frontend, Growth and
  Integration Engineers; Business Analyst, UX Researcher and Product Lead. The
  wrong choice was the common failure.
- **Reviews multiplied.** Each role's review rules called in more reviewers.

On a small team these are one job each: deciding what to build, designing
it, building it, checking it and running it.

## Decision drivers

- Work reaches someone who can do it in one step.
- Routing is close to mechanical: code to the engineer, specs to product.
- Specialists stay available for the workspaces that need them.
- Existing workspaces keep their agents.

## Considered options

1. Keep all 18 roles (status quo).
2. Keep all 18 in the catalogue, provision only a core by default (chosen).
3. Replace the catalogue with five roles and delete the rest.

## Decision

The catalogue (`server-ts/src/organization/catalog.ts`) marks each role
**core** or **specialist**. A new workspace is provisioned with the
Orchestrator and five core roles:

| Role | Key | Does | Absorbs |
|---|---|---|---|
| Product Lead | `product-lead` | Specs, research, acceptance criteria. Reads the repository. | Business Analyst, UX Researcher, Engineering Manager |
| Product Designer | `product-designer` | UI and UX; commits design assets and styles. | — |
| Software Engineer | `software-engineer` (new) | Full stack: code, database, integrations, docs. | Architect, Backend, Frontend, Database, Integration, Growth, Technical Writer |
| QA Engineer | `qa-engineer` | Tests and reviews delivered work, security included. | Security Engineer |
| DevOps Engineer | `devops-engineer` | Deploys, infrastructure, incidents. | SRE |

The other thirteen roles are **specialists**: in the catalogue, not
provisioned. A person adds one from Settings → Organization
(`POST /api/v1/organization/roles/:roleKey`), which restores an archived
agent of that role if there is one and inserts it otherwise.

A role the workspace does not have is never waited on:

- A required reviewer no agent holds is not owed; the review gate goes on
  with the reviewers that exist, and a person still releases the work. QA
  is always required, so every change still gets an independent review.
- An escalation to the CTO in a workspace without one goes to a person.
- Workflows name core roles; routing gives a step to a specialist when the
  workspace has one for it.

Provisioning adds the Software Engineer where it is missing and upgrades
untouched contracts as before. Specialists the old full roster left behind
are archived once, so an existing workspace matches the reduced catalog.
A specialist a person adds or restores after that stays.

## Consequences

### Positive

- Six agents instead of nineteen to route between, review and pay for.
- Build work goes straight to the engineer who can push.

### Negative

- One engineer role holds a wide brief; a workspace with deep database or
  security work should add that specialist.
- A workspace that had added a specialist before this retirement loses it
  until someone adds it again. Adding it restores the archived agent.

### Risks and mitigations

- **Risk:** a security-sensitive change is not reviewed by a security
  specialist. **Mitigation:** QA's brief includes security review, and the
  Security Engineer is one click away for workspaces that need it.

## Validation

`server-ts/src/organization/` tests cover the core set, provisioning of a
new workspace, adding a specialist, and reviews and escalations that name a
role the workspace lacks.
