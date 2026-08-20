/**
 * =============================================================================
 *  디스패칭 — **다음에 무엇을 만들까**
 * =============================================================================
 *  품종을 여럿 든 설비는 로트를 채울 때마다 고를 것이 생긴다. 지금까지는 규칙이
 *  하나뿐이었다 — **칩 차례대로.** 되풀이할 수 있고 도면만 보고 읽히기 때문이다.
 *
 *  그런데 실제 공장이 늘 그렇게 돌지는 않는다. 납기가 급한 것을 먼저 태우고,
 *  가장 밀린 것을 먼저 만든다. **그 규칙을 바꾸면 같은 설비로 같은 개수를
 *  만들어도 납기를 맞추기도 하고 놓치기도 한다** — 그것이 이 손잡이의 값이다.
 *
 *  ── 규칙을 셋만 둔다 ─────────────────────────────────────────────────────
 *      차례대로     칩 순서대로 돌린다 (**기본** — 이미 그린 도면이 안 바뀐다)
 *      납기 먼저    남은 납기가 가장 급한 품종 (EDD)
 *      밀린 것 먼저 오더 진척이 가장 뒤처진 품종 (least progress)
 *
 *  「짧은 것 먼저(SPT)」는 안 둔다 — 한 설비의 품종들은 **공정 시간이 같아서**
 *  고를 것이 없다. 있지도 않은 선택지를 화면에 두면 그게 곧 거짓말이다.
 *
 *  ── **오더가 라인을 이끈다** ─────────────────────────────────────────────
 *  지금까지 오더는 「얼마나 됐나」를 말하기만 했다. 이 규칙들이 오더를 **읽어서**
 *  다음 품종을 고르므로, 비로소 오더가 라인을 움직인다.
 *
 *  오더가 없거나 견줄 것이 없으면 **차례대로로 떨어진다.** 답을 못 내는 규칙이
 *  아무거나 고르면 같은 도면이 매번 다르게 돌아 견줄 수가 없다.
 *
 *  ── 왜 순수 함수인가 ─────────────────────────────────────────────────────
 *  고르는 데 필요한 것(납기 · 진척)을 **부르는 쪽이 뽑아서** 넘긴다. 여기서
 *  재고나 시계를 직접 읽으면 화면과 헤드리스가 서로 다른 값을 보게 된다.
 * ---------------------------------------------------------------------------
 */

/** 고르는 규칙 */
export const RULE = {
  /** 칩 차례대로 — 지금까지의 동작 */
  ORDER: 'order',
  /** 남은 납기가 급한 것부터 (EDD) */
  DUE: 'due',
  /** 오더 진척이 가장 뒤처진 것부터 */
  BEHIND: 'behind',
};

export const RULE_LABEL = {
  [RULE.ORDER]: '차례대로',
  [RULE.DUE]: '납기 먼저',
  [RULE.BEHIND]: '밀린 것 먼저',
};

export const RULE_HINT = {
  [RULE.ORDER]: '칩 순서대로 돌아갑니다 — 도면만 보고 읽히고, 몇 번을 돌려도 같습니다',
  [RULE.DUE]: '남은 납기가 가장 급한 품종을 먼저 만듭니다 (오더가 없으면 차례대로)',
  [RULE.BEHIND]: '오더 진척이 가장 뒤처진 품종을 먼저 만듭니다 (오더가 없으면 차례대로)',
};

/** 자리에 적은 규칙 — 없으면 차례대로(이미 그린 도면이 안 바뀐다) */
export const ruleOf = (placed, item) => {
  const v = placed?.dispatch ?? item?.dispatch;
  return v === RULE.DUE || v === RULE.BEHIND ? v : RULE.ORDER;
};

/** 차례대로 — 되풀이할 수 있는 기본값 */
const roundRobin = (cur, many) => (((Math.round(cur) % many) + many) % many + 1) % many;

/**
 * 다음에 만들 품종의 자리를 고른다.
 * ---------------------------------------------------------------------------
 *  @param cur   지금 몇 번째를 만들고 있나
 *  @param kinds [종류이름, …] — 이 설비가 든 품종들, 칩 차례대로
 *  @param rule  RULE 중 하나
 *  @param info  (종류) => { due, ratio } · 없거나 다 찼으면 null
 *                 due   남은 납기(초). 납기를 안 정했으면 null
 *                 ratio 진척 0~1
 *  @returns 다음 자리(0-based)
 */
export function nextSlot(cur, kinds, rule = RULE.ORDER, info = null) {
  const many = Array.isArray(kinds) ? kinds.length : 0;
  if (many <= 1) return 0;
  const spin = roundRobin(cur, many);
  if (rule === RULE.ORDER || typeof info !== 'function') return spin;

  /**
   * 견줄 값을 뽑는다 — **다 찬 오더는 안 본다.** 이미 끝난 것을 계속 만들면
   *  남은 오더가 영영 안 끝난다.
   */
  const rows = [];
  for (let i = 0; i < many; i++) {
    const o = info(kinds[i]);
    if (!o) continue;
    const v = rule === RULE.DUE ? o.due : o.ratio;
    if (!Number.isFinite(v)) continue;
    rows.push({ i, v });
  }
  if (!rows.length) return spin;              // 견줄 것이 없다 — 차례대로

  /**
   * 같은 값이면 **차례대로로 가른다.**
   *  안 그러면 늘 첫 자리가 이겨서 뒤쪽 품종을 영영 안 만든다. 「지금 자리
   *  다음부터」 세어 가장 가까운 것을 고르면 그런 굶주림이 안 생긴다.
   */
  let best = null;
  for (let k = 1; k <= many; k++) {
    const i = (Math.round(cur) + k) % many;
    const row = rows.find((r) => r.i === i);
    if (!row) continue;
    if (best === null || row.v < best.v) best = row;
  }
  return best ? best.i : spin;
}
