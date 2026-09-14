# Berry architecture

Berry is a control plane: it decides what work happens, records everything, and keeps a person at the release decision. Something separate, the agent runtime on AWS, does the work.

## System overview

```mermaid
flowchart LR
    classDef people fill:#fde68a,stroke:#b45309,color:#1f2937
    classDef app fill:#dbeafe,stroke:#1d4ed8,color:#1f2937
    classDef server fill:#e0e7ff,stroke:#4338ca,color:#1f2937
    classDef data fill:#dcfce7,stroke:#15803d,color:#1f2937
    classDef aws fill:#ffedd5,stroke:#c2410c,color:#1f2937
    classDef ext fill:#f3f4f6,stroke:#4b5563,color:#1f2937

    subgraph PEOPLE[" "]
        direction TB
        person(["People<br/>assign, review, approve, merge"]):::people
    end

    subgraph WEB["Berry web app — Next.js"]
        direction TB
        ui["Tasks, boards, plans, goals,<br/>Reviews, Approvals, Proposals,<br/>Agents, Chat, Settings"]:::app
        sse["Live updates (SSE)"]:::app
    end

    subgraph SERVER["Berry server — TypeScript control plane (no model SDK)"]
        direction TB
        api["HTTP API<br/>/api/v1/*"]:::server
        auth["Sign-in<br/>Better Auth, GitHub only"]:::server
        planner["Planner & triage<br/>plan → goals → tasks → Orchestrator routes"]:::server
        org["Organization<br/>19 role contracts, autonomy levels 1–5,<br/>required reviews, proposals, discovery"]:::server
        dispatcher["Run dispatcher<br/>lease with SKIP LOCKED, envelope"]:::server
        ledger["Run ledger<br/>append-only events, task status"]:::server
        gate["Review gate<br/>AutoGate & role reviews; never Done"]:::server
        tools["Agent tools API<br/>/api/v1/agent-tools — task-scoped token,<br/>autonomy allowlist"]:::server
        scm["Delivery<br/>branch, push, pull request"]:::server
        publicapi["Public API /v1<br/>tokens, plugin SDK"]:::server
    end

    subgraph DB["PostgreSQL 16"]
        direction TB
        pg[("tasks · projects · goals · plans<br/>agents & contracts · runs & events<br/>approvals · proposals · outbox")]:::data
    end

    subgraph AWS["AWS"]
        direction TB
        agentcore["Bedrock AgentCore Runtime<br/>one isolated microVM per session"]:::aws
        image["Berry runtime image<br/>Strands agent loop + permission plugin<br/>clone · edit · run checks · push"]:::aws
        bedrock["Amazon Bedrock<br/>Claude Opus · Sonnet · Haiku"]:::aws
        s3[("S3<br/>run artifacts")]:::aws
    end

    subgraph GH["GitHub"]
        direction TB
        oauth["OAuth sign-in<br/>scope: repo"]:::ext
        repo["Repositories<br/>branches & pull requests"]:::ext
    end

    subgraph EXT["Extensions"]
        direction TB
        mcp["MCP servers<br/>(optionally via AgentCore Gateway)"]:::ext
        plugins["Plugins & scripts"]:::ext
    end

    person --> ui
    ui -->|"same-origin proxy"| api
    sse -.->|"replayed from outbox"| ui
    api --> auth
    auth <--> oauth
    api --> planner
    api --> org
    api --> gate
    api --> ledger
    planner --> dispatcher
    org --> dispatcher
    dispatcher -->|"InvokeAgentRuntime"| agentcore
    agentcore --> image
    image <-->|"model calls"| bedrock
    image -.->|"lifecycle event stream"| ledger
    image -->|"named tool calls<br/>with the run's token"| tools
    tools --> org
    image --> mcp
    image -->|"push branch"| repo
    scm -->|"open PR with a member's sign-in"| repo
    ledger --> scm
    ledger --> gate
    gate -->|"waits for a person"| person
    person -->|"merge"| repo
    api --> pg
    ledger --> pg
    ledger --> s3
    plugins --> publicapi
    publicapi --> api
    planner -.->|"completion tasks"| dispatcher
```

## Life of a task

```mermaid
sequenceDiagram
    autonumber
    actor P as Person
    participant W as Web app
    participant B as Berry server
    participant DB as PostgreSQL
    participant R as AgentCore Runtime
    participant M as Bedrock (Claude)
    participant G as GitHub

    P->>W: Create project, lead = AI workflow
    W->>B: POST /plans/generate (autoStart)
    B->>R: completion task: draft the plan
    R->>M: model call
    R-->>B: plan (milestones, tasks, dependencies)
    B->>DB: goals + tasks (blocked ones wait)
    B->>R: completion task: Orchestrator routes
    R-->>B: assignments per role
    B->>DB: assign, queue runs
    Note over B: task → In progress when its run starts
    B->>R: InvokeAgentRuntime (envelope + run token)
    loop agent loop
        R->>M: think
        R->>B: agent tools (read task, comment, …) — autonomy checked
        R->>R: edit, run checks
    end
    R->>G: push branch
    R-->>B: run.delivered
    B->>G: open pull request
    B->>DB: task → In review
    opt AutoGate on
        B->>R: required role reviews (QA, Security, …)
        R-->>B: verdicts (never Done)
    end
    P->>W: Reviews: Approve or Send back
    W->>B: decision
    B->>DB: Done (or back to Todo with the note)
    B->>DB: release dependent tasks → Todo, queue their runs
    P->>G: merge the pull request
```

## Reading the diagram

- **The server never calls a model.** Every model call happens inside the runtime image on AWS. A repository check fails if a model SDK is imported by the server.
- **One narrow door for agents.** An agent reaches Berry only through the agent tools API, with a token minted for its run. The token names the workspace and the task; the model can't choose them. Each tool call is checked against the agent's autonomy level.
- **A person releases the work.** No agent tool can set *Done* or *Cancelled*, no autonomy level includes a merge tool, and a reviewer agent's approval leaves the task in review.
- **Everything is a record.** Runs are append-only event logs, task changes write outbox events in the same transaction, and live pages replay from that table.
