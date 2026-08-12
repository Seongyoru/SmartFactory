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

/**
 * 표에 올릴 만한 최소 정지 시간(초).
 * ---------------------------------------------------------------------------
 *  라인이 도는 동안 버퍼가 잠깐 찼다 비는 일은 늘 있다. 그 0.2초까지 줄을 세우면
 *  「0초 막힘」 이라고 적힌 행이 목록을 채운다 — 초 단위로 반올림해 보여 주므로
 *  숫자가 0 으로 나오고, 읽는 사람에게는 고장 난 표로 보인다. 값은 그대로 쌓되
 *  **보여 줄 때만** 이 아래를 걸러 낸다.
 */
export const LOSS_FLOOR = 0.5;

let ran = 0;                 // 시뮬레이션이 실제로 돈 시간(초)
let blocked = {};            // 설비 uid → 막혀서 서 있던 누적 시간(초)
/**
 * 설비 uid → **굶어서** 서 있던 누적 시간(초).
 * ---------------------------------------------------------------------------
 *  막힘과 굶음은 잃은 시간의 양이 같아도 **가리키는 방향이 정반대**다.
 *
 *    막힘 — 만들었는데 보낼 곳이 없다 → 이 설비가 빠르거나 **하류가 느리다**
 *    굶음 — 만들 수 있는데 재료가 없다 → 이 설비가 놀거나 **상류가 느리다**
 *
 *  한 칸에 합쳐 놓으면 "성능 40%" 라는 같은 숫자를 보고 정반대의 처방을 하게
 *  된다. 그래서 잃은 시간은 같이 세되(둘 다 P 의 손실이다) 어느 쪽인지는 끝까지
 *  따로 들고 간다.
 */
let starved = {};
/**
 * 설비 uid → **사람이 없어** 서 있던 누적 시간(초).
 * ---------------------------------------------------------------------------
 *  막힘·굶음과 달리 이건 **애초에 돌 수 없었던** 시간이라 성능(P)이 아니라
 *  가동률(A)에서 빠진다 — 고장과 같은 자리다. 둘을 한 칸에 합치지 않는 이유는
 *  처방이 다르기 때문이다: 고장은 정비로, 무인은 인력으로 푼다.
 */
let unmanned = {};
/**
 * 카트 경로 uid → 앞차에 막혀 **못 간** 시간(초) · 그리고 달린 시간.
 * ---------------------------------------------------------------------------
 *  차간 간격을 넣고 나니 "카트를 몇 대 올려야 하는가" 를 물을 수 있게 됐는데,
 *  정작 **막힌 시간이 아무 데도 안 남았다.** 설비의 막힘·굶음은 세면서 카트만
 *  안 세면, 대수를 늘렸을 때 처리량이 왜 더 안 느는지 화면이 답을 못 한다.
 *
 *  **정차(dwell)와는 갈라 센다.** 역에 서서 짐을 주고받은 시간은 **일을 한**
 *  시간이고, 앞차에 막힌 시간은 **아무것도 못 한** 시간이다. 한 칸에 합치면
 *  "카트가 자주 선다" 는 것만 알고 늘려야 할지 줄여야 할지는 모른다.
 *
 *  한 대씩이 아니라 **경로별**로 센다 — 사람이 고치는 단위가 경로(대수·길이)지
 *  개별 차량이 아니다.
 */
let cartBlocked = {};
let cartRan = {};

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
 * 프레임마다 — 흘린 시뮬 시간과 **지금 서 있는 설비들**을 넘긴다.
 *  @param haltedUids  Set<uid> · 막혀서 서 있는 설비
 *  @param shipped     지금까지의 출하 총량 (추이 표본용)
 *  @param starvedUids  Set<uid> · 재료가 없어 서 있는 설비. 호출부가 이미 막힘·
 *                      고장과 겹치지 않게 갈라서 넘긴다(EditorScene 의 SimClock)
 *  @param unmannedUids Set<uid> · 사람이 없어 서 있는 설비
 */
export function accumulate(dt, haltedUids, shipped, starvedUids = null, unmannedUids = null) {
  if (!(dt > 0)) return;
  /* 이번 실행의 기준점 — 분자와 분모가 같은 순간에서 출발해야 한다 */
  if (shippedStart === null) shippedStart = shipped ?? 0;
  ran += dt;
  if (haltedUids?.size) {
    const next = { ...blocked };
    for (const uid of haltedUids) next[uid] = (next[uid] ?? 0) + dt;
    blocked = next;
  }
  if (starvedUids?.size) {
    const next = { ...starved };
    for (const uid of starvedUids) next[uid] = (next[uid] ?? 0) + dt;
    starved = next;
  }
  if (unmannedUids?.size) {
    const next = { ...unmanned };
    for (const uid of unmannedUids) next[uid] = (next[uid] ?? 0) + dt;
    unmanned = next;
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

/**
 * 카트 한 대의 한 프레임 — 앞차에 막혀 못 간 시간을 경로 앞으로 달아 둔다.
 * ---------------------------------------------------------------------------
 *  씬이 프레임마다 부르므로 **여기서는 알리지 않는다.** 화면 갱신은 `accumulate`
 *  가 250ms 마다 한 번 하고 있고, 여기서 또 알리면 카트 대수만큼 배로 는다.
 *
 *  @param blockedDt 이번 프레임에 **못 간** 몫의 시간(초). 속도가 절반으로
 *                   깎였으면 dt 의 절반이다 — 완전히 선 것만 세면 "느려졌지만
 *                   가긴 갔다" 가 통째로 빠진다
 */
export function accumulateCart(uid, dt, blockedDt) {
  if (!(dt > 0) || !uid) return;
  cartRan = { ...cartRan, [uid]: (cartRan[uid] ?? 0) + dt };
  if (blockedDt > 0) cartBlocked = { ...cartBlocked, [uid]: (cartBlocked[uid] ?? 0) + blockedDt };
}

export const getCartBlocked = () => cartBlocked;
export const getCartRan = () => cartRan;

/** 이 경로의 카트가 앞차에 막혀 있던 시간의 비율 (0~1) */
export const cartBlockRatio = (uid) => {
  const t = cartRan[uid] ?? 0;
  return t > 0 ? Math.min(1, (cartBlocked[uid] ?? 0) / t) : 0;
};

export function resetMetrics() {
  ran = 0;
  blocked = {};
  starved = {};
  unmanned = {};
  cartBlocked = {};
  cartRan = {};
  series = [];
  lastSample = 0;
  shippedStart = null;
  lastNotify = 0;
  emit();
}

export const getRan = () => ran;
export const getBlocked = () => blocked;
export const getStarved = () => starved;
export const getUnmanned = () => unmanned;
export const getSeries = () => series;

/**
 * 라인 전체가 굶은 시간이 막힌 시간보다 많은가 — "어디를 손볼까" 의 첫 갈림길.
 *  많이 굶었다면 라인 안이 아니라 **라인 앞**이 모자란 것이다(투입·공급).
 */
export function lossSplit() {
  const sum = (m) => Object.values(m).reduce((s, n) => s + n, 0);
  const block = sum(blocked);
  const starve = sum(starved);
  const crew = sum(unmanned);
  if (!block && !starve && !crew) return null;
  return { block, starve, crew, starvedMore: starve > block };
}

/**
 * 설비 하나의 가동률 — 막히지 않고 돈 시간의 비율.
 *  아직 아무것도 안 돌았으면 1(100%)로 본다. 0으로 두면 방금 놓은 설비가
 *  전부 "고장" 처럼 보인다.
 */
export const uptimeOf = (uid) => (ran > 0 ? 1 - Math.min(1, (blocked[uid] ?? 0) / ran) : 1);

/**
 * 병목 — 가장 오래 **막혀** 있던 설비.
 *  막힌 시간이 아예 없으면 병목이 없는 것이다(라인이 흐르고 있다).
 *
 *  ── 굶은 시간은 병목 판정에 넣지 않는다 ───────────────────────────────────
 *  굶은 설비는 **피해자**다. 재료가 안 와서 놀고 있는 기계를 병목이라고 지목하면
 *  손볼 곳을 정확히 반대로 짚는다 — 정작 느린 것은 그 앞이다. 가장 오래 굶은
 *  설비는 "여기까지 물건이 못 온다" 는 표시일 뿐이라 따로 보여 준다(starvedWorst).
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

/** 가장 오래 굶은 설비 — 자재가 여기까지 못 온다는 표시 */
export function starvedWorst() {
  let uid = null;
  let worst = 0;
  for (const [k, v] of Object.entries(starved)) {
    if (v > worst) { worst = v; uid = k; }
  }
  if (!uid || ran <= 0) return null;
  return { uid, starved: worst, ratio: Math.min(1, worst / ran) };
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
 *    가동률 A = 1 − (고장 + 무인) / 전체 시간
 *               애초에 못 돈 시간. 고장은 정비로, 무인은 인력으로 푼다
 *    성능   P = 1 − (막힘 + 굶음) / (돌 수 있었던 시간)
 *               돌 수 있었는데 보낼 곳이 없거나 받을 것이 없어 못 돈 시간
 *    양품률 Q = 1 − 불량 / 만든 것
 *               만들긴 했는데 못 쓰는 것. 공정으로 푼다
 *
 *  성능의 분모가 전체 시간이 아니라 **못 돌던 시간을 뺀 시간**인 것이 중요하다.
 *  고장이나 무인으로 선 동안은 애초에 돌 수 없었으므로, 그 시간까지 "막혀서 못
 *  돌았다" 로 세면 같은 손실을 두 번 빼게 된다(SimClock 이 넷을 겹치지 않게
 *  나눠 센다).
 *
 *  ── 고장과 무인을 A 안에서도 갈라 둔다 ───────────────────────────────────
 *  잃은 시간은 같지만 **살 것이 다르다** — 고장은 정비(또는 더 나은 설비)로,
 *  무인은 사람으로 푼다. A 하나만 보고 정비 예산을 잡으면 정작 필요한 건
 *  야간 인원인 경우가 생긴다.
 *
 *  ── 굶음도 성능 손실이다. 다만 처방이 반대다 ─────────────────────────────
 *  잃은 시간으로 보면 막힘과 굶음은 같다 — 돌 수 있었는데 못 돌았다. 그래서 P
 *  하나에 함께 넣는다. 하지만 막힘은 **하류를 늘려** 풀고 굶음은 **상류를 늘려**
 *  푼다. 숫자 하나만 보고는 어느 쪽인지 알 수 없으므로 `blockSec`·`starveSec`
 *  을 끝까지 따로 들고 가서 화면이 이유를 말할 수 있게 한다.
 */
export function oeeOf(uid) {
  if (ran <= 0) return null;
  const downSec = downTimeOf(uid);
  const crewSec = Math.min(Math.max(0, ran - downSec), unmanned[uid] ?? 0);
  const able = Math.max(0, ran - downSec - crewSec);   // 돌 수 있었던 시간
  const blockSec = Math.min(able, blocked[uid] ?? 0);
  const starveSec = Math.min(Math.max(0, able - blockSec), starved[uid] ?? 0);

  const availability = Math.max(0, 1 - (downSec + crewSec) / ran);
  const performance = able > 0 ? Math.max(0, 1 - (blockSec + starveSec) / able) : 1;
  const q = quality();
  return {
    availability, performance, quality: q,
    oee: availability * performance * q,
    downSec, crewSec, blockSec, starveSec,
  };
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
