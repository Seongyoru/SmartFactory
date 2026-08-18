/* 구역 — 사각형을 이어 붙여 ㄱ 자를 만든다 · 딴 구역은 안 건드린다 */
import assert from 'node:assert/strict';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

group('구역 이어 붙이기');

const A = await import(SRC + 'core/area.js');
const store = await readSrc('core/store.jsx');

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
