/* 무인(A 손실)과 카트 대기 — 지표가 같은 시간을 두 번 안 빼는지 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('지표 — 무인 · 카트대기');

const m = await import(SRC + 'core/metrics.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

t('무인은 가동률(A)에서 빠진다 — 성능(P)이 아니다', () => {
  m.resetMetrics();
  for (let i = 0; i < 100; i++) m.accumulate(1, null, 0, null, new Set(['A']));
  const o = m.oeeOf('A');
  near(o.availability, 0);
  near(o.performance, 1);          // 돌 수 있었던 시간이 0 → 성능은 깎지 않는다
  near(o.crewSec, 100);
});
t('반은 무인, 반은 막힘', () => {
  m.resetMetrics();
  for (let i = 0; i < 50; i++) m.accumulate(1, null, 0, null, new Set(['B']));
  for (let i = 0; i < 50; i++) m.accumulate(1, new Set(['B']), 0);
  const o = m.oeeOf('B');
  near(o.crewSec, 50);
  near(o.blockSec, 50);
  near(o.availability, 0.5);       // 100초 중 50초는 애초에 못 돌았다
  near(o.performance, 0);          // 돌 수 있었던 50초를 전부 막혔다
  near(o.oee, 0);
});
t('고장 + 무인 + 막힘 + 굶음을 겹쳐 넣어도 합이 전체를 안 넘는다', () => {
  m.resetMetrics();
  const all = new Set(['C']);
  for (let i = 0; i < 100; i++) m.accumulate(1, all, 0, all, all);
  const o = m.oeeOf('C');
  assert.ok(o.crewSec + o.blockSec + o.starveSec <= m.getRan() + 1e-6,
    `합 ${o.crewSec + o.blockSec + o.starveSec} > ran ${m.getRan()}`);
  assert.ok(o.availability >= 0 && o.performance >= 0);
});
t('다시 재기가 무인도 지운다', () => {
  m.resetMetrics();
  m.accumulate(5, null, 0, null, new Set(['D']));
  assert.equal(m.getUnmanned().D, 5);
  m.resetMetrics();
  assert.deepEqual(m.getUnmanned(), {});
});
t('lossSplit 이 인력 손실을 따로 준다', () => {
  m.resetMetrics();
  for (let i = 0; i < 20; i++) m.accumulate(1, null, 0, null, new Set(['E']));
  assert.equal(m.lossSplit().crew, 20);
});

/* ---------- 카트 대기 ---------- */
t('앞차에 막힌 몫만 센다', () => {
  m.resetMetrics();
  m.accumulateCart('K1', 1, 0);        // 그냥 달렸다
  m.accumulateCart('K1', 1, 0.5);      // 속도가 절반으로 깎였다
  m.accumulateCart('K1', 1, 1);        // 아예 섰다
  assert.equal(m.getCartRan().K1, 3);
  assert.equal(m.getCartBlocked().K1, 1.5);
  near(m.cartBlockRatio('K1'), 0.5);
});
t('경로별로 따로 센다', () => {
  m.resetMetrics();
  m.accumulateCart('K1', 10, 5);
  m.accumulateCart('K2', 10, 0);
  near(m.cartBlockRatio('K1'), 0.5);
  near(m.cartBlockRatio('K2'), 0);
  assert.equal(m.cartBlockRatio('없는경로'), 0);
});
t('다시 재기가 카트 기록도 지운다', () => {
  m.resetMetrics();
  m.accumulateCart('K1', 5, 2);
  m.resetMetrics();
  assert.deepEqual(m.getCartBlocked(), {});
  assert.deepEqual(m.getCartRan(), {});
});

/* ---------- SimClock 의 네 갈래 (소스에서 떼어) ---------- */
const src = await readSrc('scene/EditorScene.jsx');
/* 갈라 세는 부분만 — 마지막 accumulate 호출은 빼고 결과를 돌려받는다 */
const CALL = 'accumulate(dt, blockedOnly, shipped, starvedOnly, downOnly);';
const body = cut(src, 'const downOnly = new Set();', CALL, 'SimClock 갈라 세기').slice(0, -CALL.length);
const split = new Function(
  'halted', 'jammed', 'starved', 'unmanned', 'nowDown',
  `${body}\nreturn { downOnly, blockedOnly, starvedOnly };`,
);

const only = (r) => Object.entries(r).filter(([, v]) => v.size).map(([k]) => k);

t('고장이 가장 앞이다', () => {
  const S = new Set(['A']);
  assert.deepEqual(only(split(S, S, S, S, S)), []);   // 전부 고장 쪽으로 빠진다
});
t('무인이 막힘·굶음보다 앞이다', () => {
  const S = new Set(['A']);
  const r = split(S, S, S, S, new Set());
  assert.deepEqual([...r.downOnly], ['A']);
  assert.equal(r.blockedOnly.size, 0);
  assert.equal(r.starvedOnly.size, 0);
});
t('무인이 아니면 막힘', () => {
  const S = new Set(['A']);
  const r = split(S, S, S, new Set(), new Set());
  assert.deepEqual([...r.blockedOnly], ['A']);
});
t('막힘도 아니면 굶음', () => {
  const S = new Set(['A']);
  const r = split(S, new Set(), S, new Set(), new Set());
  assert.deepEqual([...r.starvedOnly], ['A']);
});
t('아무 이유도 없으면 막힘으로 본다 (상류 전파로 선 설비)', () => {
  const r = split(new Set(['A']), new Set(), new Set(), new Set(), new Set());
  assert.deepEqual([...r.blockedOnly], ['A']);
});

