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

import { inputCapOf, isSource, needFor, outputKindOf, recipeOf, slotShares } from './bom.js';
import { cycleOf, outputCapFor, spacingFor, varOf } from './process.js';
import { stillageCapacity } from './stillage.js';
import { isShelf, isStillage, isUtility } from '../data/library.js';

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
          const gap = spacingFor(cycleOf(owner, itemOf(owner.itemId)), layers, speed);
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
          return {
            uid: p.uid,
            at: p,
            cycleSec: cycleOf(p, item),
            cycleVar: varOf(p, item),
            /** 한 덩어리 개수 — 벨트가 한 번에 실어 가는 단위 */
            per: Math.max(1, Math.round(p.outputCount ?? 3)),
            /* 출력 자리는 **한 덩어리 + 한 개**다. 딱 한 덩어리치면 다 만든
               순간부터 벨트 칸이 올 때까지 설비가 서서, 멀쩡한 라인이 1초에
               한 번씩 붉게 깜빡인다 (process.js 의 OUT_SPARE). */
            cap: outputCapFor(p.outputCount ?? 3),
            /* 재료는 **한 개분씩** 낸다 — 공정이 한 개 단위로 돌기 때문이다.
               예전처럼 한 덩어리치를 한꺼번에 내면, 두 개분 재료로 세 개짜리
               덩어리를 못 만들어 멀쩡한 재료가 놀게 된다. */
            need: isSource(recipe) ? null : needFor(recipe, 1),
          };
        })
        .filter(Boolean)
  );
}
