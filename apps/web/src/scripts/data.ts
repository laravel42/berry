export type Card = {
  id: string;
  title: string;
  who: string;
  col: number;
  meta: string;
};

export const LOG = [
  { t: "12:41:03", msg: "cloned berry/frontend @ 4f2a9c1" },
  { t: "12:41:09", msg: "inspected src/auth — 11 files" },
  { t: "12:41:44", msg: "read task BER-142 + linked spec" },
  { t: "12:42:17", msg: "modified 4 files (+38 −6)" },
  { t: "12:43:02", msg: "pnpm install --frozen-lockfile" },
  { t: "12:44:51", msg: "pnpm test" },
  { t: "12:45:08", msg: "✓ 84 tests passed · exit 0", ok: true },
  { t: "12:45:39", msg: "pnpm lint — clean" },
  { t: "12:46:22", msg: "opened PR #381 → main", ok: true },
  { t: "12:46:24", msg: "requested review from Andrea" },
] as const;

export const CARDS: Card[] = [
  { id: "BER-142", title: "Implement passkey enrolment", who: "Forge · agent", col: 1, meta: "run #1842" },
  { id: "BER-143", title: "Review session migration", who: "Andrea", col: 2, meta: "PR #380" },
  { id: "BER-144", title: "Update auth documentation", who: "Rhea · agent", col: 0, meta: "queued" },
  { id: "BER-151", title: "Add WebAuthn error copy", who: "unassigned", col: 0, meta: "est 2" },
  { id: "BER-139", title: "Rotate signing keys on deploy", who: "Miro", col: 1, meta: "3h" },
  { id: "BER-136", title: "Harden rate limiting on /session", who: "Forge · agent", col: 3, meta: "merged" },
];

export type Move = {
  i: number;   // index into CARDS
  to: number;  // destination column - always forward, never a wrap
  meta: string;
  who: string;
  text: string;
};

// A closed cycle. Seven forward-only moves take the board from its seeded state
// to a finished one, then it is re-seeded. No card ever regresses, and every
// caption names the card that actually moved and the column it landed in.
export const MOVES: Move[] = [
  { i: 2, to: 1, meta: "run #1849", who: "Rhea · agent",  text: "Rhea started run #1849 on BER-144 · workspace created" },
  { i: 0, to: 2, meta: "PR #381",   who: "Forge · agent", text: "Forge opened PR #381 for BER-142 · 84 tests passed · review requested" },
  { i: 1, to: 3, meta: "merged",    who: "Andrea",        text: "Andrea approved BER-143 · merged into main" },
  { i: 3, to: 1, meta: "run #1850", who: "Forge · agent", text: "BER-151 assigned to Forge · run #1850 started" },
  { i: 2, to: 2, meta: "PR #384",   who: "Rhea · agent",  text: "Rhea opened PR #384 for BER-144 · docs rebuilt · review requested" },
  { i: 4, to: 2, meta: "PR #385",   who: "Miro",          text: "Miro pushed 1 commit to BER-139 · ready for review" },
  { i: 0, to: 3, meta: "merged",    who: "Forge · agent", text: "Andrea approved BER-142 · merged into main" },
];

export const CYCLE_SEEDED = "Cycle 14 planning · board seeded from the backlog";
