/**
 * =============================================================================
 *  성과 지표 — 돌려 본 결과를 숫자로
 * =============================================================================
 *  도면을 그리는 것만으로는 "이 배치가 나은가" 를 말할 수 없다. 상용 시뮬레이터가
 *  파는 것은 형상이 아니라 **처리량 · 재공 · 가동률 · 병목** 네 숫자다. 여기서도
 *  같은 것을 센다.
 *
 *  ── 병목은 이미 계산하고 있었다 ───────────────────────────────────────────
 *  적치대가 가득 차면 그 벨트가 서고 상류 설비가 줄줄이 멈춘다(EditorScene 의
 *  `halted`). 그 값은 화면에도 숫자에도 쓰이지 않고 매 프레임 버려지고 있었다.
 *  **시간으로 적분하면 그대로 가동률**이 된다 — "이 설비는 전체 시간의 42% 를
 *  막혀서 서 있었다". 그리고 가장 오래 막힌 설비가 곧 병목이다.
 *
 *  ── 왜 store 가 아니라 여기인가 ───────────────────────────────────────────
 *  이 값들은 **도면이 아니다.** 되돌리기 대상도, 저장 대상도 아니고, 프레임마다
 *  바뀐다. 도면 상태(store)에 섞으면 지표 하나가 움직일 때마다 히스토리와 자동
 *  저장이 따라 움직인다. simStore 와 같은 이유로 밖에 둔다.
 * ---------------------------------------------------------------------------
 */

import { useSyncExternalStore } from 'react';

/** 추이 그래프를 위해 남기는 표본 간격(시뮬 초)과 최대 개수 */
const SAMPLE_SEC = 10;
const MAX_SAMPLES = 360;

let ran = 0;                 // 시뮬레이션이 실제로 돈 시간(초)
let blocked = {};            // 설비 uid → 막혀서 서 있던 누적 시간(초)
let series = [];             // [{ t, shipped }] — 시간축 추이
let lastSample = 0;

const subs = new Set();
const EMPTY = {};

const NOTIFY_MS = 250;
let lastNotify = 0;

const emit = () => subs.forEach((f) => f());
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

/**
 * 프레임마다 — 흘린 시뮬 시간과 **지금 막혀 있는 설비들**을 넘긴다.
 *  @param haltedUids Set<uid> · 막혀서 서 있는 설비
 *  @param shipped    지금까지의 출하 총량 (추이 표본용)
 */
export function accumulate(dt, haltedUids, shipped) {
  if (!(dt > 0)) return;
  ran += dt;
  if (haltedUids?.size) {
    const next = { ...blocked };
    for (const uid of haltedUids) next[uid] = (next[uid] ?? 0) + dt;
    blocked = next;
  }

  /* 추이는 촘촘히 남길 필요가 없다 — 10 시뮬초에 하나면 그래프로 충분하고,
     오래 돌려도 표본이 무한정 늘지 않는다 */
  if (ran - lastSample >= SAMPLE_SEC) {
    lastSample = ran;
    series = [...series, { t: ran, shipped }].slice(-MAX_SAMPLES);
  }

  const now = performance.now();
  if (now - lastNotify >= NOTIFY_MS) {
    lastNotify = now;
    emit();
  }
}

export function resetMetrics() {
  ran = 0;
  blocked = {};
  series = [];
  lastSample = 0;
  lastNotify = 0;
  emit();
}

export const getRan = () => ran;
export const getBlocked = () => blocked;
export const getSeries = () => series;

/**
 * 설비 하나의 가동률 — 막히지 않고 돈 시간의 비율.
 *  아직 아무것도 안 돌았으면 1(100%)로 본다. 0으로 두면 방금 놓은 설비가
 *  전부 "고장" 처럼 보인다.
 */
export const uptimeOf = (uid) => (ran > 0 ? 1 - Math.min(1, (blocked[uid] ?? 0) / ran) : 1);

/**
 * 병목 — 가장 오래 막혀 있던 설비.
 *  막힌 시간이 아예 없으면 병목이 없는 것이다(라인이 흐르고 있다).
 */
export function bottleneck() {
  let uid = null;
  let worst = 0;
  for (const [k, v] of Object.entries(blocked)) {
    if (v > worst) { worst = v; uid = k; }
  }
  if (!uid || ran <= 0) return null;
  return { uid, blocked: worst, ratio: Math.min(1, worst / ran) };
}

/** 시간당 처리량 — 개수를 시뮬 시간으로 나눈 값 */
export const throughput = (shipped) => (ran > 0 ? (shipped * 3600) / ran : 0);

export const useMetrics = () =>
  useSyncExternalStore(subscribe, () => blocked, () => EMPTY);
