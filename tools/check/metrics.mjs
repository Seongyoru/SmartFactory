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


/* ---------- 불량은 **만든 설비의** 문제다 ---------------------------------
     설비 하나의 불량률을 올렸더니 아무 상관 없는 설비의 OEE 까지 떨어졌다.
     OEE 의 품질 항이 전부 라인 합계를 보고 있었기 때문이다 — 사용자가 찾았다.
--------------------------------------------------------------------------- */

const f = await import(SRC + 'core/faults.js');

t('불량을 낸 설비만 품질이 떨어진다 — 옆 설비는 그대로', () => {
  m.resetMetrics();
  f.resetQuality();
  m.accumulate(600, new Set(), 0, null, null);       // 둘 다 정상 가동
  f.screen(100, 0, 'GOOD');                          // 불량 0%
  f.screen(100, 1, 'BAD');                           // 전부 불량

  assert.equal(m.oeeOf('GOOD').quality, 1, '남의 불량을 뒤집어썼다');
  assert.equal(m.oeeOf('BAD').quality, 0);
  assert.equal(m.oeeOf('GOOD').oee, 1, 'OEE 까지 끌려 내려갔다');
});
t('아직 아무것도 안 만든 설비는 품질 1 — 0 이면 전부 불량으로 보인다', () => {
  m.resetMetrics();
  f.resetQuality();
  m.accumulate(600, new Set(), 0, null, null);
  f.screen(50, 1, 'BAD');
  assert.equal(m.oeeOf('NEW').quality, 1, '방금 놓은 설비가 불량 100% 로 보인다');
});
t('uid 를 안 넘기면 라인 합계에만 들어간다 — 옛 호출도 안 깨진다', () => {
  f.resetQuality();
  f.screen(10, 1);
  assert.equal(f.getScrapped(), 10);
  assert.equal(f.qualityOf('아무개'), 1, '주인 없는 불량이 남에게 붙었다');
});
t('**라인 전체 양품률은 개수로 센다** — 평균이 아니다', () => {
  /* 한 개 만든 설비와 천 개 만든 설비를 같은 무게로 평균 내면, 거의 안 돌린
     설비가 라인 성적을 좌우한다. */
  m.resetMetrics();
  f.resetQuality();
  m.accumulate(600, new Set(), 0, null, null);
  f.screen(1000, 0, 'BIG');                          // 1000개 전부 양품
  f.screen(1, 1, 'TINY');                            // 1개 불량

  const line = m.oeeOverall(['BIG', 'TINY']);
  near(line.quality, 1000 / 1001, 1e-9);
  /* 설비별 품질을 평균 냈다면 0.5 가 나왔을 것이다 */
  assert.ok(line.quality > 0.99, `개수가 아니라 평균으로 셌다 (${line.quality})`);
});
t('다시 재기는 설비별 기록도 지운다', () => {
  f.resetQuality();
  f.screen(10, 1, 'X');
  assert.equal(f.qualityOf('X'), 0);
  f.resetQuality();
  assert.equal(f.qualityOf('X'), 1, '지난 실행의 불량이 남아 있다');
  assert.equal(f.madeOf('X'), 0);
});
