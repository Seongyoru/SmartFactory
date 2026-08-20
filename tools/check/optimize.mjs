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

t('맞바꿔서 줄어드는 배치를 찾는다', () => {
  const r = O.searchLayout(ctx());
  assert.ok(r.ok, `줄일 것을 못 찾았다 (${r.why})`);
  assert.ok(r.after < r.before, '더 나빠졌다');
  /* 첫 손질은 **많이 쓰는 제작기를 가까운 자리로** 여야 한다 */
  assert.deepEqual([r.steps[0].a, r.steps[0].b].sort(), ['P1', 'P2']);
  assert.ok(r.gain > r.before * 0.2, `줄어든 폭이 너무 작다 (${r.gain.toFixed(1)})`);
});

t('돌려도 같은 답이 나온다 — 씨앗도 난수도 없다', () => {
  const a = O.searchLayout(ctx());
  const b = O.searchLayout(ctx());
  assert.deepEqual(a.steps.map((s) => [s.a, s.b]), b.steps.map((s) => [s.a, s.b]));
  assert.equal(a.after, b.after);
});

t('내놓은 배치가 실제로 그 점수다 — 걸음을 따라가면 나온다', () => {
  /* 목록만 맞고 결과 배치가 다르면, 사람이 시킨 대로 했는데 값이 안 나온다 */
  const r = O.searchLayout(ctx());
  assert.ok(Math.abs(O.scoreOf(r.placed, ctx()) - r.after) < 1e-9, '적용한 배치의 점수가 다르다');

  let cur = mk();
  for (const s of r.steps) {
    cur = O.swapped(cur, cur.findIndex((p) => p.uid === s.a), cur.findIndex((p) => p.uid === s.b));
  }
  assert.deepEqual(cur.map((p) => [p.uid, ...p.pos]), r.placed.map((p) => [p.uid, ...p.pos]),
    '걸음대로 맞바꾼 결과가 내놓은 배치와 다르다');
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

/* ---------- 경로를 부수면서 점수를 올리는 함정 --------------------------- */
const cartLayout = () => {
  const list = mk();
  list.push({ uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [10, 0], rot: 0, dispatchCount: 3 });
  list.push({ uid: 'H1', name: '선반', itemId: 'SHELF', pos: [10, -6], rot: 0, bays: 2, levels: 2, rows: 1 });
  return list;
};
const CARTS = [{
  uid: 'C1', name: '카트', itemId: 'CART', speed: 2, dwell: 1, closed: true,
  points: [[8, 1], [8, -7.4], [13, -7.4], [13, 1]],
}];
const brokenSwap = (list) => O.swapped(list,
  list.findIndex((p) => p.uid === 'S1'), list.findIndex((p) => p.uid === 'P1'));

t('**카트 경로를 부수는 맞바꾸기는 안 고른다**', () => {
  /* 이 모듈에서 가장 위험한 자리다. 역이 사라지면 나르는 양이 0 이고,
     나르는 양이 0 이면 **거리도 0** 이라 점수가 「좋아진다.」 */
  const withCart = cartLayout();
  const d = ctx({ placed: withCart, carts: CARTS });
  const base = O.baseRoutesOf(d);
  assert.ok(base.routes.has('C1'), '전제가 무너졌다 — 카트가 원래도 안 돈다');
  assert.equal(base.routes.get('C1').stations, 2, '싣는 곳과 내리는 곳이 둘 다 안 잡혔다');

  const guard = { ...d, baseRoutes: base.routes, baseLinks: base.links };
  assert.equal(O.routesOk(brokenSwap(withCart), guard), false, '역이 사라진 배치를 통과시킨다');
});

t('그 함정은 **점수만 보면 좋아 보인다** — 가드가 일하는 이유', () => {
  const withCart = cartLayout();
  const d = ctx({ placed: withCart, carts: CARTS });
  const now = O.scoreOf(withCart, d);
  const after = O.scoreOf(brokenSwap(withCart), d);
  assert.ok(now > 0, '전제를 못 세웠다');
  assert.ok(after == null || after < now,
    `부쉈는데 점수가 안 좋아진다 (${now} → ${after}) — 전제가 바뀌었다`);
});

t('탐색이 실제로 그 맞바꾸기를 안 내놓는다', () => {
  const r = O.searchLayout(ctx({ placed: cartLayout(), carts: CARTS }));
  for (const s of r.steps) {
    assert.equal([s.a, s.b].includes('S1') && [s.a, s.b].includes('P1'), false,
      '경로를 부수는 맞바꾸기를 내놓았다');
  }
  if (r.ok) {
    const still = O.baseRoutesOf(ctx({ placed: r.placed, carts: CARTS })).routes;
    assert.ok(still.has('C1'), '내놓은 배치에서 카트가 안 돈다');
  }
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

t('옮길 것이 하나뿐이면 맞바꿀 상대가 없다', () => {
  assert.equal(O.searchLayout(ctx({ movable: (p) => p.uid === 'P1' })).why, 'too-few');
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
