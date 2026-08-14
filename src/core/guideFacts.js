/**
 * =============================================================================
 *  따라 하기 — 도면에서 읽어 낸 사실들
 * =============================================================================
 *  안내의 각 단계는 **「눌렀는가」 가 아니라 「이루어졌는가」** 로 판정한다.
 *  버튼을 눌렀는지 세면 「탭은 열었는데 아무 일도 안 일어난」 상태가 통과하고,
 *  그러면 안내가 **틀린 것을 맞다고 말하게** 된다.
 *
 *  판정에 쓰는 값을 여기 한곳에 모은다. 갈래(트랙)가 여럿이 되면서 같은 사실을
 *  여러 곳에서 각자 세면 반드시 어긋나기 때문이다. 그리고 여기 모아 두면
 *  **node 로 값을 직접 확인할 수 있다** — 화면을 띄우지 않고도.
 * ---------------------------------------------------------------------------
 */

import { CATEGORY, isShelf, isStillage, isTruck, isUtility } from '../data/library.js';
import { cartPath, cartStations } from './cart.js';
import { recipeOf, isSource } from './bom.js';
import { bundleOf, cycleOf, DEFAULT_BUNDLE, DEFAULT_CYCLE } from './process.js';
import { crewOf, isWorkable, normalizeShifts } from './crew.js';
import { DEFAULT_RATES, fixedOf, normalizeRates } from './cost.js';
import { shelfRows, rowKinds } from './shelf.js';
import { normalizeOrders } from './orders.js';

const some = (list, fn) => (list ?? []).some(fn);
const count = (list, fn) => (list ?? []).filter(fn).length;

/**
 * 지금 도면이 무엇을 갖추었는가.
 *  @param d  에디터 상태에서 필요한 것만 (placed · links · carts · areas · …)
 *  @param itemOf 아이템 id → 라이브러리 항목
 */
export function guideFacts(d = {}, itemOf = () => null) {
  const placed = d.placed ?? [];
  const links = d.links ?? [];
  const carts = d.carts ?? [];
  const kindOf = (p) => itemOf(p.itemId);
  const byUid = new Map(placed.map((p) => [p.uid, p]));

  const machines = placed.filter((p) => {
    const it = kindOf(p);
    return it && !isShelf(it) && !isStillage(it) && !isUtility(it);
  });

  /* ---- 나르기 ---- */
  let cartCount = 0;
  let cartWithStations = 0;
  let cartLinked = 0;
  let truckCount = 0;
  let truckLinked = 0;
  let cartFleet = 0;
  for (const c of carts) {
    const truck = isTruck(kindOf(c));
    const path = cartPath(c);
    const st = path ? cartStations(path, placed, itemOf, { loadOnly: truck, roles: c.roles }) : [];
    if (truck) {
      truckCount++;
      if (st.length) truckLinked++;
      continue;
    }
    cartCount++;
    cartFleet += Number(c.count) || 1;
    if (st.length) cartWithStations++;
    const takes = some(st, (x) => x.kind === 'shelf-out' || x.kind === 'load');
    const gives = some(st, (x) => x.kind === 'shelf-in' || x.kind === 'unload');
    if (takes && gives) cartLinked++;
  }

  const shifts = normalizeShifts(d.shifts);
  const rates = normalizeRates(d.rates);

  return {
    /* ---- 짓기 ---- */
    areas: (d.areas ?? []).length,
    walls: (d.walls ?? []).length,
    pillars: (d.pillars ?? []).length,
    zones: (d.zones ?? []).length,
    openings: (d.openings ?? []).length,

    /* ---- 놓기 ---- */
    equip: count(placed, (p) => kindOf(p)?.category === CATEGORY.EQUIPMENT),
    machines: machines.length,
    stillage: count(placed, (p) => isStillage(kindOf(p))),
    shelf: count(placed, (p) => isShelf(kindOf(p))),
    links: links.length,
    /* 벨트의 끝이 적치대인가 — 쌓일 곳에 닿아야 그 다음이 성립한다 */
    beltToStillage: some(links, (l) => isStillage(kindOf(byUid.get(l.to?.uid) ?? {}))),

    /* ---- 설비 속성 ---- */
    /** 공정 시간을 **기본값에서 바꾼** 설비가 있는가 */
    cycleTuned: some(machines, (p) => cycleOf(p, kindOf(p)) !== DEFAULT_CYCLE),
    /** 재료를 먹는 설비 — 레시피에 입력이 있으면 조립 공정이다 */
    hasRecipe: some(machines, (p) => !isSource(recipeOf(p))),
    /** 한 번에 내보내는 개수를 **기본값에서 바꿨는가** */
    layered: some(machines, (p) => bundleOf(p) !== DEFAULT_BUNDLE),
    scrapSet: some(machines, (p) => (Number(p.scrapRate) || 0) > 0),
    mtbfSet: some(machines, (p) => (Number(p.mtbf) || 0) > 0),
    /** 전력·고정비를 손댄 설비 */
    powerTuned: some(machines, (p) => p.runKw != null || p.idleKw != null || fixedOf(p) > 0),

    /* ---- 쌓는 곳 ---- */
    shelfRows: some(placed, (p) => isShelf(kindOf(p)) && shelfRows(p) > 1),
    shelfSplit: some(placed, (p) => isShelf(kindOf(p)) && (rowKinds(p) ?? []).some(Boolean)),
    stillageSlots: some(placed, (p) => isStillage(kindOf(p)) && !!p.slots),

    /* ---- 나르기 ---- */
    carts: cartCount,
    cartFleet,
    cartWithStations,
    cartLinked,
    trucks: truckCount,
    truckLinked,
    cartRoles: some(carts, (c) => c.roles && Object.keys(c.roles).length > 0),

    /* ---- 사람 ---- */
    crewNeed: placed.filter((p) => isWorkable(kindOf(p))).reduce((s, p) => s + crewOf(p), 0),
    shifts: shifts.length,
    /** 교대에 따라 **인원이 실제로 달라지는가** — 조가 하나면 바뀔 것이 없다 */
    shiftsStaffed: shifts.some((s) => s.headcount > 0),

    /* ---- 돈 ---- */
    /** 단가를 **자기 숫자로** 바꿨는가 — 기본값 그대로면 그 공장의 원가가 아니다 */
    ratesTuned: Object.keys(DEFAULT_RATES).some((k) => rates[k] !== DEFAULT_RATES[k]),
    materialSet: rates.material > 0,

    /* ---- 계획 ---- */
    orders: normalizeOrders(d.orders).length,
    ordersDue: normalizeOrders(d.orders).filter((o) => o.dueMin > 0).length,

    /* ---- 돌린 결과 ---- */
    shipped: Math.max(0, d.shipped ?? 0),
    ranSec: Math.max(0, d.ranSec ?? 0),
    view: d.view,
  };
}
