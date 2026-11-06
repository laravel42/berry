# Berry software skills

232 narrow, production-oriented Agent Skills: eight for each of the
29 software and code-writing roles in Berry's organization catalogue, the
Orchestrator, Planner and Reviewer included. Each skill is labelled with its role, and a role
agent is bound to exactly its own eight.

Each skill contains:
- precise activation criteria
- a concrete required deliverable
- capability-specific checks
- evidence-first workflow
- verification requirements
- escalation boundaries
- capability-specific anti-patterns

The pack intentionally avoids duplicating AWS service-operation expertise that can be supplied
by Amazon Bedrock AgentCore's prebuilt AWS Skills.

Edit a `SKILL.md` and its `manifest.json` entry together; the manifest is what
the seeder reads for the name, role and description.

| Role | Skills | Names |
| --- | --- | --- |
| Product Lead | 8 | `product-discovery`, `prd-authoring`, `roadmap-prioritization`, `acceptance-criteria`, `feature-triage`, `release-readiness`, `product-metrics-review`, `competitive-product-analysis` |
| Business Analyst | 8 | `requirements-elicitation`, `user-story-mapping`, `business-rules-analysis`, `process-modeling`, `requirements-gap-analysis`, `stakeholder-analysis`, `data-requirements-definition`, `business-case-analysis` |
| UX Researcher | 8 | `persona-analysis`, `journey-mapping`, `usability-review`, `feedback-synthesis`, `user-research-plan`, `interview-guide-design`, `usability-test-protocol`, `insight-repository` |
| Product Designer | 8 | `information-architecture`, `interaction-design`, `design-system-governance`, `accessibility-design-review`, `design-handoff`, `user-flow-design`, `interface-copy`, `marketing-page-design` |
| Software Architect | 8 | `architecture-discovery`, `architecture-decision-records`, `service-boundary-design`, `api-contract-design`, `system-design-review`, `dependency-analysis`, `migration-planning`, `technical-debt-assessment` |
| Backend Engineer | 8 | `rest-api-implementation`, `background-job-design`, `authentication-authorization`, `backend-performance`, `error-handling`, `domain-service-design`, `systematic-debugging`, `caching-strategy` |
| Frontend Engineer | 8 | `react-component-engineering`, `frontend-state-management`, `frontend-performance`, `responsive-ui`, `frontend-accessibility`, `frontend-testing`, `form-engineering`, `frontend-internationalization` |
| Database Engineer | 8 | `schema-design`, `safe-migrations`, `query-optimization`, `index-design`, `data-integrity`, `backup-restore-verification`, `data-retention-design`, `data-backfill-planning` |
| Integration Engineer | 8 | `oauth-integration`, `webhook-engineering`, `third-party-api-adapter`, `rate-limit-resilience`, `integration-contract-testing`, `data-sync-design`, `integration-observability`, `provider-migration` |
| QA Engineer | 8 | `test-strategy`, `e2e-testing`, `regression-testing`, `bug-reproduction`, `exploratory-testing`, `release-quality-gate`, `test-data-management`, `load-testing` |
| Security Engineer | 8 | `threat-modeling`, `secure-code-review`, `secrets-management`, `dependency-security`, `auth-security-review`, `security-incident-triage`, `owasp-web-review`, `privacy-data-review` |
| DevOps Engineer | 8 | `ci-cd-pipeline`, `docker-production`, `infrastructure-as-code`, `deployment-strategy`, `environment-management`, `cloud-cost-review`, `dns-tls-management`, `build-pipeline-performance` |
| Site Reliability Engineer | 8 | `slo-sli-design`, `observability-design`, `incident-response`, `postmortem`, `capacity-planning`, `reliability-review`, `alert-tuning`, `disaster-recovery-drill` |
| Data & Analytics Engineer | 8 | `event-taxonomy`, `funnel-analysis`, `retention-analysis`, `analytics-quality`, `experiment-analysis`, `metric-definition`, `dashboard-design`, `sql-analysis-review` |
| Technical Writer | 8 | `developer-documentation`, `api-documentation`, `runbook-authoring`, `release-notes`, `documentation-audit`, `user-guide-authoring`, `tutorial-authoring`, `docs-site-structure` |
| Growth Engineer | 8 | `technical-seo-audit`, `programmatic-seo`, `activation-funnel`, `growth-experiment`, `conversion-review`, `referral-loop-design`, `lifecycle-messaging`, `pricing-experiment` |
| Engineering Manager | 8 | `task-decomposition`, `dependency-coordination`, `engineering-risk-management`, `code-review-orchestration`, `team-capacity-allocation`, `delivery-status-report`, `retrospective-facilitation`, `blocker-resolution` |
| CTO | 8 | `technology-strategy`, `build-vs-buy`, `architecture-governance`, `technical-risk-review`, `engineering-maturity`, `technology-budget-review`, `vendor-technical-due-diligence`, `engineering-org-design` |
| Orchestrator | 8 | `request-routing`, `specialist-gap-detection`, `cross-role-delegation`, `workspace-status-briefing`, `escalation-routing`, `review-assignment`, `duplicate-work-detection`, `workspace-onboarding` |
| Planner | 8 | `request-to-plan`, `goal-definition`, `task-sizing`, `owner-assignment`, `dependency-sequencing`, `plan-risk-review`, `replanning`, `plan-acceptance-checks` |
| Software Engineer | 8 | `feature-implementation`, `bug-fix-delivery`, `test-driven-change`, `safe-refactoring`, `codebase-orientation`, `dependency-upgrade`, `change-description`, `feature-flag-rollout` |
| Reviewer | 8 | `review-verdict`, `diff-review`, `acceptance-verification`, `document-deliverable-review`, `test-evidence-review`, `risk-flagging-review`, `review-comment-writing`, `follow-up-review` |
| Mobile Engineer | 8 | `mobile-feature-implementation`, `offline-and-sync`, `mobile-permissions`, `mobile-performance`, `app-store-release-prep`, `mobile-unit-testing`, `mobile-accessibility`, `mobile-crash-triage` |
| Test Automation Engineer | 8 | `critical-flow-automation`, `flaky-test-remediation`, `test-suite-speed`, `coverage-gap-report`, `api-test-automation`, `test-framework-setup`, `visual-regression-testing`, `test-reporting` |
| Performance Engineer | 8 | `response-time-measurement`, `slow-path-diagnosis`, `load-test-plan`, `performance-budget`, `frontend-load-optimization`, `database-query-performance`, `capacity-forecast`, `performance-regression-guard` |
| Cloud Engineer | 8 | `iac-module`, `least-privilege-access`, `network-design`, `environment-parity`, `storage-design`, `infrastructure-change-runbook`, `cloud-right-sizing`, `secrets-in-infrastructure` |
| Platform Engineer | 8 | `service-template`, `shared-build-tooling`, `platform-documentation`, `developer-friction-measurement`, `golden-path-design`, `local-dev-environment`, `platform-upgrade-rollout`, `platform-adoption-review` |
| Systems Administrator | 8 | `maintenance-scripting`, `backup-verification`, `patch-tracking`, `system-runbook`, `access-review`, `monitoring-setup`, `server-hardening`, `disaster-recovery-runbook` |
| Data Scientist | 8 | `question-framing-for-data`, `reproducible-data-exploration`, `model-building`, `model-evaluation`, `results-explanation`, `experiment-design`, `causal-analysis`, `model-monitoring` |
