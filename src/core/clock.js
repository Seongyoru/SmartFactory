/**
 * =============================================================================
 *  시뮬레이션 시계 — 배속과 경과 시간
 * =============================================================================
 *  지금까지 이 도면은 **실시간으로만** 돌았다. 그러면 "한 시간 돌리면 몇 개가
 *  나가는가" 를 알기 위해 한 시간을 앉아 있어야 한다. 그건 답을 주는 도구가
 *  아니라 구경거리다. 상용 시뮬레이터가 하나같이 배속과 경과 시간을 앞에 두는
 *  이유가 이것이다 — **지표는 시간으로 나눈 값**이라, 시간을 못 다루면 지표도
 *  없다(처리량 = 개수 ÷ 시간).
 *
 *  ── 모두가 같은 한 프레임을 본다 ──────────────────────────────────────────
 *  벨트·카트·컨베이어가 각자 useFrame 으로 dt 를 받는다. r3f 는 한 프레임의 dt 를
 *  **모든 구독자에게 같은 값으로** 넘기므로, 각자 `simStep(dt)` 을 부르면 순서와
 *  무관하게 같은 시뮬 시간을 얻는다. 그래서 "누가 먼저 도느냐" 를 걱정하지 않아도
 *  된다(r3f 의 useFrame 우선순위를 쓰면 자동 렌더링이 꺼져 버려서 쓸 수 없다).
 *
 *  ── 한 프레임에 너무 많이 흘리지 않는다 ───────────────────────────────────
 *  탭을 다른 데 두었다 돌아오면 dt 가 몇 초씩 들어온다. 그대로 흘리면 카트가
 *  순간이동하고 벨트 위 물건이 통째로 건너뛴다. 실제 dt 를 0.1초로 자른 뒤 배속을
 *  곱한다 — 20배속이라면 한 프레임에 최대 2초까지만 흐른다.
 * ---------------------------------------------------------------------------
 */

import { useSyncExternalStore } from 'react';

/** 고를 수 있는 배속 */
export const SPEEDS = [1, 2, 5, 20];

/** 한 프레임에 받아들일 실제 시간의 상한(초) */
const MAX_REAL_STEP = 0.1;

let speed = 1;
let elapsed = 0;          // 시뮬레이션 안에서 흐른 시간(초)
const subs = new Set();

/* 시계는 프레임마다 움직이지만 화면은 그렇게 자주 고칠 필요가 없다.
   초 단위로만 보여 주므로 0.25초에 한 번만 알린다 — 매 프레임 알리면
   경과 시간 하나 때문에 인스펙터까지 60번씩 다시 그린다. */
const NOTIFY_MS = 250;
let lastNotify = 0;

const emit = () => subs.forEach((f) => f());
const subscribe = (f) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const getSpeed = () => speed;
export const getElapsed = () => elapsed;

export function setSpeed(v) {
  const next = Number(v) || 1;
  if (next === speed) return;
  speed = next;
  emit();
}

export function resetClock() {
  elapsed = 0;
  lastNotify = 0;
  emit();
}

/**
 * 이 프레임에 흘릴 시뮬 시간(초).
 *  소비자(벨트·카트)가 각자 부른다. 순수 함수라 몇 번을 불러도 같은 값이다.
 */
export const simStep = (dt) => Math.min(dt, MAX_REAL_STEP) * speed;

/** 프레임마다 **한 번만** — 씬의 SimClock 이 부른다 */
export function tick(dt, running) {
  if (!running) return 0;
  const d = simStep(dt);
  elapsed += d;
  const now = performance.now();
  if (now - lastNotify >= NOTIFY_MS) {
    lastNotify = now;
    emit();
  }
  return d;
}

export const useSimSpeed = () => useSyncExternalStore(subscribe, getSpeed, () => 1);
export const useElapsed = () => useSyncExternalStore(subscribe, getElapsed, () => 0);

/** 초 → "1시간 23분" · "2분 05초" 처럼 읽히는 문자열 */
export function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}시간 ${String(m).padStart(2, '0')}분`;
  if (m) return `${m}분 ${String(r).padStart(2, '0')}초`;
  return `${r}초`;
}
