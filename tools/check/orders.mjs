/**
 * 생산 오더 — 라인에 끝나는 조건을 준다.
 *  여기서 나오는 「늦는다/맞는다」 가 사람을 움직이게 하는 값이라, 라인이 채워지기
 *  전에 함부로 말하지 않는 것과 다 채운 것을 놓치지 않는 것이 둘 다 중요하다.
 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('생산 오더');

const O = await import(SRC + 'core/orders.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const ship = (kind, qty, dueMin = 0) =>
  O.normalizeOrders([{ kind, qty, dueMin, at: O.DONE_AT.SHIP }])[0];
const store = (kind, qty, atUid, dueMin = 0) =>
  O.normalizeOrders([{ kind, qty, dueMin, at: O.DONE_AT.STORE, atUid }])[0];

/* ---------- 저장된 것 맞추기 ---------- */
t('오더가 없는 옛 도면은 빈 목록 — 없던 납기가 생기면 안 된다', () => {
  assert.deepEqual(O.normalizeOrders(undefined), []);
  assert.deepEqual(O.normalizeOrders(null), []);
  assert.deepEqual(O.normalizeOrders('아무거나'), []);
});
t('쓰레기 값이 들어와도 쓸 수 있는 오더가 된다', () => {
  const [o] = O.normalizeOrders([{ qty: -5, dueMin: -3, kind: '없는종류' }]);
  assert.ok(o.qty >= 1);
  assert.equal(o.dueMin, 0);
  assert.ok(o.kind);
  assert.equal(o.at, O.DONE_AT.SHIP);
});
t('도착 지점을 안 골랐으면 출하로 둔다', () => {
  const [o] = O.normalizeOrders([{ at: O.DONE_AT.STORE }]);
  assert.equal(o.atUid, null);
  const [s] = O.normalizeOrders([{ at: O.DONE_AT.SHIP, atUid: 'E1' }]);
  assert.equal(s.atUid, null, '출하인데 도착 지점이 남았다');
});
t('옛 종류 이름도 지금 이름으로 바뀐다', () => {
  const [o] = O.normalizeOrders([{ kind: 'OBJ' }]);
  assert.equal(o.kind, 'PART_R');
});

/* ---------- 몇 개나 됐나 ---------- */
t('출하 기준 — 트럭이 내보낸 수', () => {
  const o = ship('ASM_Y', 500);
  assert.equal(O.doneOf(o, { shipped: { ASM_Y: 320, ASM_M: 99 } }), 320);
  assert.equal(O.doneOf(o, { shipped: {} }), 0);
});
t('도착 지점 기준 — 거기를 **거쳐 간** 누계 (쌓인 수가 아니다)', () => {
  /* 적치대가 200칸인데 400개 오더를 주면, 쌓인 수로 세면 영영 안 끝난다.
     담을 데가 없어서지 못 만들어서가 아니다 — 자리는 세는 지점이지 그릇이 아니다. */
  const o = store('PART_R', 400, 'E449');
  const seen = { E449: { PART_R: 380, PART_G: 5 }, E450: { PART_R: 999 } };
  assert.equal(O.doneOf(o, { arrivedOf: (u, k) => seen[u]?.[k] ?? 0 }), 380, '다른 자리 것까지 셌다');
});

t('수용량을 넘는 오더도 끝난다 — 거쳐 가기만 하면 된다', () => {
  const o = store('PART_R', 400, 'E449');   // 적치대는 200칸이라도
  const r = O.statusOf(o, { arrivedOf: () => 400 }, 600);
  assert.equal(r.state, O.ORDER.DONE);
});
t('도착 지점을 안 골랐으면 0 (엉뚱한 데를 안 센다)', () => {
  const o = O.normalizeOrders([{ at: O.DONE_AT.STORE, kind: 'PART_R', qty: 10 }])[0];
  assert.equal(O.doneOf(o, { arrivedOf: () => 99 }), 0);
});
t('진척과 남은 수량', () => {
  const o = ship('ASM_Y', 500);
  near(O.progressOf(o, 250), 0.5);
  assert.equal(O.remainOf(o, 250), 250);
  assert.equal(O.remainOf(o, 900), 0, '넘게 나왔는데 음수가 됐다');
  near(O.progressOf(o, 900), 1);
});

/* ---------- 속도는 함부로 말하지 않는다 ---------- */
t('라인이 채워지기 전에는 속도를 안 낸다', () => {
  assert.equal(O.ratePerMin(1, 3), null, '3초 만에 속도를 말했다');
  assert.equal(O.ratePerMin(0, 600), null, '한 개도 안 나왔는데 속도가 있다');
});
t('충분히 흐르면 개/분으로 낸다', () => {
  near(O.ratePerMin(100, 60), 100);
  near(O.ratePerMin(100, 120), 50);
});
t('예상 남은 시간 — 속도를 모르면 말하지 않는다', () => {
  const o = ship('ASM_Y', 500);
  assert.equal(O.etaSec(o, 100, null), null);
  assert.equal(O.etaSec(o, 500, 10), 0, '다 됐는데 시간이 남았다');
  near(O.etaSec(o, 400, 50), (100 / 50) * 60);   // 남은 100개 ÷ 50개/분 = 2분
});

/* ---------- 늦는가 ---------- */
const ctx = (n) => ({ shipped: { ASM_Y: n } });

t('아직 못 재는 동안에는 늦는다고 말하지 않는다', () => {
  const o = ship('ASM_Y', 500, 60);
  assert.equal(O.statusOf(o, ctx(1), 5).state, O.ORDER.MEASURING);
});
t('납기를 안 정했으면 늦을 일도 없다', () => {
  const o = ship('ASM_Y', 500, 0);
  const r = O.statusOf(o, ctx(100), 60);
  assert.equal(r.state, O.ORDER.NO_DUE);
  assert.equal(r.dueSec, null);
});
t('이대로면 맞는다', () => {
  /* 60초에 100개 = 100개/분. 남은 400개 → 4분. 납기 60분이니 넉넉하다 */
  const o = ship('ASM_Y', 500, 60);
  const r = O.statusOf(o, ctx(100), 60);
  assert.equal(r.state, O.ORDER.ON_TIME);
  assert.ok(r.slackSec > 0);
});
t('이대로면 늦는다 — 얼마나 초과인지까지', () => {
  /* 60초에 10개 = 10개/분. 남은 490개 → 49분. 납기가 10분이면 크게 늦는다 */
  const o = ship('ASM_Y', 500, 10);
  const r = O.statusOf(o, ctx(10), 60);
  assert.equal(r.state, O.ORDER.LATE);
  assert.ok(r.slackSec < 0);
  near(r.slackSec, 10 * 60 - 60 - (490 / 10) * 60);
});
t('다 채우면 납기와 상관없이 완료다', () => {
  const o = ship('ASM_Y', 500, 1);
  const r = O.statusOf(o, ctx(500), 6000);
  assert.equal(r.state, O.ORDER.DONE);
  assert.equal(r.left, 0);
});
t('납기가 이미 지났어도 남았으면 늦음이다', () => {
  const o = ship('ASM_Y', 500, 1);              // 납기 1분
  const r = O.statusOf(o, ctx(100), 600);       // 10분이 흘렀다
  assert.equal(r.state, O.ORDER.LATE);
  assert.ok(r.slackSec < 0);
});

/* ---------- 전체 판정 ---------- */
const rowsOf = (...states) => states.map((state) => ({ state }));

t('오더가 없으면 「전부 완료」 가 아니다 — 멈출 이유가 없다', () => {
  assert.equal(O.allDone([]), false);
  assert.equal(O.allDone(null), false);
});
t('하나라도 남으면 전부 완료가 아니다', () => {
  assert.equal(O.allDone(rowsOf(O.ORDER.DONE, O.ORDER.ON_TIME)), false);
  assert.equal(O.allDone(rowsOf(O.ORDER.DONE, O.ORDER.DONE)), true);
});
t('늦는 것이 하나라도 있으면 알린다', () => {
  assert.equal(O.anyLate(rowsOf(O.ORDER.ON_TIME, O.ORDER.LATE)), true);
  assert.equal(O.anyLate(rowsOf(O.ORDER.ON_TIME, O.ORDER.DONE)), false);
});

/* ---------- 시간 표기 ---------- */
t('남은 시간을 사람이 읽는 단위로', () => {
  assert.equal(O.formatSpan(45), '45초');
  assert.equal(O.formatSpan(605), '10분');
  assert.equal(O.formatSpan(3600 * 3 + 60 * 20), '3시간 20분');
  assert.equal(O.formatSpan(null), '—');
  assert.equal(O.formatSpan(-5), '0초');
});
