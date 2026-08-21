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


import { done } from './_harness.mjs';

/* 이 파일로 돌릴 때만 「끝까지 갔는가」를 따진다 — 파일 하나만 돌릴 때는
   중간에 멈춘 것이 정상이다 */
process.env.CHECK_ALL = '1';
/* 값으로 보는 것 — core/*.js 를 그대로 불러 확인한다 */
await import('./bom.mjs');
await import('./slots.mjs');
await import('./pick.mjs');
await import('./cart.mjs');
await import('./crew.mjs');
await import('./metrics.mjs');
await import('./metrics-crew.mjs');
await import('./orders.mjs');
await import('./report.mjs');
await import('./cost.mjs');
await import('./share.mjs');
await import('./balance.mjs');
await import('./improve.mjs');
await import('./planreport.mjs');
await import('./measure.mjs');
await import('./zone.mjs');
await import('./flow.mjs');
await import('./optimize.mjs');
await import('./guides.mjs');
await import('./shelfrows.mjs');
await import('./cartline.mjs');
await import('./lineflow.mjs');
await import('./process.mjs');
await import('./setup.mjs');
await import('./multi.mjs');
await import('./batch.mjs');
await import('./rework.mjs');
await import('./calendar.mjs');
await import('./dispatch.mjs');
await import('./divert.mjs');
await import('./inspect.mjs');
await import('./calibrate.mjs');
await import('./warmup.mjs');
await import('./random.mjs');
await import('./sweep.mjs');

/* 소스에서 떼어 내는 것 — JSX 라 import 는 안 되지만 계산 자체는 순수하다.
   손으로 옮겨 적으면 옮겨 적은 것을 검증하게 되므로 파일에서 잘라 실행한다. */
await import('./belt.mjs');
await import('./halted.mjs');
await import('./cartview.mjs');
await import('./sim.mjs');
await import('./replicate.mjs');

/* 이어 붙여 돌려 보는 것 — 조각마다 통과해도 개수는 셋에 걸쳐 샌다 */
await import('./focus.mjs');
await import('./models.mjs');
await import('./diagnose.mjs');
await import('./line.mjs');

/* 여기까지 왔다는 것이 「다 돌았다」는 뜻이다 — 앞에서 던지면 안 온다 */
done();

console.log('');
