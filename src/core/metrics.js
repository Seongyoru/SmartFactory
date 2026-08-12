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
import { downTimeOf, quality } from './faults.js';

/** 추이 그래프를 위해 남기는 표본 간격(시뮬 초)과 최대 개수 */
const SAMPLE_SEC = 10;
const MAX_SAMPLES = 360;

let ran = 0;                 // 시뮬레이션이 실제로 돈 시간(초)
let blocked = {};            // 설비 uid → 막혀서 서 있던 누적 시간(초)
let series = [];             // [{ t, shipped }] — 시간축 추이
let lastSample = 0;

/**
 * 이번 실행이 시작될 때의 출하 누계.
 * ---------------------------------------------------------------------------
 *  처리량은 **개수 ÷ 시간** 인데, 둘의 시작점이 다르면 값이 터무니없어진다.
 *  「다시 재기」로 시간만 0 으로 되돌리면 이미 나간 450개가 분자에 그대로 남아,
 *  0.3초 만에 570만 개/시간 같은 숫자가 나온다.
 *
 *  출하 누계 자체를 지울 수는 없다 — 그건 이 도면이 지금까지 만들어 낸 성과이고,
 *  선반의 재고처럼 시뮬레이션이 이어 가는 값이다. 대신 **이번 실행이 시작될 때의
 *  값을 기준으로 잡아** 그 뒤로 늘어난 만큼만 센다.
 */
let shippedStart = null;

/** 이번 실행 동안 나간 개수 */
export const producedInRun = (shipped) =>
  Math.max(0, (shipped ?? 0) - (shippedStart ?? shipped ?? 0));

/**
 * 처리량이 뜻을 갖기까지 필요한 최소 시간(시뮬 초).
 *  갓 시작한 순간에는 몇 초 만에 한 개만 나가도 수천 개/시간이 된다. 라인이
 *  채워지기 전의 숫자는 견줄 값이 아니므로 아예 내놓지 않는다.
 */
export const WARMUP = 10;

const subs = new Set();

/**
 * 무엇이 바뀌었는지가 아니라 **바뀌었다는 사실**만 알린다.
 * ---------------------------------------------------------------------------
 *  처음에는 막힘 목록(blocked)을 그대로 스냅샷으로 썼다. 그런데 아무 데도 안
 *  막히면 그 값이 영영 그대로라, 시간이 흐르고 처리량이 쌓여도 화면이 갱신되지
 *  않았다 — 라인이 잘 도는 도면일수록 성적표가 안 뜨는 셈이었다.
 *  값이 아니라 판을 세면 그런 일이 없다.
 */
let version = 0;

const NOTIFY_MS = 250;
let lastNotify = 0;

const emit = () => { version++; subs.forEach((f) => f()); };
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
  /* 이번 실행의 기준점 — 분자와 분모가 같은 순간에서 출발해야 한다 */
  if (shippedStart === null) shippedStart = shipped ?? 0;
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
    series = [...series, { t: ran, shipped: producedInRun(shipped) }].slice(-MAX_SAMPLES);
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
  shippedStart = null;
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

/**
 * 시간당 처리량 — **이번 실행에** 나간 개수를 **이번 실행이 돈** 시간으로 나눈다.
 *  분자와 분모의 시작점이 같아야 한다(위 shippedStart 참고).
 *  아직 데울 시간(WARMUP)이 안 됐으면 null 을 돌려준다 — 화면이 「측정 중」이라고
 *  말할 수 있게. 라인이 채워지기 전의 숫자는 견줄 값이 아니다.
 */
export function throughput(shipped) {
  if (ran < WARMUP) return null;
  return (producedInRun(shipped) * 3600) / ran;
}

/**
 * OEE — 설비종합효율.
 * ---------------------------------------------------------------------------
 *  현장에서 라인을 평가하는 표준 지표다. 세 가지를 **곱한다** — 하나만 나빠도
 *  전체가 무너진다는 뜻이고, 그래서 어디를 손봐야 하는지가 드러난다.
 *
 *    가동률 A = 1 − 고장으로 선 시간 / 전체 시간
 *               설비 자체가 못 돈 시간. 정비로 푼다
 *    성능   P = 1 − 막혀서 선 시간 / (돌 수 있었던 시간)
 *               돌 수 있었는데 보낼 곳이 없어 못 돈 시간. **배치로 푼다**
 *    양품률 Q = 1 − 불량 / 만든 것
 *               만들긴 했는데 못 쓰는 것. 공정으로 푼다
 *
 *  성능의 분모가 전체 시간이 아니라 **고장 시간을 뺀 시간**인 것이 중요하다.
 *  고장으로 선 동안은 애초에 돌 수 없었으므로, 그 시간까지 "막혀서 못 돌았다"
 *  로 세면 같은 손실을 두 번 빼게 된다(SimClock 이 둘을 겹치지 않게 나눠 센다).
 */
export function oeeOf(uid) {
  if (ran <= 0) return null;
  const downSec = downTimeOf(uid);
  const able = Math.max(0, ran - downSec);          // 돌 수 있었던 시간
  const blockSec = Math.min(able, blocked[uid] ?? 0);

  const availability = Math.max(0, 1 - downSec / ran);
  const performance = able > 0 ? Math.max(0, 1 - blockSec / able) : 1;
  const q = quality();
  return { availability, performance, quality: q, oee: availability * performance * q, downSec, blockSec };
}

/** 라인 전체 — 설비들의 평균. 볼 설비가 없으면 null */
export function oeeOverall(uids) {
  const rows = (uids ?? []).map((u) => oeeOf(u)).filter(Boolean);
  if (!rows.length) return null;
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const availability = avg('availability');
  const performance = avg('performance');
  const q = quality();
  return { availability, performance, quality: q, oee: availability * performance * q };
}

export const useMetrics = () => useSyncExternalStore(subscribe, () => version, () => 0);
