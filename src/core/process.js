/**
 * =============================================================================
 *  공정 시간 — 설비가 한 개를 만드는 데 걸리는 시간
 * =============================================================================
 *  여기 오기 전까지 이 도구에는 **설비의 시간이 없었다.** 생산 속도가 이렇게
 *  나왔다:
 *
 *      개/분 = 60 ÷ (벨트 간격 ÷ 벨트 속도)
 *
 *  설비의 능력이 아니라 **벨트 배선의 결과**다. 간격을 좁히면 그 기계가 갑자기
 *  빨라지고, 카트만 드나드는 설비는 카트가 올 때마다 그 자리에서 즉시 만들어
 *  냈다(시간 0). 그래서 답할 수 없는 질문이 줄줄이 있었다 —
 *  *어느 설비가 느린가, 택트를 맞추려면 몇 대가 필요한가, 버퍼는 왜 있어야 하나.*
 *
 *  이제 설비마다 **초/개**를 적는다. 공정표에 적히는 그 값 그대로다.
 *
 *  ── 재료는 **시작할 때** 낸다 ─────────────────────────────────────────────
 *   완성될 때 내면 만드는 12초 동안 재료가 창고에 그대로 있는 것으로 보인다.
 *   그 사이 카트가 와서 같은 재료를 집어 가면 없는 것을 두 번 쓰게 된다.
 *   실제로도 부품은 기계에 물리는 순간 재고에서 빠진다.
 *
 *  ── 진행률은 **알리지 않는다** ────────────────────────────────────────────
 *   남은 시간은 프레임마다 바뀐다. 이걸 simStore 에 넣고 emit 하면 화면 전체가
 *   초당 60번 다시 그려진다. 그래서 진행 중인 것은 여기 조용한 Map 에 두고,
 *   **한 개가 완성되는 순간에만** simStore 가 알린다(벨트 도착과 같은 빈도다).
 * ---------------------------------------------------------------------------
 */

/** 기본 공정 시간 (초/개) — 라이브러리 항목이 안 정했을 때 */
import { DEFAULT_SHAPE, drawShape, shapeOf as rShape } from './random.js';

export const DEFAULT_CYCLE = 6;

/** 인스펙터 슬라이더 범위 [최소, 최대, 눈금] (초/개) */
export const CYCLE_RANGE = [0.5, 120, 0.5];

/** 편차 상한 — ±50% 를 넘으면 "공정 시간" 이라 부를 수 없다 */
export const VAR_MAX = 0.5;

/** 이 설비의 공정 시간 (초/개). 자리마다 정하고, 없으면 라이브러리 항목의 값 */
export function cycleOf(placed, item) {
  const v = Number(placed?.cycleSec ?? item?.cycleSec ?? DEFAULT_CYCLE);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CYCLE;
}

/** 편차 비율 0~0.5 — 0.2 면 공정 시간이 ±20% 안에서 흔들린다 */
export function varOf(placed, item) {
  const v = Number(placed?.cycleVar ?? item?.cycleVar ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.min(VAR_MAX, Math.max(0, v));
}

/** 이 설비의 흔들림 **모양** — 안 고르면 예전 그대로(고르게) */
export const shapeOf = (placed, item) => rShape(placed?.varShape ?? item?.varShape);

/** 벨트 위 덩어리 사이의 최소 간격(m) — 이보다 붙으면 물건이 서로 겹쳐 보인다 */
export const MIN_GAP = 0.4;

/**
 * 설비 출력 자리 — **한 덩어리 + 한 개.**
 * ---------------------------------------------------------------------------
 *  처음에는 딱 한 덩어리치였다. 벨트가 한 번에 실어 가는 단위가 그것이니 더 둘
 *  이유가 없어 보였다. 그런데 그러면 **덩어리를 다 만든 순간부터 벨트 칸이 도착할
 *  때까지** 설비가 선다 — 멀쩡히 도는 라인이 1초에 한 번씩 붉게 깜빡였다.
 *
 *  한 칸만 더 주면 사라진다. 덩어리를 다 만든 뒤에도 **다음 한 개를 시작할 수
 *  있어서**, 그것을 만드는 동안 벨트 칸이 도착하기 때문이다. 실측(1분, 여러 설정):
 *
 *      자리 = 덩어리       1~4번 깜빡 · 목표치보다 적게 나옴
 *      자리 = 덩어리 + 1   0번        · 목표치 그대로
 *      자리 = 덩어리 × 2   0번        · 목표치 그대로   ← 더 둬도 나아지지 않는다
 *
 *  그래서 **딱 한 칸만** 더 준다. 두 배로 두면 화면의 「8개씩」과 「0/16」이 안
 *  맞아 사용자가 값이 두 배로 먹혔다고 읽고, 붙들려 있는 재고도 그만큼 는다.
 *
 *  실제 라인도 기계 출구에 짧은 어큐뮬레이터를 둔다 — 컨베이어 피치와 기계
 *  사이클이 딱 맞아떨어질 이유가 없기 때문이다. 붉게 서는 것은 이제 **정말로
 *  갈 곳이 없을 때**뿐이다.
 */
export const OUT_SPARE = 1;

/** 한 번에 내보내는 개수의 기본값 — 아무것도 안 적은 설비가 쓰는 값 */
export const DEFAULT_BUNDLE = 3;

/**
 * 이 설비가 한 번에 내보내는 개수.
 * ---------------------------------------------------------------------------
 *  **속성 이름은 `outputCount` 다.** 「층(layers)」 은 화면에서 부르는 말이고
 *  코드에 그런 필드는 없다 — 실제로 `p.layers` 를 읽는 코드를 두 군데 쓰는
 *  바람에 벨트 능력이 3배 낮게 나오고 따라 하기 단계가 안 넘어갔다.
 *  그래서 읽는 자리를 하나로 모은다.
 */
export const bundleOf = (p) => Math.max(1, Math.round(p?.outputCount ?? DEFAULT_BUNDLE) || 1);

/** 이 설비가 놓아 둘 수 있는 완성품 수 */
export function outputCapFor(layers, batch = 1) {
  const per = Math.max(1, Math.round(layers) || 1);
  const tray = Math.max(1, Math.round(batch) || 1);
  /**
   * **한 판이 나가는 동안 다음 판을 굽는다** — 그래서 판 두 개분이다.
   *  한 판치만 두면 오븐이 다 굽고도 앞판이 다 빠질 때까지 서 있어서, 60초에
   *  굽는 설비가 120초에 한 판씩 낸다(실측: 천장의 5%까지 떨어졌다).
   *
   *  거기에 **한 덩어리를 더** 얹는다. 판이 덩어리로 딱 나눠떨어지지 않으면
   *  자투리가 다음 판을 기다리며 자리를 물고 있어서, 그만큼 자리가 모자라면
   *  오븐이 다음 판을 못 건다 — 5개짜리 판에서 천장의 83% 밖에 안 나왔다.
   *  한 개짜리 설비에 자리를 하나 더 주는 것(`OUT_SPARE`)과 같은 이유다.
   */
  return tray > 1 ? tray * 2 + per : per + OUT_SPARE;
}

/** 초/개 → 개/분 */
export const perMinute = (sec) => (sec > 0 ? 60 / sec : 0);

/**
 * 이 설비가 **한 개**를 내는 데 걸리는 시간.
 *  공정 시간은 **한 판에** 드는 시간이라, 배치 설비는 판 크기로 나눠야 한다.
 *  벨트 간격도 이 값을 봐야 한다 — 안 그러면 20개를 한 번에 내는 오븐 뒤에
 *  600초짜리 간격이 잡혀 벨트가 텅 빈 채로 돈다.
 */
export const unitCycleOf = (placed, item) =>
  cycleOf(placed, item) / batchOf(placed, item);

/** 한 덩어리를 만드는 데 걸리는 시간(초) */
export const bundleSeconds = (cycleSec, layers) =>
  Math.max(0.01, cycleSec) * Math.max(1, Math.round(layers) || 1);

/**
 * 벨트 위 덩어리 간격 — **정하는 값이 아니라 따라 나오는 값이다.**
 * ---------------------------------------------------------------------------
 *  설비가 한 덩어리를 4초에 만드는데 벨트가 10초마다 지나가면, 설비는 6초를 그냥
 *  서 있는다. 반대로 벨트를 너무 촘촘히 하면 빈 칸이 먼저 지나가 버려 **오히려
 *  더 기다린다** — 3.5m 가 4.0m 보다 나쁜, 톱니처럼 오르내리는 함정이 생긴다
 *  (실측: 4.0m 114개/분 → 3.5m 65개/분).
 *
 *  그래서 사용자에게 슬라이더로 물어보지 않는다. 벨트가 **한 덩어리 만드는 시간에
 *  딱 한 번** 지나가도록 맞춘다.
 *
 *      간격 = 벨트속도 × (공정 시간 × 한 덩어리 개수)
 *
 *  이러면 벨트 능력이 설비 능력과 정확히 같아져서 어느 쪽도 낭비가 없다.
 *  설비가 아주 빠르면 계산값이 최소 간격보다 작아지는데, 그때는 **정말로 벨트가
 *  한계**다(물건을 더 붙여 실을 수가 없다).
 */
export function spacingFor(cycleSec, layers, speed) {
  const v = Math.max(0.01, Number(speed) || 0.6);
  return Math.max(MIN_GAP, v * bundleSeconds(cycleSec, layers));
}

/** 계산한 간격이 최소치에 걸렸는가 = 벨트가 한계인가 */
export const spacingClamped = (cycleSec, layers, speed) =>
  Math.max(0.01, Number(speed) || 0.6) * bundleSeconds(cycleSec, layers) < MIN_GAP - 1e-9;

/**
 * 이 벨트가 실어 낼 수 있는 개/분.
 *  간격이 자동으로 정해지므로 보통은 설비 능력과 같은 값이 나온다. 최소 간격에
 *  걸렸을 때만 이 값이 설비보다 작아지고, 그때가 벨트가 진짜 한계인 경우다.
 */
export function beltPerMinute(gap, speed, layers) {
  const g = Math.max(MIN_GAP, Number(gap) || 3);
  const v = Math.max(0.01, Number(speed) || 0.6);
  return (v / g) * 60 * Math.max(1, Math.round(layers) || 1);
}

/**
 * 이번 한 개의 편차 배수 — 1.0 이면 공정 시간 그대로, 0.8 이면 20% 빨리.
 *  **배수로 뽑는 이유**는 아래 `work` 주석 참고. 초로 못 박아 두면 공정 시간을
 *  바꿔도 걸려 있던 작업이 옛 시간을 그대로 쓴다.
 */
export function drawMult(ratio = 0, rand = Math.random, shape = DEFAULT_SHAPE) {
  return drawShape(Math.min(VAR_MAX, Math.max(0, ratio || 0)), rand, shape);
}

/** 이번 한 개에 실제로 걸리는 시간 — 편차는 균등분포 */
export function drawCycle(sec, ratio = 0, rand = Math.random) {
  const base = sec > 0 ? sec : DEFAULT_CYCLE;
  return Math.max(0.05, base * drawMult(ratio, rand));
}

/* --------------------------------------------------------------------------
 * 지금 만들고 있는 것 — 조용한 저장소
 * -------------------------------------------------------------------------- */

/**
 * uid → 지금 만들고 있는 한 개. 없으면 아직 안 걸었다.
 * ---------------------------------------------------------------------------
 *  `{ done, mult }` — done 은 **0~1 진행률**, mult 는 이번 개의 편차 배수다.
 *  이번 개에 걸리는 시간은 그때그때 `공정 시간 × mult` 로 다시 계산한다.
 *
 *  처음에는 **남은 시간을 초로** 들고 있었다. 그래서 공정 시간을 120초에서
 *  0.5초로 바꿔도 이미 걸려 있던 작업은 120초를 그대로 다 쓰고 나서야 새 값이
 *  먹혔다. 게이지도 그동안 멈춰 있었다 — `1 − 남은시간/0.5` 가 한참 음수라
 *  0% 에 붙어 버려서, 돌고 있는지조차 알 수 없었다.
 *
 *  진행률로 들고 있으면 둘 다 사라진다. 공정 시간을 줄이는 순간 남은 시간이
 *  **같은 비율만큼** 줄어 바로 반영되고, 게이지는 언제나 0~1 이라 멀쩡히 흐른다.
 */
const work = new Map();
/** 로트 전환 상태 — 남은 전환 시간 · 이번 로트에서 만든 개수 · 이번 틱에 쓴 시간 */
const setups = new Map();
const lots = new Map();
const took = new Map();
/** 지금 몇 번째 레시피를 만들고 있나 (품종 전환) */
const slots = new Map();
/** 판을 채우며 기다린 시간(초) — 배치 공정. 판을 걸면 0 으로 돌아간다 */
const waits = new Map();
/** 다시 만들려고 줄 세워 둔 개수 — 재작업 */
const redo = new Map();

/**
 * 이보다 적게 남았으면 끝난 것으로 본다 (1 나노초).
 * ---------------------------------------------------------------------------
 *  시간은 실수라 딱 떨어지는 법이 없다. 6초짜리 공정을 0.1초씩 60번 깎으면
 *  0 이 아니라 4.5e-14 가 남는다 — 그 티끌 때문에 완성이 **한 프레임씩 밀리고**,
 *  10개 나와야 할 것이 9개 나온다. 프레임이 잘수록 더 많이 샌다.
 */
const EPS = 1e-9;

/** 지금 만들고 있는 것이 있는가 */
export const hasWork = (uid) => work.has(uid);

/** 지금 만들고 있는 **한 개**의 진행률 0~1 (안 걸려 있으면 0) */
export function progressOf(uid) {
  const w = work.get(uid);
  return w ? Math.min(1, Math.max(0, w.done)) : 0;
}

/**
 * **다음 덩어리가 나갈 때까지**의 진행률 0~1 — 화면 게이지가 쓰는 값.
 * ---------------------------------------------------------------------------
 *  한 개짜리 진행률은 화면에서 뜻이 약하다. 8개씩 내보내는 설비라면 게이지가
 *  여덟 번 차올랐다 떨어지는 동안 벨트로는 아무것도 안 나간다 — 사용자가 보고
 *  싶은 것은 "언제 하나 나오나" 다.
 *
 *      (다 만든 개수 + 지금 만드는 한 개의 진행률) ÷ 한 덩어리 개수
 *
 *  가득 차면 **덩어리가 준비돼 벨트를 기다리는 중**이다. 그 상태가 오래 가면
 *  실어 갈 데가 없다는 뜻이고, 그때 게이지가 경고색으로 바뀐다.
 */
export function bundleProgress(uid, per, made) {
  const n = Math.max(1, Math.round(per) || 1);
  const done = Math.max(0, made ?? 0);
  return Math.min(1, Math.max(0, (done + progressOf(uid)) / n));
}

export function resetWork(uid = null) {
  if (uid == null) {
    work.clear(); setups.clear(); lots.clear(); took.clear(); slots.clear();
    waits.clear(); redo.clear();
  } else {
    work.delete(uid); setups.delete(uid); lots.delete(uid); took.delete(uid);
    slots.delete(uid); waits.delete(uid); redo.delete(uid);
  }
}

/**
 * 설비 하나를 한 프레임 굴린다.
 * ---------------------------------------------------------------------------
 *  @param dt       이번 프레임의 시뮬 시간(초)
 *  @param cycleSec 초/개
 *  @param cycleVar 편차 비율
 *  @param room     앞으로 몇 개까지 더 받아 둘 수 있는가 (출력 자리의 빈칸).
 *                  0 이면 **막힘** — 만들어 놓을 데가 없으니 시작도 안 한다
 *  @param pay      한 판분 재료를 내는 함수 `pay(n)` → 성공하면 true. 없으면 공급원
 *  @param avail    지금 재료로 **몇 개**를 만들 수 있나 (배치가 찼는지 본다)
 *  @param batch    한 판에 몇 개 — 1 이면 지금까지의 동작 그대로
 *  @param waitSec  판이 덜 찼을 때 더 기다리는 한도(초). 0 이면 안 기다린다
 *  @param check    만든 것 중 쓸 수 있는 개수를 돌려준다 `check(n, 재작업인가)`.
 *                  없으면 다 양품이다
 *  @param reworkSec 불량 한 개를 다시 만드는 데 드는 시간(초). 0 이면 **버린다**
 *  @param onRedo   재작업 줄에 넣은 개수를 알린다 (세는 쪽이 화면에 쓴다)
 *  @returns 이번 프레임에 나온 **양품 개수**
 *
 *  한 프레임에 여러 개가 끝날 수 있다(높은 배속·짧은 공정). 남는 시간을 버리지
 *  않고 다음 개로 이어 넣어야 배속을 올려도 처리량이 같다 — 배속마다 결과가
 *  달라지면 그 숫자는 아무 뜻이 없다.
 */
export function runMachine(uid, dt, {
  cycleSec, cycleVar = 0, room = 0, pay = null, rand = Math.random,
  lot = 0, setupSec = 0, shape = DEFAULT_SHAPE, kinds = 1,
  batch = 1, waitSec = 0, avail = null,
  check = null, reworkSec = 0, onRedo = null,
}) {
  took.set(uid, 0);
  if (!(dt > 0) || !(room > 0)) return 0;

  let t = dt;

  /**
   * **전환 중이면 아무것도 안 나온다.**
   *  자리가 없으면(`room <= 0`) 여기까지 오지도 않는다 — 막힌 설비가 「전환
   *  중」으로 보이면 정작 막힌 것이 화면에서 사라진다. 어차피 자리가 나야
   *  다음 로트를 시작하므로 미뤄도 값이 안 달라진다.
   */
  const left = setups.get(uid) ?? 0;
  if (left > 0) {
    const used = Math.min(t, left);
    t -= used;
    took.set(uid, used);
    if (left - used > EPS) { setups.set(uid, left - used); return 0; }
    setups.delete(uid);
  }

  let w = work.get(uid) ?? null;
  let done = 0;

  const many = Math.max(1, Math.round(batch) || 1);
  /** 이번 프레임에 나온 양품 — 돌려주는 값이다(`done` 은 자리 셈에 쓴다) */
  let good = 0;

  while (t > EPS && done < room) {
    if (w == null) {
      /**
       * **다시 만들 것이 있으면 그것부터.**
       * -----------------------------------------------------------------------
       *  규칙을 하나만 둔다 — 재작업품을 뒤로 미루는 공장도 있지만, 그러면
       *  「언제 처리하나」가 손잡이 하나 더가 되고 되풀이도 안 된다. 먼저 하면
       *  재작업 줄이 안 쌓여서 화면에서 읽기도 쉽다.
       *
       *  **재료는 안 든다** — 이미 물건이 되어 있고, 그것을 고치는 것이다.
       */
      const again = redo.get(uid) ?? 0;
      if (again > 0) {
        const n = Math.min(again, many);
        if (done + n > room) break;
        redo.set(uid, again - n);
        w = { n, again: true, done: 0, mult: drawMult(cycleVar, rand, shape) };
        continue;
      }
      /**
       * **판을 건다** — 몇 개를 얹을지 여기서 정한다.
       *  `avail` 이 없으면 옛 꼴(한 개짜리)이라 늘 꽉 찬 판이다.
       */
      const have = avail ? Math.max(0, Math.floor(avail())) : many;
      const n = trayOf(uid, have, many, waitSec);
      if (n <= 0) {
        /* 아직 못 건다. **재료가 좀 있는데** 안 걸었다면 그건 모으는 중이니
           남은 시간을 기다림으로 적는다 — 아예 없으면 그냥 굶은 것이다 */
        if (have > 0) waits.set(uid, (waits.get(uid) ?? 0) + t);
        break;
      }
      /* 낼 자리가 판만큼 없으면 시작도 안 한다 — 다 구워 놓고 못 내리면
         그 판이 어디에도 없이 사라진다(막힘으로 남는 것이 맞다) */
      if (done + n > room) break;
      if (pay && !pay(n)) break;
      waits.delete(uid);
      w = { n, done: 0, mult: drawMult(cycleVar, rand, shape) };
    }
    /* 이번 개에 걸리는 시간을 **매 프레임 다시 잰다** — 그래서 공정 시간을
       바꾸면 걸려 있던 것에도 바로 반영된다 */
    /* 재작업은 **제 시간**을 쓴다 — 처음부터 만드는 것보다 대개 짧다 */
    const base = w.again ? reworkSec * w.n : (cycleSec > 0 ? cycleSec : DEFAULT_CYCLE);
    const dur = Math.max(0.05, base * w.mult);
    const rest = (1 - w.done) * dur;
    if (rest > t + EPS) { w.done = Math.min(1, w.done + t / dur); t = 0; break; }
    t -= rest;
    /* 한 판은 **통째로** 끝난다 — 굽는 도중에 절반만 꺼낼 수 없다 */
    const made = w.n ?? 1;
    const wasRedo = !!w.again;
    w = null;

    /**
     * **만들 때 거른다.**
     *  불량품은 벨트를 안 탄다 — 실제로도 검사에서 걸러진 것을 굳이 실어
     *  보내지 않는다. 그리고 여기서 걸러야 **재작업으로 되돌릴 수 있다.**
     */
    const ok = check ? check(made, wasRedo) : made;
    const bad = made - ok;
    good += ok;
    done += ok;                                   // 자리를 먹는 것은 양품뿐이다
    /* 다시 만들 수 있으면 줄에 세운다. **재작업품이 또 불량이면 버린다** —
       안 그러면 불량률을 아무리 올려도 양품률이 100% 가 된다 */
    if (bad > 0 && reworkSec > 0 && !wasRedo) {
      redo.set(uid, (redo.get(uid) ?? 0) + bad);
      onRedo?.(bad);
    }

    /**
     * 로트를 채웠으면 **다음 품종으로 넘어간다.**
     *  품종이 하나뿐이면 넘어갈 데가 없다 — 그때도 시간을 물리는 것은 날 갈기·
     *  청소라서 맞다(로트 전환). 품종이 여럿이면 **바뀌는 그 순간**이 셋업이다.
     */
    if (lot > 0) {
      /* 로트는 **개수로** 센다. 한 판이 로트를 넘겨도 전환은 **한 번만**
         문다 — 넘긴 만큼 여러 번 물리면 굽지도 않은 판의 전환을 세게 된다.
         (그래서 배치 설비의 로트는 판 크기의 배수로 잡는 것이 자연스럽다) */
      const n = (lots.get(uid) ?? 0) + (wasRedo ? 0 : made);
      if (n >= lot) {
        lots.set(uid, 0);
        const many = Math.max(1, Math.round(kinds));
        if (many > 1) slots.set(uid, (slotOf(uid) + 1) % many);
        if (setupSec > 0) {
          const use = Math.min(t, setupSec);
          t -= use;
          took.set(uid, (took.get(uid) ?? 0) + use);
          if (setupSec - use > EPS) { setups.set(uid, setupSec - use); break; }
        }
      } else {
        lots.set(uid, n);
      }
    }
  }

  if (w == null) work.delete(uid);
  else work.set(uid, w);
  return good;
}


/* ==========================================================================
 *  배치 공정 — **N개를 한 판에 굽는다**
 * --------------------------------------------------------------------------
 *  오븐 · 도장 부스 · 열처리로 · 세척기. 이런 설비는 한 개씩 흘려보내지 않고
 *  **한 판을 모아 한 번에** 처리한다. 20개를 600초에 구우면 개당 30초다 —
 *  「600초짜리 설비」로 적으면 처리량이 스무 배 틀린다.
 *
 *  ── 공정 시간은 **한 판에** 드는 시간이다 ────────────────────────────────
 *  판이 20개든 1개든 굽는 시간은 같다. 그래서 배치가 클수록 개당 시간이 싸진다:
 *
 *      개당 = 공정 ÷ 판 크기        600초 ÷ 20개 = 30초/개
 *
 *  **천장(`balance.js`)이 이 값을 써야 한다.** 안 쓰면 「돌리기 전 계산」과
 *  「돌려 본 결과」가 스무 배로 갈린다.
 *
 *  ── 덜 찬 판을 어떻게 하나 — **기다림 한도** ──────────────────────────────
 *  「꽉 차야 굽는다」로 두면 라인이 통째로 선다. 앞 공정이 느려서 20개가 영영
 *  안 모이면 오븐은 영원히 안 돌고, 화면에는 **멀쩡해 보이는 설비가 아무것도
 *  안 하는** 그림만 남는다. 품종 전환의 자투리와 같은 함정이다.
 *
 *  그래서 기다림 한도 T 를 둔다:
 *
 *      T = 0    안 기다린다 — **있는 만큼** 굽는다
 *      T > 0    판이 차거나 T초가 지나면 굽는다
 *
 *  **0 이 기본이고, 그것으로도 배치는 제 노릇을 한다.** 오븐이 병목이면 굽는
 *  동안 앞에 재료가 쌓여서 다음 판은 저절로 꽉 찬다 — 스스로 균형을 잡는다.
 *  T 를 주는 것은 재료가 띄엄띄엄 올 때 **굽는 횟수를 줄이려는** 선택이다.
 *
 *  기다리는 시간은 **굶음으로 센다.** 서 있는 이유를 가르는 잣대는 늘 같다 —
 *  푸는 방법이 다른가. 판을 못 채워 기다리는 것은 앞 공정을 빠르게 하거나 판을
 *  줄여서 푼다. 재료가 없어 서 있는 것과 처방이 같으니 같은 자리에 센다.
 * ======================================================================== */

/** 한 판에 몇 개 — 1 이면 지금까지의 동작 그대로 (이미 그린 도면이 안 바뀐다) */
export const BATCH_RANGE = [1, 50, 1];
/** 덜 찬 판을 두고 더 기다리는 한도(초) */
export const BATCH_WAIT_RANGE = [0, 600, 10];

export const batchOf = (placed, item) =>
  Math.max(1, Math.round(Number(placed?.batchSize ?? item?.batchSize ?? 1) || 1));

export const batchWaitOf = (placed, item) =>
  Math.max(0, Math.round(Number(placed?.batchWaitSec ?? item?.batchWaitSec ?? 0) || 0));

/**
 * 이번에 판에 몇 개를 얹나 — 0 이면 아직 못 건다.
 * ---------------------------------------------------------------------------
 *  `runMachine` 과 `haltState` 가 **같은 이 함수**를 본다. 두 곳이 각자
 *  판단하면 「굶었다고 빨갛게 칠해 놓고 굽고 있는」 화면이 나온다.
 *  읽기만 하므로 굶음 판정이 기다린 시간을 건드리지 않는다.
 */
export function trayOf(uid, have, batch = 1, waitSec = 0) {
  const many = Math.max(1, Math.round(batch) || 1);
  if (have >= many) return many;                    // 꽉 찼다
  if (have <= 0) return 0;                          // 재료가 아예 없다
  if (waitSec <= 0) return have;                    // 안 기다린다 — 있는 만큼
  return (waits.get(uid) ?? 0) >= waitSec ? have : 0;
}

/** 판을 채우며 기다린 시간(초) — 화면이 「몇 초째 모으는 중」을 말한다 */
export const batchWaited = (uid) => waits.get(uid) ?? 0;

/** 다시 만들려고 줄 서 있는 개수 — 화면이 「밀린 재작업」을 말한다 */
export const redoWaiting = (uid) => redo.get(uid) ?? 0;

/* ==========================================================================
 *  로트 전환 (셋업)
 * --------------------------------------------------------------------------
 *  설비는 계속 같은 것만 뽑지 않는다. 몇 개 만들고 나면 **날을 갈고, 금형을
 *  바꾸고, 청소를 한다.** 그동안은 아무것도 안 나온다. 상용 시뮬레이터가
 *  전부 갖고 있는 것이고, 다품종 공장에서는 **이것이 진짜 병목인 경우가 흔하다.**
 *
 *  ── 「로트 전환」인가 「품종 전환」인가 — **품종 수가 정한다** ─────────────
 *  설비가 품종을 하나만 들면 로트를 채워도 바꿀 것이 없다. 그때 드는 것은 날
 *  갈기 · 금형 교체 · 청소이고, 그건 품종과 상관없이 든다 — **「로트 전환」**이다.
 *  품종을 여럿 들면(`recipes`) 로트를 채울 때마다 다음 품종으로 넘어가고,
 *  그때 비로소 **「품종 전환」**이 된다. 화면의 이름도 그것을 따라간다.
 *
 *  **이름을 정직하게 붙이는 것이 중요하다.** 품종이 하나뿐인 모델에서
 *  「품종 전환」이라고 부르면 화면이 거짓말을 하는 것이다.
 *
 *  ── 이 시간은 어디로 가나 — **가동률(A)** ─────────────────────────────────
 *  서는 이유를 가르는 잣대는 늘 같았다: **푸는 방법이 다른가.**
 *
 *      고장   정비로 푼다          → 가동률 A
 *      무인   인력으로 푼다        → 가동률 A
 *      전환   로트를 키우거나      → 가동률 A   ← 새로 생긴 것
 *             빠르게 바꿔서(SMED)
 *      막힘   배치로 푼다          → 성능 P
 *      굶음   상류로 푼다          → 성능 P
 *
 *  셋업은 「돌 수 있었는데 못 돈」 시간이 아니라 **애초에 못 도는** 시간이라
 *  고장·무인과 같은 자리에 선다.
 * ======================================================================== */

/** 몇 개마다 전환하나 — 0 이면 전환 없음 (이미 그린 도면이 안 바뀐다) */
export const LOT_RANGE = [0, 500, 1];
/** 전환 한 번에 몇 초 */
export const SETUP_RANGE = [0, 3600, 10];

export const lotOf = (placed, item) =>
  Math.max(0, Math.round(Number(placed?.lotSize ?? item?.lotSize ?? 0) || 0));

export const setupOf = (placed, item) =>
  Math.max(0, Math.round(Number(placed?.setupSec ?? item?.setupSec ?? 0) || 0));

/**
 * **양품 한 개를 내는 데 걸리는 시간.**
 *  천장(`balance.js`)이 이 값을 써야 한다 — 안 쓰면 「돌리기 전 계산」과
 *  「돌려 본 결과」가 갈리고, 사람은 시뮬이 틀렸다고 여긴다.
 *
 *      20개마다 300초 전환 · 공정 6초  →  6 + 300/20 = 21초/개
 *
 *  로트가 작을수록 전환이 비싸진다는 것이 이 한 줄에 그대로 들어 있다.
 *
 *  ── **불량과 재작업도 여기 든다** ────────────────────────────────────────
 *  열 개 만들어 하나를 버리면 **양품 한 개에 드는 시간은 늘어난다.** 그동안
 *  천장이 그걸 몰라서, 불량률만 올려도 「천장 600 · 실제 544」처럼 갈렸다.
 *
 *      버릴 때        공정 ÷ (1 − 불량률)
 *      다시 만들 때   (공정 + 불량률 × 재작업) ÷ (1 − 불량률²)
 *
 *  재작업품도 같은 불량률을 다시 통과하므로 끝내 버리는 것은 불량률의 제곱이다.
 *  잰 값과 맞는다 — 공정 6초 · 불량 10% · 재작업 30초면 9.09초/개(실측 9.3).
 */
export const effectiveCycle = (cycleSec, lot = 0, setupSec = 0, batch = 1, opt = {}) => {
  /* 공정 시간은 **한 판에** 드는 시간이다 — 판 크기로 나눠야 개당이 된다.
     전환은 개수로 세므로(로트 N개마다) 나누지 않는다 */
  const per = cycleSec / Math.max(1, Math.round(batch) || 1);
  const work = per + (lot > 0 && setupSec > 0 ? setupSec / lot : 0);

  const bad = Math.min(1, Math.max(0, Number(opt.scrap) || 0));
  if (bad <= 0) return work;
  const redo = Math.max(0, Number(opt.reworkSec) || 0);
  /* 다시 만들면 그 시간이 들고, 끝내 버리는 것은 두 번 연속 불량뿐이다 */
  const spend = work + (redo > 0 ? bad * redo : 0);
  const yield_ = redo > 0 ? 1 - bad * bad : 1 - bad;
  return yield_ > 0 ? spend / yield_ : spend;
};

/**
 * 불량 한 개를 다시 만드는 데 드는 시간(초) — **0 이면 버린다**(지금까지의 동작).
 *  기본이 0 이라 이미 그린 도면은 하나도 안 바뀐다.
 */
export const REWORK_RANGE = [0, 600, 5];

export const reworkOf = (placed, item) =>
  Math.max(0, Math.round(Number(placed?.reworkSec ?? item?.reworkSec ?? 0) || 0));

/** 지금 전환 중인가 · 이번 틱에 전환으로 쓴 시간(초) */
export const inSetup = (uid) => (setups.get(uid) ?? 0) > 0;
export const setupTook = (uid) => took.get(uid) ?? 0;
/** 이번 로트에서 몇 개나 만들었나 (화면이 「다음 전환까지」를 말한다) */
export const lotMade = (uid) => lots.get(uid) ?? 0;


/* ==========================================================================
 *  품종 전환 — **여러 가지를 번갈아 만든다**
 * --------------------------------------------------------------------------
 *  로트 전환은 「N개마다 T초 쉰다」였다. 바꿀 품종이 없었기 때문이다. 이제
 *  설비가 레시피를 여럿 가질 수 있으니(`recipesOf`) **진짜 품종 전환**이 된다.
 *
 *  ── 언제 바꾸나 — **로트를 채우면** ──────────────────────────────────────
 *  「N개 만들고 다음 품종으로」. 규칙을 하나만 두는 이유가 있다.
 *
 *    · 실제로 많은 공장이 그렇게 돈다 — 품종별 로트를 정해 놓고 순환
 *    · **도면만 보고 읽힌다.** 「20개씩 번갈아」는 한 줄로 설명되지만,
 *      「하류가 모자란 것을 만든다」는 왜 그 순서인지 화면에서 알 수가 없다
 *    · 순서가 정해져 있어 **되풀이할 수 있다** — 반복 실행이 이것에 기댄다
 *
 *  로트를 안 정하면(0) 안 바꾼다 — 첫 레시피만 계속 만든다. 이미 그린 도면이
 *  안 바뀐다.
 *
 *  ── **바뀔 때만** 전환 시간을 문다 ────────────────────────────────────────
 *  품종이 하나뿐이면 로트를 채워도 바꿀 것이 없다. 그때도 시간을 물리면
 *  「전환할 것이 없는데 전환한다」가 된다 — 그래서 `next !== now` 일 때만 문다.
 *  (품종이 하나인 설비는 예전처럼 「N개마다 쉰다」로 남는다. 날 갈기·청소가
 *  그것이고, 그건 품종과 상관없이 든다.)
 * ======================================================================== */

/** 지금 몇 번째 레시피를 만들고 있나 */
export const slotOf = (uid) => slots.get(uid) ?? 0;