/**
 * 하위 경로 배포 — 앱이 뿌리에 없을 때도 자산을 찾는가
 * ---------------------------------------------------------------------------
 *  GitHub Pages 는 `…/SmartFactory/` 처럼 **하위 경로**로 연다. 라이브러리의
 *  모델 주소는 `/models/Machine_1.glb` 처럼 뿌리에서 시작하므로, 그대로 두면
 *  `…/models/…` 를 뿌리에서 찾다가 전부 404 가 된다 — 설비가 하나도 안 뜬다.
 *
 *  그런데 이 실패는 **조용하다.** 모델이 없으면 절차적 대안을 그리는 자리가
 *  있어서(선반처럼), 화면은 뜨는데 「모양만 다른 것」이 된다. 눈으로 보고
 *  넘어가기 쉬운 종류다. 그래서 값으로 못 박는다.
 *
 *  실제 기준 경로는 Vite 가 `import.meta.env.BASE_URL` 로 넣어 준다. 검사는
 *  Node 로 곧장 부르므로 그 값이 없다 — 그래서 기준을 **밖에서 넣는** 순수
 *  함수로 갈라 두고, 여기서 세 가지 배포 모양을 전부 밟는다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('하위 경로 배포');

const { withBase } = await import(SRC + 'core/modelStore.js');

const store = await readSrc('core/modelStore.js');
const cfg = await readSrc('../vite.config.js');

/* ---------- 배포 모양 세 가지 -------------------------------------------- */

t('뿌리에 올리면 그대로 둔다', () => {
  assert.equal(withBase('/', '/models/Machine_1.glb'), '/models/Machine_1.glb');
});

t('상대 기준이면 앞에 점을 붙인다 — 어느 깊이에 놓여도 따라간다', () => {
  assert.equal(withBase('./', '/models/Machine_1.glb'), './models/Machine_1.glb');
});

t('하위 경로에 올리면 그 경로 밑에서 찾는다', () => {
  assert.equal(
    withBase('/SmartFactory/', '/models/Machine_1.glb'),
    '/SmartFactory/models/Machine_1.glb',
  );
});

t('기준 끝의 빗금이 겹치지 않는다', () => {
  /* `/SmartFactory/` + `/models` 를 그냥 이으면 `//models` 가 된다.
     주소로는 **호스트 이름**으로 읽히는 자리라 조용히 남의 서버를 부른다. */
  const out = withBase('/SmartFactory/', '/models/x.glb');
  assert.ok(!out.includes('//'), out);
});

/* ---------- 손대면 안 되는 것들 ------------------------------------------ */

t('올린 파일의 blob 주소는 건드리지 않는다', () => {
  const u = 'blob:http://localhost:5174/9f2c-…';
  assert.equal(withBase('/SmartFactory/', u), u);
});

t('이미 상대 주소인 것은 그대로 둔다', () => {
  assert.equal(withBase('/SmartFactory/', 'layouts/index.json'), 'layouts/index.json');
});

t('바깥 주소는 그대로 둔다', () => {
  const u = 'https://example.com/a.glb';
  assert.equal(withBase('/SmartFactory/', u), u);
});

t('주소가 아닌 것(캐시 열쇠·null)은 그대로 돌려준다', () => {
  assert.equal(withBase('/SmartFactory/', null), null);
  assert.equal(withBase('/SmartFactory/', undefined), undefined);
  assert.equal(withBase('/SmartFactory/', 'MACHINE_1'), 'MACHINE_1');
});

t('기준이 없으면 뿌리로 친다 — 지금까지와 같게', () => {
  assert.equal(withBase(undefined, '/models/x.glb'), '/models/x.glb');
  assert.equal(withBase(null, '/models/x.glb'), '/models/x.glb');
});

/* ---------- 배선 — 로더가 실제로 이것을 거치는가 -------------------------- */

t('모델을 부르는 자리가 기준 경로를 거친다', () => {
  assert.match(store, /loader\.load\(atBase\(/);
  assert.match(store, /const atBase = \(p\) => withBase\(BASE, p\)/);
});

t('기준 경로를 Vite 에서 받는다 — 없으면 뿌리', () => {
  assert.match(store, /import\.meta\.env\?\.BASE_URL \?\? '\/'/);
});

t('빌드가 자산을 상대 경로로 낸다', () => {
  /* `base` 를 뿌리로 되돌리면 하위 경로 배포가 통째로 깨진다 — 여기서 잡는다 */
  assert.match(cfg, /base:\s*'\.\/'/);
});
