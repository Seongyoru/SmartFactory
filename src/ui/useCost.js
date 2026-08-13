/**
 * 원가 계산에 넣을 값을 **한 곳에서** 모으는 훅.
 * ---------------------------------------------------------------------------
 *  원가 패널(Inspector) · 실행 보고서 · 배치 비교표가 전부 이걸 부른다. 각자
 *  모으면 「화면 3만원 · 보고서 3.2만원 · 비교표 2.9만원」이 되고, 그러면 셋 다
 *  못 믿게 된다. **모으는 자리는 하나여야 한다.**
 *
 *  계산 자체는 `core/cost.js` 가 한다. 여기서는 어느 저장소의 어느 값을 넣을지만
 *  정한다 — 그 결정이 화면 층의 일이라 core 가 아니라 여기 있다(cost.js 는
 *  단가와 시간만 알면 되고, 「선반은 전기를 안 먹는다」 같은 것은 몰라도 된다).
 */

import { useEditor } from '../core/store.jsx';
import { costOf } from '../core/cost.js';
import { isWorkable, totalCrewNeed } from '../core/crew.js';
import { getBlocked, getCartRan, getRan, getStarved, getUnmanned, useMetrics } from '../core/metrics.js';
import { getMade, getScrapped, useFaults } from '../core/faults.js';

export function useCostInput() {
  const { state, itemOf } = useEditor();
  useMetrics();
  useFaults();

  const workable = (p) => isWorkable(itemOf(p.itemId));
  const blocked = getBlocked();
  const starved = getStarved();
  const unmanned = getUnmanned();
  const made = getMade();

  return costOf({
    /* 선반·적치대는 뺀다 — 전기를 먹는 물건이 아니다 */
    machines: state.placed.filter(workable).map((p) => ({ uid: p.uid, name: p.name ?? p.uid, placed: p })),
    ranSec: getRan(),
    /* 세 이유는 서로 배타적이라(SimClock 의 else-if 사슬) 그냥 더해도 안 겹친다 */
    stopOf: (uid) => (blocked[uid] ?? 0) + (starved[uid] ?? 0) + (unmanned[uid] ?? 0),
    cartSec: Object.values(getCartRan()).reduce((t, n) => t + n, 0),
    shifts: state.shifts,
    crewNeed: totalCrewNeed(state.placed, workable),
    made,
    good: made - getScrapped(),
    rates: state.rates,
  });
}
