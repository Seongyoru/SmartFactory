/**
 * =============================================================================
 *  축적형 컨베이어 — **막혀도 안 서고 끝에 쌓인다**
 * =============================================================================
 *  보통 벨트는 종점이 막히면 **통째로 선다.** 실제 라인에는 그렇지 않은 것이
 *  많다 — 롤러가 물건 밑에서 계속 돌고 물건은 끝에서부터 밀려 쌓인다. 그동안
 *  상류는 계속 실을 수 있어서 **벨트 자체가 버퍼**가 된다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이미 그린 도면이 안 바뀐다.** 기본은 비축적이다 — 갑자기 버퍼가 생기면
 *     안 건드린 도면의 처리량이 저절로 달라진다.
 *  **② 끝이 있다.** 벨트 길이만큼만 쌓는다. 무한 버퍼가 되면 종점이 막혀도
 *     라인이 영영 안 서는 거짓 그림이 된다.
 *  **③ 쌓아 둔 것이 먼저 내려간다.** 안 그러면 순서가 뒤집힌다.
 *  **④ 고장 났을 때도 안 선다.** 버퍼가 가장 필요한 자리가 거기다 — 종점이
 *     찼을 때만 봐 주면, 하류가 고장 났을 때 앞 설비가 그대로 같이 선다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('축적형 컨베이어');

const B = await import(SRC + 'core/belt.js');
const L = await import(SRC + 'core/link.js');
const St = await import(SRC + 'core/simStore.js');
const Mt = await import(SRC + 'core/metrics.js');
const H = await import(SRC + 'core/halt.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

/* ---------- 값 읽기 ------------------------------------------------------- */
t('축적형은 **기본이 아니다** — 이미 그린 도면은 예전처럼 선다', () => {
  assert.equal(L.isAccumulating({}), false);
  assert.equal(L.isAccumulating({ accumulate: false }), false);
  assert.equal(L.isAccumulating({ accumulate: 'yes' }), false, '손으로 고친 값이 참으로 읽힌다');
  assert.equal(L.isAccumulating({ accumulate: true }), true);
});

/* ---------- 끝에 쌓는다 ---------------------------------------------------- */
t('**벨트 길이만큼만** 쌓는다', () => {
  const st = B.makeBelt(3);
  assert.equal(B.beltHeld(st), 0);
  assert.equal(B.beltFull(st), false);
  assert.equal(B.holdOnBelt(st, 'PART_R', 2), 2);
  assert.equal(B.holdOnBelt(st, 'PART_G', 5), 1, '길이를 넘겨 받았다 — 무한 버퍼가 된다');
  assert.equal(B.beltHeld(st), 3);
  assert.equal(B.beltFull(st), true);
  assert.equal(B.holdOnBelt(st, 'PART_B', 1), 0);
});

t('**먼저 쌓인 것이 먼저** 내려간다', () => {
  const st = B.makeBelt(5);
  B.holdOnBelt(st, 'PART_R', 2);
  B.holdOnBelt(st, 'PART_G', 2);
  assert.deepEqual(B.takeHeld(st, 3), { PART_R: 2, PART_G: 1 });
  assert.equal(B.beltHeld(st), 1);
  assert.deepEqual(B.takeHeld(st, 9), { PART_G: 1 }, '남은 것보다 많이 달라고 하면 있는 만큼');
  assert.equal(B.takeHeld(st, 1), null);
});

/* ---------- 종점에 내리는 규칙은 한 곳에 -------------------------------- */
t('**못 내린 것을 돌려준다** — 그래야 쌓을 수 있다', () => {
  St.clearStock();
  /* 적치대 자리가 둘뿐인데 다섯을 내리려 한다 */
  const left = St.dropAtSink({ uid: 'S', cap: 2, slots: null }, { PART_R: 5 });
  assert.deepEqual(left, { PART_R: 3 });
  assert.equal(St.getLots('S').length, 2);
  /* 다 내렸으면 아무것도 안 돌려준다 */
  St.clearStock();
  assert.equal(St.dropAtSink({ uid: 'S', cap: 9, slots: null }, { PART_R: 5 }), null);
});

t('재료를 먹는 설비는 **그 종류 몫**까지만 받는다 — 규칙이 그대로 산다', () => {
  St.clearStock();
  const sink = { uid: 'M', cap: 10, slots: { PART_R: 2 } };
  const left = St.dropAtSink(sink, { PART_R: 3, PART_G: 2 });
  assert.deepEqual(left, { PART_R: 1, PART_G: 2 }, '안 쓰는 종류를 받아 버린다');
  assert.equal(St.getLots('M').length, 2);
});

/* ---------- 정지 판정 ------------------------------------------------------ */
const flow = (acc) => ({
  link: { uid: 'C1', to: { uid: 'S1' } },
  owner: { uid: 'P1' },
  sink: { uid: 'S1', cap: 1, slots: null },
  outKind: 'PART_R',
  accumulate: acc,
});

t('**축적형은 종점이 차도 안 선다** — 다 쌓일 때까지', () => {
  St.clearStock();
  St.addStock('S1', 1, 1, 'PART_R');                 // 적치대가 찼다
  const base = { placed: [], machines: [], itemOf: () => null };
  assert.ok(H.haltState({ ...base, beltFlows: [flow(false)] }).links.has('C1'), '보통 벨트가 안 선다');
  assert.equal(H.haltState({ ...base, beltFlows: [flow(true)], fullOf: () => false }).links.has('C1'), false,
    '축적형인데 섰다');
  /* 다 쌓이면 그때 선다 */
  assert.ok(H.haltState({ ...base, beltFlows: [flow(true)], fullOf: () => true }).links.has('C1'),
    '다 쌓였는데 안 선다 — 무한 버퍼가 된다');
});

t('**하류가 고장 났을 때도** 안 선다 — 버퍼가 가장 필요한 자리다', () => {
  /* 종점이 찼을 때만 봐 주면, 고장 난 하류 앞에서 그대로 같이 선다.
     실제로 그렇게 만들었다가 막힌 시간이 안 줄어서 드러났다. */
  St.clearStock();
  const base = { placed: [], machines: [], itemOf: () => null, downMap: { S1: 30 } };
  assert.ok(H.haltState({ ...base, beltFlows: [flow(false)] }).links.has('C1'), '보통 벨트가 안 선다');
  assert.equal(H.haltState({ ...base, beltFlows: [flow(true)], fullOf: () => false }).links.has('C1'), false,
    '하류가 고장 났다고 축적형까지 섰다');
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'MACHINE_2', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-30, -30], [30, 30]) }];
const placed = [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-10, 16], rot: 0, outputCount: 3, cycleSec: 2,
    recipe: { in: [], out: 'PART_R' },
  },
  {
    uid: 'SL', name: '느린 설비', itemId: 'MACHINE_2', pos: [-10, -6], rot: 0, outputCount: 3, cycleSec: 8,
    inputCap: 6, recipe: { in: [{ kind: 'PART_R', qty: 1 }], out: 'ASM_C' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-10, -18], rot: 0, capacity: 200 },
];
const links = (acc) => [
  {
    uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'SL' },
    radius: 0.5, layer: 0, width: 1, accumulate: acc,
  },
  {
    uid: 'C2', itemId: 'CONVEYOR', from: { uid: 'SL', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
    radius: 0.5, layer: 0, width: 1,
  },
];
const run = (acc, sec = 900) => {
  St.clearStock();
  const w = Lu.worldOf({
    placed, links: links(acc), carts: [], areas, walls: [], openings: [], shifts: [],
    beltSpeed: 0.6, itemOf, specOf,
  });
  R.runOnce({ seconds: sec, world: w.world, flow: w.flow, pick: () => 0, warmup: w.warmup.sec });
  return { out: St.getLots('S1').length, blocked: Mt.getBlocked().P1 ?? 0 };
};

t('**앞 설비가 안 막힌다** — 이것이 축적의 값이다', () => {
  const plain = run(false);
  const acc = run(true);
  assert.ok(plain.blocked > 60, `보통 벨트인데 안 막혔다 (${plain.blocked.toFixed(0)}초) — 검사가 무엇을 재는지 알 수 없다`);
  assert.ok(acc.blocked < plain.blocked * 0.2,
    `축적형인데 ${acc.blocked.toFixed(0)}초 막혔다 (보통 ${plain.blocked.toFixed(0)}초)`);
});

t('**병목을 올려 주지는 않는다** — 앞이 덜 설 뿐이다', () => {
  /* 버퍼는 상류를 안 세울 뿐 하류의 능력을 못 올린다. 늘어난 것처럼 적으면
     사람이 벨트만 바꿔 놓고 처리량이 늘기를 기다리게 된다 */
  const plain = run(false);
  const acc = run(true);
  assert.ok(Math.abs(acc.out - plain.out) <= Math.max(3, plain.out * 0.05),
    `축적형이 병목을 올렸다 (${plain.out} → ${acc.out})`);
});

t('축적을 안 켜면 **예전 값 그대로**', () => {
  const a = run(false);
  const b = run(false);
  assert.equal(a.out, b.out);
  assert.ok(a.blocked > 0, '보통 벨트가 안 막힌다 — 도면이 축적을 시험하지 못한다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const haltSrc = await readSrc('core/halt.js');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('두 길이 **같은 규칙**으로 내린다', () => {
  /* 내리는 규칙이 두 벌이 되면 축적이 화면에서만 되거나 반대가 된다 */
  for (const src of [repSrc, sceneSrc]) {
    assert.ok(src.includes('dropAtSink('), '내리는 규칙을 안 쓴다');
    assert.ok(src.includes('takeHeld('), '쌓아 둔 것을 안 먼저 내린다');
    assert.ok(src.includes('holdOnBelt('), '못 내린 것을 안 쌓는다');
  }
  assert.ok(lineupSrc.includes('accumulate: isAccumulating(link)'), '흐름이 축적을 안 싣는다');
});

t('정지 판정이 **두 자리 다** 봐 준다', () => {
  /* ①(종점이 찼다)와 ②(상류로 번진다) 둘 다. 하나만 넣으면 고장 앞에서 선다 */
  assert.equal((haltSrc.match(/f\.accumulate && !\(d\.fullOf/g) ?? []).length, 2,
    '축적 예외가 한 자리에만 있다');
});

t('화면이 축적을 받고, **뭘 못 하는지도** 말한다', () => {
  assert.ok(inspSrc.includes('patch: { accumulate: e.target.checked }'), '축적을 저장 안 한다');
  assert.ok(inspSrc.includes('병목을 올려 주지는 않습니다'), '못 하는 것을 안 말한다');
  assert.ok(inspSrc.includes('재공이 늡니다'), '치르는 값을 안 말한다');
});
