/**
 * =============================================================================
 *  선반(랙) — 규격 · 슬롯 · 적재
 * =============================================================================
 *  선반은 설비처럼 바닥에 놓이지만, 형상이 모델이 아니라 **설정값**에서 나온다.
 *  칸 수 · 한 칸 길이 · 단 수 · 단 간격 · 한 단 적재수를 모두 사용자가 정하고,
 *  모델은 "판 한 장과 기둥" 이라는 부품으로만 쓰인다.
 *
 *  그래서 여기 있는 함수들이 형상의 사실상 유일한 출처다. 렌더(ShelfView),
 *  풋프린트(grid), 카트 정차역(cart) 이 모두 같은 값을 보고 움직여야
 *  "보이는 곳" 과 "판정되는 곳" 이 어긋나지 않는다.
 *
 *  ── 채우는 순서 ────────────────────────────────────────────────────────────
 *   아래 단을 가로로 다 채우고 위 단으로 올라간다. 위 칸이 먼저 차는 건
 *   물리적으로 어색해서, 보이는 대로 납득되는 순서를 골랐다.
 * ---------------------------------------------------------------------------
 */

import { getSpec } from './modelStore.js';
import { PAYLOAD_ITEM } from '../data/library.js';

/** 모델을 못 읽었을 때 쓰는 기본 규격(m) — 절차적으로 그릴 치수이기도 하다 */
export const FALLBACK = {
  pitch: 2.6,
  depth: 0.9,
  baseTop: 0.3,
  spacing: 1.4,
  usable: 2.5,
  boardTop: 0.3,
  postHeight: 3.4,
  boardThickness: 0.08,
  postSize: 0.09,
  levels: [0.3, 1.7, 3.1],
};

export const SHELF_SLOT_GAP = 0.16;

/* 조절 범위 */
export const MIN_BAYS = 1;
export const MAX_BAYS = 10;
export const DEFAULT_BAYS = 2;
export const MIN_LEVELS = 1;
export const MAX_LEVELS = 10;
export const DEFAULT_LEVELS = 3;
export const MIN_BAY_LENGTH = 1.0;
export const MAX_BAY_LENGTH = 6.0;
export const MIN_LEVEL_GAP = 0.4;
export const MAX_LEVEL_GAP = 3.0;
/** 한 단에 넣을 수 있는 최대 개수.
 *  길이(최대 60m)를 자재 폭으로 나누면 70개가 넘게 나온다. 예전 값 40 은
 *  이 자동 계산을 잘라 버려서 "길이를 늘려도 개수가 안 늘어나는" 상한이 됐다.
 *  형상이 감당하는 값을 그대로 쓰도록 넉넉히 둔다. */
export const MAX_PER_LEVEL = 500;

/**
 * 자재 한 개의 폭(m) — 적재수 계산의 기준.
 * ---------------------------------------------------------------------------
 *  호출부마다 "안 넘기면 0.7" 이던 것이 문제였다. 인스펙터는 0.7 로 34개라
 *  적고, 씬은 실측 폭(≈0.68)으로 35개를 그려서 표시와 실제가 어긋났다.
 *  기준은 언제나 **실제 모델의 폭** 하나뿐이어야 한다.
 */
export const DEFAULT_ITEM_WIDTH = 0.7;
export const payloadWidth = () =>
  getSpec(PAYLOAD_ITEM.modelKey)?.bbox?.size?.[0] || DEFAULT_ITEM_WIDTH;

/**
 * 입출고 구역.
 * ---------------------------------------------------------------------------
 *  선반을 길이 방향으로 반 갈라, 한쪽은 **입고(카트가 내려놓는 곳)**,
 *  다른 쪽은 **출고(카트가 실어 가는 곳)** 로 쓴다.
 *
 *  나누지 않으면 카트가 선반 옆을 지날 때마다 상황에 따라 싣거나 부려서,
 *  같은 선반에서 넣었다 뺐다 하는 동작이 된다. 자리를 갈라 두면 "어디로
 *  지나가느냐" 가 곧 "무엇을 할 것이냐" 가 되어 도면만 보고도 흐름이 읽힌다.
 *
 *  앞뒤 양면에 모두 둔다 — 랙은 양쪽에서 접근하는 게 보통이고, 카트 경로를
 *  어느 쪽으로 그리든 동작해야 하기 때문이다.
 */
export const ZONE = { IN: 'in', OUT: 'out' };

/** 구역 표시가 바닥에 깔리는 폭(m) */
export const ZONE_BAND = 0.6;

/**
 * 로컬 좌표 기준 구역 목록.
 *  { kind, cx, cz, fz, w, d, dir }
 *    cz — 바닥 표시 띠의 중심 (그리기용)
 *    fz — 선반의 옆면 (판정용)
 *
 *  판정을 띠 중심에서 하면, 경로가 띠 위에 겹칠 때 몇 mm 차이로 "안쪽" 이 되어
 *  정차역에서 빠진다. 선반 면을 기준으로 재면 바깥쪽 어디를 지나든 인정된다.
 */
export function shelfZones(p, spec) {
  const L = shelfLength(p, spec);
  const d = shelfSpec(spec).depth;
  const half = L / 2;
  const zones = [];
  for (const side of [-1, 1]) {
    const common = { fz: side * (d / 2), cz: side * (d / 2 + ZONE_BAND / 2), w: half, d: ZONE_BAND, dir: [0, side] };
    zones.push({ kind: ZONE.IN, cx: -half / 2, ...common });
    zones.push({ kind: ZONE.OUT, cx: half / 2, ...common });
  }
  return zones;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 모델 분석 결과에서 규격을 꺼낸다 (없으면 기본값) */
export const shelfSpec = (spec) => spec?.shelf ?? FALLBACK;

export const shelfBays = (p) => clamp(Math.round(p?.bays ?? DEFAULT_BAYS), MIN_BAYS, MAX_BAYS);
export const shelfLevelCount = (p) => clamp(Math.round(p?.levels ?? DEFAULT_LEVELS), MIN_LEVELS, MAX_LEVELS);

/** 한 칸 길이(m) — 지정이 없으면 모델의 기둥 간격 */
export const bayLength = (p, spec) =>
  clamp(p?.bayLength ?? shelfSpec(spec).pitch, MIN_BAY_LENGTH, MAX_BAY_LENGTH);

/** 단 간격(m) — 지정이 없으면 모델의 판 간격 */
export const levelGap = (p, spec) =>
  clamp(p?.levelGap ?? shelfSpec(spec).spacing, MIN_LEVEL_GAP, MAX_LEVEL_GAP);

/** 전체 길이(m) */
export const shelfLength = (p, spec) => shelfBays(p) * bayLength(p, spec);

/** i 단의 높이(자재를 올리는 면) */
export const levelY = (i, p, spec) => shelfSpec(spec).baseTop + i * levelGap(p, spec);

/** 자동 계산한 한 단 적재수 — 자재 폭으로 나눈 값 */
export function autoPerLevel(p, spec, itemWidth = payloadWidth()) {
  const inner = shelfLength(p, spec) - SHELF_SLOT_GAP;
  return Math.max(1, Math.floor(inner / (itemWidth + SHELF_SLOT_GAP)));
}

/** 한 단 적재수 — 지정이 없으면 자동 */
export const perLevel = (p, spec, itemWidth = payloadWidth()) =>
  clamp(Math.round(p?.perLevel ?? autoPerLevel(p, spec, itemWidth)), 1, MAX_PER_LEVEL);

/** 총 수용량 */
export const shelfCapacity = (p, spec, itemWidth = payloadWidth()) =>
  perLevel(p, spec, itemWidth) * shelfLevelCount(p);

/**
 * i 번째 자재가 놓일 자리 (선반 로컬 좌표).
 *  길이축 X · 앞뒤 Z · 단 Y.
 *  적재수를 길이보다 크게 잡으면 자재끼리 붙는다 — 그건 사용자의 선택이므로
 *  막지 않고, 인스펙터에 실제 간격을 보여 준다.
 */
export function slotPosition(index, p, spec, itemWidth = payloadWidth()) {
  const n = perLevel(p, spec, itemWidth);
  const level = Math.min(shelfLevelCount(p) - 1, Math.floor(index / n));
  const col = index % n;

  const L = shelfLength(p, spec);
  const pitch = L / n;                       // 길이를 적재수로 균등 분할
  return [-L / 2 + pitch * (col + 0.5), levelY(level, p, spec), 0];
}

/** 실제 자재 간격(m) — 너무 촘촘하면 겹친다는 걸 보여 주기 위해 */
export const slotPitch = (p, spec, itemWidth = payloadWidth()) =>
  shelfLength(p, spec) / perLevel(p, spec, itemWidth);

/** 랙 전체 높이 */
export const shelfHeight = (p, spec) =>
  levelY(shelfLevelCount(p) - 1, p, spec) + 0.3;

/** 선반이 차지하는 로컬 바운딩 박스 (풋프린트·충돌 계산용) */
export function shelfBBox(p, spec) {
  const L = shelfLength(p, spec);
  const d = shelfSpec(spec).depth;
  const h = shelfHeight(p, spec);
  return { min: [-L / 2, 0, -d / 2], max: [L / 2, h, d / 2], size: [L, h, d], center: [0, h / 2, 0] };
}
