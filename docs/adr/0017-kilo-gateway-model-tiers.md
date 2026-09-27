# ADR-0017: Model calls go through the Kilo gateway, in leaderboard-ranked tiers

- **Status:** Accepted — provider switch, tiers, routing and the tier interface implemented
- **Date:** 2026-09-25
- **Deciders:** Berry platform
- **Related:** [ADR-0014](0014-agentcore-runtime-control-plane.md), [ADR-0015](0015-default-agent-organization.md)
- **Supersedes:** the "Bedrock is the model" decision carried by ADR-0014 (and
  the "do not re-add OpenRouter" rule in `AGENTS.md`, for this gateway only).
  ADR-0014's control-plane split stands: the loop runs in the runtime image,
  and the server still imports no model SDK.

## Current state (2026-09-26)

- `BERRY_MODEL_PROVIDER=kilo` makes the runtime image call the Kilo gateway
  (`src/agents/runtime/model.ts`, `kiloModel`). Unset or `bedrock` keeps the
  Bedrock path unchanged.
- `src/agents/runtime/kilo-fetch.ts` enforces own-key billing, adds Anthropic
  cache points, and reshapes usage. Costs recorded for a Kilo deployment are
  Kilo's per-request reports, carried as `reportedCostMicros` through
  `task.usage` to `src/usage/record.ts`.
- Runtime support for BerryAuto (`kilo-auto/*`) is in place: the own-key
  exemption, the session header, and usage recorded per model Kilo picked.
- Ratings are Terminal-Bench resolution rates on the 4.0 scale, older
  versions and Kilo's scores converted onto it (`agents/kilo/ratings.ts`).
  The paid tiers hold only rated models, three each, from every provider
  Kilo serves (2026-09-26, superseding the own-key rule and the price
  cascade of Decision 6): Max the three best rated; Low the best of the
  cheapest third of rated models, preferring those not outclassed (another
  rates as well for less) and reaching a quarter of the best rating; Mid the
  best rated of the rest below Max's cheapest.
- A rating converted from another source (an older Terminal-Bench, or
  Kilo's benchmark) is an estimate: the tier table marks it ≈ and names its
  source, and ranking counts it at 85% (`ESTIMATE_WEIGHT`), so a measured
  score of similar value goes first (2026-09-26).
- A new version no leaderboard rates yet borrows the rating of the newest
  rated earlier version of its family (same vendor and name but for the
  version number), when it costs no more; marked as estimated from that
  model (`borrowPredecessorRatings`, 2026-09-26). That day it put Claude
  Opus 5.5, unrated, at the top of BerryMid on Opus 5's 0.539.
- Paid tiers are the models the deployment's own keys serve again
  (2026-09-27, reversing 2026-09-26): with a Bedrock key that is the 44 models
  Kilo flags `hasUserByokAvailable`. `BERRY_KILO_ANY_PROVIDER=true` opens them
  to models billed to Kilo credits. The runtime still accepts a credit-billed
  call, for a model a person pins.
- A deployment has its own say (`TierPolicy`, 2026-09-26): `BERRY_KILO_EXCLUDE`
  takes models out of every tier, `BERRY_KILO_PREFER` puts models first in
  the tier they reach, and `BERRY_KILO_MAX|MID|LOW` place a model in a tier
  whatever its rating, the rule filling the rest. Ids or id prefixes
  (`z-ai/`). That day: GLM excluded after GLM-5.3 ran a reply to the 32,000
  output-token ceiling; Grok preferred; Gemini 3.8 Flash placed in Mid.
- Paid calls may be billed to Kilo credits: the runtime's `is_byok` refusal
  is gone (2026-09-26), and a 402 reads as the balance running out
  (`GATEWAY_CREDITS`).
- Tiers, routing and fallback are built:
  - model choice per session and fallback model (`agents/kilo/tiers.ts`,
    `runtime/envelope-builder.ts`, `agents/runtime/fallback-model.ts`);
  - per-agent tier and fallback (migration 208);
  - hourly gateway reconciliation (`usage/gateway-fees.ts`, migration 209),
    which spreads BerryAuto's classifier fees into
    `task_usage.gateway_fee_micros` and logs a balance below
    `BERRY_KILO_MIN_BALANCE_USD`.
- The interface is built: an agent's General tab picks its tier and shows
  each tier's models (share of tasks, rating, input and output price); the
  Usage page's Spend tab compares the tiers. The fallback model is Berry's
  and has no control in the app.
- Every shipped deployment passes the gateway settings to the runtime as
  well as the server: `sandbox/agentcore/deploy.sh` for AgentCore, the AWS
  host's session env file (`deploy/aws/host/update.sh`, from the
  application secret) and the Dokploy stack
  (`deploy/dokploy/docker-compose.yml`).
- Not yet built: setting aside a model that keeps falling back, for a while.

  The runtime image must be rebuilt for the fallback and usage changes to
  apply.

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

     *Revised again 2026-09-25:* BerryLow takes scored models only, by
     completion per dollar, among those left after Max and Mid and priced no
     higher than BerryMid's dearest, so every paid model an agent runs on has
     a rating. (Capped below Mid's cheapest, as first tried, it held one
     model.) Unscored models are in no paid tier. Only when the gateway sends
     no scores at all does BerryLow fall back to the usage rule above, so
     paid runs still have a model.

     *Revised a third time 2026-09-25: ratings from Terminal-Bench.* Kilo
     rated 11 of the 34 own-key models. The ratings now come from the public
     Terminal-Bench leaderboards (tbench.ai, versions 4.0, 3.0, 2.1 and 2.0,
     read hourly with no key), with Kilo's scores filling gaps
     (`agents/kilo/ratings.ts`). The versions are on different scales, so
     every source is put on 4.0's by a line fitted in log-odds through the
     models it shares with what is already on the scale; a model 4.0 lists
     keeps its 4.0 score. That rated 24 of the 34. With cheap, weak models
     rated, rating per dollar put the weakest first, so the paid tiers
     changed as well:
     - **BerryMax:** the three best rated.
     - **BerryMid:** the best rated of the rest priced below Max's cheapest.
       A model priced at or above it is in no tier: that Max model is rated
       higher for no more money.
     - **BerryLow:** the best rated of the rest priced below Mid's cheapest.
   - **One tier per model:** each model sits only in the highest tier it
     qualifies for.
   - **No outclassed models, and a floor** (2026-09-26). A price ceiling
     alone put Claude Sonnet 5 (0.124, $4.00/M blended) in BerryLow beside
     GPT-5.6 Luna (0.173, $0.45/M). Now a model is in no paid tier when
     another eligible model rates at least as well for less, and Mid and Low
     hold only models reaching a quarter of the best rating, so a tier may
     hold fewer than three. That day Low held Luna alone.

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

- **Risk:** Kilo bills a paid call to credits. **Accepted** since 2026-09-26:
  tiers draw on every provider, so credits are spent by design. Every call's
  cost is still what Kilo reports, and an empty balance stops runs with
  `GATEWAY_CREDITS` rather than silently.
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
