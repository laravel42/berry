# ADR-0017: Model calls go through the Kilo gateway, in leaderboard-ranked tiers

- **Status:** Accepted — runtime provider switch implemented; tiers and routing in progress
- **Date:** 2026-09-25
- **Deciders:** Berry platform
- **Related:** [ADR-0014](0014-agentcore-runtime-control-plane.md), [ADR-0015](0015-default-agent-organization.md)
- **Supersedes:** the "Bedrock is the model" decision carried by ADR-0014 (and
  the "do not re-add OpenRouter" rule in `AGENTS.md`, for this gateway only).
  ADR-0014's control-plane split stands: the loop runs in the runtime image,
  and the server still imports no model SDK.

## Current state (2026-09-25)

- `BERRY_MODEL_PROVIDER=kilo` makes the runtime image call the Kilo gateway
  (`src/agents/runtime/model.ts`, `kiloModel`). Unset or `bedrock` keeps the
  Bedrock path unchanged.
- `src/agents/runtime/kilo-fetch.ts` enforces own-key billing, adds Anthropic
  cache points, and reshapes usage. Costs recorded for a Kilo deployment are
  Kilo's per-request reports, carried as `reportedCostMicros` through
  `task.usage` to `src/usage/record.ts`.
- Runtime support for BerryAuto (`kilo-auto/*`) is in place: the own-key
  exemption, the session header, and usage recorded per model Kilo picked.
- Not yet built:
  - the tiers (BerryMax, BerryMid, BerryLow, BerryFree, BerryAuto), with
    the first four computed from the Kilo leaderboard;
  - per-role tier plus fallback model (migration 208);
  - model routing per task;
  - the model picker and Usage page changes.

## Context

Berry reached models only through Bedrock with SigV4, so a deployment held no
model API key. The product needs Berry to choose models itself across every
vendor, weighted by cost and efficiency and updated continuously. It must
show cost before work and record actual cost after. The Kilo gateway
(`https://api.kilo.ai/api/gateway`) offers:
- an OpenAI-compatible API over roughly 400 models;
- per-request cost reports;
- its own provider key used when one is attached (BYOK), including a Bedrock one;
- a public leaderboard: KiloBench scores in `GET /models` (`terminalBench`),
  and 7-day real usage by mode at `GET kilo.ai/api/public/leaderboard-model-usage`.

## Decision drivers

- Paid inference stays on the deployment's AWS account and bill.
- Berry, not a person, picks the model per task. The only choice a person
  makes is the tier.
- One cost source, the one that bills.
- The server still holds no model client (ADR-0014).

## Considered options

1. Stay on Bedrock and rank models with Berry's own tables.
2. Kilo's own auto-routing (`kilo-auto/*`). Its paid tiers route to models
   Bedrock does not serve, and it lists no price, so Berry cannot estimate
   cost before work.
3. Kilo gateway with Bedrock BYOK for paid models, and Berry-computed tiers
   from Kilo's leaderboard. **Chosen.**

## Decision

1. **Where the model is called.** The runtime image calls the Kilo gateway
   with Strands' OpenAI model (`api: 'chat'`). This adds the `openai` package
   to `server-ts/package.json` only; `scripts/check-no-model-in-server.py`
   allows that one runtime dependency. Imports of it stay confined to
   `src/agents/runtime/`.
2. **Paid models are served only by the deployment's Bedrock key.** A paid
   reply that Kilo reports with `is_byok: false` is refused as `NOT_OWN_KEY`
   (final, not retried). A 402 means the Bedrock key does not serve the model
   and is classified the same way. The Kilo credit balance stays at zero.
   `:free` models are exempt.
3. **Cost comes only from Kilo's reports.**
   - For a call served by the deployment's key, the cost is
     `usage.cost_details.upstream_inference_cost`; otherwise it is `usage.cost`.
   - A run whose calls did not all report a cost is recorded unpriced, never
     estimated.
   - Estimates before work use Kilo's `/models` prices.
   - Bedrock deployments keep Berry's price table.
4. **Usage is recorded in Bedrock's terms.** Input tokens exclude cached
   tokens; cache reads and writes are counted apart.
5. **Anthropic caching.** Anthropic requests mark the system prompt and the
   last tool with `cache_control: ephemeral`.
6. **Tiers.** Each role has a tier, which is primary, plus one fallback model.
   The four tiers are BerryMax, BerryMid, BerryLow (paid, Bedrock-served) and
   BerryFree (`:free` models). Each is recomputed hourly from the Kilo
   leaderboard, ranked as follows:
   - **BerryMax:** KiloBench completion rate.
   - **BerryMid:** completion rate per dollar, among models at or above the
     median.
   - **BerryLow:** cost per attempt, among scored models.
   - **BerryFree:** real usage in the role's mode; KiloBench only breaks
     ties (revised 2026-09-25: few free models are scored, and a 15% score
     outranked the free models people actually run).

   *Revised 2026-09-25.* Only 11 of the 45 own-key models have a KiloBench
   score, and all are frontier-priced, so the ranking uses both halves of the
   leaderboard:
   - **Eligible (paid tiers):** `hasUserByokAvailable` on the authenticated
     `/models`, excluding `~` aliases, models without tools, and expiring
     models.
   - **BerryMax:** KiloBench completion.
   - **BerryMid:** completion per dollar, among scored models at or above the
     median.
   - **BerryLow:** real code-mode usage per dollar, among unscored models
     priced below BerryMid's cheapest.
   - **One tier per model:** each model sits only in the highest tier it
     qualifies for.

   Real usage in the role's mode breaks ties. Berry picks among the top 3 of a
   tier, weighted by rank, and uses the fallback model once on failure. No
   model list is hard-coded.
7. **Roles are on Berry tiers, not vendor model families.** From catalogue
   13, the default organization assigns each role `berry_max`, `berry_mid` or
   `berry_low`, stored as the contract's `tier`, and provisioning writes no
   model pair.
   - Through the gateway, a run's model is the agent's named gateway model;
     failing that, its tier's first choice today. The tier comes from the
     contract, else from the role's catalogue entry for contracts customised
     before tiers existed, else BerryLow.
   - There is no tier-to-Bedrock mapping. Without the gateway, an agent that
     names no model runs on the server default.
8. **Choosing a model, and falling back.**
   - A session (an agent on an issue) gets one of its tier's top three, weighted
     3:2:1 by rank and seeded by the session. It keeps that model, and its
     prompt cache, while the leaderboard keeps it there.
   - The fallback is the agent's own `fallback_model`, or Berry's default from
     the leaderboard: the top of the next tier down (Max → Mid, Mid → Low,
     Low → Low's next, Free and Auto → Low), never the model itself.
   - In the runtime, `FallbackModel` moves the run to the fallback when the
     chosen model fails before producing anything, and keeps it there.
     Content-filter refusals and cancellations do not switch.
   - Usage served by the fallback is recorded as that model, with
     `task_usage.fell_back`.
9. **BerryAuto, a fifth tier, is an experiment.** It sends every call to
   Kilo's `kilo-auto/efficient`, so that Kilo's routing can be compared with
   Berry's ranked tiers on the same roles.
   - It is exempt from the own-key refusal. Kilo's fallback model (GLM Flash)
     and its routing classifier are billed to Kilo credits by design, so the
     Kilo balance has to be positive while BerryAuto is in use.
   - The session id is sent as `X-KiloCode-TaskId`, so the routing can keep a
     model across a run's calls.
   - Usage is recorded per model Kilo picked, not as `kilo-auto/efficient`.
   - The classifier's fee is billed as a separate Kilo charge and is **not in
     the per-request cost report**. BerryAuto's recorded cost is therefore a
     lower bound until it is reconciled against Kilo's usage records.
   - It has no price before work (`-1`). Its estimates come from BerryAuto's
     own recorded history.
   - To keep it on Bedrock models, set a custom Efficient pool in the Kilo
     dashboard. Kilo exposes no API for that pool, so Berry cannot manage it.
   - The comparison uses the same measures for every tier: cost per task,
     whether the review gate passed the work first time, failures and
     fallbacks, and time.

## Consequences

### Positive

- Every vendor Bedrock serves is reachable through one API, and tier
  membership follows the leaderboard without code changes.
- Recorded cost is the billed cost. Caching measured through the gateway cut a
  repeated 11,200-token prefix from $0.014 to $0.0012 per call.

### Negative

- A long-lived API key (`BERRY_KILO_API_KEY`) now exists, where SigV4 needed
  none. Kilo also holds the Bedrock key.
- Two more external dependencies: the gateway and the leaderboard endpoints.
  The usage endpoint is public but not documented.

### Risks and mitigations

- **Risk:** Kilo bills a paid call to credits. **Mitigation:** the `is_byok`
  refusal, plus a zero balance with auto top-up off.
- **Risk:** a leaderboard endpoint fails or changes shape. **Mitigation:** keep
  the last good ranking, mark it stale, and use the fallback model if a tier
  is empty.
- **Risk:** a paid Bedrock model has no KiloBench score. **Mitigation:** it is
  left out of paid tiers rather than guessed at.
- **Risk:** free models may train on prompts. **Mitigation:** no role defaults
  to BerryFree.

## Validation

- Unit tests:
  - `src/agents/runtime/kilo-fetch.test.ts` (refusal, stream rewrite, cost, cache points);
  - `model.test.ts` (provider choice, Kilo model config);
  - `failure.test.ts` (`NOT_OWN_KEY`);
  - `plugins/accounting.test.ts` (cost summing).
- `pnpm check:models` and its self-test.
- A live check on 2026-09-25 through Bedrock BYOK:
  - a tool call succeeded;
  - `is_byok: true` on every call;
  - cache write 11,204 tokens, then cache read 11,204;
  - reported costs of 14,038 and 1,153 micros reached `AccountingPlugin`.

## Follow-up

- Tiers, ranking job and routing, as the next PRs; migration 208 adds per-role
  tier and fallback model.
- **PR 3 also covers account reconciliation**, using the Kilo app routes the
  extension uses. They take the gateway API key but are not documented public
  API.
  - **Daily classifier fee.** Read
    `GET app.kilo.ai/api/profile/usage?groupByModel=true`. Its `kilo-auto/*`
    rows are exactly the routing classifier's fees, in microdollars (about
    $0.00001 per request, measured 2026-09-25). Spread each day's fee across
    that day's BerryAuto requests. Compare the other per-model rows with
    Berry's own records and flag any difference.
  - **Hourly balance check.** Read `GET app.kilo.ai/api/profile/balance`. Flag
    a fall in balance that neither the per-request reports nor the classifier
    fees explain, and warn before BerryAuto would run out of credit.
  - **Stale data.** If either route fails or changes shape, keep the last
    reading, mark it stale, and never block a run on it.
  - **Shared account.** For now Berry uses the personal Kilo account, which
    other clients also use. Usage Berry did not record is reported as other
    traffic, not as a mismatch. A Kilo organization kept for Berry alone
    (`BERRY_KILO_ORG_ID`, with the Bedrock key attached at organization level)
    would make the reconciliation exact; that is deferred.
- Store `BERRY_KILO_API_KEY` in Secrets Manager for AgentCore rather than as a
  runtime environment variable.
- Update the model picker and Usage page for tiers, the fallback model and
  cost sources.
