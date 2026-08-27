/**
 * =============================================================================
 *  한 틱 — **화면 밖에서도 도는 시뮬레이션**
 * =============================================================================
 *  지금까지 시뮬은 세 곳의 `useFrame` 안에 있었다 — 설비(SimClock) · 벨트
 *  (BeltItems) · 카트(CartView). 그래서 **화면이 있어야만 돌았다.**
 *
 *  그것이 막고 있던 것은 「여러 번 돌려 평균과 신뢰구간을 내는 일」이다. 고장과
 *  공정 편차가 들어간 모델에서 **한 번 돌린 값은 사실 아무 말도 안 한다** —
 *  다시 돌리면 다른 값이 나오니까. 30번 돌려 「412 ± 18개/시」라고 해야 견줄 수
 *  있는 값이 된다.
 *
 *  ── 규칙을 옮겨 적지 않는다 ──────────────────────────────────────────────
 *  `scenarios.js` 는 「헤드리스로 한 벌 더 구현하면 두 벌이 반드시 어긋난다」고
 *  적어 두었다. 맞는 걱정이지만, 실제로 열어 보니 **규칙은 이미 전부 core 에
 *  있었다** — `stepCart` · `advanceBelt` · `runMachine` · `takeLots` …
 *  컴포넌트에 남아 있던 것은 **상태를 담는 그릇**(useRef · useState)이지 계산이
 *  아니었다.
 *
 *  그래서 여기서 하는 일은 옮겨 적기가 아니라 **그릇을 바꾸는 것**이다. 상태를
 *  평범한 객체에 담으면 화면도 헤드리스도 **같은 이 함수**를 부른다. 두 벌이
 *  될 자리가 없다.
 *
 *  ── 난수는 받아 쓴다 ─────────────────────────────────────────────────────
 *  반복 실행에서 필요한 것은 **씨앗 고정**이다. 같은 조건을 재현할 수 있어야
 *  하고, 배치 A 와 B 에 **같은 난수**를 먹여야 공정하게 견준다(같은 날 같은
 *  고장을 겪게 하는 것). 그래서 `rand` 를 인자로 흘려보낸다.
 *
 *  ── 상태는 **제자리에서 고친다** ─────────────────────────────────────────
 *  틱마다 새 객체를 만들면 30분 시뮬(18,000틱)에서 쓰레기가 산더미가 된다.
 *  여기 함수들은 넘겨받은 상태를 그 자리에서 고치고, **무슨 일이 있었는지**만
 *  돌려준다. 부르는 쪽이 그 객체의 임자다.
 * ---------------------------------------------------------------------------
 */

import { followDistance, forgetStation, loadRoom, pickSet, stepCart } from './cart.js';
import { advanceBelt, beltOffset } from './belt.js';
import { SCRAP_TO, runMachine, resetWork, setupTook, slotOf } from './process.js';
import { countKinds, needTimes, scaleNeed, slotShares } from './bom.js';
import { scrapKindOf } from '../data/library.js';
import { nextSlot } from './dispatch.js';
import { addRework, resetFaults, resetQuality, screen, screenAgain, stepFaults } from './faults.js';
import { accumulate, accumulateCart, plannedStop, resetMetrics } from './metrics.js';
import {
  addByGroup, addLots, addLotsShared, addShipped, addMade, clearStock,
  getLots, getMade, resetArrived, resetShipped, takeEach, takeLots, takeMade,
} from './simStore.js';
import { inGate, pointInMP } from './area.js';
import { resetClock } from './clock.js';

/**
 * **한 판을 처음으로 되돌린다.**
 * ---------------------------------------------------------------------------
 *  되돌릴 것이 여섯 군데에 흩어져 있다. 그 목록이 「다시 재기」 버튼 두 곳
 *  (툴바·인스펙터)에 **손으로 적혀** 있었는데, 그러면 스토어가 하나 늘 때
 *  한쪽을 빠뜨린다 — 그리고 빠뜨려도 아무 데서도 안 터진다. 지난 실행의 값이
 *  조용히 섞여 들 뿐이다.
 *
 *  실제로 걸렸다: 반복 실행 검사를 짜면서 `resetWork()` 를 빠뜨렸더니, 같은
 *  씨앗으로 두 번 돌린 결과가 **달랐다.** 앞 판에서 걸려 있던 반쯤 만든 것이
 *  다음 판으로 넘어갔기 때문이다. 반복 실행에서는 이것이 곧 못 쓰는 통계다.
 */
export function resetRun() {
  resetClock();
  resetMetrics();
  resetFaults();
  resetQuality();
  resetWork();
  clearStock();
  /**
   * **출하와 도착 누계도 지운다.**
   * -------------------------------------------------------------------------
   *  `clearStock` 은 지금 쌓인 것만 비운다. 누계는 따로 살아남았는데, 지표는
   *  기준점을 따로 잡아 두고 있어서(`shippedStart`) 아무 탈이 없었다.
   *
   *  **오더가 라인을 이끌게 되면서 달라졌다**(dispatch.js). 오더의 진척을
   *  누계로 세므로, 안 지우면 **두 번째 판부터는 오더가 이미 다 찬 것으로**
   *  보인다 — 디스패칭이 아무 일도 안 하고, 반복 실행의 판마다 답이 달라진다.
   */
  resetShipped();
  resetArrived();
}

/* ==========================================================================
 * 설비 — SimClock 이 하던 일
 * ======================================================================== */

/**
 * 설비를 굴리고, **선 이유를 하나만** 적분한다.
 *
 *  @param d.machines [{ uid, cycleSec, cycleVar, cap, need }]
 *  @param d.equips   고장 판정에 넣을 설비들 (faults.stepFaults 가 읽는 꼴)
 *  @param d.halted · d.jammed · d.starved · d.unmanned  Set<uid>
 *  @param d.shipped  지금까지 나간 총 개수 (추이 그래프가 쓴다)
 *  @param d.rand     난수 — 반복 실행에서 씨앗을 고정하려고 받는다
 *  @returns 이번 틱에 고장으로 서 있는 설비 Set
 */
export function runMachines(dt, d = {}) {
  /**
   * **쉬는 시간이면 아무것도 안 한다** — 주말 · 야간 · 정기보전.
   *  서 있는 이유를 세지도 않는다. 라인이 안 도는 것이 정상인 시간에
   *  「막혔다 · 굶었다」를 세면 그게 곧 거짓말이다.
   */
  if (d.closed) { plannedStop(dt); return; }
  const rand = d.rand ?? Math.random;
  /**
   * 이번 틱에 **전환에 시간을 쓴** 설비들.
   *  **설비 반복문보다 위에서 만든다.** 아래에 두었더니 TDZ 로, 전환이 실제로
   *  도는 순간에만 터졌다 — 두 커밋 동안 숨어 있었다. 검사는 `runMachine`
   *  (process) 을 직접 불렀지 `runMachines`(sim) 를 안 거쳤고, 브라우저 확인은
   *  지표를 손으로 넣어 화면만 봤다. **둘 다 그 길을 안 밟은 것이다.** */
  const setupNow = new Set();
  const nowDown = stepFaults(dt, d.equips ?? [], rand);

  /**
   * 설비를 굴린다 — **여기가 이 도구의 처리량을 정하는 자리다.**
   *  고장·무인이면 아예 안 돈다. 재료가 없으면 `pay` 가 실패해 그 자리에서
   *  멈추고(굶음), 출력 자리가 차 있으면 시작조차 안 한다(막힘).
   */
  for (const m of d.machines ?? []) {
    if (nowDown.has(m.uid) || d.unmanned?.has(m.uid)) continue;
    /**
     * **지금 만들고 있는 품종**을 고른다. 재료도 그 품종 것을 내고, 만든 것도
     *  그 종류로 쌓인다 — 안 그러면 제작품 2를 만들면서 제작품 1의 재료를
     *  먹거나, 만든 것이 엉뚱한 종류로 벨트에 실린다.
     */
    const many = m.kinds ?? [];
    const now = many.length ? many[slotOf(m.uid) % many.length] : null;
    const room = m.cap - getMade(m.uid);
    if (room <= 0) continue;
    /* 배치 공정 — 한 판에 여러 개. 판을 걸 때 재료도 **그만큼 한꺼번에** 낸다.
       `need` 는 한 개분이라 판 크기를 곱한다 */
    const need = now?.need ?? m.need;
    const n = runMachine(m.uid, dt, {
      cycleSec: m.cycleSec,
      cycleVar: m.cycleVar,
      shape: m.shape,
      /* 로트 전환 — 몇 개마다 몇 초 쉬는가. 0 이면 예전 그대로다 */
      /* 품종이 몇 가지인가 — 로트를 채우면 다음 품종으로 넘어간다 */
      kinds: many.length,
      lot: m.lot,
      setupSec: m.setupSec,
      room,
      /* `kinds` 가 없는 설비 객체(옛 꼴)는 `need` 를 그대로 쓴다 — 검사가
         이걸 잡았다. 새 자리를 만들었다고 옛 자리가 죽으면 안 된다. */
      batch: m.batch,
      waitSec: m.waitSec,
      /**
       * **다음 품종을 규칙이 고른다** — 차례대로 · 납기 먼저 · 밀린 것 먼저.
       *  견줄 값(납기 · 진척)은 오더에서 뽑아 부르는 쪽이 넘긴다(`orderInfo`).
       *  여기서 재고를 직접 읽으면 화면과 헤드리스가 다른 값을 본다.
       */
      /* 오더는 **이 설비 것만** 본다 — 산출이 목적지에 안 닿는 설비까지 끌려가면
         그쪽 하류가 굶는다(orders.js 의 열쇠가 (설비, 종류) 인 까닭) */
      pickSlot: (cur) => nextSlot(cur, many.map((k) => k.out), m.rule, d.orderInfo?.(m.uid)),
      /**
       * **불량은 만들 때 거른다.**
       *  예전에는 벨트 끝에서 걸렀다. 그래서 카트로 나르는 설비는 불량률을
       *  올려도 값이 안 변했고(거르는 자리가 벨트에만 있었다), 다 흘러간 뒤라
       *  재작업으로 되돌릴 수도 없었다.
       */
      check: (n, again) => (again
        ? screenAgain(n, m.scrapRate, m.uid, rand)
        : screen(n, m.scrapRate, m.uid, rand)),
      reworkSec: m.reworkSec,
      onRedo: (n) => addRework(m.uid, n),
      /**
       * **불량품으로 내보낸다** — 검사 라우팅. 벨트가 갈래로 빼 간다.
       *  자리를 못 잡으면 그만큼만 쌓는다 — 남은 것은 그냥 버린다(그 설비가
       *  막힌 것이지, 불량이 공중에 떠 있으면 안 된다).
       */
      /**
       * **어느 품종의 불량인지까지** 남긴다 — 「불량품 (제작품 1)」.
       *  한 종류로 합치면 제작품 1의 불량과 조립품 2의 불량이 같은 줄에 섞여
       *  흘러서, 재작업 설비가 무엇을 고치는지 알 수가 없고 갈래로 가를 수도 없다.
       */
      onScrap: m.scrapTo === SCRAP_TO.OUT
        ? (n) => addMade(
          m.uid, Math.max(0, Math.min(n, m.cap - getMade(m.uid))),
          scrapKindOf(now?.out ?? m.kinds?.[0]?.out),
        )
        : null,
      /* 지금 재료로 **몇 개**를 만들 수 있나 — 판이 찼는지 보는 값이다 */
      avail: need ? () => needTimes(countKinds(getLots(m.uid)), need) : null,
      pay: need ? (n) => takeEach(m.uid, scaleNeed(need, n)) : null,
      rand,
    });
    if (n > 0) addMade(m.uid, n, now?.out);
    /* **전환에 쓴 시간은 서는 이유 중 하나다.** 고장·무인과 같은 자리에 두는
       이유는 푸는 방법이 달라서다 — 로트를 키우거나 빠르게 바꾼다(SMED). */
    if (setupTook(m.uid) > 0) setupNow.add(m.uid);
  }

  /**
   * 서 있는 이유는 **한 틱에 하나만** 센다.
   * ---------------------------------------------------------------------------
   *  한 설비가 동시에 여러 목록에 들어갈 수 있다. 그대로 다 적분하면 같은 시간을
   *  두 번 빼서 지표가 함께 깎이고, 이유를 나눠 세는 뜻이 사라진다.
   *
   *  순서는 **더 근본적인 것이 앞**이다 — 고장 → 무인 → 막힘 → 굶음.
   *  고장 중에는 사람이 있어도 못 돈다. 사람이 없으면 재료가 와도 못 돈다.
   *  보낼 곳이 없으면 재료가 와도 못 돈다. 굶음은 앞의 셋 중 어느 것도 아닐 때만.
   *
   *  고장·무인은 **애초에 못 돈** 시간이라 가동률(A)에서, 막힘·굶음은 **돌 수
   *  있었는데 못 돈** 시간이라 성능(P)에서 빠진다(metrics 의 oeeOf).
   */
  const downOnly = new Set();
  const blockedOnly = new Set();
  const starvedOnly = new Set();
  for (const uid of d.halted ?? []) {
    if (nowDown.has(uid)) continue;
    if (d.unmanned?.has(uid)) downOnly.add(uid);
    else if (setupNow.has(uid)) continue;         // 전환은 따로 센다 (아래)
    else if (d.jammed?.has(uid)) blockedOnly.add(uid);
    else if (d.starved?.has(uid)) starvedOnly.add(uid);
    else blockedOnly.add(uid);
  }
  accumulate(dt, blockedOnly, d.shipped ?? 0, starvedOnly, downOnly, setupNow);
  return nowDown;
}

/* ==========================================================================
 * 벨트 — BeltItems 가 하던 일
 * ======================================================================== */

/**
 * 벨트를 한 칸 굴린다.
 *  @param belt  `belt.js` 가 다루는 그 상태 (제자리에서 고쳐진다)
 *  @returns 이번 틱에 **끝에 닿은 개수** — 부르는 쪽이 다음 설비에 넣는다
 */
/**
 * 벨트 한 줄을 한 틱 굴린다.
 *  @returns { n, byKind } — 닿은 **개수**와 종류별 개수.
 *           품종 전환이 생기면서 「몇 개」만으로는 모자라게 됐다 — 같은 벨트
 *           위에 두 종류가 앞뒤로 흐른다.
 */
export function runBelt(belt, ctx = {}, dt = 0) {
  const speed = ctx.speed ?? 0;
  if (!(speed > 0) || !(dt > 0)) return { n: 0, byKind: null };
  advanceBelt(belt, {
    d: speed * dt,
    step: ctx.step,
    length: ctx.length,
    feeding: ctx.feeding,
    spawn: ctx.spawn,
    kind: ctx.kind,
  });
  const byKind = belt.out;
  if (!byKind) return { n: 0, byKind: null };
  /* **층수를 다시 곱하지 않는다.** 칸이 든 개수(`counts`)가 이미 그 덩어리의
     개수다 — 예전에는 칸이 「덩어리 하나」였고 층수를 곱해 개수를 냈다.
     그대로 두었더니 개수가 제곱으로 부풀었다. */
  let n = 0;
  const out = {};
  for (const k of Object.keys(byKind)) { out[k] = byKind[k]; n += out[k]; }
  return { n, byKind: out };
}

export { beltOffset };

/* ==========================================================================
 * 카트 — CartView 가 하던 일 (여기가 가장 컸다)
 * ======================================================================== */

/** 카트 한 대의 상태. **화면이 아니라 이 객체가 임자다.** */
export const newCartUnit = (startS = 0, reverse = false) => ({
  s: startS,
  /** +1 정방향 · −1 역방향. `reverse` 는 모델이 아니라 **진행 방향**을 뒤집는다 */
  dir: reverse ? -1 : 1,
  pause: 0,
  /** 방금 주고받은 역 — 충분히 멀어지면 잊는다(cart.js 의 forgetStation) */
  lastKey: null,
  lastS: null,
  /** 지금 실은 짐을 어디서 받았는가 — 같은 곳에 도로 내려놓지 않기 위해 */
  source: null,
  /**
   * 싣고 있는 물건들의 **종류 목록**(아래에서부터).
   *  화면에서는 개수와 목록을 따로 들고 있었는데, 둘은 늘 같이 움직였다
   *  (`carried === carriedKinds.length`). 하나로 줄이면 어긋날 자리가 없다.
   */
  carried: [],
});

/**
 * 카트 한 대를 한 틱 굴린다. **상태는 제자리에서 고쳐진다.**
 *
 *  @param u    `newCartUnit()` 로 만든 객체
 *  @param ctx  path · stations · cart · capacity · topUp · oneWay ·
 *              fleet(다른 차들의 [{s,dir}]) · gap · floor · gates · shipOutside
 *  @returns { acted, shipped } — shipped 는 이번 틱에 밖으로 나간 종류들
 */
export function runCart(u, ctx = {}, dt = 0) {
  const { path, cart } = ctx;
  const out = { acted: false, shipped: null };
  if (!path || !(dt > 0)) return out;

  /* 방금 주고받은 역에서 충분히 멀어졌으면 그 기억을 푼다. 안 그러면 짐이
     남은 채 한 바퀴를 돌 때 그 역이 통째로 걸러져, 자리가 났는데도 안 선다. */
  u.lastKey = forgetStation(u.lastKey, u.lastS, u.s, path.length, cart.closed);
  if (!u.lastKey) u.lastS = null;

  /**
   * 앞차와의 간격 — **속도를 깎아서** 지킨다.
   * ---------------------------------------------------------------------------
   *  움직이고 나서 위치를 되밀면 안 된다. 정차역 판정은 「이번 틱에 s0 → s1
   *  사이를 지났는가」로 하는데, 지나간 뒤 되밀면 밟지도 않은 역을 들른 것으로
   *  세게 된다. 갈 수 있는 거리를 이번 틱 시간으로 나눠 **속도 상한**으로 바꿔
   *  주면 그 뒤 계산이 전부 그대로 맞는다.
   */
  const speed = cart.speed ?? 1.4;
  let capped = speed;
  if (ctx.fleet && ctx.gap > 0) {
    const room = followDistance({ s: u.s, dir: u.dir }, ctx.fleet,
      { length: path.length, closed: cart.closed, gap: ctx.gap });
    if (room !== Infinity && dt > 1e-6) capped = Math.min(speed, room / dt);
  }

  /* 앞차 때문에 **못 간 몫**을 시간으로 환산해 남긴다. 완전히 선 것만 세면
     「느려졌지만 가긴 갔다」가 통째로 빠진다. 정차(dwell)는 안 센다 — 역에
     서서 주고받은 시간은 **일을 한** 시간이다. */
  if (speed > 0 && u.pause <= 0) {
    accumulateCart(cart.uid, dt, dt * (1 - capped / speed));
  }

  const next = stepCart(
    { s: u.s, dir: u.dir, pause: u.pause, lastKey: u.lastKey },
    {
      length: path.length,
      closed: cart.closed,
      oneWay: ctx.oneWay,
      speed: capped,
      dwell: cart.dwell ?? 1.2,
    },
    ctx.stations,
    dt,
  );

  if (next.recycled) {
    /* 새 차가 나온 것이므로 이전 차의 짐과 기억은 남지 않는다 */
    u.carried = [];
    u.source = null;
    u.lastKey = null;
    u.lastS = null;
  }
  u.s = next.s;
  u.dir = next.dir;
  u.pause = next.pause;

  /* 수량 계산은 역에서 한다 — 선반이 몇 개나 받아 줄지는 재고에 달렸고,
     「실제로 주고받았을 때만」 그 역을 들른 것으로 기록해야 하기 때문이다. */
  if (next.arrived) {
    if (applyStation(u, next.arrived, ctx)) out.acted = true;
  }

  /**
   * 문으로 나가면 그것이 곧 **출하**다.
   * ---------------------------------------------------------------------------
   *  출하 지점을 따로 배선하지 않는다 — 「문으로 나갔다」는 사실 자체가 출하다.
   *  다만 **문으로** 나가야 한다. 벽을 뚫고 나간 자리에서는 아무 일도 안 일어나,
   *  도면이 틀렸다는 것이 짐을 실은 채 도는 트럭으로 드러난다.
   */
  if (ctx.shipOutside && u.carried.length > 0) {
    const f = path.at(u.s);
    const at = [f.pos[0], f.pos[2]];
    if (ctx.floor && !pointInMP(ctx.floor, at) && inGate(ctx.gates, at)) {
      /* 무엇이 나갔는지까지 넘긴다 — 총량만 세면 라인이 치우쳐도 모른다 */
      addShipped(u.carried);
      out.shipped = u.carried;
      u.carried = [];
      u.source = null;
      u.lastKey = null;       // 밖에 다녀왔으니 다시 실을 수 있다
      u.lastS = null;
    }
  }

  return out;
}

/**
 * 역 하나에서 **주고받는다.** 실제로 오간 것이 있으면 true.
 * ---------------------------------------------------------------------------
 *  `runCart` 에서 떼어 낸 이유는 이것만 따로 확인하고 싶어서다 — 「안 쓰는 종류를
 *  거르는가」, 「실어 온 곳에 도로 안 내려놓는가」 같은 것은 카트를 굴리지 않고도
 *  물어볼 수 있어야 한다.
 *
 *  @param u  카트 상태 — **제자리에서 고쳐진다**
 *  @param a  `stepCart` 가 준 `arrived`
 */
export function applyStation(u, a, ctx = {}) {
  const { cart = {} } = ctx;
  {
    const n = u.carried.length;
    let acted = false;

    if (a.kind === 'shelf-in') {
      /* 내리기. 실어 온 곳으로 도로 가져다 놓지 않는다 — 1번 선반에서 실은
         짐을 1번 선반에 내리면 아무 일도 안 한 셈이고, 왕복 경로에서는 그게
         무한히 되풀이된다. */
      if (n > 0 && u.source !== a.uid) {
        /* 줄을 나눈 선반이면 **그 지정을 지켜** 내린다. 규칙은 shelf.js 에
           있고 역이 싸서 넘겨 준다(binOf). 지정이 없으면 순서대로 쌓인다. */
        const r = a.binOf
          ? addByGroup(a.uid, u.carried, a.binOf)
          : { moved: addLots(a.uid, u.carried, a.capacity), left: null };
        if (r.moved > 0) {
          /* 못 넣은 것을 **목록으로** 받는다 — 앞에서부터 잘라 내면 안 들어간
             종류가 사라진다 */
          u.carried = r.left ?? u.carried.slice(r.moved);
          if (!u.carried.length) u.source = null;
          acted = true;
        }
      }
    } else if (a.kind === 'shelf-out') {
      /* 싣기. 카트는 **비어 있을 때만** 싣는다 — 가는 길에 이것저것 주워 담으면
         어디에 무엇을 내려놓아야 하는지가 흐려진다. 트럭은 반대다(topUp). */
      const room = loadRoom(n, ctx.capacity, ctx.topUp, cart.loadCount ?? a.dispatch ?? 0);
      if (room > 0) {
        const got = takeLots(a.uid, room, pickSet(cart));
        if (got.length > 0) {
          u.carried = [...u.carried, ...got];
          u.source = a.uid;
          acted = true;
        }
      }
    } else if (a.kind === 'load') {
      let take = Math.min(a.count, loadRoom(n, ctx.capacity, ctx.topUp, a.count));
      /* **만들어 놓은 것만** 실어 간다 — 만드는 것은 runMachines 가 공정
         시간대로 하고, 카트는 벨트와 똑같이 출력 자리에 쌓인 것만 가져간다 */
      take = Math.min(take, getMade(a.uid));
      const want = pickSet(cart);
      if (take > 0 && (!want.size || want.has(a.payloadKind))) {
        const got = takeMade(a.uid, take);
        if (got > 0) {
          u.carried = [...u.carried, ...Array.from({ length: got }, () => a.payloadKind)];
          u.source = a.uid;
          acted = true;
        }
      }
    } else if (a.kind === 'unload') {
      /* 설비 유입부에 내려놓기. 레시피가 있는 설비에는 **실제로 쌓이고**,
         **쓰는 종류만** 받는다 — 안 쓰는 것을 받아 두면 그 자리가 영영 안 빠져
         라인이 조용히 선다. 레시피가 없으면 예전 그대로 사라진다. */
      if (n > 0 && a.recipe) {
        const slots = slotShares(a.recipe, a.capacity);
        const { moved, left } = addLotsShared(a.uid, u.carried, (k) => slots[k] ?? 0);
        if (moved > 0) {
          u.carried = left;
          if (!left.length) u.source = null;
          acted = true;
        }
      } else if (n > 0) {
        u.carried = [];
        u.source = null;
        acted = true;
      }
    }

    if (acted) {
      u.lastKey = a.key ?? a.uid;
      u.lastS = u.s;
    } else {
      u.pause = 0;            // 아무 일도 없었으면 서 있을 이유도 없다
    }
    return acted;
  }
}
