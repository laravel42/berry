import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineRatings, modelKey, parseLeaderboard, type Scores } from './ratings.ts';

/** Terminal-Bench ratings: read per leaderboard, then put on the newest one's scale. */

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
const scores = (entries: Record<string, number>): Scores => new Map(Object.entries(entries));

test('one model under the names the sources give it is one key', () => {
   assert.equal(modelKey('anthropic/claude-opus-4.7'), modelKey('Claude Opus 4.7'));
   assert.equal(modelKey('Opus 4.7'), modelKey('Claude Opus 4.7'));
   assert.equal(modelKey('Claude 4.5 Sonnet'), modelKey('anthropic/claude-sonnet-4.5'));
   assert.equal(modelKey('GPT-5.6 Luna'), modelKey('openai/gpt-5.6-luna'));
   assert.equal(modelKey('nvidia/nemotron-3:free'), modelKey('nvidia/nemotron-3'));
   assert.notEqual(modelKey('Qwen 3 Coder 480B'), modelKey('qwen/qwen3-coder-next'));
   assert.notEqual(modelKey('Opus 4.7'), modelKey('Opus 4.8'));
});

test('a leaderboard gives each model its best run, in percent or fractions', () => {
   const row = (label: unknown, accuracy: number) => ({ metadata: { model_display: label }, metrics: { accuracy } });
   const percent = parseLeaderboard({
      rows: [row({ label: 'GPT-6 Astra' }, 54.2), row({ label: 'GPT-6 Astra' }, 58.18), row('Opus 4.8', 23.6), { metadata: {} }],
   });
   assert.deepEqual(
      [...percent].map(([key, rate]) => [key, Math.round(rate * 10_000) / 10_000]),
      [
         [modelKey('GPT-6 Astra'), 0.5818],
         [modelKey('Opus 4.8'), 0.236],
      ]
   );
   const fractions = parseLeaderboard({ rows: [row('Kimi K2.5', 0.432)] });
   assert.equal(fractions.get(modelKey('Kimi K2.5')), 0.432);
   assert.throws(() => parseLeaderboard({ error: 'nope' }));
});

test('the newest leaderboard keeps its scores; an older one is converted through shared models, in log-odds', () => {
   // The older version is easier: logit(new) = 2·logit(old) − 3, exactly.
   const toNew = (old: number) => sigmoid(2 * logit(old) - 3);
   const newest = scores({ a: toNew(0.9), b: toNew(0.8), c: toNew(0.7) });
   const older = scores({ a: 0.9, b: 0.8, c: 0.7, cheap: 0.4 });
   const { scale, ratings } = combineRatings([
      { title: 'TB 4', scores: newest },
      { title: 'TB 2', scores: older },
   ]);
   assert.equal(scale, 'TB 4');
   assert.equal(ratings.get('a'), newest.get('a'), 'a model on the scale keeps its own score');
   assert.ok(Math.abs(ratings.get('cheap')! - toNew(0.4)) < 1e-9, 'the older-only model lands on the new scale');
});

test('a source reaches the scale through another, and one sharing too few models is left out', () => {
   const newest = scores({ a: 0.5, b: 0.4, c: 0.3 });
   const middle = scores({ a: 0.9, b: 0.85, c: 0.8, d: 0.7 });
   // Shares only a and b with the scale until middle brings d onto it.
   const oldest = scores({ d: 0.8, e: 0.6, a: 0.95, b: 0.9, g: 0.3 });
   const lonely = scores({ a: 0.6, z: 0.2 });
   const { ratings } = combineRatings([
      { title: 'new', scores: newest },
      { title: 'lonely', scores: lonely },
      { title: 'old', scores: oldest },
      { title: 'middle', scores: middle },
   ]);
   assert.ok(ratings.has('g'), 'oldest joins through middle, which rates d');
   assert.ok(ratings.get('g')! < ratings.get('d')!, 'order within a source survives the conversion');
   assert.equal(ratings.has('z'), false, 'a source sharing one model is not guessed at');
});

test('with no leaderboard at all, the first source present sets the scale', () => {
   const { scale, ratings } = combineRatings([
      { title: 'TB 4', scores: new Map() },
      { title: 'Kilo', scores: scores({ a: 0.7 }) },
   ]);
   assert.equal(scale, 'Kilo');
   assert.equal(ratings.get('a'), 0.7);
   assert.deepEqual(combineRatings([]), { scale: null, ratings: new Map() });
});
