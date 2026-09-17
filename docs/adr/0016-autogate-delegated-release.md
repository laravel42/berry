# ADR-0016: AutoGate delegates the release decision, once per plan

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** Berry platform
- **Related:** [ADR-0015](0015-default-agent-organization.md) (required reviews
  and role contracts; this ADR supersedes its "your approval never releases
  work" wording), [ADR-0014](0014-agentcore-runtime-control-plane.md)

## Context

Berry has said since the beginning that the release gate is always human: a
person moves a task to `done`, and no agent tool can. AutoGate was introduced as
a chip on a plan meaning "agents review each finished task first" — an extra
review before the person, not instead of them.

That produced a product that cannot finish anything on its own. A plan of
thirty-five tasks was compiled, routed and worked, and then stopped dead: every
task waited in `in_review` for thirty-five separate clicks, and the twenty-five
tasks that depended on those never became ready at all, because nothing in Berry
moved a `blocked` task on when its blocker closed. The board looked alive and was
inert.

Two smaller faults made it worse. The review gate refused to review anything
without a pull request, so research, requirements, design and test-strategy
tasks — most of a plan — were never reviewed by anyone, silently: the followup
recorded success and the reviewer was never asked. And when routing or reviewing
failed, nothing said so where the work was.

The question this ADR answers is not "may an agent release work" — the answer to
that stays no. It is "must a person spend their attention per task, or may they
spend it once".

## Decision drivers

- A person must remain the one who decides that work is releasable.
- Consent given deliberately, in advance, for a named scope is still consent.
- The tool boundary must not move: no agent may gain a way to close work.
- A plan that cannot advance its own dependency graph is not autonomous, however
  its tasks are closed.
- Work that produces no code is most of a plan and must be reviewable.

## Considered options

1. **Keep the per-task human gate.** Honest and unchanged, but AutoGate then
   means almost nothing, and Berry cannot run a project — the product's stated
   purpose.
2. **Let agents close their own work** by adding `done` to `set_status` at high
   autonomy. Simple, and wrong: it puts the release in the hands of the agent
   that did the work, removes the independent reviewer from the decision, and
   makes every future autonomy change a release-policy change.
3. **AutoGate delegates the release to the gate, once per plan (chosen).** The
   person decides — at plan time, explicitly, for that plan's tasks. Berry's
   review gate performs the release when the conditions the person delegated
   against are met.

## Decision

**AutoGate on a plan is a person's consent to release that plan's tasks on a
passing review.** It is set before the plan runs, stored on the plan, and
inherited by every task the plan compiles (`issues.auto_gate`).

**A passing review merges the pull request.** A release that leaves the change on
a branch is not a release, and a task marked done over an unmerged branch is a
lie in the direction that costs most: the board says shipped and the base branch
does not have it. So `ReviewGate.#merge` squash-merges before closing, and only
closes if the merge succeeded. GitHub refusing — a conflict, a required check
that has not passed, a protected branch — is the author's work, not the reader's
decision, so it goes back as a rejection carrying GitHub's own words and the loop
continues. GitHub being *unreachable* is different: nothing is known about the
pull request, so the task stays in review rather than being sent back for a
conflict it may not have. This is the sentence in
[ADR-0015](0015-default-agent-organization.md) that no longer holds without
qualification — "nothing merges because an agent said it was finished" — and it
still holds where it matters: no agent has a merge tool, and none gains one here.

**The release is performed by Berry's review gate, not by an agent.**
`set_status` still refuses `done` and `cancelled` at every autonomy level, and no
tool reaches the release path. `ReviewGate.#release` is the only code that closes
a task without a click, and it closes one only when:

- the task carries `auto_gate`,
- every **blocking** required review has approved, and
- the pull request, if there is one, merged.

Advisory reviews comment and do not gate. A blocking rejection sends the task
back with the findings and re-admits its author. Under AutoGate this loop has no
attempt ceiling: it ends when a different agent approves, not when Berry asks a
person to take over. If no role-specific blocking reviewer applies — QA cannot
review its own work, for example — another non-author peer reviews instead.

**Domain reviews stay blocking.** QA on everything, Security on security labels
and paths, the Software Architect on architecture labels and paths. AutoGate
delegates *who waits*, not *what is checked*: the same reviews that would have
run still run, and they now decide something.

**The release is attributed to the person whose consent it was** — the run's
`requested_by` — falling back to the deciding reviewer agent when a run records
no requester, so the audit trail never names a user who was not involved.

**Closing a task starts what it was blocking.** Every dependent whose blockers
are all `done` or `cancelled` moves to `todo`, and the agent already holding it
is given a run. Without this the graph stalls one layer in, which is the
difference between closing tasks and running a project.

**Work with no pull request is reviewed on its account.** The reviewer is given
the task and the author's own account of what it did, told plainly that there is
no diff, and instructed to refuse an account that is vague, that restates the
task, that describes a plan rather than finished work, or that claims what it has
not evidenced. A review that cannot see the work rejects rather than approves.

## Consequences

**A project can now finish without a person.** That is the point, and it is also
the risk: with AutoGate on, tasks are worked, reviewed, sent back and closed with
nobody watching, and every one of those steps is a paid model call. The loop is
intentionally unbounded by attempt count — a fixed ceiling would hand the task
back to the person who explicitly delegated it. AutoGate is off by default and
is a per-plan decision for that reason; operators retain the ability to pause or
cancel the project when spend or progress is wrong.

**A bad reviewer is now a release risk, not just noise.** Before, an agent's
approval cost nothing; now it closes work. The mitigations are that the reviewer
is never the author (`issue_auto_reviews_peer_ck`), that it reviews within its
contract's domains on its own model, and that its verdict and reasoning are
recorded per attempt on the task where a person can read them afterwards.

**Nothing changes for a plan without AutoGate.** Reviews are advice, tasks wait,
and a person releases each one. Dependents of a task a person closes by hand are
*not* advanced by this change — the gate is the only caller — which is a known
asymmetry and the obvious next thing to reconsider.

**Prompts and docs had to change with the code.** `src/organization/prompt.ts`
told every reviewer its approval never releases work. Leaving that in place while
the gate did otherwise would have been a lie to the reviewer and an instruction
to the next agent working on Berry to put the old behaviour back. Same for
AGENTS.md, the coding playbook, the product brief and the steering rules.
