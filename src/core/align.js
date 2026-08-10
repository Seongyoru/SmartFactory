/**
 * =============================================================================
 *  정렬 · 등간격
 * =============================================================================
 *  여러 개를 골라 놓고 "왼쪽 맞춤", "가로 등간격" 을 눌렀을 때 각자가 어디로
 *  가야 하는지를 계산한다. 순수 함수만 두는 이유는 두 가지다.
 *
 *   - 크기를 아는 곳은 씬/인스펙터다. 설비는 모델 바운딩 박스에서, 기둥은
 *     설정값에서 나온다. 리듀서에 넣으면 리듀서가 모델 캐시를 알아야 한다.
 *   - 좌표 계산은 눈으로 확인하기 어려운 종류라, 따로 떼어 두면 값으로 검증할
 *     수 있다.
 *
 *  ── 왜 풋프린트 기준인가 ──────────────────────────────────────────────────
 *  원점(pos)을 맞추면 모델마다 원점이 박힌 자리가 달라서 눈에는 안 맞아 보인다.
 *  사람이 "맞았다" 고 느끼는 것은 **차지하는 네모의 변**이 한 줄에 선 상태다.
 *
 *  입력은 { uid, pos:[x,z], rect:{minX,maxX,minZ,maxZ} } 목록.
 *  출력은 { uid, pos } 목록 — 그대로 MOVE_MANY 로 넘긴다.
 * ---------------------------------------------------------------------------
 */

/** 축 0 = 가로(X) · 1 = 세로(Z) */
export const AXIS = { X: 0, Z: 1 };

const lo = (r, axis) => (axis === AXIS.X ? r.minX : r.minZ);
const hi = (r, axis) => (axis === AXIS.X ? r.maxX : r.maxZ);
const mid = (r, axis) => (lo(r, axis) + hi(r, axis)) / 2;

/** 모드 — 어느 변을 기준선에 맞출 것인가 */
export const ALIGN = {
  MIN: 'min',        // 왼쪽 / 위쪽
  CENTER: 'center',  // 가운데
  MAX: 'max',        // 오른쪽 / 아래쪽
};

export function boundsOf(items, axis) {
  return {
    lo: Math.min(...items.map((i) => lo(i.rect, axis))),
    hi: Math.max(...items.map((i) => hi(i.rect, axis))),
  };
}

const moveOn = (item, axis, delta) =>
  axis === AXIS.X
    ? { uid: item.uid, pos: [item.pos[0] + delta, item.pos[1]] }
    : { uid: item.uid, pos: [item.pos[0], item.pos[1] + delta] };

/**
 * 정렬.
 *  기준선은 **고른 것 전체를 감싸는 네모**에서 가져온다. 마지막에 누른 것을
 *  기준으로 삼는 방식도 있지만, 그러면 어느 것이 기준인지 화면에서 구분되지
 *  않아 결과를 예측할 수 없다.
 */
export function alignMoves(items, axis, mode) {
  if (!items?.length || items.length < 2) return [];
  const b = boundsOf(items, axis);
  const target = mode === ALIGN.MIN ? b.lo : mode === ALIGN.MAX ? b.hi : (b.lo + b.hi) / 2;
  const edge = (r) => (mode === ALIGN.MIN ? lo(r, axis) : mode === ALIGN.MAX ? hi(r, axis) : mid(r, axis));
  return items.map((i) => moveOn(i, axis, target - edge(i.rect)));
}

/**
 * 등간격 — 물체 **사이의 빈틈**을 똑같이 벌린다.
 * ---------------------------------------------------------------------------
 *  중심 간격을 고르게 하는 방식도 흔하지만, 크기가 제각각인 설비를 늘어놓으면
 *  큰 설비 옆만 좁아 보인다. 눈에 고르게 보이는 쪽은 틈이 같은 쪽이다.
 *
 *  양 끝은 움직이지 않는다 — 전체가 차지하는 폭은 사용자가 이미 정한 것이고,
 *  사이만 다시 나누는 것이 "배치" 라는 말에 맞는다.
 *
 *  이미 서로 겹쳐 있어 넣을 자리가 모자라면 틈이 음수가 되어 더 겹친다. 그건
 *  값으로 드러나야 하므로 막지 않고, 호출부가 gapOf 로 미리 보여 준다.
 */
export function distributeMoves(items, axis) {
  if (!items?.length || items.length < 3) return [];
  const sorted = [...items].sort((a, b) => lo(a.rect, axis) - lo(b.rect, axis));
  const gap = gapOf(sorted, axis);

  let cursor = lo(sorted[0].rect, axis);
  return sorted.map((i) => {
    const size = hi(i.rect, axis) - lo(i.rect, axis);
    const m = moveOn(i, axis, cursor - lo(i.rect, axis));
    cursor += size + gap;
    return m;
  });
}

/** 등간격으로 폈을 때 생기는 틈(m). 음수면 서로 겹친다는 뜻이다. */
export function gapOf(items, axis) {
  if (!items?.length || items.length < 2) return 0;
  const b = boundsOf(items, axis);
  const used = items.reduce((s, i) => s + (hi(i.rect, axis) - lo(i.rect, axis)), 0);
  return (b.hi - b.lo - used) / (items.length - 1);
}
