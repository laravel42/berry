# PostHog Self-driving setup report

## Summary

PostHog Self-driving is configured for Berry with Session Replay, Error Tracking, and Support enabled, plus health, error, and support signal sources. Two Replay Vision monitors are armed for the public landing page. Findings will start appearing in the [Self-driving inbox](https://us.posthog.com/project/591782/inbox) within about 30 minutes as new data arrives.

## AI data processing

Approved by the wizard gate before this setup began.

## GitHub

The PostHog GitHub App was already connected before this run. GitHub Issues was not selected for Self-driving ingestion, so no GitHub Issues warehouse source or responder was added.

## Products enabled

| Product | Result | Notes |
| --- | --- | --- |
| Session Replay | enabled | Browser init was checked; it does not disable recording. No recordings existed at setup time. |
| Error Tracking | enabled | Browser init was checked; it does not disable exception capture. |
| Support (Conversations) | enabled | An inbound email, inbox, or Slack channel is still required before support tickets arrive. |

## Signal sources

| Source product | Source type | Action |
| --- | --- | --- |
| `signals_scout` | `cross_source_issue` | Platform default is enabled; no opt-out row was created. |
| `health_checks` | `health_issue` | Enabled (source config `01a06664-327f-78ee-ad61-5b5ae723fbb0`). |
| `error_tracking` | `issue_created` | Enabled (source config `01a06664-3285-7bc3-9ffd-04af7cca91b5`). |
| `error_tracking` | `issue_reopened` | Enabled (source config `01a06664-3252-7ba8-b06a-3e803f6dc67e`). |
| `error_tracking` | `issue_spiking` | Enabled (source config `01a06664-3256-78bb-aa73-a060999b29cb`). |
| `conversations` | `ticket` | Enabled (source config `01a06664-324e-7b92-baad-618f75963840`). |
| Session replay responder | retired | Deliberately skipped; Replay Vision scanners provide the session-replay route into the inbox. |

## Connected tools

No issue tracker, external error tracker, or support desk was selected in the connected-tools prompt. No external warehouse sources or connected-tool responders were added.

## Scout troop

Four of 27 built-in scouts are active, each on the server default daily cadence:

| Scout | Status | Reason |
| --- | --- | --- |
| `signals-scout-general` | enabled | Cross-product baseline and otherwise-uncovered surfaces. |
| `signals-scout-web-analytics` | enabled | Berry is a public Astro landing site; traffic, attribution, and landing-page health are relevant. |
| `signals-scout-web-vitals` | enabled | Public-page Core Web Vitals are relevant to visitor experience. |
| `signals-scout-health-checks` | enabled | Newly configured analytics should have active health coverage. |
| `signals-scout-error-tracking` | disabled | Covered by the native Error Tracking source. |
| `signals-scout-session-replay` | disabled | Covered by the Replay Vision monitors below. |
| Other 21 built-in scouts | disabled | Their product surfaces have no current evidence in this repository or project profile. |

The project is enrolled with a verified budget of **100 scout runs per day**; **0** were used at setup time and **100** remained. Early-access banner: “Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more.”

## Custom scouts

No custom scouts were created; the user chose **None — keep the built-in troop**.

Two candidates were considered from repository evidence and declined:

- **GitHub interest conversion:** would watch whether landing-page visitors continue through the GitHub call to action. It complements traffic monitoring by testing a specific visitor-to-interest conversion.
- **Work-model demo engagement:** would watch use of the human-versus-agent explainer control, flagging a material interaction decline or unusually one-sided engagement.

If a future custom scout proves noisy, set `emit: false` on its scout configuration in PostHog to keep it in dry-run mode. Live event-schema discovery was unavailable to this MCP connection, so any future event-specific scout should revalidate its event taxonomy first.

## Replay Vision scanners

A scanner is an LLM that watches individual session recordings on a schedule and pushes high-confidence observations to the inbox. These are the only items in this setup that consume Replay Vision quota. Their findings arrive at half weight and need independent corroboration before promotion into a report.

| Brief | Scanner | Status | Scope | Sampling | Estimate |
| --- | --- | --- | --- | --- | --- |
| Breakage monitor | **Berry landing-page breakage** | created | Recordings whose current URL contains `berry.pm`; the public landing page is Berry’s identifiable visitor flow, including the GitHub call to action, work-model selector, live activity, board demo, and section navigation. | 50% | 0 observations/month, 0 credits/month (no recordings in the 7-day estimate window). |
| Frustration monitor | **Berry visitor frustration** | created | Recordings containing `$rageclick` only; intentionally not URL-scoped so it remains a distinct interaction-based monitor. | 100% | 0 observations/month, 0 credits/month (no recordings in the 7-day estimate window). |

Both monitors are enabled and emit to the inbox. Organization quota was checked before creation: 7,500 credits remained, none were used, and the organization was not exhausted. There are no session recordings yet, so the monitors are armed and start working as recordings arrive.

## Files modified or created

| File | Change |
| --- | --- |
| `posthog-self-driving-report.md` | Created this setup report. |
| Application source files | No changes. Existing browser PostHog initialization was inspected and has no replay or error-tracking opt-out. |

## Follow-ups

- [ ] Connect an inbound Support channel (email, inbox, or Slack) in PostHog so the enabled support responder can receive tickets.
- [ ] Generate browser traffic and recordings; Replay Vision monitors and web scouts have no historical data yet.
- [ ] Reauthorize the MCP connection with event-schema read access before creating any event-specific custom scout.
- [ ] Enable an additional built-in scout later only when its matching PostHog product surface is actively used.

## What happens next

Fresh scout configurations are picked up by the coordinator within about 30 minutes and draw from the daily budget. Findings cluster into reports in the [Self-driving inbox](https://us.posthog.com/project/591782/inbox); immediately actionable reports can start coding tasks.
