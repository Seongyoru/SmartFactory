/* metrics.js — 굶음을 막힘과 갈라 세고, 같은 시간을 두 번 안 빼는지 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('지표 — 막힘 · 굶음');

const m = await import(SRC + 'core/metrics.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

t('굶은 시간은 따로 쌓인다', () => {
  m.resetMetrics();
  for (let i = 0; i < 10; i++) m.accumulate(1, new Set(['A']), 0, new Set(['B']));
  assert.equal(m.getRan(), 10);
  assert.equal(m.getBlocked().A, 10);
  assert.equal(m.getStarved().B, 10);
  assert.equal(m.getBlocked().B, undefined);
});

t('성능은 막힘 + 굶음을 함께 뺀다', () => {
  m.resetMetrics();
  for (let i = 0; i < 100; i++) m.accumulate(1, new Set(), 0, new Set(['C']));
  const o = m.oeeOf('C');
  near(o.availability, 1);
  near(o.performance, 0);          // 100초 중 100초를 굶었다
  near(o.starveSec, 100);
  near(o.blockSec, 0);
});

t('반씩 막히고 굶으면 성능 0', () => {
  m.resetMetrics();
  for (let i = 0; i < 50; i++) m.accumulate(1, new Set(['D']), 0, null);
  for (let i = 0; i < 50; i++) m.accumulate(1, null, 0, new Set(['D']));
  const o = m.oeeOf('D');
  near(o.blockSec, 50);
  near(o.starveSec, 50);
  near(o.performance, 0);
});

t('성능은 음수로 내려가지 않는다 (겹쳐 들어와도)', () => {
  m.resetMetrics();
  for (let i = 0; i < 100; i++) m.accumulate(1, new Set(['E']), 0, new Set(['E']));
  const o = m.oeeOf('E');
  assert.ok(o.performance >= 0, `performance=${o.performance}`);
  near(o.blockSec + o.starveSec, 100);      // 합쳐도 전체 시간을 못 넘는다
});

t('병목은 막힘만 본다 — 굶은 설비는 피해자다', () => {
  m.resetMetrics();
  for (let i = 0; i < 10; i++) m.accumulate(1, new Set(['F']), 0, new Set(['G']));
  for (let i = 0; i < 90; i++) m.accumulate(1, null, 0, new Set(['G']));
  assert.equal(m.bottleneck().uid, 'F');    // 10초 막힘
  assert.equal(m.starvedWorst().uid, 'G');  // 100초 굶음 — 병목이 아니다
});

t('어느 쪽으로 더 잃었는지', () => {
  m.resetMetrics();
  for (let i = 0; i < 10; i++) m.accumulate(1, new Set(['H']), 0, new Set(['I']));
  for (let i = 0; i < 90; i++) m.accumulate(1, null, 0, new Set(['I']));
  const s = m.lossSplit();
  assert.equal(s.block, 10);
  assert.equal(s.starve, 100);
  assert.equal(s.starvedMore, true);
});

t('다시 재기가 굶음도 지운다', () => {
  m.resetMetrics();
  m.accumulate(5, null, 0, new Set(['J']));
  assert.equal(m.getStarved().J, 5);
  m.resetMetrics();
  assert.deepEqual(m.getStarved(), {});
  assert.equal(m.lossSplit(), null);
});

/* SimClock 의 갈라 세기는 이유가 넷으로 늘어 check-metrics2.mjs 로 옮겼다 */

