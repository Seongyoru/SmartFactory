/**
 * =============================================================================
 *  적치대 둘 → 조립기 하나 — 카트가 실제로 나르는가
 * =============================================================================
 *  인수인계 문서에 「끝까지 못 봤다」로 남아 있던 항목이다. 씬에서 돌려 보다가
 *  **정차역이 안 잡혀** 확인을 못 끝냈고, 그때는 화면 없이 돌릴 방법이 없었다.
 *
 *  이제 셋이 다 갖춰졌다 — 틱이 core 에 있고(`core/sim.js`), 라인을 세우는 것도
 *  core 에 있고(`core/lineup.js`), 모델까지 Node 에서 읽힌다(`_models.mjs`).
 *  그래서 **실제 GLB 치수로 도면을 세워** 300초를 돌린다.
 *
 *  ── 돌려 보고 나온 것 ─────────────────────────────────────────────────────
 *  역은 넷 다 잡혔다(적치대 둘 · 조립기 유입부 둘). 그런데 **적치대 하나는 한
 *  번도 안 썼다.** 카트는 비어 있을 때만 싣는데, 내려놓고 나서 먼저 만나는
 *  적치대에서 이미 차 버리기 때문이다. 화면에서는 「역이 넷이고 다 잡혔다」로
 *  보이고, 값으로는 한쪽 종류가 첫 바퀴 뒤로 영영 안 들어온다.
 *  → `usedLoads` / `idleLoads` 로 못 박고, 인스펙터가 경고한다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf } from './_models.mjs';

group('카트가 나르는 라인 (실제 모델)');

const C = await import(SRC + 'core/cart.js');
const S = await import(SRC + 'core/sim.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');

const have = await loadModels(['MACHINE_2', 'STILLAGE']);
const ready = have.includes('MACHINE_2');

t('조립기 GLB 가 Node 에서 읽힌다 — 없으면 아래가 전부 뜻이 없다', () => {
  assert.ok(ready, 'public/models/Machine_2.glb 를 못 읽었다');
  const sp = specOf('MACHINE_2');
  /* 라이브러리 설명에 적힌 치수 그대로여야 한다 — 다르면 둘 중 하나가 낡았다 */
  const [w, h, d] = sp.bbox.size.map((n) => Number(n.toFixed(2)));
  assert.deepEqual([w, h, d], [3.44, 4.0, 4.19], `치수가 다르다: ${w}×${h}×${d}`);
  assert.equal(sp.ports.filter((p) => p.kind === 'in').length, 2, '유입부가 둘이 아니다');
});

/* ---------- 도면 ---------------------------------------------------------
     적치대 A(-4,0) · 적치대 B(4,0) · 조립기 M(0,8)
     경로는 넷을 다 지나는 고리 하나.
   ------------------------------------------------------------------------ */
const placed = [
  { uid: 'A', name: '적치대 A', itemId: 'STILLAGE', pos: [-4, 0], rot: 0, dispatchCount: 3 },
  { uid: 'B', name: '적치대 B', itemId: 'STILLAGE', pos: [4, 0], rot: 0, dispatchCount: 3 },
  {
    uid: 'M', name: '조립기', itemId: 'MACHINE_2', pos: [0, 8], rot: 0,
    outputCount: 3, cycleSec: 4,
    recipe: { in: [{ kind: 'PART_R', qty: 1 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' },
  },
];
const cart = {
  uid: 'C1', speed: 3, dwell: 0.3, closed: true,
  points: [[-4, -1.2], [4, -1.2], [4, 10.3], [-4, 10.3]],
};
const path = C.cartPath(cart);
const stations = C.cartStations(path, placed, itemOf, {});
const at = (uid, kind) => stations.filter((s) => s.uid === uid && s.kind === kind);

t('역이 넷 다 잡힌다 — 적치대 둘 · 조립기 유입부 둘', () => {
  assert.equal(at('A', 'shelf-out').length, 1, '적치대 A 가 역이 아니다');
  assert.equal(at('B', 'shelf-out').length, 1, '적치대 B 가 역이 아니다');
  assert.equal(at('M', 'unload').length, 2, '조립기 유입부 둘이 안 잡혔다');
  /* 유출부는 경로에서 4m 밖이다 — 안 잡히는 것이 맞다 */
  assert.equal(at('M', 'load').length, 0, '지나가지도 않는 유출부가 역이 됐다');
});

/**
 * 300초를 돌린다. 만든 개수는 **걷어 가면서** 센다 — 출력 자리가 차면 설비가
 * 막혀서, 나르는 쪽을 보려는 검사가 만드는 쪽 한계에 걸린다.
 */
function run(pickKinds, seconds = 300) {
  S.resetRun();
  St.addLots('A', Array.from({ length: 90 }, () => 'PART_R'), 99);
  St.addLots('B', Array.from({ length: 90 }, () => 'PART_G'), 99);
  const u = S.newCartUnit(0);
  const machines = Lu.machinesOf({ placed, itemOf });
  const ctx = { path, cart: { ...cart, pickKinds }, stations, capacity: 6, topUp: false };
  let made = 0;
  for (let s = 0; s < seconds; s += S.STEP ?? 0.1) {
    S.runCart(u, ctx, 0.1);
    S.runMachines(0.1, { machines });
    made += St.takeMade('M', 99);
  }
  const kinds = {};
  for (const k of St.getLots('M')) kinds[k] = (kinds[k] ?? 0) + 1;
  return { made, buffer: kinds, left: { A: St.getStock('A'), B: St.getStock('B') } };
}

t('두 종류를 다 골라야 조립기가 돈다', () => {
  /* 조립기는 제작품 둘을 받아야 하나를 만든다. 한 종류만 고른 카트는 그 종류만
     날라서, 버퍼는 차는데 **완성품은 0** 이다 — 「재고는 쌓이는데 안 만든다」가
     화면에서 가장 헷갈리는 자리라 값으로 못 박는다. */
  assert.ok(run(['PART_R', 'PART_G']).made > 0, '두 종류를 다 골랐는데 안 만든다');
  assert.equal(run(['PART_R']).made, 0, '한 종류만 날랐는데 조립품이 나왔다');
});

t('고른 것만 싣는다 — 안 고른 적치대는 그대로 남는다', () => {
  const r = run(['PART_R']);
  assert.equal(r.left.B, 90, `안 고른 종류를 실어 갔다 (남은 ${r.left.B})`);
  assert.ok(r.left.A < 90, '고른 종류를 안 실어 갔다');
});

/* ---------- 돌려 보고 나온 것 -------------------------------------------- */
t('싣는 곳이 둘이면 **먼저 만나는 하나만** 쓰인다', () => {
  /* 값이 먼저다. 두 종류를 다 골랐는데도 B 쪽(PART_G)이 거의 안 빠진다 —
     첫 바퀴에 실은 3개뿐이다. */
  const r = run(['PART_R', 'PART_G']);
  assert.equal(r.left.B, 87, `B 가 첫 바퀴 말고도 쓰였다 (남은 ${r.left.B})`);
  assert.ok(90 - r.left.A > 3 * 5, `A 도 첫 바퀴밖에 안 쓰였다 (남은 ${r.left.A})`);

  /* 그 사실을 규칙이 똑같이 말하는가 — 돌려 보지 않고도 경고할 수 있어야 한다 */
  const used = C.usedLoads(stations, { closed: true });
  assert.deepEqual([...used].map((i) => stations[i].uid), ['A'], '쓰이는 역을 잘못 짚는다');
  assert.deepEqual(C.idleLoads(stations, { closed: true }).map((s) => s.uid), ['B']);
});

t('싣는 곳이 하나면 노는 역이 없다 — 위 규칙이 과하지 않다', () => {
  const only = stations.filter((s) => s.uid !== 'B');
  assert.equal(C.idleLoads(only, { closed: true }).length, 0, '멀쩡한 경로를 경고한다');
});

t('트럭은 이 규칙 밖이다 — 자리가 찰 때까지 여러 역에서 담는다', () => {
  assert.equal(C.idleLoads(stations, { closed: true, topUp: true }).length, 0);
});

t('나르는 능력은 **서는 역만** 센다', () => {
  /* 예전에는 싣는 역 중 가장 많이 싣는 쪽을 골랐다. 그 역이 안 서는 역이면
     화면의 능력만 크고 라인은 그대로 굶는다. */
  const big = stations.map((s) => (s.uid === 'B' ? { ...s, dispatch: 99 } : s));
  const h = C.haulPerMinute({ ...cart, count: 1 }, path, big);
  const base = C.haulPerMinute({ ...cart, count: 1 }, path, stations);
  assert.equal(h.perLap, base.perLap, '안 서는 역의 수량이 능력으로 잡힌다');
});

/* ---------- 화면이 그 사실을 말하는가 ------------------------------------ */
const insp = await readSrc('ui/Inspector.jsx');
t('인스펙터가 노는 역을 경고한다', () => {
  assert.ok(insp.includes('idleLoads(stations, { closed: !!cart.closed })'), '경고가 없다');
  assert.ok(insp.includes('한 번도 안 섭니다.'), '문구가 없다');
  assert.ok(/idleLoads,/.test(insp), 'import 가 없다');
});
t('트럭에는 그 경고를 안 띄운다', () => {
  const blk = insp.slice(insp.indexOf('const idle = idleLoads') - 220, insp.indexOf('const idle = idleLoads'));
  assert.ok(blk.includes('if (truck) return null;'), '트럭까지 경고한다');
});
