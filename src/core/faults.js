/**
 * =============================================================================
 *  고장과 수리 — 설비가 스스로 서는 시간
 * =============================================================================
 *  지금까지 설비가 서는 이유는 하나뿐이었다: **보낼 곳이 가득 참**(blocked).
 *  실제 공장에서 라인을 세우는 더 큰 이유는 고장이다. 그리고 이 둘은 **성격이
 *  다르다** — 막힘은 배치를 고쳐 풀 수 있지만, 고장은 설비 자체의 성질이다.
 *  OEE 가 가동률과 성능을 나누어 세는 이유가 정확히 이것이다.
 *
 *      가동률(Availability)  고장으로 못 돈 시간을 뺀 비율
 *      성능(Performance)     돌 수 있었는데 막혀서 못 돈 시간을 뺀 비율
 *      양품률(Quality)       만든 것 중 쓸 수 있는 것의 비율
 *
 *  ── 언제 고장 나는가 ──────────────────────────────────────────────────────
 *  설비마다 **평균 고장 간격(MTBF)** 과 **평균 수리 시간(MTTR)** 을 준다. 고장을
 *  주기로 두면(정확히 600초마다) 여러 대가 박자를 맞춰 서서 실제와 다른 그림이
 *  나오므로, 지수분포로 뽑는다 — dt 동안 고장 날 확률은 `1 − e^(−dt/MTBF)`.
 *  "지금까지 잘 돌았으니 곧 고장 날 때가 됐다" 가 성립하지 않는(무기억) 모델이라,
 *  설비 여러 대가 제각각 서고 제각각 복구된다.
 *
 *  MTBF 가 0 이면 고장이 없는 설비다(기본값) — 이미 그린 도면이 갑자기 서면 안 된다.
 * ---------------------------------------------------------------------------
 */

import { useSyncExternalStore } from 'react';

/** 설비 하나의 기본값 — 고장 없음 */
export const FAULT_DEFAULTS = { mtbf: 0, mttr: 300, scrapRate: 0 };

/** 인스펙터 슬라이더 범위 */
export const MTBF_RANGE = [0, 7200, 60];      // 0(없음) ~ 2시간
export const MTTR_RANGE = [10, 1800, 10];     // 10초 ~ 30분
export const SCRAP_RANGE = [0, 0.3, 0.005];   // 0 ~ 30%

let down = {};        // uid → 남은 수리 시간(초). 키가 있으면 고장 중이다
let downAcc = {};     // uid → 고장으로 선 누적 시간(초)
let repairs = {};     // uid → 고장 횟수

const subs = new Set();
const EMPTY = {};
const NOTIFY_MS = 250;
let lastNotify = 0;

const emit = () => subs.forEach((f) => f());
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const isDown = (uid) => down[uid] > 0;
export const getDown = () => down;
export const getDownAcc = () => downAcc;
export const downTimeOf = (uid) => downAcc[uid] ?? 0;
export const repairsOf = (uid) => repairs[uid] ?? 0;

export function resetFaults() {
  down = {};
  downAcc = {};
  repairs = {};
  lastNotify = 0;
  emit();
}

/** 도면에서 사라진 설비의 기록은 들고 있을 이유가 없다 */
export function pruneFaults(aliveUids) {
  const keep = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => aliveUids.has(k)));
  down = keep(down);
  downAcc = keep(downAcc);
  repairs = keep(repairs);
}

/**
 * 한 프레임 — 고장 낼 것은 내고, 수리 중인 것은 시간을 깎는다.
 *  @param equips [{ uid, mtbf, mttr }]
 *  @returns 이번 프레임에 고장으로 서 있던 설비 Set (지표가 이걸 적분한다)
 */
export function stepFaults(dt, equips) {
  if (!(dt > 0) || !equips?.length) return EMPTY_SET;

  let nextDown = null;
  let nextAcc = null;
  let nextRepairs = null;
  const nowDown = new Set();

  for (const e of equips) {
    let remain = down[e.uid] ?? 0;

    /* 서 있지 않으면 이번 프레임에 고장 날지 뽑는다.
       무기억 — 지금까지 얼마나 돌았는지와 무관하게 매 순간 같은 확률이다. */
    if (remain <= 0) {
      const mtbf = e.mtbf ?? 0;
      if (!(mtbf > 0)) continue;                       // 고장 없는 설비
      if (Math.random() >= 1 - Math.exp(-dt / mtbf)) continue;
      remain = Math.max(1, e.mttr ?? FAULT_DEFAULTS.mttr);
      nextRepairs = nextRepairs ?? { ...repairs };
      nextRepairs[e.uid] = (nextRepairs[e.uid] ?? 0) + 1;
    }

    /* 여기까지 온 것은 **이번 프레임에 서 있는** 설비다 — 고장이 난 바로 그
       프레임도 포함한다. 예전에는 고장 난 프레임을 빼먹어서 수리 시간이 10초인데
       9초만 쌓였고, 고장 직후에 물어보면 "아직 0초" 라고 답했다.

       남은 수리 시간보다 더 세지 않는다(마지막 프레임이 길어도 총합은 MTTR). */
    nowDown.add(e.uid);
    nextAcc = nextAcc ?? { ...downAcc };
    nextAcc[e.uid] = (nextAcc[e.uid] ?? 0) + Math.min(dt, remain);

    const left = remain - dt;
    nextDown = nextDown ?? { ...down };
    if (left > 0) nextDown[e.uid] = left;
    else delete nextDown[e.uid];
  }

  if (nextDown) down = nextDown;
  if (nextAcc) downAcc = nextAcc;
  if (nextRepairs) repairs = nextRepairs;

  if (nextDown || nextRepairs) {
    const now = performance.now();
    if (now - lastNotify >= NOTIFY_MS) {
      lastNotify = now;
      emit();
    }
  }
  return nowDown;
}

const EMPTY_SET = new Set();

export const useFaults = () => useSyncExternalStore(subscribe, getDown, () => EMPTY);

/* --------------------------------------------------------------------------
 * 불량
 * --------------------------------------------------------------------------
 *  설비가 만든 것 중 일부는 쓸 수 없다. 불량품은 **쌓이지 않고 버려진다** —
 *  적치대에 넣으면 그 자리를 차지해 라인이 서게 되는데, 실제로는 라인 밖으로
 *  빠지는 것이 보통이다. 대신 몇 개가 버려졌는지를 세어 양품률로 돌려준다.
 */
let made = 0;
let scrapped = 0;
/** 설비마다 따로 — 불량은 **만든 설비의** 문제다 (screen 주석 참고) */
let madeBy = {};
let scrappedBy = {};

/**
 * 만든 것 중 쓸 수 있는 것만 골라낸다.
 * ---------------------------------------------------------------------------
 *  **누가 만들었는지도 같이 센다.** 처음에는 라인 전체 합만 두었더니, 설비
 *  하나의 불량률을 올리자 **아무 상관 없는 설비들의 OEE 까지 같이 떨어졌다** —
 *  OEE 의 품질 항이 전부 같은 전역 값을 보고 있었기 때문이다.
 *
 *  불량은 만든 설비의 문제다. 옆 설비가 대신 뒤집어쓰면 「어디를 손볼까」 가
 *  통째로 어긋난다.
 *
 *  @param uid 만든 설비. 없으면 라인 합계에만 들어간다
 *  @returns 이번에 실제로 쓸 수 있는(양품) 개수
 */
export function screen(count, scrapRate, uid = null) {
  const n = Math.max(0, Math.round(count));
  if (!n) return 0;
  const rate = Math.min(1, Math.max(0, scrapRate ?? 0));
  let bad = 0;
  for (let i = 0; i < n; i++) if (Math.random() < rate) bad++;
  made += n;
  scrapped += bad;
  if (uid) {
    madeBy = { ...madeBy, [uid]: (madeBy[uid] ?? 0) + n };
    if (bad) scrappedBy = { ...scrappedBy, [uid]: (scrappedBy[uid] ?? 0) + bad };
  }
  if (bad) {
    const now = performance.now();
    if (now - lastNotify >= NOTIFY_MS) { lastNotify = now; emit(); }
  }
  return n - bad;
}

export const getMade = () => made;
export const getScrapped = () => scrapped;
export const madeOf = (uid) => madeBy[uid] ?? 0;
export const scrappedOf = (uid) => scrappedBy[uid] ?? 0;

/** 라인 전체 양품률 — 배치끼리 견줄 때 쓴다(scenarios) */
export const quality = () => (made > 0 ? 1 - scrapped / made : 1);

/**
 * **그 설비의** 양품률.
 *  아직 아무것도 안 만들었으면 1 로 본다 — 0 으로 두면 방금 놓은 설비와
 *  재료를 안 쓰는 설비가 전부 「불량 100%」 로 보인다.
 */
export const qualityOf = (uid) => {
  const n = madeBy[uid] ?? 0;
  return n > 0 ? 1 - (scrappedBy[uid] ?? 0) / n : 1;
};

export function resetQuality() {
  made = 0;
  scrapped = 0;
  madeBy = {};
  scrappedBy = {};
  emit();
}
