/**
 * CartView 의 정차역 처리를 소스에서 떼어 돌린다.
 *  카트가 설비에 재료를 **실제로** 주는지, 안 쓰는 종류를 걸러 내는지,
 *  조립 설비에서 실을 때 재료를 내는지 — 전부 이 블록 안에서 갈린다.
 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('카트 정차역 (소스에서)');

const bom = await import(SRC + 'core/bom.js');
const sim = await import(SRC + 'core/simStore.js');
const cartMod = await import(SRC + 'core/cart.js');
const lib = await import(SRC + 'data/library.js');

const src = await readSrc('scene/CartView.jsx');
/* 끝 표시는 마지막 else 안의 주석이다 — 그 뒤로 else 와 if 를 닫아 줘야
   블록이 온전한 코드가 된다 */
const block = `${cut(src, 'if (next.arrived) {', '아무 일도 없었으면 서 있을 이유도 없다', '정차역 처리')}\n}\n}`;

const step = new Function(
  'next', 'carried', 'carriedKinds', 'capacity', 'topUp', 'cart',
  'setCarried', 'setCarriedKinds', 'sourceRef', 'lastKeyRef', 'lastSRef', 'sRef', 'pauseRef',
  'addLots', 'addLotsShared', 'takeLots', 'getMade', 'takeMade', 'loadRoom',
  'pickSet', 'slotShares',
  block + '\nreturn { carried, carriedKinds };',
);

/** 한 역을 처리하고, 카트가 어떻게 됐는지 돌려준다 */
function visit(station, { carried = 0, kinds = [], capacity = 3, topUp = false, cart = {}, source = null } = {}) {
  const out = { carried, kinds, source, lastKey: null, pause: 1.2 };
  const sourceRef = { current: source };
  const lastKeyRef = { current: null };
  const lastSRef = { current: null };
  const sRef = { current: 42 };
  const pauseRef = { current: 1.2 };
  step(
    { arrived: station }, carried, kinds, capacity, topUp, cart,
    (v) => { out.carried = v; }, (v) => { out.kinds = v; },
    sourceRef, lastKeyRef, lastSRef, sRef, pauseRef,
    sim.addLots, sim.addLotsShared, sim.takeLots, sim.getMade, sim.takeMade,
    cartMod.loadRoom, cartMod.pickSet, bom.slotShares,
  );
  out.source = sourceRef.current;
  out.lastKey = lastKeyRef.current;
  out.pause = pauseRef.current;
  return out;
}

const R = { in: [{ kind: 'PART_R', qty: 2 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' };

/* ---------- 설비 유입부에 내려놓기 ---------- */
t('레시피가 있으면 실제로 쌓인다', () => {
  sim.clearStock();
  const r = visit({ kind: 'unload', uid: 'C', key: 'C:i', recipe: R, capacity: 30 },
    { carried: 3, kinds: ['PART_R', 'PART_R', 'PART_G'] });
  assert.equal(r.carried, 0);
  assert.deepEqual(bom.countKinds(sim.getLots('C')), { PART_R: 2, PART_G: 1 });
  assert.equal(r.lastKey, 'C:i');
});
t('레시피가 없으면 예전 그대로 사라진다', () => {
  sim.clearStock();
  const r = visit({ kind: 'unload', uid: 'D', key: 'D:i', recipe: null },
    { carried: 3, kinds: ['PART_R', 'PART_R', 'PART_R'] });
  assert.equal(r.carried, 0);
  assert.equal(sim.getStock('D'), 0);
});
t('안 쓰는 종류는 안 받는다 — 버퍼가 막히지 않게', () => {
  sim.clearStock();
  const r = visit({ kind: 'unload', uid: 'C', key: 'C:i', recipe: R, capacity: 30 },
    { carried: 3, kinds: ['PART_R', 'ASM_C', 'PART_G'] });
  assert.deepEqual(bom.countKinds(sim.getLots('C')), { PART_R: 1, PART_G: 1 });
  assert.deepEqual(r.kinds, ['ASM_C']);          // 안 쓰는 것은 그대로 싣고 간다
  assert.equal(r.carried, 1);
});
t('쓸 것이 하나도 없으면 아무 일도 없다 (서지도 않는다)', () => {
  sim.clearStock();
  const r = visit({ kind: 'unload', uid: 'C', key: 'C:i', recipe: R, capacity: 30 },
    { carried: 2, kinds: ['ASM_C', 'ASM_C'] });
  assert.equal(r.carried, 2);
  assert.equal(sim.getStock('C'), 0);
  assert.equal(r.pause, 0);
  assert.equal(r.lastKey, null);
});
t('제 몫이 차면 들어간 만큼만 내리고 나머지는 싣고 간다', () => {
  /* 버퍼 30 · 레시피 2:1 → 제작품1 자리는 20칸, 제작품2 는 10칸.
     전체가 안 찼어도 **제 몫**이 차면 더 못 넣는다 — 그게 교착을 막는 규칙이다 */
  sim.clearStock();
  sim.addStock('C', 18, 30, 'PART_R');
  const r = visit({ kind: 'unload', uid: 'C', key: 'C:i', recipe: R, capacity: 30 },
    { carried: 5, kinds: ['PART_R', 'PART_R', 'PART_R', 'PART_R', 'PART_R'] });
  assert.equal(sim.getStock('C'), 20, '제작품1 은 제 몫 20칸까지만');
  assert.equal(r.carried, 3, '못 넣은 3개는 그대로 싣고 간다');
});
t('버퍼가 꽉 찼으면 그냥 지나간다', () => {
  sim.clearStock();
  sim.addStock('C', 30, 30, 'PART_R');
  const r = visit({ kind: 'unload', uid: 'C', key: 'C:i', recipe: R, capacity: 30 },
    { carried: 2, kinds: ['PART_R', 'PART_R'] });
  assert.equal(r.carried, 2);
  assert.equal(r.pause, 0);
});

/* ---------- 설비 유출부에서 싣기 ------------------------------------------
     공정 시간이 생기면서 규칙이 바뀌었다. 예전에는 카트가 오면 그 자리에서
     **가지러 온 만큼 만들어** 줬다(시간 0). 지금은 설비가 미리 만들어 둔 것만
     실어 간다 — 없으면 빈손으로 지나간다.
--------------------------------------------------------------------------- */
t('만들어 놓은 것을 실어 간다', () => {
  sim.clearStock();
  sim.addMade('A', 3);
  const r = visit({ kind: 'load', uid: 'A', key: 'A:o', count: 3, payloadKind: 'PART_R', recipe: null });
  assert.equal(r.carried, 3);
  assert.deepEqual(r.kinds, ['PART_R', 'PART_R', 'PART_R']);
  assert.equal(r.source, 'A');
  assert.equal(sim.getMade('A'), 0, '가져간 만큼 빠져야 한다');
});
t('아무것도 안 만들어 놨으면 빈손으로 지나간다', () => {
  sim.clearStock();
  /* 재료가 산더미처럼 있어도 소용없다 — 만드는 것은 설비의 시간이지 카트가 아니다 */
  sim.addLots('C', [...Array(30).fill('PART_R')], 30);
  const r = visit({ kind: 'load', uid: 'C', key: 'C:o', count: 3, payloadKind: 'ASM_C', recipe: R });
  assert.equal(r.carried, 0);
  assert.equal(sim.getStock('C'), 30, '재료를 건드리면 안 된다');
  assert.equal(r.pause, 0);
});
t('만들어 둔 것이 모자라면 있는 만큼만', () => {
  sim.clearStock();
  sim.addMade('C', 2);
  const r = visit({ kind: 'load', uid: 'C', key: 'C:o', count: 3, payloadKind: 'ASM_C', recipe: R });
  assert.equal(r.carried, 2);
  assert.equal(sim.getMade('C'), 0);
});
t('카트가 실을 자리보다 많이 만들어 뒀으면 자리만큼만', () => {
  sim.clearStock();
  sim.addMade('C', 10);
  const r = visit({ kind: 'load', uid: 'C', key: 'C:o', count: 3, payloadKind: 'ASM_C', recipe: R });
  assert.equal(r.carried, 3);
  assert.equal(sim.getMade('C'), 7, '안 실은 것은 그대로 남아야 한다');
});
t('가져올 종류를 정해 둔 카트는 다른 것을 만드는 설비를 지나친다', () => {
  sim.clearStock();
  sim.addMade('C', 3);
  const r = visit({ kind: 'load', uid: 'C', key: 'C:o', count: 3, payloadKind: 'ASM_C', recipe: R },
    { cart: { pickKinds: ['PART_R'] } });
  assert.equal(r.carried, 0);
  assert.equal(sim.getMade('C'), 3, '안 실었는데 재고가 줄었다');
});
t('짐이 있으면 카트는 더 안 싣는다', () => {
  sim.clearStock();
  sim.addMade('C', 3);
  const r = visit({ kind: 'load', uid: 'C', key: 'C:o', count: 3, payloadKind: 'ASM_C', recipe: R },
    { carried: 1, kinds: ['PART_R'] });
  assert.equal(r.carried, 1);
  assert.equal(sim.getMade('C'), 3);
});

/* ---------- 선반은 그대로인지 (회귀) ---------- */
t('선반 내리기는 예전 그대로', () => {
  sim.clearStock();
  const r = visit({ kind: 'shelf-in', uid: 'S1', key: 'S1', capacity: 10 },
    { carried: 2, kinds: ['PART_R', 'PART_G'] });
  assert.equal(r.carried, 0);
  assert.deepEqual(sim.getLots('S1'), ['PART_R', 'PART_G']);
});
t('실어 온 곳에 도로 내려놓지 않는다', () => {
  sim.clearStock();
  const r = visit({ kind: 'shelf-in', uid: 'S1', key: 'S1', capacity: 10 },
    { carried: 2, kinds: ['PART_R', 'PART_R'], source: 'S1' });
  assert.equal(r.carried, 2);
  assert.equal(sim.getStock('S1'), 0);
});
t('선반 싣기는 예전 그대로', () => {
  sim.clearStock();
  sim.addLots('S2', ['PART_R', 'PART_G', 'PART_R'], 10);
  const r = visit({ kind: 'shelf-out', uid: 'S2', key: 'S2', dispatch: 2 }, { capacity: 5 });
  assert.equal(r.carried, 2);
  assert.equal(sim.getStock('S2'), 1);
});

/* ---------- 옛 도면의 옛 종류 이름 (회귀) ---------- */
t('옛 이름으로 골라 둔 카트도 지금 이름과 맞는다', () => {
  sim.clearStock();
  sim.addMade('A', 2);
  const r = visit({ kind: 'load', uid: 'A', key: 'A:o', count: 2, payloadKind: 'PART_R', recipe: null },
    { cart: { pickKind: 'OBJ' } });          // 옛 이름 = PART_R
  assert.equal(r.carried, 2, '옛 이름이 안 통해 카트가 그냥 지나갔다');
});
t('옛 이름으로 골라 둔 카트가 선반에서도 그것만 집는다', () => {
  sim.clearStock();
  sim.addLots('S3', ['PART_R', 'PART_G', 'PART_R'], 10);
  const r = visit({ kind: 'shelf-out', uid: 'S3', key: 'S3', dispatch: 3 },
    { capacity: 5, cart: { pickKind: 'OBJ' } });
  assert.deepEqual(r.kinds, ['PART_R', 'PART_R']);
  assert.deepEqual(sim.getLots('S3'), ['PART_G']);
});

/* ---------- 복수 선택 ---------- */
t('여러 종류를 고른 카트는 그중 아무 설비 앞에서나 선다', () => {
  sim.clearStock();
  const c = { cart: { pickKinds: ['PART_R', 'PART_B'] } };
  sim.addMade('A', 2);
  const r1 = visit({ kind: 'load', uid: 'A', key: 'A:o', count: 2, payloadKind: 'PART_R', recipe: null }, c);
  assert.equal(r1.carried, 2);
  sim.addMade('A', 2);
  const r2 = visit({ kind: 'load', uid: 'A', key: 'A:o', count: 2, payloadKind: 'PART_B', recipe: null }, c);
  assert.equal(r2.carried, 2);
  /* 안 고른 것은 여전히 지나친다 */
  sim.addMade('A', 2);
  const r3 = visit({ kind: 'load', uid: 'A', key: 'A:o', count: 2, payloadKind: 'PART_G', recipe: null }, c);
  assert.equal(r3.carried, 0);
  assert.equal(sim.getMade('A'), 2, '안 실었는데 재고가 줄었다');
});
t('선반에서 고른 것들만 섞어 싣는다', () => {
  sim.clearStock();
  sim.addLots('S9', ['PART_R', 'PART_G', 'PART_B', 'PART_R'], 20);
  const r = visit({ kind: 'shelf-out', uid: 'S9', key: 'S9', dispatch: 4 },
    { capacity: 5, cart: { pickKinds: ['PART_R', 'PART_B'] } });
  assert.deepEqual(bom.countKinds(r.kinds), { PART_R: 2, PART_B: 1 });
  assert.deepEqual(sim.getLots('S9'), ['PART_G']);       // 안 고른 것만 남는다
});

