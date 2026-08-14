/**
 * =============================================================================
 *  도면 속 들여다보기 — 열지 않고도 무엇인지 알게
 * =============================================================================
 *  목록의 카드는 「어느 것인가」 를 가려 준다. 그런데 남이 올린 도면을 열려면
 *  그 앞에 질문이 하나 더 있다 — **「이게 볼 만한 도면인가?」**
 *
 *  여는 순간 지금 그리던 것이 덮이므로, 열어 보고 아니면 되돌리는 식은 값이
 *  비싸다. 그래서 열기 전에 속을 편다: 규모 · 건물 · 설비 구성 · 오더 · 인력 ·
 *  단가. 이 여섯이면 「우리 라인과 비슷한가」 를 대개 가릴 수 있다.
 *
 *  ── 전부 도면에서 나온다 ─────────────────────────────────────────────────
 *  시뮬을 돌리지 않아도 알 수 있는 것만 센다. 처리량·가동률 같은 것은 **돌려
 *  봐야** 나오는 값이라 여기 없다 — 있는 척하면 그게 더 나쁘다.
 * ---------------------------------------------------------------------------
 */

import { isShelf, isStillage, isTruck, isUtility } from '../data/library.js';
import { crewOf, isWorkable, normalizeShifts, shiftLabel } from './crew.js';
import { DONE_AT, normalizeOrders } from './orders.js';
import { normalizeRates } from './cost.js';

/** 고리 하나의 넓이 — 신발끈 공식. 방향과 상관없이 크기만 */
export function ringArea(ring) {
  const pts = Array.isArray(ring) ? ring : [];
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!a || !b) continue;
    s += (Number(a[0]) || 0) * (Number(b[1]) || 0) - (Number(b[0]) || 0) * (Number(a[1]) || 0);
  }
  return Math.abs(s) / 2;
}

/**
 * 멀티폴리곤의 넓이 — **구멍은 뺀다.**
 *  도형 하나가 `[바깥 고리, 구멍, 구멍…]` 이라, 다 더하면 뚫린 자리를 두 번
 *  세게 된다(첫 고리만 더하면 반대로 구멍이 메워진 넓이가 나온다).
 */
export function mpArea(mp) {
  let total = 0;
  for (const poly of mp ?? []) {
    const rings = poly ?? [];
    rings.forEach((ring, i) => { total += i === 0 ? ringArea(ring) : -ringArea(ring); });
  }
  return Math.max(0, total);
}

const nameOf = (itemOf, id) => itemOf?.(id)?.name ?? id ?? '(알 수 없음)';

/**
 * 도면 한 장의 속.
 *  @param itemOf 아이템 id → 라이브러리 항목. 없으면 id 를 그대로 이름으로 쓴다
 */
export function layoutInfo(d, itemOf = () => null) {
  const placed = d?.placed ?? [];
  const carts = d?.carts ?? [];
  const item = (p) => itemOf?.(p.itemId) ?? null;

  /* 설비를 성질로 가른다 — 「설비 26대」 안에 선반과 적치대가 섞여 있으면
     규모가 부풀려 보인다 */
  const machines = placed.filter((p) => { const it = item(p); return it && !isShelf(it) && !isStillage(it) && !isUtility(it); });
  const stores = placed.filter((p) => { const it = item(p); return isShelf(it) || isStillage(it); });

  /* 종류별 대수 — 무엇으로 이루어진 라인인지가 여기서 드러난다 */
  const byKind = new Map();
  for (const p of placed) {
    const key = p.itemId ?? '?';
    const cur = byKind.get(key) ?? { id: key, name: nameOf(itemOf, key), n: 0 };
    cur.n += 1;
    byKind.set(key, cur);
  }

  const vehicles = carts.reduce((s, c) => s + (Number(c.count) || 1), 0);
  const trucks = carts.filter((c) => isTruck(item(c))).length;

  const shifts = normalizeShifts(d?.shifts);
  const need = placed.filter((p) => isWorkable(item(p))).reduce((s, p) => s + crewOf(p), 0);

  const orders = normalizeOrders(d?.orders).map((o) => ({
    kind: o.kind,
    qty: o.qty,
    dueMin: o.dueMin,
    at: o.at === DONE_AT.SHIP ? '출하' : (placed.find((p) => p.uid === o.atUid)?.name ?? '저장소'),
  }));

  return {
    scale: {
      machines: machines.length,
      stores: stores.length,
      links: (d?.links ?? []).length,
      paths: carts.length,
      vehicles,
      trucks,
    },
    building: {
      floor: mpArea((d?.areas ?? []).flatMap((a) => a.mp ?? [])),
      areas: (d?.areas ?? []).length,
      walls: (d?.walls ?? []).length,
      pillars: (d?.pillars ?? []).length,
      zones: (d?.zones ?? []).length,
      openings: (d?.openings ?? []).length,
    },
    /* 많은 것부터 — 라인의 성격은 가장 많은 설비가 정한다 */
    kinds: [...byKind.values()].sort((a, b) => b.n - a.n),
    orders,
    crew: {
      shifts: shifts.map((s) => ({ name: s.name, label: shiftLabel(s.minutes), headcount: s.headcount })),
      need,
    },
    rates: normalizeRates(d?.rates),
    beltSpeed: Number(d?.beltSpeed) > 0 ? Number(d.beltSpeed) : 0.6,
  };
}
