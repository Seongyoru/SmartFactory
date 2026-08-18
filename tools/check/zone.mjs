/* 구역 — 사각형을 이어 붙여 ㄱ 자를 만든다 · 딴 구역은 안 건드린다 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('구역 이어 붙이기');

const A = await import(SRC + 'core/area.js');
const store = await readSrc('core/store.jsx');
const zoneSrc = await readSrc('core/zoneInfo.js');

const rect = (x1, z1, x2, z2) => [[[[x1, z1], [x2, z1], [x2, z2], [x1, z2]]]];

/* ---------- 합치기 자체 ---------------------------------------------------- */

t('겹친 사각형 둘이 **ㄱ 자 하나**가 된다 — 펜으로 여덟 점을 찍을 일이 아니다', () => {
  const l = A.unionMP(rect(0, 0, 20, 8), rect(0, 0, 8, 24));
  assert.equal(l.length, 1, '두 덩어리로 남았다 — 안 합쳐졌다');
  const ring = l[0][0];
  /* ㄱ 자는 모서리가 여섯이다(닫는 점까지 세면 일곱) */
  const pts = ring.length - (ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  assert.equal(pts, 6, `ㄱ 자가 아니다 (모서리 ${pts}개)`);
  /* 넓이도 맞아야 한다 — 겹친 8×8 을 두 번 세면 안 된다 */
  assert.ok(Math.abs(A.mpArea(l) - (20 * 8 + 8 * 24 - 8 * 8)) < 0.01, '겹친 데를 두 번 셌다');
});

t('안 겹치는 사각형 둘은 안 합쳐진다', () => {
  const two = A.unionMP(rect(0, 0, 5, 5), rect(10, 10, 15, 15));
  assert.equal(two.length, 2, '떨어진 것을 하나로 만들었다');
});

t('겹쳤는지 아닌지를 가리는 규칙이 있다', () => {
  assert.equal(A.mpOverlaps(rect(0, 0, 10, 10), rect(5, 5, 15, 15)), true);
  assert.equal(A.mpOverlaps(rect(0, 0, 10, 10), rect(20, 20, 30, 30)), false);
});

/* ---------- 리듀서의 규칙 --------------------------------------------------- */

const addZone = cut(store, "case 'ADD_ZONE': {", '\n    case ', 'ADD_ZONE');

t('**고른 구역에만** 이어 붙인다 — 「입고」와 「검사」를 합치면 뜻이 사라진다', () => {
  /* 영역(ADD_AREA)은 겹치면 무조건 합친다. 바닥은 하나뿐이라 그게 맞다.
     구역은 이름과 색을 가진 서로 다른 것이라 같은 규칙을 쓰면 안 된다. */
  assert.match(addZone, /state\.selected\?\.kind === 'zone'/, '무엇에 붙일지를 안 가린다');
  assert.match(addZone, /z\.uid === pickedUid && mpOverlaps\(z\.mp, mp\)/,
    '고른 구역이 아니어도 붙이거나, 겹치지 않아도 붙인다');
  assert.match(addZone, /unionMP\(z\.mp, mp\)/, '합치지 않고 덮어쓴다');
});

t('이어 붙인 것은 **새 구역이 아니다** — 번호와 색이 그대로 남아야 한다', () => {
  const grow = addZone.slice(addZone.indexOf('if (grow)'), addZone.indexOf('const uid ='));
  assert.equal(/seq: state\.seq \+ 1/.test(grow), false, '이어 붙였는데 번호를 새로 먹는다');
  assert.equal(/ZONE_DEFAULTS/.test(grow), false, '이어 붙였는데 색이 기본값으로 돌아간다');
  assert.ok(/hint:/.test(grow), '말없이 합쳐 버리면 딴 구역을 그리려던 사람이 놀란다');
});

t('바닥 밖으로는 여전히 못 그린다 — 이어 붙일 때도 같다', () => {
  /* 자르기(clipZoneToAreas)가 합치기보다 **먼저** 와야 한다. 뒤에 오면
     바닥 밖 사각형이 기존 구역에 붙어 바닥을 삐져나간다. */
  const iClip = addZone.indexOf('clipZoneToAreas');
  const iGrow = addZone.indexOf('const grow');
  assert.ok(iClip > 0 && iClip < iGrow, '바닥 밖을 자르기 전에 이어 붙인다');
});

t('선택이 구역이 아니면 새로 만든다 — 설비를 고른 채로 그려도 멀쩡해야 한다', () => {
  assert.match(addZone, /pickedUid = state\.selected\?\.kind === 'zone' \? state\.selected\.uid : null/);
  assert.match(addZone, /selected: \{ kind: 'zone', uid \}/, '새로 그린 구역이 안 골라진다');
});

/* ---------- 구역이 말해 주는 것 --------------------------------------------- */

const Z = await import(SRC + 'core/zoneInfo.js');
const inspector = await readSrc('ui/Inspector.jsx');

const SQ = { uid: 'Z1', mp: rect(0, 0, 20, 20) };
const BB = { min: [-2, 0, -2], max: [2, 3, 2] };            // 4 × 4 m
const ITEM = { id: 'M', name: '제작기' };
const io = (id) => (id === 'M' ? ITEM : null);
const DOC = (over = {}) => ({
  placed: [
    { uid: 'E1', itemId: 'M', pos: [5, 5], rot: 0, crew: 2 },
    { uid: 'E2', itemId: 'M', pos: [15, 5], rot: 1, crew: 1 },
    { uid: 'E9', itemId: 'M', pos: [50, 50], rot: 0, crew: 9 },   // 구역 밖
  ],
  carts: [], shifts: [{ minutes: 480, headcount: 0 }], rates: {},
  bboxOf: () => BB,
  ...over,
});

t('**밖에 있는 것은 안 센다** — 그러려고 구역을 그린 것이다', () => {
  const i = Z.zoneInfo(SQ, DOC(), io);
  assert.equal(i.machines, 2, '구역 밖 설비까지 셌다');
  assert.equal(i.crew, 3, '밖의 9명이 섞였다');
});

t('찬 비율은 **돌려 놓은 대로** 센다 — 원래 치수로 세면 안 맞는다', () => {
  const i = Z.zoneInfo(SQ, DOC(), io);
  assert.equal(i.area, 400);
  assert.equal(i.covered, 32, '4×4 두 대 = 32 ㎡');
  assert.ok(Math.abs(i.fill - 32 / 400) < 1e-9);
});

t('치수를 모르면 **0 이 아니라 못 세는 것**이다 — 화면 층만 아는 값이라', () => {
  /* 라이브러리 항목에는 bbox 가 없다(GLB 에서 읽어 캐시된다). 넘겨 주지
     않으면 찬 비율이 0% 로 나오는데, 그건 「비었다」가 아니라 「모른다」다.
     실제로 이걸 안 넘겨서 0% 가 찍혔다. */
  const i = Z.zoneInfo(SQ, DOC({ bboxOf: undefined }), io);
  assert.equal(i.covered, 0);
  assert.ok(inspector.includes('bboxOf:'), '화면이 실제 치수를 안 넘긴다');
});

t('넓이가 0 이면 비율이 없다 — 0% 라고 하면 「비었다」로 읽힌다', () => {
  const i = Z.zoneInfo({ uid: 'Z0', mp: [] }, DOC(), io);
  assert.equal(i.fill, null);
});

t('경로가 구역을 지나는 길이를 잰다', () => {
  /* 20m 짜리 네모를 가로지르는 직선 — 안쪽은 정확히 20m */
  const m = Z.pathLengthIn(SQ, [[-5, 10], [25, 10]]);
  assert.ok(Math.abs(m - 20) < Z.STEP, `${m}`);
  /* 통째로 밖이면 0 */
  assert.equal(Z.pathLengthIn(SQ, [[-5, -5], [-1, -5]]), 0);
  /* 고리는 마지막→첫 점도 잇는다 */
  const open = Z.pathLengthIn(SQ, [[2, 2], [18, 2], [18, 18]], false);
  const closed = Z.pathLengthIn(SQ, [[2, 2], [18, 2], [18, 18]], true);
  assert.ok(closed > open, '고리인데 닫는 변을 안 셌다');
});

t('지나는 카트는 **경로 수**를 센다 — 대수를 곱하면 딴 이야기가 된다', () => {
  const d = DOC({ carts: [
    { uid: 'K1', points: [[-5, 10], [25, 10]], count: 5 },
    { uid: 'K2', points: [[-5, -9], [-1, -9]], count: 1 },   // 구역 밖
  ] });
  const i = Z.zoneInfo(SQ, d, io);
  assert.equal(i.carts, 1, '밖으로만 다니는 경로를 셌거나 대수를 곱했다');
  assert.ok(Math.abs(i.pathM - 20) < Z.STEP);
});

t('비용은 원가와 **같은 함수**를 쓴다 — 따로 곱하면 구역 합이 라인과 안 맞는다', () => {
  assert.match(zoneSrc, /import \{ hourlyCost \} from '\.\/improve\.js'/, '자기 나름대로 곱한다');
  /* 카트 전력은 뺀다 — 경로가 여러 구역에 걸쳐 어느 몫인지 못 가른다 */
  assert.match(zoneSrc, /carts: \[\]/, '카트 전력을 구역에 물리고 있다');

  /* 사람이 안 붙은 구역 = 전력만 (7kW × 130원 × 2대) */
  const bare = Z.zoneInfo(SQ, DOC({
    placed: [{ uid: 'E1', itemId: 'M', pos: [5, 5], rot: 0 }, { uid: 'E2', itemId: 'M', pos: [15, 5], rot: 0 }],
  }), io);
  assert.equal(Math.round(bare.hourly), 2 * 7 * 130);

  /* 사람이 붙으면 **그 인건비가 따라 붙는다** — 안 붙이면 사람이 공짜가 된다 */
  const manned = Z.zoneInfo(SQ, DOC(), io);
  assert.equal(manned.crew, 3);
  assert.equal(Math.round(manned.hourly), 2 * 7 * 130 + 3 * 12000, '구역 안 인건비가 빠졌다');
});

t('쌓는 곳은 설비와 갈라 센다 — 「설비 26대」에 선반이 섞이면 규모가 부푼다', () => {
  const shelfItem = { id: 'S', name: '선반', kind: 'shelf' };
  const i = Z.zoneInfo(SQ, DOC({
    placed: [{ uid: 'E1', itemId: 'M', pos: [5, 5], rot: 0 }, { uid: 'S1', itemId: 'S', pos: [9, 9], rot: 0 }],
  }), (id) => (id === 'M' ? ITEM : id === 'S' ? shelfItem : null));
  assert.equal(i.machines, 1);
  assert.equal(i.stores, 1);
});

t('화면이 구역 칸에서 이것을 부른다', () => {
  assert.match(inspector, /import \{ zoneInfo \} from '\.\.\/core\/zoneInfo\.js'/);
  const stats = cut(inspector, 'function ZoneStats(', '\nfunction ', '구역 통계');
  assert.ok(stats.includes('zoneInfo('), '계산을 안 부른다');
  for (const label of ['찬 비율', '인원', '시간당 비용', '지나는 카트']) {
    assert.ok(stats.includes(label), `「${label}」 이 없다`);
  }
  /* 통로를 뺀 값이 아니라는 것을 말해야 한다 — 90% 라고 못 다니는 게 아니다 */
  assert.ok(stats.includes('통로를 뺀 값이 아닙니다'), '찬 비율을 오해하게 둔다');
});
