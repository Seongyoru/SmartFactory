/**
 * 카메라 — **멀리 물러났을 때 구역이 바닥과 다투던 것**
 * ---------------------------------------------------------------------------
 *  깊이 버퍼의 눈금은 `near` 에 몰려 있다. `near=0.1 · far=600` 이면 비가
 *  6000 이라 먼 쪽이 성기고, 바닥 위 몇 밀리미터에 깔린 구역이 같은 눈금으로
 *  뭉개져 얼룩진다. 재 보니 **100~150 m 밖에서만** 났다 — 가까이서는 눈금이
 *  수십에서 수백 개 남는다.
 *
 *  y 를 더 띄우는 쪽은 안 골랐다. 바닥·그리드·구역의 높이 차례는 **색**을 맞추려고
 *  잡아 둔 것이라(4cc868d), 흔들면 눈금이 구역 위에 격자로 찍혀 색이 탁해진다.
 *  게다가 더 물러나면 어차피 다시 깨진다 — 거리를 막는 쪽이 근본이다.
 *
 *  이 값들을 지키는 검사가 하나도 없었다. 다음 사람이 근거 없이 되돌릴 수 있다.
 */
import assert from 'node:assert/strict';
import { group, readSrc, t } from './_harness.mjs';

group('카메라 깊이');

const scene = await readSrc('scene/EditorScene.jsx');
const grid = await readSrc('../src/core/grid.js');

t('3D 카메라의 near 가 충분히 크다 — 먼 쪽 눈금이 성겨지지 않게', () => {
  const m = scene.match(/<PerspectiveCamera[^>]*near=\{([\d.]+)\}[^>]*far=\{(\d+)\}/);
  assert.ok(m, '3D 카메라를 못 찾았다');
  const near = Number(m[1]);
  const far = Number(m[2]);
  assert.ok(near >= 0.4, `near=${near} — 너무 작다`);
  /* far/near 비가 깊이 정밀도를 정한다. 2000 을 넘으면 먼 쪽이 뭉개진다 */
  assert.ok(far / near <= 2000, `far/near = ${Math.round(far / near)} — 너무 크다`);
});

t('**물러날 수 있는 거리를 막는다** — 이쪽이 실제 수정이다', () => {
  const m = scene.match(/maxDistance=\{(\d+)\}/);
  assert.ok(m, 'maxDistance 가 없다 — 150 m 밖으로 물러나면 구역이 바닥과 다툰다');
  assert.ok(Number(m[1]) <= 200, `maxDistance=${m[1]} — 다투는 거리까지 갈 수 있다`);
});

t('막은 거리가 도면을 다 담는다 — 잘라서 잃는 것이 없어야 한다', () => {
  const size = Number(grid.match(/export const FLOOR_SIZE = (\d+)/)[1]);
  const max = Number(scene.match(/maxDistance=\{(\d+)\}/)[1]);
  assert.ok(max >= size * 1.2, `도면 ${size} m 를 ${max} m 에서 다 못 본다`);
});

t('near 를 올렸으면 minDistance 도 건다 — 안 그러면 바싹 붙였을 때 설비가 사라진다', () => {
  assert.match(scene, /minDistance=\{\d+\}/, 'minDistance 가 없다');
});

t('눕히는 것은 **막지 않는다** — 그쪽이 오히려 안전하다', () => {
  /* 시선이 누울수록 광선이 두 면 사이를 더 길게 지나 분리가 커진다.
     한때 「눕히면 깨진다」고 짐작했는데 재 보니 정반대였다. */
  assert.match(scene, /maxPolarAngle=\{Math\.PI \/ 2\.05\}/, '기울기 제한이 바뀌었다');
});
