/**
 * =============================================================================
 *  도면 → **시뮬이 훑는 목록**
 * =============================================================================
 *  시뮬은 매 틱 두 가지를 훑는다 — 굴릴 설비들과, 어느 벨트가 어느 설비를
 *  먹이는지. 둘 다 **도면에서 나오고 틱마다 안 변한다**(설비를 옮기지 않는 한).
 *
 *  이 계산이 `EditorScene` 의 useMemo 안에 있었다. 그러면 화면 밖에서 라인을
 *  돌리려는 쪽이 **같은 것을 한 벌 더** 만들어야 하고, 그 순간 두 벌이 어긋난다
 *  — 반복 실행이 화면과 다른 라인을 돌리게 된다.
 *
 *  ── 여기 있는 것과 halt.js 에 있는 것 ────────────────────────────────────
 *      여기       도면에서 나온다. 설비를 옮길 때만 다시 만든다
 *      halt.js    **재고**에서 나온다. 매 틱 다시 답한다
 *
 *  그 경계가 반복 실행의 속도를 정한다 — 한 판에 18,000틱이면 여기 것을 한 번,
 *  저기 것을 18,000번 부른다.
 * ---------------------------------------------------------------------------
 */

import { inputCapOf, isSource, needFor, outKindOf, outputKindOf, recipeOf, recipesOf, slotShares } from './bom.js';
import {
  batchOf, batchWaitOf, cycleOf, lotOf, outputCapFor, setupOf, shapeOf, spacingFor,
  unitCycleOf, varOf,
} from './process.js';
import { stillageCapacity } from './stillage.js';
import { isShelf, isStillage, isTruck, isUtility } from '../data/library.js';
import { linkPath } from './link.js';
import { lineBalance } from './balance.js';
import { lineFlow, lineWorld } from './replicate.js';
import { cartPath, cartStations } from './cart.js';
import { floorOf, openingGates, wallLines } from './area.js';
import { FAULT_DEFAULTS, getDown } from './faults.js';
import { assignCrew, crewRows, isWorkable, normalizeShifts, shiftAt } from './crew.js';
import { getShipped, shippedTotal } from './simStore.js';

/**
 * 어느 벨트가 어느 설비를 먹이나.
 *  @param d.linkPaths [{ link, path }] — 경로 계산은 모델 규격을 봐야 해서
 *                     화면 층의 일이다. 풀어서 넘겨 준다
 *  @param d.placed · d.itemOf · d.beltSpeed
 */
export function beltFlowsOf(d = {}) {
  const linkPaths = d.linkPaths ?? [];
  const placed = d.placed ?? [];
  const itemOf = d.itemOf ?? (() => null);
  const beltSpeed = d.beltSpeed ?? 0.6;
  return (
      linkPaths
        .map(({ link, path }) => {
          const item = itemOf(link.itemId);
          if (!item || item.utility || item.render === 'tube') return null;
          const ep = link.from;
          if (!ep?.uid || ep.anchor || ep.link) return null;
          const owner = placed.find((x) => x.uid === ep.uid);
          if (!owner) return null;

          /**
           * 이 벨트가 어디로 들어가는가 — 자재가 **쌓이는 자리**를 찾는다.
           * -------------------------------------------------------------------
           *  적치대는 예전부터 그랬다. 이제 **재료를 먹는 설비**도 같다 —
           *  들어온 것이 그 설비의 입력 버퍼에 쌓이고, 거기서 레시피대로 빠진다.
           *
           *  레시피가 없는 설비로 보내면 예전처럼 **그냥 사라진다.** 여기에 다
           *  쌓기 시작하면 이미 그린 도면들이 어느 날 갑자기 버퍼가 차서 서게
           *  된다 — 먹지 않는 설비에 쌓아 둘 이유도 없다.
           */
          const dest = link.to?.uid ? placed.find((x) => x.uid === link.to.uid) : null;
          const outKind = outputKindOf(owner, itemOf(owner.itemId));
          let sink = null;
          if (dest && isStillage(itemOf(dest.itemId))) {
            /* 적치대는 한 통이다 — 무엇이든 들어오는 대로 쌓인다 */
            sink = { uid: dest.uid, cap: stillageCapacity(dest), slots: null };
          } else if (dest && !isSource(recipeOf(dest))) {
            /**
             * 재료를 먹는 설비 — **자리가 종류마다 정해져 있다.**
             * ---------------------------------------------------------------
             *  `slots[outKind]` 이 없으면 그 설비가 **안 쓰는 종류**다. 예전에는
             *  그래도 받아서 쌓였는데(카트는 걸러 받는데 벨트만 안 걸렀다),
             *  그러면 쓸모없는 것이 자리를 차지해 라인이 조용히 죽는다.
             *
             *  안 받고 **벨트를 세운다.** 자재가 소리 없이 사라지면 도면이
             *  틀렸다는 사실이 어디에도 안 남는다 — 벨트가 밀려 서 있으면
             *  "여기 잘못 이었다" 가 눈에 보인다(레시피 진단도 같은 말을 한다).
             */
            sink = {
              uid: dest.uid,
              cap: inputCapOf(dest),
              slots: slotShares(recipeOf(dest), inputCapOf(dest)),
            };
          }

          /* 이 벨트에 흐르는 것은 **출발 설비가 만드는 것**이다.
             레시피가 산출 종류를 정했으면 그것, 아니면 라이브러리 항목의 payload. */
          const recipe = recipeOf(owner);
          /**
           * 덩어리 간격은 **정하는 값이 아니라 따라 나오는 값이다.**
           * -----------------------------------------------------------------
           *  벨트가 한 덩어리 만드는 시간에 딱 한 번 지나가도록 맞춘다. 예전에는
           *  사용자가 슬라이더로 정했는데, 촘촘히 할수록 좋은 게 아니라 톱니처럼
           *  오르내려서(4.0m 114개/분 → 3.5m 65개/분) 맞출 방법이 없었다.
           *  자세한 것은 `process.js` 의 spacingFor.
           */
          const layers = Math.max(1, Math.round(owner.outputCount ?? 3));
          const speed = link.speed ?? beltSpeed;
          /* 간격은 **개당** 시간에서 나온다 — 배치 설비의 공정 시간은 한 판에
             드는 시간이라, 그대로 쓰면 간격이 판 크기만큼 벌어져 벨트가 텅 빈
             채로 돈다(실측: 20개 판에서 천장의 5%만 나왔다) */
          const gap = spacingFor(unitCycleOf(owner, itemOf(owner.itemId)), layers, speed);
          return { link, path, owner, sink, recipe, outKind, layers, speed, gap };
        })
        .filter(Boolean)
  );
}

/**
 * 굴릴 설비 목록 — 시뮬이 매 틱 훑는다.
 *  선반·적치대는 만들지 않고, 재료를 먹지 않는 설비(공급원)는 `need` 가 null 이다.
 */
export function machinesOf(d = {}) {
  const placed = d.placed ?? [];
  const itemOf = d.itemOf ?? (() => null);
  return (
      placed
        .map((p) => {
          const item = itemOf(p.itemId);
          if (!item || isShelf(item) || isStillage(item) || isUtility(item)) return null;
          const recipe = recipeOf(p);
          /**
           * **품종마다 한 벌씩** 싣는다 — 굴리는 쪽이 지금 몇 번째를 만드는지
           *  보고 골라 쓴다(`slotOf`). 여기서 고르지 않는 이유는, 이 목록이
           *  도면에서 한 번 만들어지고 매 틱 다시 안 만들어지기 때문이다.
           */
          const list = recipesOf(p);
          return {
            uid: p.uid,
            at: p,
            cycleSec: cycleOf(p, item),
            cycleVar: varOf(p, item),
            shape: shapeOf(p, item),
            /* 로트 전환 — 몇 개마다 몇 초 쉬는가. 0 이면 예전 그대로다 */
            lot: lotOf(p, item),
            setupSec: setupOf(p, item),
            /* 배치 공정 — 한 판에 몇 개를 굽나. 1 이면 예전 그대로다 */
            batch: batchOf(p, item),
            waitSec: batchWaitOf(p, item),
            /** 한 덩어리 개수 — 벨트가 한 번에 실어 가는 단위 */
            per: Math.max(1, Math.round(p.outputCount ?? 3)),
            /* 출력 자리는 **한 덩어리 + 한 개**다. 딱 한 덩어리치면 다 만든
               순간부터 벨트 칸이 올 때까지 설비가 서서, 멀쩡한 라인이 1초에
               한 번씩 붉게 깜빡인다 (process.js 의 OUT_SPARE). */
            cap: outputCapFor(p.outputCount ?? 3, batchOf(p, item)),
            /* 재료는 **한 개분씩** 낸다 — 공정이 한 개 단위로 돌기 때문이다.
               예전처럼 한 덩어리치를 한꺼번에 내면, 두 개분 재료로 세 개짜리
               덩어리를 못 만들어 멀쩡한 재료가 놀게 된다. */
            need: isSource(recipe) ? null : needFor(recipe, 1),
            /** 품종마다 [재료, 산출종류] — 굴리는 쪽이 slot 으로 고른다 */
            kinds: list.map((r) => ({
              need: isSource(r) ? null : needFor(r, 1),
              out: outKindOf(r, item),
            })),
          };
        })
        .filter(Boolean)
  );
}


/**
 * =============================================================================
 *  도면 한 벌 → **화면 없이 굴릴 수 있는 세상**
 * =============================================================================
 *  원래 이 계산은 `ui/useLineWorld.js` 안에 있었다. 훅이라 **지금 상태**로만
 *  만들 수 있었는데, 「손보기 전과 후를 나란히 돌려 보자」가 되면서 **지금이
 *  아닌 배치**로도 만들 수 있어야 했다. 그래서 순수한 부분을 여기로 옮겼다.
 *  훅은 이제 이것을 부르기만 한다 — 모으는 자리는 여전히 하나다.
 *
 *  모으는 자리가 둘이 되면 **화면이 돌리는 라인과 반복 실행이 돌리는 라인이
 *  달라진다.** 그러면 「여러 번 돌려 봤더니 다르더라」가 배치 때문인지 모으는
 *  방식 때문인지 알 수 없어진다 — 그 순간 이 기능은 못 쓰는 것이 된다.
 *
 *  @param d.specOf  모델 규격을 어디서 읽을지 (브라우저만 아는 값이라 밖에서 준다)
 *  @returns { world, flow, machines, capacity, ready }
 */
export function worldOf(d = {}) {
  const placed = d.placed ?? [];
  const links = d.links ?? [];
  const carts = d.carts ?? [];
  const itemOf = d.itemOf ?? (() => null);
  const specOf = d.specOf ?? (() => null);
  const beltSpeed = d.beltSpeed ?? 0.6;

  /* 벨트가 실제로 깔린 경로 — 모델 규격을 봐야 나온다 */
  const linkPaths = links
    .map((link) => ({ link, path: linkPath(link, placed, itemOf) }))
    .filter((x) => x.path);

  const machines = machinesOf({ placed, itemOf });
  const beltFlows = beltFlowsOf({ linkPaths, placed, itemOf, beltSpeed });

  /* 옮기는 쪽 — 이것이 없으면 설비만 돌고 만든 것이 아무 데도 안 간다 */
  const cartPaths = carts
    .map((c) => {
      const p = cartPath(c);
      /* 트럭은 싣기만 한다 — 방향이 처음부터 정해진 차량이다 */
      const opt = { loadOnly: isTruck(itemOf(c.itemId)), roles: c.roles };
      return p ? { cart: c, path: p, stations: cartStations(p, placed, itemOf, opt) } : null;
    })
    .filter(Boolean);
  const floor = floorOf(d.areas ?? []);
  const gates = openingGates(d.openings ?? [], wallLines(d.areas ?? [], d.walls ?? []));

  /**
   * 인력 — **첫 조**로 고정한다.
   *  교대가 도는 것까지 반복 실행에 넣으면 판마다 어느 조에서 시작했는지가
   *  결과를 흔든다. 견주려는 것은 배치지 「몇 시에 시작했나」가 아니다.
   */
  const shifts = normalizeShifts(d.shifts ?? []);
  const head = shiftAt(shifts, 0).shift?.headcount ?? 0;
  const crew = assignCrew(crewRows(placed, (p) => isWorkable(itemOf(p.itemId))), head);

  /* 고장 판정에 넣을 설비들 — 화면의 SimClock 이 넘기는 것과 같은 꼴 */
  const equips = machines.map((m) => ({
    uid: m.uid,
    mtbf: m.at?.mtbf ?? FAULT_DEFAULTS.mtbf,
    mttr: m.at?.mttr ?? FAULT_DEFAULTS.mttr,
    /* 수리 시간도 흔들린다 — 모양은 설비가 공정에 고른 것을 같이 쓴다 */
    repairVar: m.at?.repairVar ?? FAULT_DEFAULTS.repairVar,
    shape: m.shape,
  }));

  return {
    ready: machines.length > 0,
    machines,
    /** **돌리기 전에** 계산으로 나오는 천장 (개/분) — 잰 값과 나란히 놓으라고 있다 */
    capacity: lineBalance({ placed, links, carts, itemOf, specOf, beltSpeed }).capacity,
    world: lineWorld({
      beltFlows, machines, placed, itemOf, crew, equips,
      downMap: getDown,
      shipped: () => shippedTotal(getShipped()),
    }),
    flow: lineFlow({
      beltFlows, cartPaths, floor, gates,
      isTruck: (c) => isTruck(itemOf(c.itemId)),
    }),
  };
}
