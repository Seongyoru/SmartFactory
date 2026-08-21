/**
 * =============================================================================
 *  반복 실행 — **한 번 돌린 값은 사실 아무 말도 안 한다**
 * =============================================================================
 *  이 시뮬에는 고장(지수분포)과 공정 편차가 들어 있다. 그러면 같은 배치를 다시
 *  돌려도 다른 값이 나온다. 그런데 지금까지 화면은 **한 번 돌린 숫자 하나**를
 *  「이 배치의 처리량」이라고 말해 왔다. 그건 주사위를 한 번 굴려 놓고 「이
 *  주사위는 4가 나온다」고 하는 것과 같다.
 *
 *      한 번:   412 개/시
 *      30번:    412 ± 18 개/시 (95%)      ← 이래야 견줄 수 있는 값이 된다
 *
 *  배치 A(410)와 B(420)를 한 번씩 돌려 「B가 낫다」고 하면 **틀릴 수 있다.**
 *  구간이 겹치면 그 차이는 아직 아무것도 아니다. 이 모듈은 그 판단을 숫자로
 *  하게 만든다.
 *
 *  ── 왜 이제 되나 ─────────────────────────────────────────────────────────
 *  틱이 `core/sim.js` 로 나왔기 때문이다. 그 전에는 시뮬이 3D 씬의 프레임 루프
 *  안에 있어서 **화면이 있어야만** 돌았고, 배경에서 여러 번 돌릴 방법이 없었다.
 *  지금은 같은 함수를 루프로 부르면 된다 — 30분 시뮬이 몇 ms 다.
 *
 *  ── 같은 난수를 먹인다 (common random numbers) ───────────────────────────
 *  배치 둘을 견줄 때는 **같은 씨앗**을 쓴다. 그래야 「A는 운 좋게 고장이 안
 *  났고 B는 났다」가 아니라 **배치 차이만** 남는다. 통계에서 표본을 줄이는
 *  고전적인 수법이고, 여기서는 공짜로 얻는다.
 *
 *  ── 데우는 시간은 버린다 ─────────────────────────────────────────────────
 *  라인이 채워지기 전의 처리량은 그 배치의 실력이 아니다. `metrics` 가 이미
 *  WARMUP 을 두고 있으므로, 여기서는 **그 뒤부터** 재도록 시간을 준다.
 * ---------------------------------------------------------------------------
 */

import { isClosedAt } from './crew.js';
import { orderInfoOf } from './orders.js';
import { newCartUnit, resetRun, runBelt, runCart, runMachines } from './sim.js';
import { beltCount, beltFull, beltHeld, holdOnBelt, makeBelt, takeHeld } from './belt.js';
import { arrivedOf, dropAtSink, getShipped, takeBundles } from './simStore.js';
import { haltState } from './halt.js';
import { getRan, setWarmup } from './metrics.js';

/** 한 판을 이만큼씩 끊어 굴린다 (시뮬 초) — 화면의 한 프레임과 같은 크기 */
export const STEP = 0.1;

/**
 * 씨앗을 받는 난수. **재현이 되어야 반복 실행이 성립한다.**
 *  선형 합동법 — 통계적으로 훌륭하진 않지만 이 용도에는 충분하고, 한 줄이라
 *  어디서 무엇이 달라졌는지 따질 일이 없다.
 */
export function seeded(seed = 1) {
  let x = (Math.abs(Math.trunc(seed)) || 1) % 4294967296;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

/* ==========================================================================
 * 통계 — 여러 판을 한 줄로
 * ======================================================================== */

/**
 * t 분포의 95% 값. 표본이 적을 때 정규분포(1.96)를 쓰면 **구간이 좁게 나온다** —
 * 즉 「차이가 있다」고 성급하게 말하게 된다. 30까지는 표를 그대로 쓴다.
 */
const T95 = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
];
const tOf = (df) => (df <= 0 ? 0 : df < T95.length ? T95[df] : 1.96);

/**
 * 값 여럿 → 평균과 95% 신뢰구간.
 *
 *  @returns { n, mean, sd, half, lo, hi }
 *    half  ± 얼마 — 화면이 「412 ± 18」 로 쓰는 그 값
 *    lo·hi 구간. **두 배치의 구간이 겹치면 아직 차이라고 말할 수 없다**
 */
export function stats(values) {
  const xs = (values ?? []).filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (!n) return { n: 0, mean: null, sd: 0, se: 0, half: 0, lo: null, hi: null };
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { n, mean, sd: 0, se: 0, half: 0, lo: mean, hi: mean };
  /* 표본 표준편차 — n 이 아니라 n−1 로 나눈다. 모집단이 아니라 **뽑은 것**이다 */
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const half = tOf(n - 1) * se;
  return { n, mean, sd, se, half, lo: mean - half, hi: mean + half };
}

/**
 * 두 배치가 **정말 다른가.**
 * ---------------------------------------------------------------------------
 *  「A 410, B 420 이니 B가 낫다」 는 틀릴 수 있다. 다시 돌리면 뒤집힐 수 있다는
 *  뜻이다. 이 판정이 없으면 반복 실행을 해 놓고도 결국 눈으로 숫자를 견주게 된다.
 *
 *  ── 「구간이 겹치나」로 보면 안 된다 ──────────────────────────────────────
 *  처음에는 두 신뢰구간이 겹치는지로 봤다. 쉽고 그럴듯하지만 **지나치게 보수적
 *  이다** — 실제로 6.0초/개와 5.5초/개(9% 차이)를 스무 판씩 돌려 견줬더니
 *  「아직 모른다」가 나왔다. 있는 차이를 없다고 하는 것은 안 하느니만 못하다.
 *
 *  차이 자체에도 신뢰구간이 있다. 그걸 보는 것이 맞다 —
 *
 *      차이의 표준오차 = √(seA² + seB²)          (Welch)
 *      차이가 0 을 안 품으면 **진짜 차이**다
 *
 *  자유도는 Welch–Satterthwaite 로 낸다. 분산이 다른 두 표본을 견주는 자리라
 *  「합쳐서 하나로 본다」가 성립하지 않는다.
 */
export function differs(a, b) {
  if (!a?.n || !b?.n || a.n < 2 || b.n < 2) return null;
  const gap = Math.abs(a.mean - b.mean);
  const va = a.se ** 2;
  const vb = b.se ** 2;
  const se = Math.sqrt(va + vb);
  if (!(se > 0)) return { gap, half: 0, sure: gap > 0, better: a.mean > b.mean ? 'a' : 'b' };
  /* Welch–Satterthwaite */
  const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1));
  const half = tOf(Math.max(1, Math.floor(df))) * se;
  return {
    gap,
    /** 차이의 ± — `gap` 이 이보다 크면 0 을 안 품는다 */
    half,
    sure: gap > half,
    better: a.mean > b.mean ? 'a' : 'b',
  };
}

/**
 * **짝지어 견준다** — 같은 난수를 먹인 두 판 묶음.
 * ---------------------------------------------------------------------------
 *  `differs` 는 두 묶음이 **서로 남남**이라고 보고 견준다(Welch). 그런데 이
 *  도구는 값을 바꿔 가며 돌릴 때 **씨앗을 같게** 준다(common random numbers) —
 *  1번 판은 어느 값에서든 같은 난수를 먹는다. 그러면 판마다 **짝이 맞고**,
 *  짝을 지어 빼면 「그날 운」이 통째로 상쇄된다.
 *
 *  ── 왜 이게 필요했나 ──────────────────────────────────────────────────────
 *  손잡이 돌리기에서 적치대 수용량을 재 보니 이랬다.
 *
 *      10개 691 ± 135 · 20개 737 ± 83 · 40개 788 ± 68 · 80개 821 ± 62
 *
 *  눈으로 보면 **뚜렷이 오르는데** Welch 는 「10개나 80개나 다르다고 못 한다」고
 *  했다 — 판마다 운이 크게 흔들려 ± 가 넓기 때문이다. 그래서 화면이
 *  **「10개면 충분합니다」**라고 거짓말을 했다.
 *
 *  짝을 지으면 그 운이 사라진다. 같은 난수에서 버퍼만 키운 판끼리 빼면 남는
 *  것은 버퍼의 몫뿐이다.
 *
 *  **짝이 안 맞으면 쓰면 안 된다** — 판 수가 다르거나 씨앗이 다르면 이 계산은
 *  거짓이다. 그때는 부르는 쪽이 `differs` 로 가야 한다.
 */
export function pairedDiffers(a, b) {
  const xs = a?.runs ?? [];
  const ys = b?.runs ?? [];
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { gap: 0, half: 0, sure: false, better: null, n: 0 };

  const d = new Array(n);
  for (let i = 0; i < n; i++) d[i] = ys[i] - xs[i];
  const s = stats(d);
  return {
    /** b − a 의 평균 (양수면 b 가 크다) */
    gap: s.mean,
    half: s.half,
    sure: Math.abs(s.mean) > s.half,
    better: s.mean > 0 ? 'b' : 'a',
    n,
  };
}

/* ==========================================================================
 * 여러 판 돌리기
 * ======================================================================== */

/**
 * =============================================================================
 *  자재를 **옮기는** 쪽 — 벨트와 카트
 * =============================================================================
 *  이것이 없을 때 반복 실행은 라인의 절반만 돌았다. `runOnce` 가 `runMachines`
 *  하나만 불렀으므로 설비는 만들고, 만든 것은 **아무 데도 안 갔다.** 출력 자리가
 *  차면 전부 막히고, 밖으로 나간 것은 늘 0 이라 처리량이 **구조적으로 0** 이었다.
 *
 *  화면에서는 이 일을 BeltItems 와 CartView 가 한다. 규칙은 이미 `core/sim.js`
 *  에 있으므로(runBelt · runCart) 여기서는 **그릇만** 만들어 같은 함수를 부른다 —
 *  화면 쪽 콜백(onSpawn · onArrive)까지 같은 규칙으로 옮겼다. 두 벌이 되면
 *  화면과 표가 어긋나므로, 붙여 놓은 자리를 검사가 지킨다.
 *
 *  @param d.beltFlows `beltFlowsOf` 의 결과 (도면에서 나온다 — 판마다 안 바뀐다)
 *  @param d.cartPaths [{ cart, path, stations }]
 *  @param d.floor · d.gates · d.isTruck  출하 판정에 쓴다
 *  @returns { reset, move } — 판을 시작할 때 reset, 매 틱 move(dt, halted)
 */
export function lineFlow(d = {}) {
  const flows = d.beltFlows ?? [];
  const paths = d.cartPaths ?? [];
  const isTruck = d.isTruck ?? (() => false);

  /* 벨트 상태 — 칸 수는 경로 길이와 덩어리 간격에서 나온다(화면과 같은 식) */
  const belts = flows.map((b) => ({
    ...b,
    step: Math.max(0.4, b.gap),
    state: null,
  }));
  /* 카트 — 대수만큼 자리를 고르게 나눠 세운다(화면의 startS 와 같은 규칙) */
  const fleets = paths.map(({ cart, path, stations }) => {
    const n = Math.max(1, Math.round(cart.count ?? 1));
    return {
      cart, path, stations,
      truck: isTruck(cart),
      units: [],
      n,
      /* 형제들의 자리 — runCart 가 간격을 잴 때 본다 */
      fleet: [],
    };
  });

  /**
   * 축적형 벨트가 **다 찼나** — 정지 판정이 이것을 본다(`haltState` 의 fullOf).
   *  쌓인 양은 굴리는 쪽만 아는 값이라, 도면에서 만든 흐름에는 안 들어 있다.
   */
  const fullOf = (uid) => {
    const b = belts.find((x) => x.link?.uid === uid);
    return !!b?.state && beltFull(b.state);
  };

  const reset = () => {
    for (const b of belts) b.state = makeBelt(beltCount(b.path?.length ?? 0, b.step), b.layers);
    for (const f of fleets) {
      const len = f.path?.length ?? 0;
      f.units = Array.from({ length: f.n }, (_, k) => newCartUnit((len * k) / f.n, f.cart.reverse));
      f.fleet = f.units.map((u) => ({ s: u.s, dir: u.dir }));
    }
  };
  reset();

  /**
   * 한 틱. `halted` 는 `haltState` 가 돌려준 것 — 벨트가 서는지(links)와
   * 앞머리가 마르는지(dry)를 화면과 **같은 값**으로 본다.
   */
  const move = (dt, halted = {}) => {
    for (const b of belts) {
      if (halted.links?.has?.(b.link.uid)) {
        /**
         * 서 있어도 **쌓아 둔 것은 내린다.**
         *  안 그러면 다 찬 축적형 벨트가 영영 안 비워진다 — 자리가 나도 아무도
         *  안 내리니 라인이 통째로 죽는다.
         */
        if (b.sink && beltHeld(b.state)) {
          const back = takeHeld(b.state, beltHeld(b.state));
          const left = dropAtSink(b.sink, back);
          for (const k of Object.keys(left ?? {})) holdOnBelt(b.state, k, left[k]);
        }
        continue;                                        // 보낼 곳이 없으면 선다
      }
      const per = Math.max(1, Math.round(b.owner.outputCount ?? 3));
      const got = runBelt(b.state, {
        speed: b.speed,
        step: b.step,
        length: b.path?.length ?? 0,
        layers: b.layers,
        feeding: !halted.dry?.has?.(b.link.uid),
        /* 만들어 놓은 것만 **덩어리 단위로** 싣는다 — 화면의 onSpawn 그대로다.
           품종이 바뀌는 자리에서는 짧은 덩어리가 나온다(takeBundles). */
        /* 갈래가 잡힌 벨트는 **제 종류만** 집어 간다 (link.js 의 beltKinds).
           못 싣는 종류는 건너뛴다 — 안 그러면 두 벨트가 함께 선다 */
        spawn: (n) => takeBundles(b.owner.uid, per, n, b.kinds),
        /* 옛 도면(품종 하나)에서는 줄의 이름표를 쓴다 */
        kind: b.outKind,
      }, dt);
      /**
       * 종점에 내린다 — **쌓아 둔 것이 먼저다.**
       * ---------------------------------------------------------------------
       *  축적형 벨트는 막혀도 안 서고 끝에 쌓는다. 자리가 나면 **먼저 쌓인
       *  것부터** 내려가야 순서가 안 뒤집힌다.
       *
       *  종류마다 따로 쌓는 것은 그대로다 — 같은 벨트에 두 품종이 앞뒤로
       *  흐르므로 줄에 이름표 하나만 붙이면 엉뚱한 종류로 쌓인다.
       *
       *  불량은 **만들 때** 이미 걸렀다(sim 의 runMachines) — 벨트에는 양품만
       *  실린다. 여기서 또 거르면 같은 불량률을 두 번 문다.
       */
      if (b.sink) {
        if (beltHeld(b.state)) {
          const back = takeHeld(b.state, beltHeld(b.state));
          const left = dropAtSink(b.sink, back);
          for (const k of Object.keys(left ?? {})) holdOnBelt(b.state, k, left[k]);
        }
        if (got.n > 0) {
          const left = dropAtSink(b.sink, got.byKind);
          /**
           * 못 내린 것은 **벨트 끝에 남는다** — 축적형이든 아니든.
           * -------------------------------------------------------------------
           *  전에는 그냥 사라졌다. 「종점이 막히면 벨트가 서니 여기까지 안 온다」고
           *  여겼는데 **틀렸다** — 자리가 한 칸 남았는데 세 개짜리 덩어리가 닿으면
           *  하나만 들어가고 **둘이 없어진다.** 900초에 343개를 만들어 131개만
           *  찾을 수 있었다(212개가 사라졌다).
           *
           *  축적이 가르는 것은 **벨트가 서느냐**지 물건이 사라지느냐가 아니다.
           */
          if (left) for (const k of Object.keys(left)) holdOnBelt(b.state, k, left[k]);
        }
      }
    }

    for (const f of fleets) {
      const capacity = Math.max(0, f.cart.loadCount ?? (f.truck ? 10 : 3));
      for (let k = 0; k < f.units.length; k++) {
        runCart(f.units[k], {
          path: f.path, stations: f.stations, cart: f.cart,
          capacity, topUp: f.truck, oneWay: d.oneWay,
          fleet: f.fleet, gap: d.gap,
          floor: d.floor, gates: d.gates, shipOutside: f.truck,
        }, dt);
        f.fleet[k] = { s: f.units[k].s, dir: f.units[k].dir };
      }
    }
  };

  /* `belts` 는 검사가 「벨트에 얼마나 쌓였나」를 들여다보려고 쓴다 */
  return { reset, move, fullOf, belts };
}


/**
 * 도면 한 벌 → **틱마다 다시 답하는** world.
 * ---------------------------------------------------------------------------
 *  「누가 서 있는가」는 도면이 아니라 **지금 재고**에 달려 있어서 매 틱 달라진다.
 *  적치대가 차면 그 앞이 서고, 카트가 비워 주면 다시 돈다. 그래서 world 를
 *  객체가 아니라 **함수로** 준다.
 *
 *  이것을 안 쓰면 반복 실행이 **막힘·굶음이 없는 라인**만 돌리게 된다 — 정작
 *  보고 싶은 것이 빠진 반복 실행이다.
 *
 *  @param d.beltFlows · d.machines · d.placed · d.itemOf · d.crew  도면에서 나온다
 *  @param d.equips   고장 판정에 넣을 설비들
 *  @param d.downMap  () => 지금 고장 난 설비. `faults.getDown` 을 그대로 준다
 */
export function lineWorld(d = {}) {
  return (elapsed = 0) => {
    const h = haltState({
      beltFlows: d.beltFlows,
      machines: d.machines,
      placed: d.placed,
      itemOf: d.itemOf,
      downMap: d.downMap ? d.downMap() : {},
      crew: d.crew,
      /* 축적형 벨트가 다 찼나 — 옮기는 쪽(`lineFlow`)만 아는 값이다 */
      fullOf: d.fullOf,
    });
    return {
      machines: d.machines,
      equips: d.equips ?? [],
      /* 옮기는 쪽(lineFlow)이 보는 값 — 벨트가 서는지, 앞머리가 마르는지.
         화면의 BeltItems 가 running·feeding 으로 받는 것과 같은 값이다. */
      links: h.links,
      dry: h.dry,
      halted: h.equips,
      jammed: h.jammed,
      starved: h.starved,
      unmanned: h.unmanned,
      shipped: d.shipped ? d.shipped() : 0,
      /**
       * **오더가 라인을 이끈다** — 디스패칭 규칙(`dispatch.js`)이 읽는 값.
       *  진척은 매 틱 달라지므로 **여기서 매번 다시 뽑는다.** 한 번 만들어
       *  두면 「처음에 밀렸던 것」을 끝까지 먼저 만드는 엉뚱한 라인이 된다.
       */
      orderInfo: orderInfoOf(d.orders ?? [], {
        shipped: getShipped(),
        arrivedOf,
      }, elapsed),
    };
  };
}

/**
 * 한 판을 끝까지 굴리고, 볼 값을 뽑아 돌려준다.
 *
 *  @param d.seconds 시뮬 몇 초를 굴릴지
 *  @param d.world   `runMachines` 에 넘길 것들 (machines · equips · halted …)
 *                   **틱마다 다시 만들어야 하면** 함수로 준다
 *  @param d.pick    (…) => 값 — 이 판에서 무엇을 볼지. 없으면 처리량
 *  @param d.rand    난수
 *  @param d.shifts  교대표 — **쉬는 조**(주말·정기보전)가 있으면 그때는 안 돈다
 *  @param d.warmup  이 도면의 예열 시간(초) — 처리량을 언제부터 재나(`warmup.js`)
 */
export function runOnce(d = {}) {
  const seconds = Math.max(0, d.seconds ?? 600);
  const rand = d.rand ?? Math.random;
  const step = d.step ?? STEP;

  resetRun();
  /* **예열은 도면이 정한다** — `resetRun` 이 바닥값으로 되돌리므로 그 뒤에 넣는다.
     화면 쪽은 씬이 같은 값을 넣는다(두 길이 같은 시점부터 재야 한다) */
  if (d.warmup > 0) setWarmup(d.warmup);
  d.flow?.reset();
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    const w = typeof d.world === 'function' ? d.world(i * step) : (d.world ?? {});
    /**
     * **쉬는 시간이면 이 걸음은 통째로 넘긴다** — 주말 · 야간 · 정기보전.
     *  화면 쪽은 시계(`clock.js`)가 같은 판정을 해서 벨트·카트까지 세운다.
     *  여기서 안 보면 반복 실행만 주말에도 돌아, 화면과 표가 갈린다.
     */
    const closed = isClosedAt(d.shifts ?? [], i * step);
    runMachines(step, { ...w, rand, closed });
    if (closed) continue;
    /* 만든 것을 **옮긴다** — 이것이 없으면 출력 자리가 차서 전부 막히고,
       밖으로 나간 것이 없어 처리량이 구조적으로 0 이 된다 */
    d.flow?.move(step, w);
  }
  return d.pick ? d.pick() : getRan();
}

/**
 * **여러 판**을 돌려 평균과 신뢰구간을 낸다.
 *
 *  @param d.reps  몇 판. 기본 10 — 30분 시뮬 열 판이 1초 남짓이다
 *  @param d.seed  씨앗. 배치 둘을 견줄 때 **같은 값**을 주면 같은 난수를 먹는다
 *  @returns { runs, ...stats }
 */
export function replicate(d = {}) {
  const reps = Math.max(1, Math.round(d.reps ?? 10));
  const seed = d.seed ?? 1;
  const runs = [];
  for (let r = 0; r < reps; r++) {
    /* 판마다 씨앗을 옮긴다 — 같은 씨앗으로 열 번 돌리면 같은 판을 열 번 보는
       것이라 편차가 0 으로 나온다. 대신 **씨앗을 정하는 규칙**이 같으므로
       배치 A 와 B 는 r 번째 판에서 같은 난수를 먹는다. */
    runs.push(runOnce({ ...d, rand: seeded(seed + r * 7919) }));
  }
  return { runs, ...stats(runs) };
}

/** 「412 ± 18」 — 화면과 보고서가 같은 모양으로 쓴다 */
export const ciText = (s, digits = 1) => {
  if (!s?.n) return '—';
  if (s.n === 1) return `${s.mean.toFixed(digits)} (한 판)`;
  return `${s.mean.toFixed(digits)} ± ${s.half.toFixed(digits)}`;
};
