/**
 * =============================================================================
 *  예열 자동 판정 — **언제부터 잰 값이 뜻을 갖나**
 * =============================================================================
 *  예전에는 **10초 고정**이었다. 240초에 한 판을 굽는 오븐이 있는 라인에서
 *  11초에 나온 값을 「측정 끝」이라고 내놓으면 도구가 사람을 속이는 것이다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 단순한 라인은 예전만큼 짧다.** 바닥값은 그대로 10초다.
 *  **② 느린 것이 있으면 그만큼 는다.** 배치 · 품종 순환 · 긴 벨트.
 *  **③ 왜 그만큼인지 말할 수 있다.** 재서 판정하면 이유가 안 남는다.
 *  **④ 두 길이 같은 값을 쓴다.** 화면과 헤드리스가 다른 시점부터 재면 눈으로 본
 *     처리량과 반복 실행의 처리량이 갈린다.
 *  **⑤ 끝이 있다.** 손으로 이상한 값을 적은 도면에서 영영 「측정 중」이면 안 된다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';
import { itemOf, loadModels, specOf as specById } from './_models.mjs';

group('예열 자동 판정');

const W = await import(SRC + 'core/warmup.js');
const Mt = await import(SRC + 'core/metrics.js');
const Sim = await import(SRC + 'core/sim.js');
const St = await import(SRC + 'core/simStore.js');
const Lu = await import(SRC + 'core/lineup.js');
const R = await import(SRC + 'core/replicate.js');
const A = await import(SRC + 'core/area.js');
const LIB = await import(SRC + 'data/library.js');

const makes = () => true;
const one = (p) => ({ placed: [{ uid: 'M', itemId: 'MACHINE_1', ...p }], itemOf: () => ({}), makes });

/* ---------- 도면에서 센다 -------------------------------------------------- */
t('단순한 라인은 **예전만큼 짧다**', () => {
  /* 바닥값을 올리면 이미 그린 도면들이 갑자기 「측정 중」에 오래 머문다 */
  assert.equal(W.WARMUP_MIN, 10);
  assert.equal(W.warmupOf({}).sec, 10, '빈 도면이 오래 데운다');
  assert.equal(W.warmupOf(one({ cycleSec: 2 })).sec, 10);
});

t('**배치 설비는 한 판을 모으고 굽는다** — 두 몫이다', () => {
  /* 20개를 240초에 굽는 오븐: 개당 12초 × 20개 = 240초, 모으고 굽느라 두 배 */
  const w = W.warmupOf(one({ cycleSec: 240, batchSize: 20 }));
  assert.equal(Math.round(w.slow), 480);
  assert.ok(w.sec >= 480, `예열이 ${w.sec}초다 — 한 판도 못 낸다`);
});

t('**품종 한 순환**을 돈다', () => {
  /* 한 품종만 보고 잰 값은 그 순간의 값이지 라인의 값이 아니다 */
  const w = W.warmupOf({
    placed: [{
      uid: 'M', itemId: 'MACHINE_1', cycleSec: 6, lotSize: 20, setupSec: 30,
      recipes: [{ in: [], out: 'PART_R' }, { in: [], out: 'PART_G' }],
    }],
    itemOf: () => ({}), makes,
  });
  /* (6 + 30/20) × 20개 × 2품종 = 300초 */
  assert.equal(Math.round(w.cycle), 300);
  /* 품종이 하나면 순환이 없다 */
  assert.equal(W.warmupOf(one({ cycleSec: 6, lotSize: 20, setupSec: 30 })).cycle, 0);
});

t('**벨트를 채우는 시간**을 더한다', () => {
  const w = W.warmupOf({
    placed: [], itemOf: () => ({}), makes,
    flows: [{ path: { length: 30 }, speed: 0.6 }, { path: { length: 12 }, speed: 0.6 }],
  });
  assert.equal(Math.round(w.fill), 70);            // 30/0.6 + 12/0.6
});

t('**불량과 재작업**도 개당 시간을 늘린다 — 예열도 는다', () => {
  const fast = W.warmupOf(one({ cycleSec: 6 }));
  const slow = W.warmupOf(one({ cycleSec: 6, scrapRate: 0.3, scrapTo: 'redo', reworkSec: 30 }));
  assert.ok(slow.slow > fast.slow, '재작업이 예열에 안 잡힌다');
});

t('**끝이 있다** — 영영 측정 중이면 도구가 죽은 것처럼 보인다', () => {
  const w = W.warmupOf(one({ cycleSec: 3600, batchSize: 50 }));
  assert.equal(w.sec, W.WARMUP_MAX);
  assert.equal(w.capped, true);
  assert.match(W.warmupText(w), /여기서 끊었습니다/);
});

t('**왜 그만큼인지** 말한다', () => {
  /* 재서 판정하면(Welch·MSER) 이유가 안 남는다 — 그게 안 쓴 이유다 */
  const w = W.warmupOf({
    placed: [{ uid: 'M', itemId: 'MACHINE_1', cycleSec: 240, batchSize: 20 }],
    itemOf: () => ({}), makes,
    flows: [{ path: { length: 30 }, speed: 0.6 }],
  });
  const why = W.warmupText(w);
  assert.match(why, /벨트 채우기 50초/);
  assert.match(why, /한 판 내기 480초/);
  /* 아무것도 안 걸리면 그렇게 말한다 */
  assert.match(W.warmupText(W.warmupOf({})), /단순한 라인/);
});

/* ---------- 지표가 그 값을 쓴다 ------------------------------------------- */
t('**처리량이 예열 전에는 안 나온다**', () => {
  Mt.resetMetrics();
  Mt.setWarmup(500);
  Sim.runMachines(100, { machines: [] });
  assert.equal(Mt.throughput(50), null, '예열도 안 됐는데 값을 내놨다');
  assert.equal(Math.round(Mt.warmupLeft()), 400);
  Sim.runMachines(450, { machines: [] });
  assert.ok(Mt.throughput(50) != null, '예열이 끝났는데 아직 측정 중이다');
  assert.equal(Mt.warmupLeft(), 0);
});

t('예열은 **바닥값 밑으로 안 내려간다**', () => {
  Mt.setWarmup(3);
  assert.equal(Mt.getWarmup().sec, Mt.WARMUP);
  Mt.setWarmup({ sec: 240, slow: 240, fill: 0, cycle: 0 });
  assert.equal(Mt.getWarmup().sec, 240);
  assert.equal(Mt.getWarmup().slow, 240, '이유를 안 들고 있다');
});

t('**다시 재기가 예열을 안 지운다**', () => {
  /* 다시 재기를 눌렀다고 240초짜리 오븐이 10초에 데워지지는 않는다 */
  Mt.setWarmup(240);
  Mt.resetMetrics();
  assert.equal(Mt.getWarmup().sec, 240);
});

/* ---------- 끝에서 끝까지 ------------------------------------------------- */
await loadModels(['MACHINE_1', 'STILLAGE', 'CONVEYOR']);
const idByKey = new Map(LIB.BUILTIN_LIBRARY.filter((x) => x.modelKey).map((x) => [x.modelKey, x.id]));
const specOf = (it) => (it?.modelKey ? specById(idByKey.get(it.modelKey) ?? '') : null);
const areas = [{ uid: 'F', mp: A.rectMP([-25, -25], [25, 25]) }];
const links = [{
  uid: 'C1', itemId: 'CONVEYOR', from: { uid: 'P1', portId: 'PORT_OUT@Z-' }, to: { uid: 'S1' },
  radius: 0.5, layer: 0, width: 1,
}];
const world = (p1) => Lu.worldOf({
  placed: [
    { uid: 'P1', name: '제작기', itemId: 'MACHINE_1', pos: [-6, 10], rot: 0, outputCount: 3, ...p1 },
    { uid: 'S1', name: '적치대', itemId: 'STILLAGE', pos: [-6, -8], rot: 0, capacity: 200 },
  ],
  links, carts: [], areas, walls: [], openings: [], shifts: [], beltSpeed: 0.6, itemOf, specOf,
});

t('**도면이 예열을 낸다** — 부르는 쪽이 따로 셀 것이 없다', () => {
  const fast = world({ cycleSec: 6, recipe: { in: [], out: 'PART_R' } });
  const oven = world({ cycleSec: 240, batchSize: 20, recipe: { in: [], out: 'PART_R' } });
  assert.ok(fast.warmup?.sec > 0, 'worldOf 가 예열을 안 낸다');
  assert.ok(oven.warmup.sec > fast.warmup.sec * 5,
    `오븐이 있는데 예열이 ${oven.warmup.sec}초다 (단순 라인 ${fast.warmup.sec}초)`);
});

t('**오븐 라인은 11초에 답하지 않는다** — 예전에는 답했다', () => {
  /* 240초에 한 판을 굽는 라인에서 11초에 나온 값은 그 배치의 실력이 아니다 */
  const w = world({ cycleSec: 240, batchSize: 20, recipe: { in: [], out: 'PART_R' } });
  St.clearStock();
  R.runOnce({ seconds: 11, world: w.world, flow: w.flow, pick: () => 0, warmup: w.warmup.sec });
  assert.equal(Mt.throughput(St.shippedTotal(St.getShipped())), null, '11초에 답을 내놨다');
  /* 옛 동작(10초 고정)으로 되돌리면 같은 도면이 11초에 답한다 — 그 차이가 이
     기능이다. **예열은 `resetMetrics` 로 안 지워지므로** 손으로 바닥값을 넣는다
     (도면의 성질이라 다시 재기로 지우면 안 되는 값이다). */
  St.clearStock();
  R.runOnce({ seconds: 11, world: w.world, flow: w.flow, pick: () => 0 });
  Mt.setWarmup(Mt.WARMUP);
  assert.ok(Mt.throughput(St.shippedTotal(St.getShipped())) != null,
    '예열을 안 넘겼는데도 안 답한다 — 검사가 무엇을 재는지 알 수 없게 된다');
});

t('충분히 돌리면 **답을 내놓는다**', () => {
  const w = world({ cycleSec: 240, batchSize: 20, recipe: { in: [], out: 'PART_R' } });
  St.clearStock();
  R.runOnce({ seconds: 1800, world: w.world, flow: w.flow, pick: () => 0, warmup: w.warmup.sec });
  assert.ok(Mt.throughput(St.shippedTotal(St.getShipped())) != null, '오래 돌려도 측정 중이다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const repSrc = await readSrc('core/replicate.js');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const sweepSrc = await readSrc('core/sweep.js');
const appSrc = await readSrc('App.jsx');
const dockSrc = await readSrc('ui/RunDock.jsx');

t('두 길이 **같은 함수**로 센다', () => {
  assert.ok(lineupSrc.includes('warmupOf({ placed, itemOf, flows: beltFlows'), '도면이 예열을 안 센다');
  assert.ok(sceneSrc.includes('warmupOf({'), '화면이 따로 판단한다');
  assert.ok(sceneSrc.includes('setWarmup(warmup)'), '화면이 예열을 안 넣는다');
  assert.ok(repSrc.includes('if (d.warmup > 0) setWarmup(d.warmup);'), '헤드리스가 예열을 안 넣는다');
});

t('손잡이 돌리기도 **값마다** 예열을 다시 센다', () => {
  /* 카트를 늘리면 라인이 빨리 차고, 로트를 키우면 한 순환이 길어진다.
     한 값으로 고정하면 어떤 자리에서는 아직 데워지지도 않은 숫자를 표에 싣는다 */
  assert.ok(sweepSrc.includes('warmup: built.warmup?.sec'), '값마다 예열을 안 본다');
});

t('화면이 **언제 끝나는지** 말한다', () => {
  /* 「측정 중…」만 뜨면 사람이 도구가 멈춘 줄 안다 — 오븐 라인은 몇 분씩 간다 */
  assert.ok(appSrc.includes('formatElapsed(warmupLeft())'), '남은 시간을 안 적는다');
  assert.ok(dockSrc.includes('warmupText(warmup)'), '왜 그만큼인지 안 적는다');
  /* 짧은 라인에서는 아예 안 띄운다 — 10초짜리를 적어 봐야 잡음이다 */
  assert.ok(dockSrc.includes('{warmup?.sec > WARMUP && ('), '짧은 라인에도 예열 줄이 뜬다');
});
