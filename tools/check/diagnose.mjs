/**
 * 왜 섰는가 — 원인 사슬.
 *  이 파일이 지키는 것은 하나다: **피해자를 손볼 곳이라고 하지 않는다.**
 *  예전 「병목」 표시가 정확히 그 잘못을 했고, 그것 때문에 멀쩡한 제작기를 붙들고
 *  한참을 헤맸다.
 */
import assert from 'node:assert/strict';
import { SRC, group, t } from './_harness.mjs';

group('원인 사슬');

const D = await import(SRC + 'core/diagnose.js');

/* ---- 도면 한 벌 ------------------------------------------------------------
     제작기 M (0.5초/개 → 120개/분) ──벨트──▶ 적치대 S (200칸)
     카트 K 가 S 에서 싣고 선반 H 에 내린다
--------------------------------------------------------------------------- */
const ITEMS = {
  MACHINE_1: { id: 'MACHINE_1', category: 'equipment' },
  STILLAGE: { id: 'STILLAGE', kind: 'stillage' },
  CONVEYOR: { id: 'CONVEYOR', category: 'connector' },
  CART: { id: 'CART', kind: 'cart' },
};
const itemOf = (id) => ITEMS[id] ?? null;

const M = { uid: 'M', itemId: 'MACHINE_1', name: '제작기', pos: [0, 0], cycleSec: 0.5, outputCount: 2 };
const S = { uid: 'S', itemId: 'STILLAGE', name: '적치대', pos: [8, 0], capacity: 200 };
const LINK = { uid: 'L1', itemId: 'CONVEYOR', from: { uid: 'M' }, to: { uid: 'S' } };

const ctxOf = ({ carts = [], stock = {} } = {}) => ({
  placed: [M, S],
  links: [LINK],
  carts,
  itemOf,
  getStock: (uid) => stock[uid] ?? 0,
});

const names = (r) => r.steps.map((s) => s.name);

/* ---------- 사슬을 편다 ---------- */
t('안 찼으면 손볼 곳이 없다 — 지금 막힌 것은 잠깐이다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 4 } }));
  assert.deepEqual(names(r), ['제작기', '적치대']);
  assert.equal(r.culprit, null);
});
t('가득 찼는데 빼가는 것이 없으면 **그것이** 손볼 곳이다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 200 } }));
  assert.deepEqual(names(r), ['제작기', '적치대', '빼가는 것']);
  assert.equal(r.culprit.note, '없습니다');
  assert.equal(r.culprit.kind, D.STEP.NONE);
});
t('벨트를 안 물렸으면 보낼 곳부터가 없다', () => {
  const r = D.blockChain('M', { ...ctxOf(), links: [] });
  assert.deepEqual(names(r), ['제작기', '보낼 곳']);
  assert.ok(r.culprit);
});
t('제작기는 **피해자로** 표시된다 — 사슬 끝이 자기가 아니다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 200 } }));
  assert.equal(D.isVictim('M', r.steps), true);
  assert.notEqual(r.culprit.uid, 'M');
});
t('한 줄로도 읽힌다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 200 } }));
  assert.equal(D.chainText(r.steps),
    '제작기 (만드는 속도 120.0 개/분) → 적치대 (200/200 가득) → 빼가는 것 (없습니다)');
});

/* ---------- 카트가 있을 때 -------------------------------------------------
     선반·설비 포트는 모델 치수가 있어야 역으로 잡혀서 node 만으로는 못 세운다.
     그래서 수송 능력만 직접 준다 — 능력 계산 자체는 cart.mjs 가 따로 본다.
--------------------------------------------------------------------------- */
const hauling = (...rates) => () =>
  rates.map((perMinute, i) => ({ uid: 'K' + i, name: '카트' + (i + 1), perMinute }));

t('나를 힘이 모자라면 카트가 손볼 곳이다', () => {
  const r = D.blockChain('M', { ...ctxOf({ stock: { S: 200 } }), haulOf: hauling(21) });
  const last = r.steps[r.steps.length - 1];
  assert.equal(last.kind, D.STEP.HAUL);
  assert.equal(last.short, true);
  assert.equal(r.culprit, last);
});
t('나를 힘이 넉넉하면 카트를 손볼 곳이라고 **안 한다**', () => {
  /* 실제로 이걸 틀렸다 — 415개/분 나르는 카트를 병목이라고 짚었다 */
  const r = D.blockChain('M', { ...ctxOf({ stock: { S: 200 } }), haulOf: hauling(415.4) });
  const last = r.steps[r.steps.length - 1];
  assert.equal(last.kind, D.STEP.HAUL);
  assert.equal(last.short, false);
  assert.equal(r.culprit, null, '능력이 넘치는 카트를 손볼 곳이라고 했다');
});
t('빼가는 능력은 **모든 차량을 더해서** 본다', () => {
  const r = D.blockChain('M', { ...ctxOf({ stock: { S: 200 } }), haulOf: hauling(30, 40) });
  const last = r.steps[r.steps.length - 1];
  assert.equal(last.perMinute, 70);
  assert.equal(last.name, '카트1 · 카트2');
  assert.equal(last.short, true);            // 70 < 120
});

/* ---------- 굶은 설비도 피해자다 ---------- */
const A = { uid: 'A', itemId: 'MACHINE_1', name: '앞공정', pos: [-8, 0], cycleSec: 12, outputCount: 1 };
const C = { uid: 'C', itemId: 'MACHINE_1', name: '뒷공정', pos: [0, 0], cycleSec: 1, outputCount: 1 };

t('굶은 설비의 원인은 **앞 공정**이다', () => {
  const r = D.starveChain('C', {
    placed: [A, C], links: [{ uid: 'L', itemId: 'CONVEYOR', from: { uid: 'A' }, to: { uid: 'C' } }],
    carts: [], itemOf,
  });
  assert.deepEqual(names(r), ['뒷공정', '앞공정']);
  assert.equal(r.culprit.uid, 'A');
  assert.equal(r.culprit.short, true);       // 5 개/분 < 60 개/분
});
t('대주는 것이 아무것도 없으면 그렇게 말한다', () => {
  const r = D.starveChain('C', { placed: [C], links: [], carts: [], itemOf });
  assert.equal(r.culprit.kind, D.STEP.NONE);
});
t('앞 공정이 더 빠르면 손볼 곳이 아니다', () => {
  const fast = { ...A, cycleSec: 0.1 };
  const r = D.starveChain('C', {
    placed: [fast, C], links: [{ uid: 'L', itemId: 'CONVEYOR', from: { uid: 'A' }, to: { uid: 'C' } }],
    carts: [], itemOf,
  });
  assert.equal(r.culprit, null);
});

/* ---------- 없는 설비 ---------- */
t('도면에 없는 uid 면 빈 사슬', () => {
  assert.deepEqual(D.blockChain('없음', ctxOf()).steps, []);
  assert.deepEqual(D.starveChain('없음', ctxOf()).steps, []);
});

/* ---------- 누르면 어디로 데려가나 -----------------------------------------
     "저기가 문제다" 라고 말만 하고 끝나면, 도면이 크면 이름만 보고 그 설비를
     찾는 데 또 한참이 걸린다. 짚어 줬으면 데려다도 줘야 한다.
--------------------------------------------------------------------------- */
const K = {
  uid: 'K', itemId: 'CART', name: '카트',
  points: [[6, -2], [12, -2], [12, 2], [6, 2]], closed: true,
};

t('설비 칸은 그 설비를 고르고 그 자리를 본다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 200 } }));
  const tgt = D.stepTarget(r.steps[1], { placed: [M, S], carts: [] });
  assert.deepEqual(tgt, { kind: 'equip', uid: 'S', at: [8, 0] });
});
t('카트 칸은 카트를 고르고 **경로 첫 점**을 본다', () => {
  /* 차가 지금 어디 있는지는 매 순간 달라지지만 경로는 안 변한다 */
  const tgt = D.stepTarget({ uid: 'K' }, { placed: [M, S], carts: [K] });
  assert.deepEqual(tgt, { kind: 'cart', uid: 'K', at: [6, -2] });
});
t('가리킬 대상이 없는 칸은 null — 글자로만 둔다', () => {
  const r = D.blockChain('M', ctxOf({ stock: { S: 200 } }));
  const none = r.steps[r.steps.length - 1];
  assert.equal(none.kind, D.STEP.NONE);
  assert.equal(D.stepTarget(none, { placed: [M, S], carts: [] }), null);
});
t('도면에서 지워진 uid 면 null (없는 것을 고르지 않는다)', () => {
  assert.equal(D.stepTarget({ uid: '지워짐' }, { placed: [M, S], carts: [K] }), null);
});
t('빼가는 카트 칸에도 uid 가 실린다 — 안 실으면 누를 수가 없다', () => {
  const r = D.blockChain('M', {
    ...ctxOf({ stock: { S: 200 } }),
    haulOf: () => [{ uid: 'K', name: '카트', perMinute: 5 }],
  });
  assert.equal(r.steps[r.steps.length - 1].uid, 'K');
});
