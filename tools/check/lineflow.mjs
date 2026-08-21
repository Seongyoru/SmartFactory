/**
 * =============================================================================
 *  화면 없이 **물건이 밖으로 나가는가** — 라인 통짜로
 * =============================================================================
 *  반복 실행은 라인의 **절반만** 돌고 있었다. `runOnce` 가 `runMachines` 하나만
 *  불렀으므로 설비는 만들고, 만든 것은 **아무 데도 안 갔다.** 출력 자리가 차면
 *  전부 막히고, 밖으로 나간 것이 없어 처리량은 **어떤 도면에서든 0** 이었다.
 *
 *  화면은 「밖으로 나간 것이 없습니다 — 출하 경로를 놓아야 잡힙니다」 라고 말했다.
 *  도면 탓으로 읽히는 문구인데, 실은 **돌리는 쪽이 옮기지를 않고 있었다.**
 *
 *  그래서 여기서는 도면 한 벌을 세워 놓고 **끝에서 끝까지** 본다 —
 *  제작기 → 컨베이어 → 적치대 → 트럭 → 개구부 → 출하.
 *  실제 GLB 치수로 세운다(`_models.mjs`), 화면은 없다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { LIB, itemOf, loadModels } from './_models.mjs';

group('라인 통짜 — 만들고 옮기고 내보낸다');

const C = await import(SRC + 'core/cart.js');
const A = await import(SRC + 'core/area.js');
const Lk = await import(SRC + 'core/link.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const St = await import(SRC + 'core/simStore.js');

await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR', 'TRUCK']);

/* ---------- 도면 한 벌 ----------------------------------------------------
     제작기(-6,6) ─벨트─> 적치대(-6,0) ─트럭─> 개구부(0,-15) 밖
   ------------------------------------------------------------------------ */
const areas = [{ uid: 'F', name: '바닥', mp: A.rectMP([-15, -15], [15, 15]) }];
const openings = [{ uid: 'O1', at: [0, -15], width: 4, height: 4, sill: 0 }];
const placed = [
  {
    uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 6], rot: 0,
    outputCount: 3, cycleSec: 3, recipe: { in: [], out: 'PART_R' },
  },
  { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, 0], rot: 0, dispatchCount: 3 },
];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const carts = [{
  uid: 'T1', name: '트럭', itemId: 'TRUCK', speed: 4, dwell: 0.5, closed: true, loadCount: 10,
  points: [[-6, -1.6], [2, -1.6], [2, -18], [-6, -18]],
}];

const linkPaths = links.map((link) => ({ link, path: Lk.linkPath(link, placed, itemOf) })).filter((x) => x.path);
const beltFlows = Lu.beltFlowsOf({ linkPaths, placed, itemOf, beltSpeed: 0.6 });
const cartPaths = carts.map((c) => {
  const p = C.cartPath(c);
  return p ? { cart: c, path: p, stations: C.cartStations(p, placed, itemOf, { loadOnly: true, roles: c.roles }) } : null;
}).filter(Boolean);
const floor = A.floorOf(areas);
const gates = A.openingGates(openings, A.wallLines(areas, []));
const machines = Lu.machinesOf({ placed, itemOf });

const worldOf = () => R.lineWorld({
  beltFlows, machines, placed, itemOf, crew: null, equips: [],
  downMap: () => ({}), shipped: () => St.shippedTotal(St.getShipped()),
});
const flowOf = () => R.lineFlow({
  beltFlows, cartPaths, floor, gates, isTruck: (c) => LIB.isTruck(itemOf(c.itemId)),
});
/**
 * 한 판. **판마다 0 에서 시작한다.**
 *  예전에는 `resetRun` 이 출하 누계를 안 비워서, 여기서 앞 판의 값을 빼 뒀다.
 *  **오더가 라인을 이끌게 되면서 달라졌다**(dispatch.js) — 오더의 진척을 누계로
 *  세므로, 안 지우면 두 번째 판부터 오더가 이미 다 찬 것으로 보인다.
 *  이제 `resetRun` 이 누계까지 지우므로 뺄 것이 없다.
 */
const run = (withFlow, seconds = 600) => R.runOnce({
  seconds, world: worldOf(), flow: withFlow ? flowOf() : null, rand: R.seeded(7),
  pick: () => ({ shipped: St.shippedTotal(St.getShipped()), stock: St.getStock('S1') }),
});

const dockSrc = await readSrc('ui/RunDock.jsx');
const scenSrc = await readSrc('ui/Scenarios.jsx');

t('도면이 실제로 이어져 있다 — 벨트·역·문', () => {
  assert.equal(beltFlows.length, 1, '벨트가 안 잡혔다');
  assert.equal(beltFlows[0].sink?.uid, 'S1', '벨트 종점이 적치대가 아니다');
  assert.deepEqual(cartPaths[0].stations.map((s) => `${s.uid}/${s.kind}`), ['S1/shelf-out'],
    '트럭이 적치대에서 싣지 않는다');
  assert.equal(gates.length, 1, '개구부가 문이 안 됐다');
});

t('**물건이 밖으로 나간다** — 화면 없이', () => {
  const r = run(true);
  assert.ok(r.shipped > 100, `10분 돌려 ${r.shipped}개밖에 안 나갔다`);
});

t('옮기는 쪽이 없으면 **하나도** 안 나간다 — 이게 원래 상태였다', () => {
  /* 같은 도면, 같은 시간. 다른 것은 flow 하나다.
     이 값이 0 이 아니게 되면 위 검사가 무엇을 재는지 알 수 없게 된다. */
  const r = run(false);
  assert.equal(r.shipped, 0, '옮기지도 않는데 나갔다 — 전제가 무너졌다');
  assert.equal(r.stock, 0, '벨트가 없는데 적치대에 쌓였다');
});

t('벨트가 적치대를 채운다 — 중간 단계도 값으로', () => {
  R.runOnce({ seconds: 60, world: worldOf(), flow: R.lineFlow({ beltFlows, cartPaths: [], floor, gates }) });
  assert.ok(St.getStock('S1') > 0, '벨트가 적치대로 안 나른다');
});

t('판마다 처음부터 — 벨트와 카트도 되돌린다', () => {
  /* 그릇을 안 비우면 두 번째 판이 첫 판의 벨트 위 물건을 이어받아, 판이
     거듭될수록 처리량이 는다 — 「여러 판」의 뜻이 통째로 사라진다. */
  const flow = flowOf();
  const w = worldOf();
  /* `resetRun` 이 **출하 누계까지** 0 으로 돌린다 — 판마다 빼 둘 것이 없다.
     (오더가 라인을 이끌게 되면서 누계가 남으면 안 되게 됐다: dispatch.js) */
  const one = () => R.runOnce({
    seconds: 120, world: w, flow, rand: R.seeded(7),
    pick: () => St.shippedTotal(St.getShipped()),
  });
  const x = one();
  const y = one();
  assert.ok(x > 0, `첫 판에서 아무것도 안 나갔다`);
  assert.equal(x, y, `같은 씨앗인데 판이 달라진다 (${x} vs ${y})`);
});

t('반복 실행이 실제로 값을 낸다 — 「0 ± 0」 이 아니라', () => {
  const r = R.replicate({
    reps: 3, seconds: 120, seed: 1, world: worldOf(), flow: flowOf(),
    pick: () => St.shippedTotal(St.getShipped()),
  });
  assert.equal(r.n, 3);
  assert.ok(r.mean > 0, `여러 판을 돌려도 0 이 나온다`);
});

t('화면은 **이번 판에 늘어난 만큼**을 본다 — 누계가 아니라', () => {
  /* 출하 누계는 판을 거듭해도 안 비워진다(화면 HUD 가 그 값이다). 그대로
     세면 판이 갈수록 커져 ± 가 뜻을 잃는다. metrics 의 throughput 이
     shippedStart 로 이번 실행 몫만 내주므로 화면은 그것을 쓴다. */
  for (const f of [dockSrc, scenSrc]) {
    assert.ok(/pick: \(\) => throughput\(shippedTotal\(getShipped\(\)\)\)/.test(f),
      '누계를 그대로 세고 있다');
  }
});

/* ---------- 규칙이 두 벌이 되지 않게 ------------------------------------ */
const repSrc = await readSrc('core/replicate.js');
const storeSrc = await readSrc('core/simStore.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');

t('굴리는 것은 **sim.js 가 한다** — 여기는 그릇만 만든다', () => {
  assert.ok(repSrc.includes('runBelt('), 'sim 의 runBelt 를 안 쓴다');
  assert.ok(repSrc.includes('runCart('), 'sim 의 runCart 를 안 쓴다');
  assert.equal(/advanceBelt|stepCart|applyStation/.test(repSrc), false,
    '옮기는 규칙을 여기서 다시 적었다 — 화면과 두 벌이 된다');
});

t('덩어리를 싣는 규칙이 화면과 같다 — **한 곳에** 있다', () => {
  /* 화면(onSpawn)과 헤드리스가 다르면 같은 도면이 다른 처리량을 낸다.
     규칙 자체는 `simStore.takeBundles` 한 곳에 있고 둘 다 그것을 부른다. */
  for (const src of [repSrc, sceneSrc]) assert.ok(src.includes('takeBundles('), '덩어리 규칙을 안 쓴다');
  assert.ok(storeSrc.includes('export function takeBundles'), '규칙이 한 곳에 없다');
  /* 자투리를 안 보내면 라인이 통째로 선다 — 실제로 18개에서 멈췄다 */
  assert.ok(storeSrc.includes('closed: at + n < list.length'), '자투리가 영영 안 빠진다');
});

const simSrc = await readSrc('core/sim.js');
t('불량은 **만들 때** 거른다 — 벨트에는 양품만 실린다', () => {
  /* 예전에는 벨트 끝에서 걸렀다. 그래서 **카트로 나르는 설비는 불량이 아예
     안 나왔고**, 다 흘러간 뒤라 재작업으로 되돌릴 수도 없었다. 도착 자리에
     거르는 코드가 남아 있으면 같은 불량률을 두 번 문다. */
  for (const src of [repSrc, sceneSrc]) {
    assert.equal(/screen\(/.test(src), false, '도착 자리에서 또 거른다');
  }
  assert.ok(simSrc.includes('screenAgain(n, m.scrapRate, m.uid, rand)'), '재작업품을 다시 안 본다');
  assert.ok(simSrc.includes('screen(n, m.scrapRate, m.uid, rand)'), '만들 때 안 거른다');
});

t('벨트는 화면과 **같은 값**으로 선다', () => {
  /* running = !halted.links · feeding = !halted.dry — EditorScene 이 넘기는 그대로 */
  assert.ok(repSrc.includes("halted.links?.has?.(b.link.uid)"), '보낼 곳이 없어도 계속 돈다');
  assert.ok(repSrc.includes("feeding: !halted.dry?.has?.(b.link.uid)"), '앞 설비가 굶어도 계속 올라탄다');
  assert.ok(repSrc.includes('links: h.links'), 'lineWorld 가 그 값을 안 넘긴다');
  assert.ok(repSrc.includes('dry: h.dry'), 'lineWorld 가 그 값을 안 넘긴다');
});

t('트럭만 나눠 담고 밖으로 나간다', () => {
  assert.ok(repSrc.includes('topUp: f.truck'), '카트도 자리 찰 때까지 담는다');
  assert.ok(repSrc.includes('shipOutside: f.truck'), '카트도 밖으로 나가면 출하가 된다');
});

/* ---------- 화면이 그것을 부르는가 -------------------------------------- */
const lwSrc = await readSrc('ui/useLineWorld.js');
const lineupSrc = await readSrc('core/lineup.js');
for (const [file, what] of [['ui/RunDock.jsx', '여러 판'], ['ui/Scenarios.jsx', '배치 비교']]) {
  const s = await readSrc(file);
  t(`${what} 이 옮기는 쪽까지 넘긴다`, () => {
    assert.ok(/const \{[^}]*\bflow\b[^}]*\} = useLineWorld\(\)/.test(s), 'flow 를 안 받는다');
    assert.ok(/replicate\(\{[\s\S]{0,200}?\bflow,/.test(s), 'replicate 에 flow 를 안 넘긴다');
  });
}
t('옮기는 쪽도 **같은 자리**에서 만든다', () => {
  assert.ok(lineupSrc.includes('const flow = lineFlow({'), 'worldOf 가 flow 를 안 만든다');
  assert.ok(lineupSrc.includes('cartStations(p, placed, itemOf, opt)'), '역을 화면과 다르게 푼다');
  assert.ok(lwSrc.includes('worldOf({'), '훅이 core 를 안 부른다');
  const deps = lwSrc.match(/\[([\s\S]*?)\],\s*\);/)?.[1] ?? '';
  for (const k of ['state.areas', 'state.walls', 'state.openings']) {
    assert.ok(deps.includes(k), `문이 ${k} 를 안 본다 — 개구부를 뚫어도 안 나간다`);
  }
});
