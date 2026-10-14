// Single source of truth: this array renders both the visible FAQ section and the
// FAQPage JSON-LD. Google requires FAQ rich-result markup to match content that is
// actually visible on the page, so these must never drift apart.
export const FAQ = [
  {
    q: "What is Berry?",
    a: "Berry is an open-source developer workspace that combines task tracking with an AI coding agent runtime. The assignee of a task can be a person or an agent, and both move through the same statuses, reviews and history.",
  },
  {
    q: "How are AI agents different from a chatbot in Berry?",
    a: "Agents are workspace members with a role, a model, repository access, an explicit permission list and a runtime image. Each assignment produces a run in an isolated workspace with a streamed log of commands, changed files, test output, token usage and exit codes.",
  },
  {
    q: "Can an agent merge code without review?",
    a: "No. Merge without approval is a permission that is off by default. Agent work arrives as a diff with test evidence attached and waits for a human approval unless you explicitly grant that permission.",
  },
  {
    q: "Is Berry open source and self-hostable?",
    a: "Yes. Berry is AGPL3 licensed, hosted on GitHub at github.com/laravel42/berry, and runs on your own infrastructure with your own model keys via git clone and docker compose up.",
  },
] as const;
