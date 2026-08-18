/**
 * =============================================================================
 *  구역이 말해 주는 것 — 「이 네모 안이 어떤 상태인가」
 * =============================================================================
 *  구역은 지금까지 **넓이와 이름**만 있는 색칠이었다. 그런데 사람이 구역을
 *  그리는 이유는 색칠이 아니라 **가르기** 위해서다 — 「가공 구역」 「출하 구역」
 *  으로 나눠 놓고 그 단위로 따지고 싶은 것이다.
 *
 *  따질 거리는 이미 전부 있다. 설비마다 풋프린트가 있고(grid), 인원이 있고(crew),
 *  전력·단가가 있고(cost), 카트에는 경로가 있다. 여기서는 **구역 안에 든 것만
 *  골라 그 합을 낸다** — 새로 재는 것은 하나도 없다.
 *
 *  ── 밀도가 왜 첫 줄인가 ──────────────────────────────────────────────────
 *  배치를 하면서 늘 묻는 질문이 「여기 더 들어가나?」 다. 넓이만으로는 답이
 *  안 나오고, 눈대중은 설비가 열 대만 넘어가도 틀린다. **찬 비율**은 그 답을
 *  숫자 하나로 준다.
 *
 *  다만 이것은 **바닥에 깔린 넓이**지 통로를 뺀 값이 아니다. 90% 라고 못 다니는
 *  것도, 40% 라고 넉넉한 것도 아니다 — 통로는 사람이 보고 정할 몫이라 그 판단을
 *  숫자가 대신하지 않는다.
 *
 *  ── 경로 길이는 **재서** 낸다 ────────────────────────────────────────────
 *  「구역을 지나는 카트 경로가 몇 m 인가」 는 선분을 잘라야 나오는 값이다.
 *  다각형 클리핑을 새로 들이는 대신 **잘게 썰어 안쪽만 더한다**(STEP). 25cm
 *  조각이면 도면에서 볼 자릿수(0.1m)보다 훨씬 잘고, 규칙이 한 줄이라 틀릴 데가
 *  없다. 대신 **근삿값**이라는 것을 이름에 적어 둔다.
 * ---------------------------------------------------------------------------
 */

import { inZone, mpArea } from './area.js';
import { footprintOf } from './grid.js';
import { crewOf, isWorkable } from './crew.js';
import { hourlyCost } from './improve.js';
import { isShelf, isStillage } from '../data/library.js';

/** 경로를 이만큼씩 썰어 안쪽인지 본다 (m) */
export const STEP = 0.25;

const rectArea = (r) => Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ);

/**
 * 구역 안을 지나는 경로 길이 — **근삿값**.
 *  @param points [[x,z],…] · closed 면 마지막→첫 점도 잇는다
 */
export function pathLengthIn(zone, points = [], closed = false) {
  const pts = points ?? [];
  if (!zone || pts.length < 2) return 0;

  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);

  let sum = 0;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (!(len > 0)) continue;
    const n = Math.max(1, Math.ceil(len / STEP));
    const piece = len / n;
    for (let i = 0; i < n; i++) {
      /* 조각의 **가운데**로 판정한다 — 끝점으로 보면 경계에 걸친 조각이
         두 번 세지거나 아예 빠진다 */
      const t = (i + 0.5) / n;
      if (inZone(zone, [a[0] + dx * t, a[1] + dz * t])) sum += piece;
    }
  }
  return sum;
}

/**
 * 구역 하나의 속.
 *
 *  @param zone    구역
 *  @param d.placed · d.carts · d.shifts · d.rates  도면
 *  @param d.bboxOf  (placed, item) => bbox — **실제 치수는 화면 층만 안다.**
 *                   모델 규격은 GLB 에서 읽어 `modelStore` 에 캐시되고, 선반은
 *                   설정값에서 나온다. core 가 그걸 알면 안 되므로 받아 쓴다.
 *                   안 넘기면 라이브러리의 bbox 를 쓴다(대개 없다 → 0 ㎡).
 *  @param itemOf  (itemId) => 라이브러리 항목
 *  @returns {{ area, machines, stores, fill, crew, hourly, pathM, carts }}
 *    area      구역 넓이 (㎡)
 *    fill      바닥이 찬 비율 (0~1) — 통로를 뺀 값이 **아니다**
 *    crew      안에 있는 설비가 요구하는 인원 합
 *    hourly    안에 있는 것만으로 센 시간당 비용 (원) — 쉬지 않고 돌 때
 *    pathM     안을 지나는 카트 경로 길이 (m, 근삿값)
 */
export function zoneInfo(zone, d = {}, itemOf = () => null) {
  const area = mpArea(zone?.mp);
  const inside = (d.placed ?? []).filter((p) => p.pos && inZone(zone, p.pos));
  const item = (p) => itemOf(p.itemId);

  const machines = inside.filter((p) => {
    const it = item(p);
    return it && !isShelf(it) && !isStillage(it);
  });
  const stores = inside.length - machines.length;

  /* 바닥에 깔린 넓이. 회전을 반영한 풋프린트를 쓴다 — 돌려 놓은 설비를
     원래 치수로 세면 안 맞는다 */
  const bboxOf = d.bboxOf ?? ((p, it) => it?.bbox ?? null);
  const covered = inside.reduce((s, p) => {
    const bb = bboxOf(p, item(p));
    return bb ? s + rectArea(footprintOf({ ...p, bboxOverride: bb }, null)) : s;
  }, 0);

  /* 경로가 **조금이라도** 걸치면 그 카트를 센다. 대수(count)만큼 곱하지 않는다 —
     여기서 세는 것은 「몇 대가 다니나」가 아니라 「어떤 경로가 지나나」다 */
  let pathM = 0;
  let carts = 0;
  for (const c of d.carts ?? []) {
    const m = pathLengthIn(zone, c.points, c.closed);
    if (m > 0) { pathM += m; carts += 1; }
  }

  /* 시간당 비용 — improve 와 **같은 함수**를 쓴다. 여기서 따로 곱하면
     구역 넷을 더한 값이 라인 전체와 안 맞는다 */
  const workable = inside.filter((p) => isWorkable(item(p)));
  const { total: hourly } = hourlyCost({
    machines: workable,
    /* 카트 전력은 경로가 여러 구역에 걸쳐 있어 어느 구역 몫인지 못 가른다 —
       구역 비용에서 뺀다. 빼는 편이 「반쯤 맞는 값」보다 낫다 */
    carts: [],
    shifts: d.shifts,
    crewNeed: workable.reduce((s, p) => s + crewOf(p), 0),
    rates: d.rates,
  });

  return {
    area,
    machines: machines.length,
    stores,
    /* 넓이가 0 이면 비율을 낼 수 없다 — 0 이 아니라 없는 것이다 */
    fill: area > 0 ? covered / area : null,
    covered,
    crew: workable.reduce((s, p) => s + crewOf(p), 0),
    hourly,
    pathM,
    carts,
  };
}
