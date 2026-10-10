# Development skills

Development assistants discover the vendored skill folders in `.agents/skills/`.
These are repository development skills, not automatically imported into Berry's product skill catalog or assigned to organization agents.

## Usage and precedence

- Read `AGENTS.md` and the applicable workspace instructions before using a skill.
- Load only skills relevant to the current task. Installing a collection does not activate every workflow.
- Berry's instructions and user authorization take precedence over upstream prescriptions, including always-on entry points.
- Use the current workspace manifest for versions and commands. Preserve independent workspace toolchains and the existing pnpm layout.
- Model execution stays in the isolated runtime. Never move provider calls or credentials into the product server or frontend.
- Preserve human release decisions, task-scoped tools, immutable migrations, and exact description bytes.
- Skills do not authorize merges, releases, deployments, messages, or destructive actions.
- Tiptap guidance applies to designated rich-text views; it must not replace exact-byte description inputs.
- PostgreSQL guidance applies to hosted Postgres and desktop PGlite only where their capabilities match.
- AWS examples may use Python or Terraform; use Berry's TypeScript Strands runtime and existing infrastructure conventions.
- Upstream scripts are included as supporting source. Review them and install their documented dependencies only when a task calls for them.

## Provenance and updates

`.agents/skills-manifest.json` records each newly installed skill's upstream commit, source path, license evidence, and SHA-256 for every installed file.
The existing `skills-lock.json` remains owned by its original installer. Existing skill folders were not replaced.
Update vendored skills deliberately from their upstream source, review the diff, preserve license notices, and regenerate the manifest file hashes.

## Installed additions

| Skill | Area | Pinned source |
| --- | --- | --- |
| `aws-bedrock-agentcore-skill` | AWS agent runtime | [ferdinandobons/AWSBedrockAgentCoreSkill](https://github.com/ferdinandobons/AWSBedrockAgentCoreSkill/tree/973bcbd3a54c249ab5f76503cb0e5fff056b495b/skills/aws-bedrock-agentcore-skill) |
| `advanced-evaluation` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/advanced-evaluation) |
| `agent-evaluation-designer` | Agent engineering | [microsoft/cat-agent-skills](https://github.com/microsoft/cat-agent-skills/tree/0da8412e47acd01a19d8b4f2e43fed33872effe6/submissions/agent-evaluation-designer) |
| `context-compression` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/context-compression) |
| `context-degradation` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/context-degradation) |
| `context-fundamentals` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/context-fundamentals) |
| `context-optimization` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/context-optimization) |
| `evaluation` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/evaluation) |
| `filesystem-context` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/filesystem-context) |
| `harness-engineering` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/harness-engineering) |
| `hosted-agents` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/hosted-agents) |
| `latent-briefing` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/latent-briefing) |
| `long-horizon-prompting` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/long-horizon-prompting) |
| `memory-systems` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/memory-systems) |
| `multi-agent-patterns` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/multi-agent-patterns) |
| `project-development` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/project-development) |
| `self-improvement-loops` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/self-improvement-loops) |
| `self-managed-context` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/self-managed-context) |
| `tool-design` | Agent engineering | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/58b55a8921758d13453b440704fb1b5b208c0b0e/skills/tool-design) |
| `supabase-postgres-best-practices` | Database | [supabase/agent-skills](https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices) |
| `design-critique` | Design review | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-ops/skills/design-critique) |
| `design-debt-audit` | Design review | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-ops/skills/design-debt-audit) |
| `design-qa-checklist` | Design review | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-ops/skills/design-qa-checklist) |
| `design-review-process` | Design review | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-ops/skills/design-review-process) |
| `handoff-spec` | Design review | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-ops/skills/handoff-spec) |
| `accessibility-audit` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/accessibility-audit) |
| `component-spec` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/component-spec) |
| `design-system-governance` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/design-system-governance) |
| `design-token` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/design-token) |
| `documentation-template` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/documentation-template) |
| `localization-design` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/localization-design) |
| `motion-system` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/motion-system) |
| `pattern-library` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/pattern-library) |
| `theming-system` | Design system | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-systems/skills/theming-system) |
| `electron-best-practices` | Desktop | [octaviantocan/pawrrtal-ai](https://github.com/octaviantocan/pawrrtal-ai/tree/5a11fd18fcdc1865dc28cf317d326d0aab7c4538/.agent/skills/electron-best-practices) |
| `doc-coauthoring` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/doc-coauthoring) |
| `frontend-design` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design) |
| `mcp-builder` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/mcp-builder) |
| `skill-creator` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/skill-creator) |
| `web-artifacts-builder` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/web-artifacts-builder) |
| `webapp-testing` | Development and documentation | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing) |
| `github-actions` | Development tooling | [oakoss/agent-skills](https://github.com/oakoss/agent-skills/tree/85e3a3919d9e0ec7f7302a5143ec4b3e66f5f6ad/skills/github-actions) |
| `pglite` | Development tooling | [oakoss/agent-skills](https://github.com/oakoss/agent-skills/tree/85e3a3919d9e0ec7f7302a5143ec4b3e66f5f6ad/skills/pglite) |
| `pnpm` | Development tooling | [antfu/skills](https://github.com/antfu/skills/tree/feb0f3aba6566426f12230e7fc7a10d97c1293bb/skills/pnpm) |
| `vite` | Development tooling | [antfu/skills](https://github.com/antfu/skills/tree/feb0f3aba6566426f12230e7fc7a10d97c1293bb/skills/vite) |
| `vitest` | Development tooling | [antfu/skills](https://github.com/antfu/skills/tree/feb0f3aba6566426f12230e7fc7a10d97c1293bb/skills/vitest) |
| `ask-matt` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/ask-matt) |
| `brainstorming` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/brainstorming) |
| `claude-handoff` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/in-progress/claude-handoff) |
| `code-review` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/code-review) |
| `codebase-design` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/codebase-design) |
| `diagnosing-bugs` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/diagnosing-bugs) |
| `diagnosing-superpowers` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/diagnosing-superpowers) |
| `dispatching-parallel-agents` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/dispatching-parallel-agents) |
| `domain-modeling` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/domain-modeling) |
| `executing-plans` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/executing-plans) |
| `finishing-a-development-branch` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/finishing-a-development-branch) |
| `git-guardrails-claude-code` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/misc/git-guardrails-claude-code) |
| `grill-me` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/grill-me) |
| `grill-with-docs` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/grill-with-docs) |
| `grilling` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/grilling) |
| `handoff` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/handoff) |
| `implement` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement) |
| `implement-spec` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec) |
| `improve-codebase-architecture` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/improve-codebase-architecture) |
| `loop-me` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/in-progress/loop-me) |
| `pr` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/pr) |
| `prototype` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/prototype) |
| `receiving-code-review` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/receiving-code-review) |
| `requesting-code-review` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/requesting-code-review) |
| `research` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/research) |
| `retro` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro) |
| `setup-matt-pocock-skills` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/setup-matt-pocock-skills) |
| `setup-pre-commit` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/misc/setup-pre-commit) |
| `setup-ts-deep-modules` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/in-progress/setup-ts-deep-modules) |
| `subagent-driven-development` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/subagent-driven-development) |
| `systematic-debugging` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/systematic-debugging) |
| `tdd` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd) |
| `test-driven-development` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/test-driven-development) |
| `to-questionnaire` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/to-questionnaire) |
| `to-spec` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-spec) |
| `to-tickets` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-tickets) |
| `triage` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/triage) |
| `using-git-worktrees` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/using-git-worktrees) |
| `using-superpowers` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/using-superpowers) |
| `verification-before-completion` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/verification-before-completion) |
| `wayfinder` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/wayfinder) |
| `wizard` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/wizard) |
| `writing-for-agents` | Engineering workflow | [mattpocock/skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/writing-for-agents) |
| `writing-plans` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/writing-plans) |
| `writing-skills` | Engineering workflow | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/writing-skills) |
| `github-integration` | Integrations | [inbharatai/claude-skills](https://github.com/inbharatai/claude-skills/tree/02077f8b2c05946a71fa087dee6d614c0b4e4e0d/skills/github-integration) |
| `conversational-ux` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/conversational-ux) |
| `error-handling-ux` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/error-handling-ux) |
| `feedback-patterns` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/feedback-patterns) |
| `form-design` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/form-design) |
| `loading-states` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/loading-states) |
| `micro-interaction-spec` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/micro-interaction-spec) |
| `navigation-patterns` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/navigation-patterns) |
| `onboarding-design` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/onboarding-design) |
| `search-ux` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/search-ux) |
| `state-machine` | Interaction design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/interaction-design/skills/state-machine) |
| `shadcn` | React and UI | [shadcn-ui/ui](https://github.com/shadcn-ui/ui/tree/2d3f1cd436b18ea12f24130de4df781355925b08/skills/shadcn) |
| `vercel-composition-patterns` | React and UI | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/composition-patterns) |
| `vercel-react-best-practices` | React and UI | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices) |
| `vercel-react-native-skills` | React and UI | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-native-skills) |
| `web-design-guidelines` | React and UI | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines) |
| `authentication-failures` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/authentication-failures) |
| `broken-access-control` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/broken-access-control) |
| `concurrency-correctness` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/concurrency-correctness) |
| `cryptographic-failures` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/cryptographic-failures) |
| `csrf` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/csrf) |
| `excessive-agency` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/excessive-agency) |
| `file-upload` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/file-upload) |
| `hardcoded-secrets` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/hardcoded-secrets) |
| `header-injection` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/header-injection) |
| `injection` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/injection) |
| `insecure-local-storage` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/insecure-local-storage) |
| `insecure-output-handling` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/insecure-output-handling) |
| `insecure-plugin-design` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/insecure-plugin-design) |
| `integrity-failures` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/integrity-failures) |
| `ipc-security` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/ipc-security) |
| `llm-supply-chain` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/llm-supply-chain) |
| `logging-failures` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/logging-failures) |
| `mass-assignment` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/mass-assignment) |
| `mcp-security` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/mcp-security) |
| `memory-api-misuse` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/memory-api-misuse) |
| `model-dos` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/model-dos) |
| `multi-agent-trust` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/multi-agent-trust) |
| `oauth-implementation` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/oauth-implementation) |
| `open-redirect` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/open-redirect) |
| `path-traversal` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/path-traversal) |
| `prompt-injection` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/prompt-injection) |
| `prototype-pollution` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/prototype-pollution) |
| `race-condition` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/race-condition) |
| `rag-security` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/rag-security) |
| `redos` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/redos) |
| `security-misconfiguration` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/security-misconfiguration) |
| `sensitive-disclosure` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/sensitive-disclosure) |
| `ssrf` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/ssrf) |
| `supply-chain` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/supply-chain) |
| `unsafe-api-consumption` | Security | [thejefflarson/soundcheck](https://github.com/thejefflarson/soundcheck/tree/4fc07c9516e2c64766dfdc47ae1508d9d7a5905d/.claude/skills/unsafe-api-consumption) |
| `api-database-postgresql` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/api-database-postgresql) |
| `api-framework-hono` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/api-framework-hono) |
| `api-performance-api-performance` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/api-performance-api-performance) |
| `api-specs-openapi` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/api-specs-openapi) |
| `desktop-framework-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-framework-electron) |
| `desktop-ipc-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-ipc-electron) |
| `desktop-multiwindow-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-multiwindow-electron) |
| `desktop-security-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-security-electron) |
| `desktop-storage-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-storage-electron) |
| `desktop-testing-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-testing-electron) |
| `desktop-ui-electron` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-ui-electron) |
| `desktop-updates-electron-updater` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/desktop-updates-electron-updater) |
| `mobile-framework-expo` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/mobile-framework-expo) |
| `mobile-framework-react-native` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/mobile-framework-react-native) |
| `mobile-navigation-expo-router` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/mobile-navigation-expo-router) |
| `mobile-security-react-native` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/mobile-security-react-native) |
| `shared-monorepo-pnpm-workspaces` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/shared-monorepo-pnpm-workspaces) |
| `shared-security-auth-security` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/shared-security-auth-security) |
| `shared-tooling-typescript-config` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/shared-tooling-typescript-config) |
| `web-dataviz-recharts` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-dataviz-recharts) |
| `web-editor-tiptap` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-editor-tiptap) |
| `web-error-handling-error-boundaries` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-error-handling-error-boundaries) |
| `web-files-file-upload-patterns` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-files-file-upload-patterns) |
| `web-files-image-handling` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-files-image-handling) |
| `web-forms-react-hook-form` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-forms-react-hook-form) |
| `web-forms-zod-validation` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-forms-zod-validation) |
| `web-framework-react` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-framework-react) |
| `web-meta-framework-nextjs` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-meta-framework-nextjs) |
| `web-realtime-sse` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-realtime-sse) |
| `web-state-zustand` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-state-zustand) |
| `web-styling-cva` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-styling-cva) |
| `web-styling-tailwind` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-styling-tailwind) |
| `web-styling-theming` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-styling-theming) |
| `web-testing-playwright-e2e` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-testing-playwright-e2e) |
| `web-testing-react-testing-library` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-testing-react-testing-library) |
| `web-testing-visual-regression` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-testing-visual-regression) |
| `web-tooling-storybook` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-tooling-storybook) |
| `web-ui-radix-ui` | Stack-specific development | [agents-inc/skills](https://github.com/agents-inc/skills/tree/3a51ef571e996b18294bf776d53dbdad26de0617/src/skills/web-ui-radix-ui) |
| `color-system` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/color-system) |
| `dark-mode-design` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/dark-mode-design) |
| `data-visualization` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/data-visualization) |
| `layout-grid` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/layout-grid) |
| `responsive-design` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/responsive-design) |
| `spacing-system` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/spacing-system) |
| `typography-scale` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/typography-scale) |
| `visual-hierarchy` | UI design | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ui-design/skills/visual-hierarchy) |
| `interview-script` | UX research | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-research/skills/interview-script) |
| `jobs-to-be-done` | UX research | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-research/skills/jobs-to-be-done) |
| `usability-test-plan` | UX research | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-research/skills/usability-test-plan) |
| `user-persona` | UX research | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/design-research/skills/user-persona) |
| `information-architecture` | UX strategy | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ux-strategy/skills/information-architecture) |
| `metrics-definition` | UX strategy | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/ux-strategy/skills/metrics-definition) |
| `accessibility-test-plan` | UX validation | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/prototyping-testing/skills/accessibility-test-plan) |
| `heuristic-evaluation` | UX validation | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/prototyping-testing/skills/heuristic-evaluation) |
| `prototype-strategy` | UX validation | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/prototyping-testing/skills/prototype-strategy) |
| `test-scenario` | UX validation | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/prototyping-testing/skills/test-scenario) |
| `wireframe-spec` | UX validation | [Owl-Listener/designer-skills](https://github.com/Owl-Listener/designer-skills/tree/9a6930cf84a822eb458624bd11c61aac5bbdf224/prototyping-testing/skills/wireframe-spec) |

## Reference-only listings

`aws-strands` and `aws-harness` from [hoodini/ai-agents-skills](https://github.com/hoodini/ai-agents-skills) were not copied because no explicit permissive license was found.
The installed MIT-licensed `aws-bedrock-agentcore-skill` covers Strands, AgentCore Runtime, Memory, Gateway, Identity, and observability.

## Stack exclusions

Fastify, BullMQ, SQLite, TanStack Query/Router/AI, Docker Compose scaffolding, and alternative framework skills from the discovery inventory were excluded because they do not match the current manifests or repository boundaries.
The mobile workspace does use Expo/React Native, so matching mobile guidance is included.
