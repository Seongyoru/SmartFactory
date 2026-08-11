/**
 * =============================================================================
 *  스틸리지(적치대) — 벨트의 종점
 * =============================================================================
 *  설비가 컨베이어로 내보낸 자재가 마지막으로 도착해 쌓이는 자리다.
 *
 *    들어오는 길 — 컨베이어 하나뿐 (그래서 포트를 **유입부로 고정**한다)
 *    나가는 길   — 카트가 실어 가는 것 하나뿐
 *    가득 차면   — 들어오던 벨트가 서고, 그 벨트를 먹이던 설비도 함께 선다
 *
 *  선반과 닮았지만 성격이 다르다. 선반은 "쌓아 두는 곳" 이라 양쪽으로 드나들고
 *  길이를 늘려 규모를 키우지만, 스틸리지는 **한 공정의 끝** 이라 크기가 고정이고
 *  대신 "얼마나 쌓이면 라인을 세울 것인가" 를 정한다. 그 값이 곧 수용량이다.
 *
 *  쌓는 모양은 바닥 면적에 몇 개가 들어가는지로 정한다 — 자재 크기를 바꾸면
 *  한 층에 놓이는 개수도 따라 바뀌어야, 보이는 것과 세는 것이 어긋나지 않는다.
 * ---------------------------------------------------------------------------
 */

import { payloadWidth } from './shelf.js';

export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 200;
export const DEFAULT_CAPACITY = 24;

/**
 * 자재끼리 벌어지는 틈(m).
 *  넉넉히 잡으면 1.5m 상판에 0.69m 자재가 **한 개**밖에 안 들어간다(0.69+0.06 이
 *  두 개면 1.50 을 아슬아슬하게 넘는다). 적치대는 실제로 빈틈없이 붙여 쌓는
 *  물건이라, 틈은 "겹쳐 보이지 않을 만큼" 만 준다.
 */
const SLOT_GAP = 0.02;

export const stillageCapacity = (p) =>
  Math.max(MIN_CAPACITY, Math.min(MAX_CAPACITY, Math.round(p?.capacity ?? DEFAULT_CAPACITY)));

/**
 * 한 층에 몇 개가 놓이는가 — 상판 위의 격자.
 *  @param size 모델 바운딩 박스 [x, y, z]
 */
export function stillageGrid(size, itemW = payloadWidth()) {
  const pitch = itemW + SLOT_GAP;
  const nx = Math.max(1, Math.floor((size?.[0] ?? 1.5) / pitch));
  const nz = Math.max(1, Math.floor((size?.[2] ?? 1.5) / pitch));
  return { nx, nz, pitch, perLevel: nx * nz };
}

/**
 * i 번째 자재가 놓일 자리 (스틸리지 로컬 좌표).
 *  아래 층을 다 채우고 위로 올라간다 — 선반과 같은 순서라 눈으로 납득된다.
 */
export function stillageSlot(index, size, itemH, itemW = payloadWidth()) {
  const { nx, nz, pitch, perLevel } = stillageGrid(size, itemW);
  const level = Math.floor(index / perLevel);
  const r = index % perLevel;
  const ix = r % nx;
  const iz = Math.floor(r / nx);
  const top = size?.[1] ?? 0.76;                       // 상판 높이 = 모델 전체 높이
  return [
    (ix - (nx - 1) / 2) * pitch,
    top + level * (itemH || 0.3),
    (iz - (nz - 1) / 2) * pitch,
  ];
}

/** 쌓아 올렸을 때의 총 높이(m) — 선택 케이지가 실제 부피를 감싸도록 */
export function stillageStackHeight(count, size, itemH) {
  const { perLevel } = stillageGrid(size);
  const levels = Math.ceil(Math.max(0, count) / perLevel);
  return (size?.[1] ?? 0.76) + levels * (itemH || 0.3);
}
