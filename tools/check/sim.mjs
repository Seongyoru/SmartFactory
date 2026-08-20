/**
 * core/sim.js — 화면 밖에서도 도는 한 틱.
 * ---------------------------------------------------------------------------
 *  여기가 통과한다는 것은 **화면 없이 굴릴 수 있다**는 뜻이다. 이 파일 자체가
 *  그 증거다 — node 에는 캔버스도 rAF 도 없는데 라인이 돈다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('한 틱 (화면 밖)');

const S = await import(SRC + 'core/sim.js');
const M = await import(SRC + 'core/metrics.js');
const F = await import(SRC + 'core/faults.js');
const SS = await import(SRC + 'core/simStore.js');

const simSrc = await readSrc('core/sim.js');
const faultsSrc = await readSrc('core/faults.js');
const cartView = await readSrc('scene/CartView.jsx');
const beltItems = await readSrc('scene/BeltItems.jsx');
const editorScene = await readSrc('scene/EditorScene.jsx');

const NONE = new Set();
/* **resetRun 을 쓴다.** 손으로 적으면 빠뜨린다 — 실제로 resetWork() 를
   빠뜨려서 같은 씨앗의 두 판이 다른 값을 냈다 */
const fresh = () => S.resetRun();
const MACH = (over = {}) => ({ uid: 'A', cycleSec: 6, cycleVar: 0, cap: 999, need: null, ...over });

/** 화면 없이 n 초를 굴린다 */
function run(seconds, d = {}, dt = 0.1) {
  fresh();
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    S.runMachines(dt, { equips: [], halted: NONE, shipped: 0, rand: () => 0.5, ...d });
  }
}

/* ---------- 설비 ------------------------------------------------------------ */

t('**화면 없이 라인이 돈다** — 이 검사가 도는 것 자체가 증거다', () => {
  run(600, { machines: [MACH()] });
  assert.equal(SS.getMade('A'), 100, '6초/개로 600초면 100개');
  assert.ok(Math.abs(M.getRan() - 600) < 1e-6);
});

t('공정 시간이 처리량을 정한다', () => {
  run(600, { machines: [MACH({ cycleSec: 12 })] });
  assert.equal(SS.getMade('A'), 50);
});

t('출력 자리가 차면 멈춘다 — 막힘', () => {
  run(600, { machines: [MACH({ cap: 7 })] });
  assert.equal(SS.getMade('A'), 7, '자리가 7개면 7개에서 선다');
});

t('무인이면 아예 안 돈다 — 배치를 고쳐도 안 풀리는 유일한 이유', () => {
  run(600, { machines: [MACH()], unmanned: new Set(['A']) });
  assert.equal(SS.getMade('A'), 0);
});

t('선 이유를 **하나만** 센다 — 두 번 빼면 지표가 함께 깎인다', () => {
  const all = new Set(['A']);
  fresh();
  /* 무인이면서 막힌 설비 — 무인 쪽으로만 가야 한다 */
  S.runMachines(1, { machines: [], equips: [], halted: all, jammed: all, starved: all, unmanned: all, shipped: 0 });
  assert.equal(M.getUnmanned().A, 1);
  assert.equal(M.getBlocked().A ?? 0, 0, '무인인데 막힘으로도 셌다');
  assert.equal(M.getStarved().A ?? 0, 0, '무인인데 굶음으로도 셌다');
});

t('아무 이유도 없이 선 것은 막힘으로 본다 — 상류 전파', () => {
  fresh();
  S.runMachines(1, { machines: [], equips: [], halted: new Set(['A']), shipped: 0 });
  assert.equal(M.getBlocked().A, 1);
});

/* ---------- 씨앗을 고정하면 되풀이된다 -------------------------------------- */

t('**같은 씨앗이면 같은 결과** — 반복 실행이 성립하는 조건이다', () => {
  /* 고장과 공정 편차가 들어가면 돌릴 때마다 값이 달라진다. 그래서 여러 번
     돌려 평균과 신뢰구간을 내야 하는데, 그러려면 먼저 **재현**이 되어야 한다.
     배치 둘을 견줄 때도 같은 난수를 먹여야 공정하다(같은 날 같은 고장). */
  const seeded = (seed) => {
    let x = seed;
    return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  };
  const once = (seed) => {
    fresh();
    const rand = seeded(seed);
    for (let i = 0; i < 3000; i++) {
      S.runMachines(0.2, {
        machines: [MACH({ cycleVar: 0.4 })],
        equips: [{ uid: 'A', mtbf: 120, mttr: 30 }],
        halted: NONE, shipped: 0, rand,
      });
    }
    return { made: SS.getMade('A'), down: Math.round(F.downTimeOf('A')), repairs: F.repairsOf('A') };
  };
  const a = once(12345);
  const b = once(12345);
  const c = once(99999);
  assert.deepEqual(a, b, '같은 씨앗인데 결과가 다르다 — 어딘가 Math.random 이 남았다');
  assert.notDeepEqual(a, c, '씨앗을 바꿔도 같다 — 난수가 안 쓰이고 있다');
  assert.ok(a.repairs > 0, '고장이 한 번도 안 났다 — 표본이 시시하다');
});

t('난수를 쓰는 곳이 **전부** 받아 쓴다 — 하나만 놓쳐도 재현이 깨진다', () => {
  const faults = faultsSrc;
  /* 기본값(= Math.random) 말고 직접 부르는 자리가 남아 있으면 안 된다 */
  const calls = (faults.match(/Math\.random/g) ?? []).length;
  const defaults = (faults.match(/rand = Math\.random/g) ?? []).length;
  assert.equal(calls, defaults, 'faults 안에 난수를 직접 부르는 자리가 남았다');
});

/* ---------- 벨트 ------------------------------------------------------------ */

t('벨트는 **끝에 닿은 것**을 종류별로 돌려준다', () => {
  /* 품종 전환이 생기면서 「몇 개」만으로는 모자라게 됐다 — 같은 벨트 위에
     두 종류가 앞뒤로 흐르므로, 도착한 것이 무엇인지까지 알려 줘야 한다. */
  const B = { slots: [], head: 0 };
  assert.deepEqual(S.runBelt(B, { speed: 0 }, 1), { n: 0, byKind: null }, '속도가 0인데 굴렀다');
  assert.deepEqual(S.runBelt(B, { speed: 1 }, 0), { n: 0, byKind: null }, '시간이 0인데 굴렀다');
});

/* ---------- 화면은 **그리기만** 한다 ---------------------------------------- */

t('CartView 는 규칙을 안 들고 있다 — 굴리는 일은 sim 이 한다', () => {
  assert.match(cartView, /import \{ newCartUnit, runCart \} from '\.\.\/core\/sim\.js'/);
  assert.ok(cartView.includes('runCart(unit.current'), '굴리는 함수를 안 부른다');
  /* 규칙이 화면에 도로 새어 나오면 안 된다 */
  for (const rule of ['takeLots(', 'addLotsShared(', 'slotShares(', 'followDistance(', 'addShipped(']) {
    assert.equal(cartView.includes(rule), false, `CartView 가 ${rule} 를 다시 들고 있다`);
  }
});

t('카트의 가변 상태는 **객체 하나**다 — 흩어져 있으면 화면 없이 못 굴린다', () => {
  assert.ok(cartView.includes('newCartUnit('), '상태를 sim 의 꼴로 안 만든다');
  for (const ref of ['sRef', 'dirRef', 'pauseRef', 'lastKeyRef', 'sourceRef']) {
    assert.equal(cartView.includes(ref), false, `${ref} 가 아직 남아 있다`);
  }
});

t('실은 개수와 목록을 따로 들지 않는다 — 둘은 늘 같이 움직였다', () => {
  const u = S.newCartUnit(0, false);
  assert.deepEqual(u.carried, [], '목록 하나가 임자여야 한다');
  assert.equal('carriedCount' in u, false);
});

t('BeltItems 도 sim 을 부른다', () => {
  assert.match(beltItems, /import \{ runBelt \} from '\.\.\/core\/sim\.js'/);
  assert.ok(beltItems.includes('runBelt(belt'), '굴리는 함수를 안 부른다');
  assert.equal(beltItems.includes('advanceBelt('), false, 'BeltItems 가 아직 직접 굴린다');
});

t('SimClock 도 sim 을 부른다', () => {
  assert.match(editorScene, /import \{ runMachines \} from '\.\.\/core\/sim\.js'/);
  assert.ok(editorScene.includes('runMachines(dt,'), '굴리는 함수를 안 부른다');
  /* 갈라 세는 규칙이 화면에 도로 새어 나오면 안 된다 */
  assert.equal(editorScene.includes('const blockedOnly'), false, '갈라 세기가 화면에 남았다');
  assert.equal(editorScene.includes('runMachine('), false, '설비 공정이 화면에 남았다');
});

t('상태를 **제자리에서** 고친다 — 틱마다 새 객체를 만들면 쓰레기가 산더미다', () => {
  const u = S.newCartUnit(5, false);
  const before = u;
  S.applyStation(u, { kind: 'unload', uid: 'X', key: 'X' }, { cart: {} });
  assert.equal(u, before, '새 객체를 만들어 돌려준다');
});

/* ---------- 되돌리기는 **한 곳**에서 ---------------------------------------- */

const toolbar = await readSrc('ui/Toolbar.jsx');
const inspector = await readSrc('ui/Inspector.jsx');

t('되돌릴 목록이 화면에 손으로 적혀 있지 않다', () => {
  /* 「다시 재기」 버튼 두 곳에 여섯 개짜리 목록이 각각 적혀 있었다. 스토어가
     하나 늘면 한쪽을 빠뜨리는데, 빠뜨려도 아무 데서도 안 터진다 — 지난 실행의
     값이 조용히 섞여 들 뿐이다. 실제로 resetWork() 를 빠뜨려 같은 씨앗의 두
     판이 다른 값을 냈다. */
  for (const src of [toolbar, inspector]) {
    assert.match(src, /import \{ resetRun \} from '\.\.\/core\/sim\.js'/, '한 곳에서 안 가져온다');
    for (const one of ['resetClock', 'resetWork', 'resetFaults', 'resetQuality']) {
      /**
       * **정규식을 안 쓴다.**
       *  템플릿 리터럴 안에서는 역슬래시-b 가 단어 경계가 아니라 **백스페이스
       *  문자**(코드 8)로 바뀐다. 그래서 이 검사는 무엇을 넣든 **늘 통과**하고
       *  있었다 — 되돌려 보고 0건 실패로 확인했다.
       *  낱말이 그대로 있는지만 보면 되는 자리라 includes 로 충분하다.
       */
      assert.equal(src.includes(one), false, `${one} 를 아직 손으로 부른다`);
    }
  }
});

t('resetRun 이 **여섯 가지를 다** 되돌린다 — 하나만 빠져도 반복 실행이 못 쓴다', () => {
  for (const one of ['resetClock()', 'resetMetrics()', 'resetFaults()', 'resetQuality()', 'resetWork()', 'clearStock()']) {
    assert.ok(simSrc.includes(one), `resetRun 에 ${one} 가 없다`);
  }
});

t('되돌리면 정말 비어 있다', () => {
  run(120, { machines: [MACH()] });
  assert.ok(SS.getMade('A') > 0 && M.getRan() > 0, '먼저 뭔가 쌓여 있어야 뜻이 있다');
  S.resetRun();
  assert.equal(SS.getMade('A'), 0);
  assert.equal(M.getRan(), 0);
});
