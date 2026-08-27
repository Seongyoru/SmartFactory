/**
 * 선반 줄(row) — 같은 규격의 랙을 앞뒤로 여러 줄 세운 것을 한 덩어리로.
 *  형상(풋프린트·접근 면)과 적재(어느 줄에 쌓이는가)가 **같은 값을 봐야** 한다 —
 *  보이는 곳과 판정되는 곳이 어긋나면 카트가 허공에서 짐을 주고받는다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('선반 줄');

const S = await import(SRC + 'core/shelf.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
/** 모델 없이 기본 규격으로 — depth 0.9 · pitch 2.6 · spacing 1.4 · baseTop 0.3 */
const SPEC = null;
const W = 0.7;                                   // 자재 폭을 못 박아 둔다
const cap = (p) => S.shelfCapacity(p, SPEC, W);
const lay = (lots, p) => S.layoutShelf(lots, p, SPEC, W);

const ONE = { bays: 2, levels: 2, perLevel: 3, rows: 1 };
const THREE = { ...ONE, rows: 3, rowGap: 1 };

/* ---------- 값 읽기 ---------- */
t('줄 수와 통로는 범위 안으로 자른다', () => {
  assert.equal(S.shelfRows({ rows: 0 }), S.MIN_ROWS);
  assert.equal(S.shelfRows({ rows: 99 }), S.MAX_ROWS);
  assert.equal(S.shelfRows({}), S.DEFAULT_ROWS);
  assert.equal(S.rowGap({ rowGap: -5 }), S.MIN_ROW_GAP);
  assert.equal(S.rowGap({}), S.DEFAULT_ROW_GAP);
});

/* ---------- 형상 ---------- */
t('줄이 하나면 예전과 같은 깊이다 — 이미 그린 도면이 안 바뀐다', () => {
  near(S.shelfDepth(ONE, SPEC), S.shelfSpec(SPEC).depth);
  near(S.rowZ(0, ONE, SPEC), 0);
});
t('줄을 늘리면 깊이가 랙 + 통로만큼 는다', () => {
  const d = S.shelfSpec(SPEC).depth;
  near(S.shelfDepth(THREE, SPEC), d * 3 + 1 * 2);
});
t('줄 간격은 랙 깊이 + 통로', () => {
  near(S.rowPitch(THREE, SPEC), S.shelfSpec(SPEC).depth + 1);
});
t('**첫 줄은 제자리**, 나머지가 뒤로 덧붙는다', () => {
  /* 가운데 기준으로 양쪽으로 자라게 했더니 줄을 늘리는 순간 앞을 지나던 카트
     경로가 선반 안쪽으로 들어가 정차역이 통째로 사라졌다. 줄은 덧붙이는 것이다. */
  const z = [0, 1, 2].map((r) => S.rowZ(r, THREE, SPEC));
  near(z[0], 0, 1e-9);
  near(z[1] - z[0], S.rowPitch(THREE, SPEC));
  near(z[2] - z[1], S.rowPitch(THREE, SPEC));
});
t('고정 면은 줄을 늘려도 안 움직인다 — 그려 둔 경로가 산다', () => {
  for (const rows of [1, 2, 5, 8]) near(S.shelfNearZ({ ...THREE, rows }, SPEC), S.shelfNearZ(ONE, SPEC));
});
t('반대쪽 면만 줄 수를 따라 밀려난다', () => {
  near(S.shelfFarZ(ONE, SPEC), S.shelfSpec(SPEC).depth / 2);
  assert.ok(S.shelfFarZ(THREE, SPEC) > S.shelfFarZ(ONE, SPEC));
  near(S.shelfFarZ(THREE, SPEC) - S.shelfNearZ(THREE, SPEC), S.shelfDepth(THREE, SPEC));
});
t('풋프린트가 줄 수를 반영한다 — 안 그러면 옆 설비와 겹쳐 놓인다', () => {
  near(S.shelfBBox(THREE, SPEC).size[2], S.shelfDepth(THREE, SPEC));
  assert.ok(S.shelfBBox(THREE, SPEC).size[2] > S.shelfBBox(ONE, SPEC).size[2]);
});
t('접근 면은 **바깥 두 면**이다 — 안쪽 줄은 통로로 못 닿는다', () => {
  const zs = S.shelfZones(THREE, SPEC);
  const faces = [...new Set(zs.map((z) => z.fz.toFixed(6)))].sort();
  assert.equal(faces.length, 2, '면이 둘이 아니다');
  near(Number(faces[0]), S.shelfNearZ(THREE, SPEC));
  near(Number(faces[1]), S.shelfFarZ(THREE, SPEC));
});
t('띠는 면의 **바깥쪽**에 깔린다 — 안쪽에 그리면 선반 밑에 깔린다', () => {
  for (const z of S.shelfZones(THREE, SPEC)) {
    assert.ok(z.dir[1] > 0 ? z.cz > z.fz : z.cz < z.fz, '띠가 안쪽으로 들어갔다');
  }
});

/* ---------- 수용량 ---------- */
t('수용량 = 한 단 × 단 수 × 줄 수', () => {
  assert.equal(S.perRow(ONE, SPEC, W), 3 * 2);
  assert.equal(cap(ONE), 6);
  assert.equal(cap(THREE), 18);
});

/* ---------- 줄마다 종류 ---------- */
t('안 정한 줄은 길이를 줄 수에 맞춰 null 로 채운다', () => {
  assert.deepEqual(S.rowKinds({ ...THREE, rowKinds: ['PART_R'] }), ['PART_R', null, null]);
  assert.deepEqual(S.rowKinds(THREE), [null, null, null]);
});
t('줄 수를 줄이면 뒤쪽 지정은 버린다', () => {
  const p = { ...THREE, rows: 2, rowKinds: ['A', 'B', 'C'] };
  assert.deepEqual(S.rowKinds(p), ['A', 'B']);
});
t('제 몫 줄이 있으면 거기만 쓴다', () => {
  const p = { ...THREE, rowKinds: ['PART_R', null, 'PART_R'] };
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, [0, 2]);
});
t('제 몫이 없으면 **안 정한 줄**을 함께 쓴다', () => {
  const p = { ...THREE, rowKinds: ['PART_R', null, null] };
  assert.deepEqual(S.rowGroupOf(p, 'PART_G').rows, [1, 2]);
  assert.equal(S.rowGroupOf(p, 'PART_G').id, 'shared');
});
t('공용은 **한 통**으로 센다 — 종류마다 세면 자리가 뻥튀기된다', () => {
  const p = { ...THREE, rowKinds: ['PART_R', null, null] };
  assert.equal(S.rowGroupOf(p, 'PART_G').id, S.rowGroupOf(p, 'PART_B').id);
});
t('모든 줄이 다른 종류로 차 있으면 그 종류는 못 들어간다', () => {
  const p = { ...THREE, rowKinds: ['A', 'B', 'C'] };
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, []);
  assert.equal(S.shelfRoom([], p, SPEC, 'PART_R', W), 0);
});

/* ---------- 어디에 앉는가 ---------- */
t('지정한 종류는 **그 줄에만** 앉는다', () => {
  const p = { ...THREE, rowKinds: ['R', null, 'B'] };
  const out = lay(['R', 'B', 'R', 'B'], p);
  assert.deepEqual(out.filter((x) => x.kind === 'R').map((x) => x.row), [0, 0]);
  assert.deepEqual(out.filter((x) => x.kind === 'B').map((x) => x.row), [2, 2]);
});
t('안 정한 종류는 공용 줄에 차례로 앉는다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  /* 공용은 1·2번 줄, 한 줄에 6개 */
  const out = lay(Array(8).fill('G'), p);
  assert.deepEqual(out.slice(0, 6).map((x) => x.row), Array(6).fill(1));
  assert.deepEqual(out.slice(6).map((x) => x.row), [2, 2]);
});
t('아래 단을 가로로 다 채우고 위로 올라간다', () => {
  const out = lay(Array(6).fill('G'), ONE);
  assert.deepEqual(out.map((x) => x.level), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(out.map((x) => x.col), [0, 1, 2, 0, 1, 2]);
});
t('자리보다 많이 쌓여 있으면 넘치는 것은 안 그린다', () => {
  const out = lay(Array(100).fill('G'), ONE);
  assert.equal(out.length, cap(ONE));
});
t('받을 줄이 없는 종류는 아예 안 그린다', () => {
  const p = { ...THREE, rowKinds: ['A', 'B', 'C'] };
  assert.equal(lay(['PART_R'], p).length, 0);
});
t('같은 재고면 **언제나 같은 그림**이다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  const lots = ['G', 'R', 'B', 'R', 'G'];
  assert.deepEqual(lay(lots, p), lay(lots, p));
});
t('그린 자리의 z 가 그 줄의 z 와 맞는다', () => {
  const p = { ...THREE, rowKinds: ['R', null, 'B'] };
  for (const x of lay(['R', 'B'], p)) near(x.pos[2], S.rowZ(x.row, p, SPEC));
});

/* ---------- 얼마나 더 받나 ---------- */
t('남은 자리는 제 묶음 기준이다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  assert.equal(S.shelfRoom([], p, SPEC, 'R', W), 6);            // 제 줄 하나
  assert.equal(S.shelfRoom([], p, SPEC, 'G', W), 12);           // 공용 두 줄
  assert.equal(S.shelfRoom(Array(4).fill('R'), p, SPEC, 'R', W), 2);
});
t('공용은 종류가 섞여도 **합쳐서** 찬다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  const lots = [...Array(7).fill('G'), ...Array(5).fill('B')];  // 공용 12칸을 다 썼다
  assert.equal(S.shelfRoom(lots, p, SPEC, 'G', W), 0);
  assert.equal(S.shelfRoom(lots, p, SPEC, 'B', W), 0);
  assert.equal(S.shelfRoom(lots, p, SPEC, 'R', W), 6, '제 줄까지 같이 찼다');
});
t('줄 지정이 하나도 없으면 예전 그대로 — 전부 공용', () => {
  assert.equal(S.shelfRoom([], THREE, SPEC, 'PART_R', W), cap(THREE));
});

/* ---------- 실제로 내려놓기 (simStore) --------------------------------------
     그리는 자리와 **받아 주는 자리**가 같아야 한다. 화면은 layoutShelf 를 보고,
     내려놓는 쪽은 rowGroupOf 로 만든 binOf 를 본다 — 둘이 어긋나면 카트가 허공에
     짐을 놓거나, 자리가 있는데 그냥 지나간다.
--------------------------------------------------------------------------- */
const sim = await import(SRC + 'core/simStore.js');
const cartSrc = await readSrc('core/cart.js');
const viewSrc = await readSrc('scene/CartView.jsx');
const simSrc = await readSrc('core/sim.js');

/** cart.js 가 역에 실어 보내는 것과 **같은 방식**으로 만든다 */
const binOf = (p) => (kind) => {
  const g = S.rowGroupOf(p, kind);
  return { id: g.rows.length ? g.id : null, cap: g.rows.length * S.perRow(p, SPEC, W) };
};

t('지정한 줄의 종류만 그 몫만큼 들어간다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  sim.clearStock();
  const r = sim.addByGroup('S1', Array(9).fill('R'), binOf(p));
  assert.equal(r.moved, 6, '제 줄(6칸)보다 많이 받았다');
  assert.equal(r.left.length, 3);
});
t('공용은 여러 종류가 **합쳐서** 찬다 — 종류마다 뻥튀기되지 않는다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  sim.clearStock();
  const r = sim.addByGroup('S1', [...Array(8).fill('G'), ...Array(8).fill('B')], binOf(p));
  assert.equal(r.moved, 12, `공용 두 줄(12칸)을 넘겼다 — ${r.moved}`);
});
t('받을 줄이 없는 종류는 하나도 안 받고 그대로 돌려준다', () => {
  const p = { ...THREE, rowKinds: ['A', 'B', 'C'] };
  sim.clearStock();
  const r = sim.addByGroup('S1', ['R', 'R'], binOf(p));
  assert.equal(r.moved, 0);
  assert.deepEqual(r.left, ['R', 'R']);
});
t('못 넣은 것을 **목록으로** 돌려준다 — 앞에서 자르면 종류가 사라진다', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  sim.clearStock();
  sim.addByGroup('S1', Array(6).fill('R'), binOf(p));         // R 자리를 다 채운다
  const r = sim.addByGroup('S1', ['R', 'G', 'R'], binOf(p));  // R 은 못 들어간다
  assert.deepEqual(r.left, ['R', 'R'], '남은 것이 R 두 개여야 한다');
  assert.equal(r.moved, 1);
});
t('넣은 것은 **거쳐 간 누계**에도 잡힌다 (오더가 이걸 센다)', () => {
  const p = { ...THREE, rowKinds: ['R', null, null] };
  sim.clearStock();
  sim.addByGroup('S2', ['R', 'R'], binOf(p));
  assert.equal(sim.arrivedOf('S2', 'R'), 2);
});
t('그린 개수와 받은 개수가 같다 — 보이는 곳과 받는 곳이 안 어긋난다', () => {
  const p = { ...THREE, rowKinds: ['R', null, 'B'] };
  sim.clearStock();
  const kinds = [...Array(10).fill('R'), ...Array(10).fill('G'), ...Array(10).fill('B')];
  sim.addByGroup('S3', kinds, binOf(p));
  const lots = sim.getLots('S3');
  assert.equal(lay(lots, p).length, lots.length, '받아 놓고 못 그리는 것이 있다');
});

/* ---------- 규칙이 한 곳에만 있는가 ---------------------------------------
     화면(layoutShelf)과 내려놓기(binOf)가 각자 줄을 계산하면 반드시 어긋난다.
     그래서 cart.js 가 역에 규칙을 싸서 넘기고, CartView 는 그것을 쓰기만 한다.
--------------------------------------------------------------------------- */
t('선반 역이 binOf 를 싣고 온다', () => {
  assert.ok(cartSrc.includes('binOf: (kind) => {'), 'cart.js 가 역에 binOf 를 안 넘긴다');
  assert.ok(cartSrc.includes('rowGroupOf(p, kind)'), 'shelf.js 의 규칙을 안 쓴다');
});
t('굴리는 쪽은 줄 계산을 **다시 하지 않는다**', () => {
  /* 규칙은 역이 싸서 준다(binOf). 굴리는 쪽이 줄을 직접 세면 그리는 자리와
     어긋날 수 있다. (예전에는 CartView 안에 있었다 — core/sim.js 로 옮겼다) */
  assert.ok(simSrc.includes('addByGroup(a.uid, u.carried, a.binOf)'), '역이 준 규칙을 안 쓴다');
  assert.equal(/rowGroupOf|rowKinds|perRow/.test(simSrc), false,
    '굴리는 쪽이 줄을 직접 계산한다 — 그리는 자리와 어긋날 수 있다');
  /* 화면 쪽도 마찬가지 — 그리기만 하고 줄을 다시 세면 안 된다 */
  assert.equal(/rowGroupOf|perRow/.test(viewSrc), false, 'CartView 가 줄을 직접 계산한다');
});
t('줄 지정이 없던 옛 도면은 예전 길로 간다', () => {
  assert.ok(simSrc.includes('addLots(a.uid, u.carried, a.capacity)'), '옛 경로가 사라졌다');
});

/* ---------- 줄을 늘려도 이미 그려 둔 경로가 살아 있는가 -------------------
     실제로 났던 버그 둘. 둘 다 "화면은 바뀌었는데 판정이 안 따라온" 종류다.
--------------------------------------------------------------------------- */
const C = await import(SRC + 'core/cart.js');
const shelfAt = (rows) => ({
  uid: 'H', itemId: 'SHELF', pos: [0, 0], rot: 0, bays: 3, levels: 3, rows, rowGap: 1.4,
});
const asShelf = () => ({ id: 'SHELF', kind: 'shelf' });
const stationsOn = (path, rows) => C.cartStations(path, [shelfAt(rows)], asShelf, {});

t('앞을 지나던 경로는 줄을 늘려도 역을 잃지 않는다', () => {
  /* 줄을 가운데 기준으로 늘렸더니 앞면이 경로를 넘어 밀려나 역이 통째로 사라졌다. */
  const z = S.shelfNearZ(shelfAt(1), null) - 0.6;
  const path = C.cartPath({ points: [[-6, z], [6, z]], closed: false });
  for (const rows of [1, 2, 3, 8]) {
    assert.equal(stationsOn(path, rows).length, 1, `${rows}줄에서 역이 사라졌다`);
  }
});
t('선반을 **한 바퀴 도는** 경로도 역을 만든다', () => {
  /* 가장 가까운 한 점만 보면 반대편 구간이 먼저 잡히고, 그 점이 등을 지고 있어
     역이 통째로 죽었다 — 경로가 띠를 멀쩡히 지나가는데도. */
  for (const rows of [1, 3]) {
    const p = shelfAt(rows);
    const a = S.shelfNearZ(p, null) - 0.6;
    const b = S.shelfFarZ(p, null) + 0.6;
    const loop = C.cartPath({ points: [[-6, a], [6, a], [6, b], [-6, b]], closed: true });
    assert.ok(stationsOn(loop, rows).length >= 1, `${rows}줄 고리 경로에 역이 없다`);
  }
});
t('띠를 안 지나는 경로에는 역이 안 생긴다 — 위 완화가 과하지 않다', () => {
  const far = S.shelfFarZ(shelfAt(1), null) + 40;
  const path = C.cartPath({ points: [[-6, far], [6, far]], closed: false });
  assert.equal(stationsOn(path, 1).length, 0, '먼 경로에까지 역이 붙는다');
});
const shelfViewSrc = await readSrc('scene/ShelfView.jsx');
t('띠는 줄 수가 바뀌면 **바로** 다시 그려진다', () => {
  /* useMemo 가 줄 수를 안 보고 있어 새로고침 전까지 옛 자리에 남아 있었다. */
  const deps = shelfViewSrc.match(/shelfZones\(placed, modelSpec\),\s*\[([^\]]*)\]/)?.[1] ?? '';
  for (const k of ['rows', 'rowGap']) {
    assert.ok(deps.includes(`placed.${k}`), `zones useMemo 가 ${k} 를 안 본다`);
  }
});

/* ---------- 줄이 하나여도 종류를 정한다 ------------------------------------ *
 *  「이 선반은 불량품만 받는다」는 줄 수와 상관없는 이야기다. 그런데 고르개가
 *  여러 줄일 때만 떴다. 시뮬 쪽은 원래부터 한 줄에서도 제대로 돌고 있었다 —
 *  `rowGroupOf` 는 줄 수를 안 본다. 막고 있던 것은 화면 하나뿐이었다.
 * -------------------------------------------------------------------------- */

const L = await import(SRC + 'data/library.js');
const inspSrc = await readSrc('ui/Inspector.jsx');

t('한 줄 선반도 제 종류만 받는다', () => {
  const p = { ...ONE, rowKinds: ['PART_R'] };
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, [0]);
  assert.deepEqual(S.rowGroupOf(p, 'PART_G').rows, [], '안 적은 종류가 들어간다');
});

t('한 줄이어도 안 정하면 예전처럼 섞어 받는다', () => {
  const p = { ...ONE };
  assert.equal(S.rowGroupOf(p, 'PART_R').id, 'shared');
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, [0]);
});

t('화면이 **줄 수로 막지 않는다**', () => {
  /* 이 한 조건이 기능 전부를 막고 있었다 */
  assert.equal(/\{rows > 1 && \(\s*\n\s*<div className="mt-2">/.test(inspSrc), false,
    '고르개가 아직 여러 줄일 때만 뜬다');
  assert.match(inspSrc, /rowKindOptions\(\)\.map/, '고르개가 묶음 목록을 안 쓴다');
});

/* ---------- 불량품 전체 ----------------------------------------------------- *
 *  불량품은 품종마다 따로 있다(`불량품 (제작품 1)` …). 「불량품을 받는 줄」을
 *  만들려면 일곱 개를 일곱 줄에 나눠 적어야 했다 — 줄이 하나면 아예 못 했다.
 * -------------------------------------------------------------------------- */

const SCRAPS = Object.keys(L.PAYLOAD_ITEMS).filter((k) => L.isScrapKind(k));

t('불량품은 일곱 가지다 — 아래 검사들의 전제', () => {
  assert.equal(SCRAPS.length, 7, `${SCRAPS.length}가지 — 전제가 바뀌었으면 아래도 다시 볼 것`);
});

t('묶음 줄이 **모든 불량품**을 받는다', () => {
  const p = { ...ONE, rowKinds: ['SCRAP_ANY'] };
  for (const k of SCRAPS) {
    assert.deepEqual(S.rowGroupOf(p, k).rows, [0], `${k} 가 안 들어간다`);
  }
});

t('묶음 줄은 양품을 안 받는다', () => {
  const p = { ...ONE, rowKinds: ['SCRAP_ANY'] };
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, [], '양품이 불량품 줄에 들어간다');
});

t('**일곱 종이 한 통에 합쳐서 찬다** — 종류마다 세면 자리가 일곱 배가 된다', () => {
  const p = { ...ONE, rowKinds: ['SCRAP_ANY'] };
  const ids = SCRAPS.map((k) => S.rowGroupOf(p, k).id);
  assert.equal(new Set(ids).size, 1, `통이 ${new Set(ids).size}개다 — 자리가 뻥튀기된다`);
});

t('제 이름으로 적은 줄이 **묶음보다 먼저**다 — 좁게 적은 쪽이 사람의 뜻이다', () => {
  const p = { ...THREE, rowKinds: ['SCRAP_ANY', 'SCRAP_PART_R', null] };
  assert.deepEqual(S.rowGroupOf(p, 'SCRAP_PART_R').rows, [1], '제 줄을 놔두고 묶음으로 간다');
  assert.deepEqual(S.rowGroupOf(p, 'SCRAP_PART_G').rows, [0], '묶음 줄로 안 간다');
});

t('묶음 줄이 있어도 **안 정한 줄**은 그대로 공용이다', () => {
  const p = { ...THREE, rowKinds: ['SCRAP_ANY', null, null] };
  assert.equal(S.rowGroupOf(p, 'PART_R').id, 'shared');
  assert.deepEqual(S.rowGroupOf(p, 'PART_R').rows, [1, 2]);
});

t('**묶음은 종류가 아니다** — 재고로 새면 안 터지고 조용히 오염된다', () => {
  /* `PAYLOAD_ITEMS` 안에 넣으면 레시피·카트·오더로 샌다. 모델도 한 벌 더 읽는다 */
  assert.equal(L.PAYLOAD_ITEMS.SCRAP_ANY, undefined, '묶음이 종류 표에 들어갔다');
  assert.equal(L.canonKind('SCRAP_ANY'), null, '묶음이 종류로 통과된다');
  assert.equal(/setStock\(placed\.uid, capacity, /.test(inspSrc), false,
    '「가득 채우기」가 줄 값을 재고에 직결한다 — 묶음이 재고가 된다');
});

t('묶음 견본색이 따로 있다 — 불량품 색은 밝은 바탕에서 안 보인다', () => {
  const opt = L.rowKindOptions().find((o) => o.value === 'SCRAP_ANY');
  assert.ok(opt?.group, '묶음이 목록에 없다');
  assert.notEqual(opt.color, L.PAYLOAD_ITEMS.SCRAP?.color);
});

t('묶음이 목록 **맨 앞**에 온다 — 종류 열세 개 밑에 묻히면 못 찾는다', () => {
  assert.equal(L.rowKindOptions()[0].value, 'SCRAP_ANY');
});
