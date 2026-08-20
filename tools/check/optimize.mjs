/**
 * =============================================================================
 *  배치 탐색 — 값을 올리려고 **도면을 망가뜨리지 않는가**
 * =============================================================================
 *  이 모듈의 위험은 「좋은 답을 못 찾는 것」이 아니라 **「나쁜 답을 좋다고 하는
 *  것」**이다. 개당 거리는 나르는 양이 0 이면 함께 0 이 되므로, 경로를 부수면
 *  점수가 좋아진다. 막지 않으면 탐색이 **부수는 쪽으로 수렴한다.**
 *
 *  그래서 검사의 절반이 「안 고르는가」다. 실제 GLB 치수로 도면을 세운다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { LIB, itemOf, loadModels, specOf as specById } from './_models.mjs';

group('배치 탐색');

const O = await import(SRC + 'core/optimize.js');
const A = await import(SRC + 'core/area.js');
const Lk = await import(SRC + 'core/link.js');
const Sh = await import(SRC + 'core/shelf.js');
const G = await import(SRC + 'core/grid.js');

await loadModels(['MACHINE_1', 'MACHINE_2', 'STILLAGE', 'CONVEYOR']);

const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const bboxOf = (p) => {
  const it = itemOf(p.itemId);
  if (LIB.isShelf(it)) return Sh.shelfBBox(p, specOf(it));
  return specOf(it)?.bbox ?? null;
};
const lengthOf = (l, list) => Lk.linkPath(l, list, itemOf)?.length ?? 0;
const floor = A.floorOf([{ uid: 'F', mp: A.rectMP([-30, -30], [30, 30]) }]);

/* ---------- 도면: 제작기 둘이 조립기 하나를 먹인다 -----------------------
     조립기는 PART_R 을 **세 개**, PART_G 를 한 개 먹는다. 그런데 많이 쓰는
     쪽(제작기 A)이 **먼 자리**에 앉아 있다 — 맞바꾸면 줄어드는 배치다.
   ------------------------------------------------------------------------ */
const mk = () => [
  { uid: 'P1', name: '제작기 A', itemId: 'MACHINE_1', pos: [-4, 16], rot: 2, outputCount: 3, cycleSec: 3, recipe: { in: [], out: 'PART_R' } },
  { uid: 'P2', name: '제작기 B', itemId: 'MACHINE_1', pos: [4, 0], rot: 2, outputCount: 3, cycleSec: 3, recipe: { in: [], out: 'PART_G' } },
  {
    uid: 'ASM', name: '조립기', itemId: 'MACHINE_2', pos: [0, -8], rot: 0, outputCount: 3, cycleSec: 6,
    recipe: { in: [{ kind: 'PART_R', qty: 3 }, { kind: 'PART_G', qty: 1 }], out: 'ASM_C' },
  },
];
const links = [
  { uid: 'L1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'ASM', portId: 'PORT_IN@Z+1' }, radius: 0.5, layer: 0, width: 1 },
  { uid: 'L2', itemId: 'CONVEYOR', from: { uid: 'P2', portId: 'PORT_OUT@Z-' }, to: { uid: 'ASM', portId: 'PORT_IN@Z+2' }, radius: 0.5, layer: 0, width: 1 },
];
const ctx = (over = {}) => ({
  placed: mk(), links, carts: [], itemOf, specOf, bboxOf, beltSpeed: 0.6,
  floor, walls: [], pillars: [], lengthOf, ...over,
});

const optSrc = await readSrc('core/optimize.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');

/* ---------- 잰다 ---------------------------------------------------------- */
t('개당 거리를 잰다 — 화면과 같은 식으로', () => {
  const per = O.scoreOf(mk(), ctx());
  assert.ok(per > 0, `못 쟀다 (${per})`);
  /* 오가는 것이 없으면 「좋다」가 아니라 **모른다** 여야 한다 */
  assert.equal(O.scoreOf(mk(), ctx({ links: [] })), null, '벨트가 없는데 점수가 나온다');
});

t('돌려도 같은 답이 나온다 — 씨앗도 난수도 없다', () => {
  const a = O.searchLayout(ctx());
  const b = O.searchLayout(ctx());
  assert.deepEqual(a.steps.map((s) => [s.a, s.b]), b.steps.map((s) => [s.a, s.b]));
  assert.equal(a.after, b.after);
});

t('맞바꾸기와 당기기를 **섞어서** 줄인다', () => {
  const r = O.searchLayout(ctx());
  assert.ok(r.ok, `줄일 것을 못 찾았다 (${r.why})`);
  assert.ok(r.after < r.before, '더 나빠졌다');
  /* 빈 자리로 옮길 수 있으면 맞바꾸기만 할 때보다 훨씬 더 줄어든다.
     맞바꾸기만 돌리던 시절의 답이 69.9 m 였다. */
  assert.ok(r.after < 40, `당기기가 일을 안 한다 (${r.after.toFixed(1)} m)`);
  assert.ok(r.steps.some((s) => s.kind === 'slide'), '당기기를 한 번도 안 골랐다');
});

t('당기기 걸음은 **말로 옮길 수 있다** — 누구를 어디로 몇 미터', () => {
  const r = O.searchLayout(ctx());
  const slide = r.steps.find((s) => s.kind === 'slide');
  assert.ok(slide.aName, '누구를 옮기는지 안 적었다');
  assert.ok(slide.towardName, '어디로 당기는지 안 적었다');
  assert.ok(slide.dist > 0, '몇 미터인지 안 적었다');
  /* 그리드에 맞춰 돌려준다 — 그대로 놓을 수 있어야 한다 */
  for (const v of slide.pos) assert.equal(Math.round(v / 0.25) * 0.25, v, `격자에 안 맞는다 (${v})`);
});

t('맞바꾸기 쪽이 나으면 맞바꾼다 — 당기기가 다 먹지 않는다', () => {
  /* 자리가 꽉 차 옮길 데가 없으면 맞바꾸기밖에 없다. 그때도 답이 나와야 한다. */
  const tight = mk().map((p) => ({ ...p, pos: [p.pos[0], p.pos[1]] }));
  const boxed = A.rectMP([-6, -11], [6, 19]);          // 딱 세 대만 들어가는 바닥
  const r = O.searchLayout(ctx({ placed: tight, floor: boxed }));
  assert.ok(r.ok, '좁은 바닥에서 아무것도 못 한다');
  assert.ok(r.after < r.before);
});

t('걸음을 따라가면 내놓은 배치가 나온다 (맞바꾸기 · 당기기 둘 다)', () => {
  const r = O.searchLayout(ctx());
  let cur = mk();
  for (const s of r.steps) {
    if (s.kind === 'swap') {
      cur = O.swapped(cur, cur.findIndex((p) => p.uid === s.a), cur.findIndex((p) => p.uid === s.b));
    } else {
      cur = cur.map((p) => (p.uid === s.a ? { ...p, pos: s.pos } : p));
    }
  }
  assert.deepEqual(cur.map((p) => [p.uid, ...p.pos]), r.placed.map((p) => [p.uid, ...p.pos]),
    '걸음대로 옮긴 결과가 내놓은 배치와 다르다');
  assert.ok(Math.abs(O.scoreOf(r.placed, ctx()) - r.after) < 1e-9, '적용한 배치의 점수가 다르다');
});

t('옮길 것이 하나도 없으면 아무 말도 안 한다', () => {
  assert.equal(O.searchLayout(ctx({ movable: () => false })).why, 'too-few');
});

/* ---------- 통로 --------------------------------------------------------- */
const AISLE_CART = [{
  uid: 'C0', name: '통로', itemId: 'CART', speed: 2, dwell: 1, closed: true,
  points: [[-12, 4], [12, 4], [12, 12], [-12, 12]],
}];

t('경로를 점으로 펴 둔다 — 후보마다 다시 훑지 않는다', () => {
  const pts = O.aislePoints(AISLE_CART);
  assert.ok(pts.length > 100, `너무 성기다 (${pts.length}개)`);
  /* 성기면 설비 한 대가 두 점 사이로 빠져나간다 */
  let gap = 0;
  for (let i = 1; i < pts.length; i++) {
    gap = Math.max(gap, Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  assert.ok(gap < 0.25, `점 사이가 벌어져 설비가 빠져나간다 (${gap.toFixed(2)} m)`);
});

t('**길 위에 물건을 놓지 않는다**', () => {
  const pts = O.aislePoints(AISLE_CART);
  const on = { minX: -1.4, maxX: 1.4, minZ: 2.1, maxZ: 5.9 };      // 경로(z=4) 한복판
  const off = { minX: -1.4, maxX: 1.4, minZ: -5.9, maxZ: -2.1 };
  assert.equal(O.blocksAisle(on, pts), true, '경로 위에 놓을 수 있다고 한다');
  assert.equal(O.blocksAisle(off, pts), false, '경로에서 먼 자리까지 막는다');
});

t('여유(margin)는 **0 이 기본**이다 — 두면 정차역이 사라진다', () => {
  /* 정차역은 경로가 설비 포트 1 m 안을 지나야 생기고, 포트는 바운딩 박스
     **안쪽**에 박혀 있다. 여유를 1 m 로 두면 정상 배치가 전부 불법이 된다. */
  assert.equal(O.AISLE_MARGIN, 0);
  assert.ok(optSrc.includes('STATION_DIST'), '왜 0 인지가 코드에 안 적혀 있다');
});

/* ---------- 통로를 가로지르고 싶어 하는 도면 ----------------------------
     앞 검사(「탐색이 설비를 경로 위로 안 옮긴다」)는 **아무 도면에서나** 하면
     저절로 통과한다 — 탐색이 애초에 그리로 갈 이유가 없으면 가드가 있으나
     없으나 같다. 되돌리기 테스트로 그걸 확인했다(안 물었다).

     그래서 **길이 라인을 가로지르는** 도면을 세운다.

         제작기 A (z=16)
         ────────── 카트 길 (z=4~6) ──────────   ← 적치대·선반이 이 길에 붙어 있다
         제작기 B (z=0) · 조립기 (z=−8)

     조립기를 제작기 A 쪽으로 당기면 길을 밟는 자리가 나오고, 그 자리가 실제로
     점수가 좋다. 통로를 안 보면 설비 셋이 길 위에 올라앉는다.
   ------------------------------------------------------------------------ */
const CROSS = () => {
  const list = mk();
  list.push({ uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-12, 5], rot: 0, dispatchCount: 3 });
  list.push({ uid: 'H1', name: '선반', itemId: 'SHELF', pos: [12, 5], rot: 0, bays: 2, levels: 2, rows: 1 });
  return list;
};
const CROSS_CART = [{
  uid: 'C1', name: '카트', itemId: 'CART', speed: 2, dwell: 1, closed: true,
  points: [[-16, 4], [16, 4], [16, 6], [-16, 6]],
}];
const onAisle = (list, pts) => list.filter((p) => {
  const bb = bboxOf(p);
  return bb && O.blocksAisle(G.footprintOf({ ...p, bboxOverride: bb }, null), pts);
});

t('길이 라인을 가로지르면 **당기기가 길을 밟고 싶어 한다**', () => {
  /* 이 검사가 통로 판정의 존재 이유다. 안 보고 돌리면 실제로 셋이 올라앉는다.
     여기서 「길 위에 놓는 쪽이 점수가 좋다」가 확인돼야, 가드를 빼면 그리로
     간다는 말이 된다. */
  const d = ctx({ placed: CROSS(), carts: CROSS_CART });
  const pts = O.aislePoints(CROSS_CART);
  assert.equal(onAisle(CROSS(), pts).length, 0, '전제가 무너졌다 — 처음부터 길 위에 있다');

  const free = O.searchLayout({ ...d, aisle: [] });            // 통로를 안 볼 때
  assert.ok(free.ok, '전제가 무너졌다 — 줄일 것이 없다');
  const parked = onAisle(free.placed, pts);
  assert.ok(parked.length >= 2, `길 위에 안 올라앉는다 (${parked.length}대) — 도면을 다시 세울 것`);
  assert.ok(free.after < 40, `길을 밟는 쪽이 안 좋다 (${free.after.toFixed(1)} m) — 유혹이 없다`);
});

t('통로를 보면 **하나도 안 올라앉는다**', () => {
  const d = ctx({ placed: CROSS(), carts: CROSS_CART });
  const pts = O.aislePoints(CROSS_CART);
  const r = O.searchLayout(d);
  assert.ok(r.ok, '통로를 지키면 아무것도 못 한다 — 너무 빡빡하다');
  assert.deepEqual(onAisle(r.placed, pts).map((p) => p.name), [], '설비가 길 위에 있다');
});

t('통로를 지키는 값은 **점수로 치른다** — 그 사실을 숨기지 않는다', () => {
  /* 길을 밟으면 29.6 m 까지 가지만 그 도면은 카트가 못 다닌다. 63.1 m 가
     「쓸 수 있는 배치」의 값이다. 이 차이가 사라지면 위 검사도 뜻이 없어진다. */
  const d = ctx({ placed: CROSS(), carts: CROSS_CART });
  const kept = O.searchLayout(d);
  const free = O.searchLayout({ ...d, aisle: [] });
  assert.ok(free.after < kept.after, '통로를 지켜도 점수가 같다 — 판정이 안 물고 있다');
});

/* ---------- 구역 --------------------------------------------------------- */
t('구역을 그렸으면 그 안에 머문다', () => {
  /* 제작기 A(-4,16)만 감싸는 구역. 이 설비는 아무리 좋아 보여도 못 나간다. */
  const zones = [{ uid: 'Z1', name: '제작 구역', mp: A.rectMP([-10, 10], [2, 22]) }];
  const d = ctx({ zones });
  const home = O.zoneHome(d);
  assert.equal(home.get('P1')?.uid, 'Z1', '구역 안에 있는 설비를 못 알아본다');
  assert.equal(home.has('ASM'), false, '구역 밖 설비까지 묶는다');

  const r = O.searchLayout(d);
  const p1 = r.placed.find((p) => p.uid === 'P1');
  const f = G.footprintOf({ ...p1, bboxOverride: bboxOf(p1) }, null);
  assert.ok(f.minX >= -10 && f.maxX <= 2 && f.minZ >= 10 && f.maxZ <= 22,
    `제작기 A 가 구역 밖으로 나갔다 (${JSON.stringify(p1.pos)})`);
});

t('구역에 걸쳐 있거나 밖에 있던 것은 안 묶는다', () => {
  /* 원래 자유롭던 것을 묶으면, 구역 하나 그었다고 딴 데가 굳는다 */
  const zones = [{ uid: 'Z1', name: '반쯤', mp: A.rectMP([-4, 14], [20, 22]) }];
  assert.equal(O.zoneHome(ctx({ zones })).size, 0, '걸쳐 있는 설비를 묶었다');
});

/* ---------- 얼마나 걸리나 ------------------------------------------------ */
t('후보를 무한정 안 뒤진다 — 화면이 멈추면 안 쓴다', () => {
  const t0 = Date.now();
  const r = O.searchLayout(ctx());
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `${ms}ms 나 걸린다`);
  /* 빈 자리를 전부 훑으면 수만 자리다. 당기는 방향으로만 걸어 본다 */
  assert.ok(r.tried < 3000, `후보가 너무 많다 (${r.tried})`);
  assert.ok(O.PULL_STEPS <= 12, '너무 멀리까지 당겨 본다');
});


t('회전은 안 건드린다 — 「맞바꾸세요」 한 마디로 끝나야 한다', () => {
  const r = O.searchLayout(ctx());
  const rot = new Map(mk().map((p) => [p.uid, p.rot]));
  for (const p of r.placed) assert.equal(p.rot, rot.get(p.uid), `${p.uid} 의 방향이 바뀌었다`);
});

/* ---------- 안 고르는가 (여기가 핵심) ------------------------------------ */
t('겹치는 자리는 안 고른다', () => {
  /* **맞바꾸는 둘끼리는 절대 안 겹친다** — 서로의 자리를 바꾸는 것이라 판정이
     대칭이다. 겹침은 늘 **제3자**와 생긴다. 조립기(가로 3.44)가 제작기(2.83)보다
     넓으므로, 제작기 옆에 딱 맞게 붙여 둔 적치대(1.50)와 부딪힌다. */
  const tight = mk();
  tight.push({ uid: 'S9', name: '적치대', itemId: 'STILLAGE', pos: [6.3, 0], rot: 0 });
  const d = ctx({ placed: tight });
  assert.equal(O.placeOk(tight, ['P2'], d), true, '전제가 무너졌다 — 원래 배치가 이미 겹친다');

  const i = tight.findIndex((p) => p.uid === 'P2');
  const j = tight.findIndex((p) => p.uid === 'ASM');
  assert.equal(O.placeOk(O.swapped(tight, i, j), ['P2', 'ASM'], d), false,
    '겹치는 배치를 놓을 수 있다고 한다');
});

t('바닥 밖은 안 고른다', () => {
  const far = mk();
  far[0].pos = [0, 40];                            // 바닥(±30) 밖
  assert.equal(O.placeOk(O.swapped(far, 0, 1), ['P1', 'P2'], ctx({ placed: far })), false,
    '바닥 밖에 놓는다');
});

t('기둥 자리는 안 고른다', () => {
  const next = O.swapped(mk(), 0, 1);
  assert.equal(O.placeOk(next, ['P1', 'P2'], ctx()), true, '전제가 무너졌다 — 기둥 없이도 못 놓는다');
  const pillars = [{ uid: 'W1', pos: [4, 0], size: [2, 2], rot: 0 }];
  assert.equal(O.placeOk(next, ['P1', 'P2'], ctx({ pillars })), false, '기둥 위에 놓는다');
});

/* ---------- 경로를 갉아먹으면서 점수를 올리는 함정 ----------------------
     **여기가 이 모듈에서 가장 위험한 자리다.** 개당 거리는 오가는 구간의 평균이라,
     먼 역 하나가 사라지면 라인이 조금도 나아지지 않았는데 값이 뚝 떨어진다.

     경로가 **통째로** 죽는 경우는 사실 저절로 걸러진다 — 못 도는 카트는
     `lineBalance` 에서 능력 0 이 되고, 그게 라인 천장이 되어 점수가 null 이 된다.
     그래서 진짜 위험한 것은 **일부만 갉아먹는** 맞바꾸기다. 아래 도면이 그것이다.

         적치대 S1(싣기) · 선반 H1(내리기) · 선반 H2(내리기)  ← 카트 한 대가 다 돈다
         제작기 A 를 H1 자리와 맞바꾸면 H1 이 역에서 빠진다 →
         남은 경로는 **여전히 돌지만** 개당 거리가 117.9 → 83.8 로 「좋아진다」
   ------------------------------------------------------------------------ */
const cartLayout = () => {
  const list = mk();
  list.push({ uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [10, 0], rot: 0, dispatchCount: 3 });
  list.push({ uid: 'H1', name: '선반', itemId: 'SHELF', pos: [10, -6], rot: 0, bays: 2, levels: 2, rows: 1 });
  list.push({ uid: 'H2', name: '선반 2', itemId: 'SHELF', pos: [10, 6], rot: 0, bays: 2, levels: 2, rows: 1 });
  return list;
};
const CARTS = [{
  uid: 'C1', name: '카트', itemId: 'CART', speed: 2, dwell: 1, closed: true,
  points: [[8, 6.6], [8, -7.4], [13, -7.4], [13, 6.6]],
}];
const gnaw = (list) => O.swapped(list,
  list.findIndex((p) => p.uid === 'P1'), list.findIndex((p) => p.uid === 'H1'));

t('경로를 **갉아먹는** 맞바꾸기를 가드가 잡는다', () => {
  const withCart = cartLayout();
  const d = ctx({ placed: withCart, carts: CARTS });
  const base = O.baseRoutesOf(d);
  assert.ok(base.routes.has('C1'), '전제가 무너졌다 — 카트가 원래도 안 돈다');
  assert.equal(base.routes.get('C1').stations, 3, '싣기 하나 · 내리기 둘이 안 잡혔다');

  const guard = { ...d, baseRoutes: base.routes, baseLinks: base.links };
  assert.equal(O.routesOk(gnaw(withCart), guard), false, '역이 줄어든 배치를 통과시킨다');
});

t('그 함정은 **점수만 보면 제일 좋다** — 가드가 없으면 이걸 고른다', () => {
  /* 이 검사가 가드의 존재 이유다. 갉아먹은 쪽이 「허용되는 모든 맞바꾸기」보다
     점수가 좋아야, 가드를 빼면 탐색이 그리로 간다는 말이 된다. */
  const withCart = cartLayout();
  const d = ctx({ placed: withCart, carts: CARTS });
  const base = O.baseRoutesOf(d);
  const guard = { ...d, baseRoutes: base.routes, baseLinks: base.links };

  const cheated = O.scoreOf(gnaw(withCart), d);
  assert.ok(cheated > 0, '갉아먹었더니 아예 못 재게 됐다 — 전제가 다르다');
  assert.ok(cheated < O.scoreOf(withCart, d), '갉아먹어도 점수가 안 좋아진다');

  let bestFair = Infinity;
  for (let i = 0; i < withCart.length; i++) {
    for (let j = i + 1; j < withCart.length; j++) {
      const next = O.swapped(withCart, i, j);
      if (!O.placeOk(next, [withCart[i].uid, withCart[j].uid], d)) continue;
      if (!O.routesOk(next, guard)) continue;
      const per = O.scoreOf(next, d);
      if (per != null && per < bestFair) bestFair = per;
    }
  }
  assert.ok(cheated < bestFair,
    `함정이 정직한 최선(${bestFair.toFixed(1)})보다 안 좋다 — 가드가 없어도 안 고른다`);
});

t('탐색이 실제로 그 맞바꾸기를 안 내놓는다', () => {
  const d = ctx({ placed: cartLayout(), carts: CARTS });
  const r = O.searchLayout(d);
  assert.ok(r.ok, '이 도면에서는 줄일 것이 있어야 한다');
  for (const s of r.steps) {
    assert.equal([s.a, s.b].includes('P1') && [s.a, s.b].includes('H1'), false,
      '경로를 갉아먹는 맞바꾸기를 내놓았다');
  }
  /* 내놓은 배치에서도 역이 그대로여야 한다 */
  const after = O.baseRoutesOf(ctx({ placed: r.placed, carts: CARTS })).routes;
  assert.equal(after.get('C1')?.stations, 3, '내놓은 배치에서 역이 줄었다');
});


t('벨트가 끊기는 맞바꾸기는 안 고른다', () => {
  const d = ctx();
  const base = O.baseRoutesOf(d);
  assert.equal(base.links.size, 2, '전제가 무너졌다 — 벨트가 원래도 안 이어져 있다');
  const dead = { ...d, baseRoutes: base.routes, baseLinks: base.links, lengthOf: () => 0 };
  assert.equal(O.routesOk(mk(), dead), false, '경로를 못 뽑는 배치를 통과시킨다');
});

t('나르는 양이 0 인 경로가 있으면 **아무 말도 안 한다**', () => {
  /* 그리다 만 경로는 `lineBalance` 에서 능력 0 으로 잡히고, 그게 라인의 천장이
     된다(화면도 그렇게 보여 준다 — 그 경로부터 고치라는 뜻이다). 천장이 0 이면
     개당 거리를 못 재므로 탐색은 **찍지 않고 모른다고 한다.** */
  const carts = [{
    uid: 'C9', name: '허공', itemId: 'CART', speed: 2, dwell: 1, closed: true,
    points: [[25, 25], [28, 25], [28, 28]],
  }];
  const d = ctx({ carts });
  assert.equal(O.baseRoutesOf(d).routes.size, 0, '역도 없는 경로가 「돈다」로 잡혔다');
  const r = O.searchLayout(d);
  assert.equal(r.ok, false, '못 재는 도면에서 답을 냈다');
  assert.equal(r.why, 'no-flow');
});

/* ---------- 못 찾을 때 ---------------------------------------------------- */
t('줄일 것이 없으면 **없다고 한다** — 억지로 안 내놓는다', () => {
  const r = O.searchLayout(ctx());
  const done = O.searchLayout(ctx({ placed: r.placed }));
  assert.equal(done.ok, false, '더 줄일 것이 없는데 또 내놓는다');
  assert.equal(done.why, 'none');
  assert.equal(done.gain, 0);
});

t('티끌만큼 줄어드는 것은 안 센다 — 사람을 헛수고시킨다', () => {
  assert.ok(O.GAIN_TIE > 0 && O.GAIN_TIE < 0.05, `문턱이 이상하다 (${O.GAIN_TIE})`);
  assert.ok(optSrc.includes('per > cur * (1 - GAIN_TIE)'), '문턱을 안 쓴다');
});

t('걸음 수에 천장이 있다 — 스무 번 맞바꾸라는 말은 지시가 아니다', () => {
  assert.ok(O.MAX_STEPS >= 3 && O.MAX_STEPS <= 12, `천장이 이상하다 (${O.MAX_STEPS})`);
  assert.equal(O.searchLayout(ctx({ maxSteps: 1 })).steps.length, 1, '천장을 안 지킨다');
});

t('「53.2 m → 41.7 m (−22%)」', () => {
  assert.equal(O.gainText(53.24, 41.68), '53.2 m → 41.7 m (−22%)');
  assert.equal(O.gainText(null, 1), '—');
});

/* ---------- 규칙이 두 벌이 되지 않게 ------------------------------------- */
t('놓을 수 있는가는 **화면과 같은 판정**을 쓴다', () => {
  for (const one of ['outOfBounds', 'rectsOverlap', 'rectInFloor', 'hitsObstacle']) {
    assert.ok(optSrc.includes(one), `${one} 을 안 본다`);
    assert.ok(sceneSrc.includes(one), `화면이 ${one} 을 안 본다 — 규칙이 갈렸다`);
  }
});

t('거리도 화면과 같은 식으로 잰다', () => {
  assert.ok(optSrc.includes('metersPerUnit('), '개당 거리를 안 쓴다');
  assert.equal(/totalWork\(/.test(optSrc), false,
    '총 작업량으로 견준다 — 라인이 빨라지기만 해도 커지는 값이다');
});

/* ==========================================================================
 *  화면 — 제안하고, 사람이 적용한다
 * ======================================================================== */
const insp = await readSrc('ui/Inspector.jsx');

t('화면이 탐색을 실제로 부른다', () => {
  assert.ok(insp.includes("from '../core/optimize.js'"), 'optimize 를 안 부른다');
  assert.ok(insp.includes('setPlan(searchLayout({'), '탐색을 안 돌린다');
});

t('**도면을 마음대로 안 바꾼다** — 적용은 사람이 누른다', () => {
  /* 자동으로 고쳐 놓으면 「내가 그린 것」이 아니게 되고, 그러면 값이 좋아져도
     안 쓴다. 그래서 찾는 것과 적용하는 것이 버튼 둘이어야 한다. */
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes('배치 손보기'), '찾는 버튼이 없다');
  assert.ok(tidy.includes('이대로 옮기기'), '적용 버튼이 없다');
  assert.equal(/useEffect|useMemo\(\s*\(\)\s*=>\s*searchLayout/.test(tidy), false,
    '열자마자 저절로 돌린다 — 무거운 일을 사람이 안 시켰는데 한다');
});

t('적용은 **한 번의 MOVE_MANY** 다 — Ctrl+Z 한 번으로 돌아간다', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes("dispatch({ type: 'MOVE_MANY'"), '한 번에 안 옮긴다');
  assert.equal(/dispatch\(\{ type: 'MOVE'/.test(tidy), false,
    '하나씩 옮긴다 — 되돌리려면 Ctrl+Z 를 여러 번 눌러야 한다');
});

t('놓을 수 있는가 · 거리는 **화면과 같은 값**으로 넘긴다', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes('floor: floorOf(state.areas)'), '바닥을 안 넘긴다');
  for (const k of ['walls: state.walls', 'pillars: state.pillars']) {
    assert.ok(tidy.includes(k), `${k} 를 안 넘긴다 — 벽·기둥 위에 놓는 답이 나온다`);
  }
  assert.ok(tidy.includes('shelfBBox(p, specOf(it))'), '선반 크기를 모델 bbox 로 잰다');
  assert.ok(tidy.includes('linkPath(l, list, itemOf)'), '**후보 배치**로 벨트를 다시 안 잰다');
});

t('도면을 고치면 지난 제안을 버린다', () => {
  /* 옛 도면에서 나온 「A ↔ B」 를 그대로 눌러 적용하면 엉뚱한 데가 옮겨진다 */
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(/if \(keyAt !== key\) \{[^}]*setPlan\(null\)/.test(tidy), '옛 제안이 남는다');
});

t('못 찾았을 때 **이유를 말한다**', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  for (const why of ['no-flow', 'too-few']) assert.ok(tidy.includes(why), `${why} 를 안 가른다`);
  assert.ok(tidy.includes('맞바꿔서 줄일 것이 없습니다'), '「없다」를 안 말한다');
});

t('**처리량은 안 바뀐다**는 것을 못 박아 말한다', () => {
  /* 안 적으면 「배치를 손봤는데 왜 처리량이 그대로냐」가 된다 */
  assert.ok(insp.includes('처리량은 안 바뀝니다.'), '기대를 안 맞춰 준다');
  assert.ok(insp.includes('최선이라는 보장은 없습니다.'), '언덕 내려가기라는 것을 안 말한다');
});

t('화면이 **통로와 구역까지** 넘긴다', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes('zones: state.zones'), '구역을 안 넘긴다 — 그어 둔 선을 넘어간다');
  assert.ok(tidy.includes('grid: state.gridSize'), '격자를 안 넘긴다 — 손으로 놓은 것과 눈금이 어긋난다');
  /* 통로는 카트에서 나온다 — carts 를 넘기고 있으면 된다 */
  assert.ok(tidy.includes('carts: state.carts'), '카트를 안 넘긴다 — 통로를 모른다');
});

t('걸음 목록이 **당기기도** 그린다', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes("s.kind === 'swap'"), '두 수를 안 가른다');
  assert.ok(tidy.includes('{s.towardName}'), '어디로 당기는지 안 적는다');
  assert.ok(tidy.includes('{s.dist.toFixed(1)} m'), '몇 미터인지 안 적는다');
});

t('적용이 당기기까지 옮긴다 — 결과 배치를 통째로 쓴다', () => {
  /* 걸음을 다시 해석하지 않는다. 탐색이 내놓은 placed 를 그대로 넣으므로
     맞바꾸기든 당기기든 한 길로 적용된다. */
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes('plan.placed.map((p) => ({ uid: p.uid, pos: p.pos }))'), '결과 배치를 안 쓴다');
});

/* ==========================================================================
 *  「다 줄였다」와 「여기서 끊었다」는 다른 말이다
 * ======================================================================== */
t('걸음 천장에 걸렸으면 **그렇게 말한다**', () => {
  /* 설비가 대여섯 대만 넘어도 매번 천장에 걸린다. 안 갈라 말하면 사람이
     다 된 줄 알고 그만둔다 — 아직 줄어드는 중인데. */
  const one = O.searchLayout(ctx({ maxSteps: 1 }));
  assert.equal(one.capped, true, '끊었는데 안 끊었다고 한다');

  /* 끝까지 간 뒤 다시 돌리면 더 줄일 것이 없다 → 끊은 것이 아니다 */
  let cur = ctx().placed;
  for (let k = 0; k < 6; k++) cur = O.searchLayout(ctx({ placed: cur })).placed;
  const done = O.searchLayout(ctx({ placed: cur }));
  assert.equal(done.capped, false, '다 줄였는데 끊었다고 한다');
});

t('천장에서 끊긴 답은 **이어서 더 줄일 수 있다**', () => {
  /* 「다시 눌러 보세요」가 빈말이 아닌지 — 실제로 더 줄어야 한다 */
  const first = O.searchLayout(ctx({ maxSteps: 2 }));
  assert.ok(first.capped);
  const next = O.searchLayout(ctx({ placed: first.placed, maxSteps: 2 }));
  assert.ok(next.ok && next.after < first.after, '다시 눌러도 더 안 줄어든다');
});

t('아무것도 못 찾았을 때는 끊은 것이 아니다', () => {
  for (const why of [ctx({ links: [] }), ctx({ movable: () => false })]) {
    assert.equal(O.searchLayout(why).capped, false, '못 찾은 것을 끊었다고 한다');
  }
});

t('화면이 천장을 말한다 · 찾는 동안 말이 있다', () => {
  const tidy = insp.slice(insp.indexOf('function Tidy('), insp.indexOf('function FlowSection('));
  assert.ok(tidy.includes('{plan.capped && ('), '천장에 걸린 것을 안 알린다');
  assert.ok(tidy.includes('여기까지만 찾았습니다'), '문구가 없다');
  assert.ok(tidy.includes('옮기고 나서 다시 눌러'), '무엇을 하라는지 안 말한다');
  /* 큰 도면에서 반 초 넘게 멈춘다 — 아무 말이 없으면 눌린 줄도 모른다 */
  assert.ok(tidy.includes("busy ? '찾는 중…'"), '찾는 동안 아무 말이 없다');
  assert.ok(tidy.includes('setBusy(true)') && tidy.includes('setBusy(false)'), '상태를 안 되돌린다');
  assert.ok(/setTimeout\(\(\) => \{/.test(tidy), '한 틱을 안 쉬어 「찾는 중」이 안 그려진다');
});
