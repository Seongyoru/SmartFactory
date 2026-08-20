/**
 * =============================================================================
 *  컨베이어 갈래 · 합류 — **어느 벨트로 무엇을 보내나**
 * =============================================================================
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 종류를 안 정한 벨트는 아무거나 싣는다.
 *  **② 못 싣는 종류는 건너뛴다.** 앞머리가 제 종류가 아니면 뒤를 본다 — 안
 *     그러면 갈래를 나눠 놓고도 두 벨트가 함께 서서, 갈래의 뜻이 사라진다.
 *  **③ 천장이 갈래를 안다.** 벨트가 설비 산출의 절반만 실으면 되는데 전부를
 *     실어야 하는 줄 알면 천장이 절반으로 낮아지고, **실측이 천장을 넘는다.**
 *  **④ 합류는 원래 됐다.** 벨트 여럿이 한 곳으로 들어가는 것은 예전부터 된다 —
 *     그 사실을 값으로 못 박아 둔다(안 그러면 「됐었나?」를 매번 다시 묻는다).
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('갈래 · 합류');

const St = await import(SRC + 'core/simStore.js');
const L = await import(SRC + 'core/link.js');
const Lu = await import(SRC + 'core/lineup.js');
const B = await import(SRC + 'core/balance.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

/* ---------- 값 읽기 ------------------------------------------------------- */
t('벨트의 종류는 **기본이 빈 목록** — 아무거나 싣는다', () => {
  assert.deepEqual(L.beltKinds({}), []);
  assert.deepEqual(L.beltKinds({ kinds: ['PART_R'] }), ['PART_R']);
  assert.equal(L.isDiverted({}), false);
  assert.equal(L.isDiverted({ kinds: [] }), false);
  assert.equal(L.isDiverted({ kinds: ['PART_R'] }), true);
  /* 손으로 고친 도면에 이상한 것이 들어와도 걸러 낸다 */
  assert.deepEqual(L.beltKinds({ kinds: [null, 3, '', 'PART_G'] }), ['PART_G']);
});

/* ---------- 골라 집는다 --------------------------------------------------- */
const fill = (uid, list) => {
  St.clearStock();
  for (const k of list) St.addMade(uid, 1, k);
};

t('종류를 안 정하면 **앞머리부터** 집는다 — 예전 그대로', () => {
  fill('M', ['PART_R', 'PART_R', 'PART_G', 'PART_G']);
  const got = St.takeBundles('M', 2, 1);
  assert.equal(got.kind, 'PART_R');
  assert.equal(got.count, 2);
});

t('**못 싣는 종류는 건너뛴다** — 갈래의 핵심이다', () => {
  fill('M', ['PART_R', 'PART_R', 'PART_G', 'PART_G']);
  /* 제작품 2만 싣는 벨트 — 앞의 제작품 1을 건너뛰고 뒤를 집는다 */
  const got = St.takeBundles('M', 2, 1, ['PART_G']);
  assert.equal(got.kind, 'PART_G', '앞머리에 막혀 아무것도 못 실었다');
  assert.equal(got.count, 2);
  /* 앞의 제작품 1은 그대로 남아 있어야 한다 — 다른 벨트 몫이다 */
  assert.deepEqual(St.getLots ? St.getMadeLots('M') : [], ['PART_R', 'PART_R']);
});

t('가운데를 덜어 내도 **줄이 안 엉킨다**', () => {
  fill('M', ['PART_R', 'PART_G', 'PART_G', 'PART_R']);
  St.takeBundles('M', 2, 1, ['PART_G']);
  assert.deepEqual(St.getMadeLots('M'), ['PART_R', 'PART_R']);
});

t('실을 것이 없으면 **아무것도 안 집는다**', () => {
  fill('M', ['PART_R', 'PART_R']);
  assert.equal(St.takeBundles('M', 2, 1, ['PART_G']).made, 0);
  assert.deepEqual(St.getMadeLots('M'), ['PART_R', 'PART_R'], '못 싣는데 덜어 갔다');
});

t('자투리 규칙이 **갈래에서도** 산다', () => {
  /* 뒤에 다른 종류가 서 있으면 그 줄은 더 안 자란다 — 짧아도 보낸다 */
  fill('M', ['PART_G', 'PART_R', 'PART_R']);
  const got = St.takeBundles('M', 3, 1, ['PART_G']);
  assert.equal(got.made, 1);
  assert.equal(got.count, 1, '자투리를 안 보냈다');
  /* 뒤가 비어 있으면 기다린다 */
  fill('M', ['PART_G']);
  assert.equal(St.takeBundles('M', 3, 1, ['PART_G']).made, 0, '아직 만드는 중인데 보냈다');
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-25, -25], [25, 25]) }];

/** 제작기 하나 · 벨트 둘 · 적치대 둘 — 갈래 */
const splitLinks = (aKinds, bKinds) => [
  {
    uid: 'CA', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'SA' },
    radius: 0.5, layer: 0, width: 1, kinds: aKinds,
  },
  {
    uid: 'CB', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'SB' },
    radius: 0.5, layer: 1, width: 1, kinds: bKinds,
  },
];
const TWO = [
  { in: [], out: 'PART_R' },
  { in: [], out: 'PART_G' },
];
const splitPlaced = [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 8], rot: 0, outputCount: 3, cycleSec: 2,
    lotSize: 6, recipes: TWO,
  },
  { uid: 'SA', name: '적치대 A', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, capacity: 200 },
  { uid: 'SB', name: '적치대 B', itemId: 'STILLAGE', pos: [2, 0], rot: 0, capacity: 200 },
];
const runSplit = (aKinds, bKinds, sec = 300) => {
  St.clearStock();
  const links = splitLinks(aKinds, bKinds);
  const w = Lu.worldOf({
    placed: splitPlaced, links, carts: [], areas, walls: [], openings: [], shifts: [],
    beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0, rand: R.seeded(5) });
  const tally = (uid) => {
    const out = {};
    for (const k of St.getLots(uid)) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  return { A: tally('SA'), B: tally('SB'), ceil: w.capacity * 60 };
};

t('**갈래가 실제로 갈라진다** — 종류마다 제 길로', () => {
  const r = runSplit(['PART_R'], ['PART_G']);
  assert.ok((r.A.PART_R ?? 0) > 0, `A 로 제작품 1이 안 갔다 ${JSON.stringify(r.A)}`);
  assert.ok((r.B.PART_G ?? 0) > 0, `B 로 제작품 2가 안 갔다 ${JSON.stringify(r.B)}`);
  assert.equal(r.A.PART_G ?? 0, 0, 'A 에 제작품 2가 섞였다');
  assert.equal(r.B.PART_R ?? 0, 0, 'B 에 제작품 1이 섞였다');
});

t('갈래를 안 정하면 **섞여 흐른다** — 예전 그대로', () => {
  const r = runSplit([], []);
  const mixed = Object.keys(r.A).length > 1 || Object.keys(r.B).length > 1;
  assert.ok(mixed, '아무것도 안 정했는데 갈라졌다');
});

t('**한쪽만 막아도 라인이 안 선다**', () => {
  /* 갈래를 나눠 놓고 못 싣는 종류를 건너뛰지 않으면 두 벨트가 함께 선다 */
  const r = runSplit(['PART_R'], ['PART_G']);
  const total = Object.values(r.A).reduce((s, n) => s + n, 0) + Object.values(r.B).reduce((s, n) => s + n, 0);
  const both = runSplit([], []);
  const ref = Object.values(both.A).reduce((s, n) => s + n, 0) + Object.values(both.B).reduce((s, n) => s + n, 0);
  assert.ok(total > ref * 0.8, `갈라 놓으니 ${total} / ${ref} 밖에 안 나온다 — 서로 막고 있다`);
});

t('**천장이 갈래를 안다** — 실측이 천장을 안 넘는다', () => {
  /* 천장은 **한 품종에** 얼마인지를 말한다(balance 의 many 나눔). 두 품종을
     합쳐서 견주면 두 배로 보여, 갈래와 상관없이 늘 천장을 넘는다 */
  const r = runSplit(['PART_R'], ['PART_G']);
  const total = Object.values(r.A).reduce((s, n) => s + n, 0) + Object.values(r.B).reduce((s, n) => s + n, 0);
  const perHour = (total / 2) * 12;                 // 300초 · 품종 둘 → 한 품종 개/시
  assert.ok(perHour <= r.ceil + 1, `천장 ${r.ceil.toFixed(0)} 을 넘었다 (${perHour.toFixed(0)})`);
  assert.ok(perHour > r.ceil * 0.8, `천장 ${r.ceil.toFixed(0)} 인데 ${perHour.toFixed(0)} 밖에 안 나온다`);
});

/** 제작기 둘 · 벨트 둘 · 적치대 하나 — 합류 */
const mergePlaced = [
  {
    uid: 'PA', name: '제작기 A', itemId: 'MACHINE_1', pos: [-8, 8], rot: 0, outputCount: 3, cycleSec: 4,
    recipe: { in: [], out: 'PART_R' },
  },
  {
    uid: 'PB', name: '제작기 B', itemId: 'MACHINE_1', pos: [4, 8], rot: 0, outputCount: 3, cycleSec: 4,
    recipe: { in: [], out: 'PART_G' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-2, 0], rot: 0, capacity: 200 },
];
const mergeLinks = [
  { uid: 'CA', itemId: 'CONVEYOR', from: { uid: 'PA', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' }, radius: 0.5, layer: 0, width: 1 },
  { uid: 'CB', itemId: 'CONVEYOR', from: { uid: 'PB', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' }, radius: 0.5, layer: 0, width: 1 },
];

t('**합류는 원래 된다** — 두 벨트가 한 적치대로', () => {
  St.clearStock();
  const w = Lu.worldOf({
    placed: mergePlaced, links: mergeLinks, carts: [], areas, walls: [], openings: [], shifts: [],
    beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: 300, world: w.world, flow: w.flow, pick: () => 0, rand: R.seeded(5) });
  const tally = {};
  for (const k of St.getLots('S1')) tally[k] = (tally[k] ?? 0) + 1;
  assert.ok((tally.PART_R ?? 0) > 0, `A 쪽이 안 들어왔다 ${JSON.stringify(tally)}`);
  assert.ok((tally.PART_G ?? 0) > 0, `B 쪽이 안 들어왔다 ${JSON.stringify(tally)}`);
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const balSrc = await readSrc('core/balance.js');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('두 길이 **같은 갈래**를 본다', () => {
  assert.ok(lineupSrc.includes('const picked = beltKinds(link).filter((k) => own.includes(k));'),
    '흐름이 갈래를 안 읽는다');
  assert.ok(repSrc.includes('takeBundles(b.owner.uid, per, n, b.kinds)'), '헤드리스가 갈래를 무시한다');
  assert.ok(sceneSrc.includes('takeBundles(owner.uid, per, n, kinds)'), '화면이 갈래를 무시한다');
});

t('**설비가 안 만드는 종류**는 갈래에서 걸러진다', () => {
  /* 안 만드는 것을 적어 두면 그 벨트는 영영 아무것도 못 실어 조용히 죽는다 */
  assert.ok(lineupSrc.includes('.filter((k) => own.includes(k))'), '안 만드는 종류를 그대로 받는다');
});

t('천장이 **몫만큼만** 지운다', () => {
  assert.ok(balSrc.includes('const own = beltPerMinute(gap, v, layers) / share;'), '벨트가 전부를 진다');
  assert.ok(balSrc.includes('const share = kinds.length ? kinds.length / Math.max(1, sends.length) : 1;'),
    '몫을 안 센다');
});

t('화면이 갈래를 받고, **가를 것이 있을 때만** 보여 준다', () => {
  assert.ok(inspSrc.includes("patch: { kinds: next }"), '갈래를 저장 안 한다');
  /* 벨트가 하나뿐이거나 한 종류만 만드는 설비면 고를 것이 없다 */
  assert.ok(inspSrc.includes('if (makes.length < 2 || outs.length < 2) return null;'),
    '가를 것이 없는데 칸이 뜬다');
});
