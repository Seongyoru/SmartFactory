/**
 * =============================================================================
 *  전부 돌린다 — `npm test`
 * =============================================================================
 *  순서에 뜻이 있다. **바닥부터** 본다 — 아래가 깨졌으면 위는 볼 것도 없고,
 *  결과를 읽는 사람도 맨 위 실패부터 짚으면 된다.
 *
 *      값(순수 모듈)  →  소스에서 떼어 낸 계산(JSX 안)
 *
 *  파일 하나만 보고 싶으면 그것만 직접 돌려도 된다 — 같은 뼈대를 쓰므로 결과
 *  모양이 같다.
 *
 *      node tools/check/halted.mjs
 * ---------------------------------------------------------------------------
 */

/* 값으로 보는 것 — core/*.js 를 그대로 불러 확인한다 */
await import('./bom.mjs');
await import('./slots.mjs');
await import('./pick.mjs');
await import('./cart.mjs');
await import('./crew.mjs');
await import('./metrics.mjs');
await import('./metrics-crew.mjs');
await import('./process.mjs');

/* 소스에서 떼어 내는 것 — JSX 라 import 는 안 되지만 계산 자체는 순수하다.
   손으로 옮겨 적으면 옮겨 적은 것을 검증하게 되므로 파일에서 잘라 실행한다. */
await import('./belt.mjs');
await import('./halted.mjs');
await import('./cartview.mjs');

/* 이어 붙여 돌려 보는 것 — 조각마다 통과해도 개수는 셋에 걸쳐 샌다 */
await import('./line.mjs');

console.log('');
