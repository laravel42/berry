import { CARDS, CYCLE_SEEDED, LOG, MOVES, type Card } from "./data";

const CYCLE_START = 41 * 60 + 3; // 12:41:03, matching the first line of the run log
const STEP_SECS = 47;

const NAV_IDS = ["workmodel", "execution", "agents", "opensource"] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatRuntime(secs: number) {
  return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Monotonic within a cycle - the event clock never runs backwards.
function stampAt(step: number) {
  const s = CYCLE_START + step * STEP_SECS;
  return `${12 + Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

function $(id: string) {
  return document.getElementById(id);
}

function setText(id: string, value: string) {
  const el = $(id);
  if (el) el.textContent = value;
}

function renderLog(n: number) {
  const root = $("activity-log");
  if (!root) return;
  const cursor = $("log-cursor");
  const lines = LOG.slice(0, n);
  const rows = lines.map((line) => {
    const row = document.createElement("div");
    row.className = "log-row";
    const time = document.createElement("span");
    time.className = "log-t";
    time.textContent = line.t;
    const msg = document.createElement("span");
    msg.className = "ok" in line && line.ok ? "log-ok" : "log-msg";
    msg.textContent = line.msg;
    row.append(time, msg);
    return row;
  });
  root.replaceChildren(...rows);
  if (cursor) root.append(cursor);
  const last = lines[lines.length - 1];
  setText("log-stamp", last ? last.t : "12:41:03");
}

function cardNode(card: Card, justMoved: boolean) {
  const el = document.createElement("div");
  el.className = justMoved ? "board-card just-moved" : "board-card";
  el.innerHTML = `
    <div class="board-card-meta"><span></span><span></span></div>
    <div class="board-card-title"></div>
    <div class="board-card-who"></div>
  `;
  const meta = el.querySelectorAll("span");
  meta[0]!.textContent = card.id;
  meta[1]!.textContent = card.meta;
  const title = el.querySelector(".board-card-title")!;
  title.textContent = card.title;
  if (card.col === 3) title.classList.add("is-done");
  el.querySelector(".board-card-who")!.textContent = card.who;
  return el;
}

function renderBoard(cards: Card[], moved: number) {
  for (let n = 0; n < 4; n++) {
    const col = $("col-" + n);
    if (!col) continue;
    const items = cards
      .map((card, i) => ({ card, i }))
      .filter(({ card }) => card.col === n);
    col.replaceChildren(...items.map(({ card, i }) => cardNode(card, i === moved)));
    setText("n-" + n, String(items.length));
  }
}

function init() {
  const reduced = prefersReducedMotion();
  let secs = 522;
  let n = reduced ? LOG.length : 4;
  let cards = CARDS.map((card) => ({ ...card }));
  let step = 0;
  let moved = -1;

  const navLinks = Object.fromEntries(
    NAV_IDS.map((id) => [id, document.querySelector(`[data-nav="${id}"]`)])
  );

  function tickRuntime() {
    document.querySelectorAll("[data-runtime]").forEach((el) => {
      el.textContent = formatRuntime(secs);
    });
  }

  function onScroll() {
    let active = "";
    if (window.scrollY > 40) {
      for (const id of NAV_IDS) {
        const el = $(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top <= 140 && r.bottom > 140) active = id;
      }
    }
    for (const id of NAV_IDS) {
      navLinks[id]?.classList.toggle("is-active", id === active);
    }
  }

  function advance() {
    if (step >= MOVES.length) {
      // Cycle complete. Re-seed rather than wrapping cards backwards.
      cards = CARDS.map((card) => ({ ...card }));
      step = 0;
      moved = -1;
      setText("event-time", stampAt(0));
      setText("event-text", CYCLE_SEEDED);
      renderBoard(cards, moved);
      return;
    }
    const m = MOVES[step]!;
    cards = cards.map((card, idx) =>
      idx === m.i ? { ...card, col: m.to, meta: m.meta, who: m.who } : card
    );
    step += 1;
    moved = m.i;
    setText("event-time", stampAt(step));
    setText("event-text", m.text);
    renderBoard(cards, moved);
  }

  tickRuntime();
  renderLog(n);
  renderBoard(cards, moved);

  let tick = 0;
  let feed = 0;
  let board = 0;

  // Motion runs only while its own section is on screen, so no part of the page
  // asks you to read something and watch something else at the same time.
  function whileVisible(el: Element | null, start: () => void, stop: () => void) {
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    new IntersectionObserver(
      (entries) => {
        for (const entry of entries) (entry.isIntersecting ? start : stop)();
      },
      { threshold: 0.12 }
    ).observe(el);
  }

  if (!reduced) {
    whileVisible(
      $("execution"),
      () => {
        if (!tick) {
          tick = window.setInterval(() => {
            secs += 1;
            tickRuntime();
          }, 1000);
        }
        if (!feed) {
          feed = window.setInterval(() => {
            n = n >= LOG.length ? 1 : n + 1;
            renderLog(n);
          }, 1400);
        }
      },
      () => {
        if (tick) { clearInterval(tick); tick = 0; }
        if (feed) { clearInterval(feed); feed = 0; }
      }
    );
    whileVisible(
      $("board"),
      () => {
        if (!board) board = window.setInterval(advance, 2600);
      },
      () => {
        if (board) { clearInterval(board); board = 0; }
      }
    );
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  requestAnimationFrame(() => requestAnimationFrame(onScroll));

  window.addEventListener("pagehide", () => {
    if (tick) clearInterval(tick);
    if (feed) clearInterval(feed);
    if (board) clearInterval(board);
    window.removeEventListener("scroll", onScroll);
  });
}

init();
