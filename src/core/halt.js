/**
 * =============================================================================
 *  누가 서 있는가 — **재고를 보고 매 틱 다시 답한다**
 * =============================================================================
 *  `sim.js` 의 `runMachines` 는 「무엇이 서 있는지」를 **받아서** 지표에 적분한다.
 *  그 목록을 만드는 일이 여기다. 그런데 이것은 도면이 아니라 **지금 재고**에
 *  달려 있어서 틱마다 달라진다 — 적치대가 차면 그 앞이 서고, 재료가 오면 다시
 *  돈다.
 *
 *  이 계산이 `EditorScene` 의 useMemo 안에 있었다. 순수한 계산인데도 화면에
 *  묶여 있어서, 반복 실행을 하려면 **막힘·굶음이 없는 라인**만 돌릴 수 있었다.
 *  즉 정작 보고 싶은 것(어디서 막히나)이 빠진 반복 실행이었다.
 *
 *  ── 도면에서 나오는 것과 재고에서 나오는 것을 가른다 ─────────────────────
 *  `beltFlows`(어느 벨트가 어느 설비를 먹이나)는 **도면**에서 나온다 — 설비를
 *  옮기지 않는 한 안 변한다. 그래서 부르는 쪽이 한 번 만들어 두고, 여기서는
 *  틱마다 **재고만** 다시 본다. 이 경계가 반복 실행의 속도를 정한다.
 *
 *  ── 「서 있다」가 한 가지가 아니다 ────────────────────────────────────────
 *      equips    서 있는 설비 전부 (화면이 빨갛게 칠하는 것)
 *      jammed    **받지도 못하는** 설비 — 상류로 번지는 씨앗
 *      starved   재료가 없어 서 있는 설비
 *      unmanned  사람이 안 붙어 서 있는 설비
 *      links     선 벨트 · dry 마른 벨트 (돌지만 새것이 안 올라탄다)
 *
 *  갈라 두는 이유는 지표가 **이유마다 다른 항에** 넣기 때문이다(metrics 의
 *  oeeOf). 그리고 「막혔다」는 결과지 원인이 아니라서, 갈라 놓지 않으면 어디를
 *  손볼지 말해 줄 수가 없다.
 * ---------------------------------------------------------------------------
 */

import { buildableCount, countKinds, isSource, recipeAt } from './bom.js';
import { batchOf, batchWaitOf, slotOf, trayOf } from './process.js';
import { getLots, getMade, getStock } from './simStore.js';
import { isShelf, isStillage } from '../data/library.js';

/**
 * 지금 누가 서 있는가.
 *
 *  @param d.beltFlows [{ link, owner, sink, outKind }] — **도면**에서 나온다.
 *                     틱마다 안 변하므로 부르는 쪽이 한 번 만들어 둔다
 *  @param d.machines  [{ uid, cap }] — 출력 자리가 찼는지 보는 데 쓴다
 *  @param d.placed    굶었는지 보려면 도면의 설비를 다 훑어야 한다
 *  @param d.itemOf    (itemId) => 라이브러리 항목
 *  @param d.downMap   지금 고장 나 있는 설비 { uid: 남은 수리 시간 }
 *  @param d.crew      `assignCrew` 의 결과 — `unmanned` 를 읽는다
 *  @param d.fullOf    (링크 uid) => 축적형 벨트가 **다 찼는가**. 없으면 안 찬 것으로
 *                     본다 — 그러면 축적형 벨트는 영영 안 선다
 *  @returns { links, dry, equips, jammed, starved, unmanned }
 */
export function haltState(d = {}) {
  const beltFlows = d.beltFlows ?? [];
  const machines = d.machines ?? [];
  const placed = d.placed ?? [];
  const itemOf = d.itemOf ?? (() => null);
  const downMap = d.downMap ?? {};

  /** 서 있는 벨트 — 보낼 곳이 없다 */
  const links = new Set();
  /** 마른 벨트 — 돌기는 도는데 새 자재가 안 올라탄다 */
  const dry = new Set();
  const equips = new Set();
  /** 받을 수 없는 설비 — 상류 전파의 씨앗 (고장 · 막힘) */
  const jammed = new Set();
  /** 재료가 없어 서 있는 설비 — 지표에서 막힘과 갈라 센다 */
  const starved = new Set();
  /** 사람이 안 붙어 서 있는 설비 */
  const unmanned = new Set(d.crew?.unmanned ?? []);
  for (const uid of unmanned) equips.add(uid);
  for (const f of beltFlows) if (unmanned.has(f.owner.uid)) dry.add(f.link.uid);

  /**
   * ⓪ 고장 난 설비.
   * -------------------------------------------------------------------------
   *  막힘은 배치를 고쳐 풀 수 있지만 고장은 설비 자체의 성질이라, 지표에서는
   *  갈라 센다. 다만 화면에서 벌어지는 일은 같고, 고장 난 설비는 실제로
   *  **받지도 못하므로** 상류 전파도 그대로 태운다.
   *
   *  유출 벨트는 **세우지 않고 말린다** — 고장 난 것은 설비지 컨베이어가
   *  아니다. 이미 올라타 있던 물건은 끝까지 흘러 나가야 한다.
   */
  for (const uid of Object.keys(downMap)) { equips.add(uid); jammed.add(uid); }
  for (const f of beltFlows) if (downMap[f.owner.uid]) dry.add(f.link.uid);

  /**
   * ① 자리가 없는 종점으로 들어가는 벨트와, 그 벨트를 먹이던 설비.
   * -------------------------------------------------------------------------
   *  적치대는 한 통이라 **전체가 차면** 못 받는다. 재료를 먹는 설비는 자리가
   *  종류마다 나뉘어 있으므로 **그 종류 몫이 차면** 못 받는다 — 버퍼에 빈칸이
   *  남아 있어도 그건 다른 종류의 자리다.
   *
   *  안 쓰는 종류(`slots` 에 없는 것)를 보내는 벨트도 여기서 선다. 받아서
   *  쌓아 두면 라인이 조용히 죽고, 그냥 버리면 도면이 틀렸다는 사실이 안 남는다.
   */
  for (const f of beltFlows) {
    if (!f.sink) continue;
    if (f.sink.slots) {
      /**
       * **이 벨트가 실어 오는 종류들**을 본다 — 하나라도 자리가 있으면 안 선다.
       * -----------------------------------------------------------------------
       *  `outKind` 는 출발 설비의 **첫 레시피** 산출물이다. 갈래가 생기면서
       *  그것으로는 못 본다 — 불량품만 싣는 벨트를 「제작품 1 자리가 찼나」로
       *  판정하면, 재작업 설비에는 불량품 자리가 얼마든 남아 있는데도 벨트가
       *  선다. 실제로 그래서 검사 라우팅이 통째로 안 돌았다.
       */
      const kinds = f.kinds?.length ? f.kinds : [f.outKind];
      const have = countKinds(getLots(f.sink.uid));
      if (kinds.some((k) => (f.sink.slots[k] ?? 0) - (have[k] ?? 0) > 0)) continue;
    } else if (getStock(f.sink.uid) < f.sink.cap) continue;

    /**
     * **축적형 벨트는 종점이 막혀도 안 선다** — 끝에 쌓으며 계속 돈다.
     * -------------------------------------------------------------------------
     *  다 쌓이고 나서야 선다. 그 전에 세우면 축적의 뜻이 통째로 사라진다 —
     *  버퍼가 되라고 만든 벨트가 예전처럼 상류를 바로 막아 버린다.
     *
     *  쌓인 양은 **굴리는 쪽의 상태**라 도면에서 못 읽는다. 부르는 쪽이 알려
     *  준다(`fullOf`) — 안 주면 예전처럼 바로 선다.
     */
    if (f.accumulate && !(d.fullOf?.(f.link.uid) ?? false)) continue;
    links.add(f.link.uid);
    equips.add(f.owner.uid);
    jammed.add(f.owner.uid);
  }

  /**
   * ①' 재료가 모자란 설비.
   * -------------------------------------------------------------------------
   *  **한 개**를 만들 재료가 없으면 굶은 것이다. 벨트를 물리지 않은 설비(카트만
   *  드나드는 자리)도 함께 본다 — 굶은 것은 벨트가 있고 없고의 문제가 아니라
   *  그 설비의 상태다. 정지 표시가 안 뜨면 카트가 왜 빈손으로 지나가는지
   *  도면에서 읽을 수 없다.
   */
  for (const p of placed) {
    const item = itemOf(p.itemId);
    if (isShelf(item) || isStillage(item)) continue;
    /**
     * **지금 만들고 있는 품종**의 재료를 본다.
     *  첫 레시피만 보면, 제작품 2를 만드는 중에 제작품 1의 재료가 없다고
     *  「굶었다」고 찍는다 — 멀쩡히 도는 라인이 붉게 선다.
     */
    const recipe = recipeAt(p, slotOf(p.uid));
    if (isSource(recipe)) continue;
    const have = buildableCount(countKinds(getLots(p.uid)), recipe);
    /**
     * **배치 설비는 한 판을 못 걸면 서 있는 것이다.**
     *  판을 채우며 기다리는 시간도 굶음으로 센다 — 푸는 방법이 「앞 공정을
     *  빠르게 하거나 판을 줄이는 것」이라 재료가 없는 것과 처방이 같다.
     *
     *  거는 규칙은 **굴리는 쪽과 같은 함수**를 본다(`trayOf`). 두 곳이 각자
     *  판단하면 굽고 있는 설비를 굶었다고 빨갛게 칠하는 화면이 나온다.
     */
    if (trayOf(p.uid, have, batchOf(p, item), batchWaitOf(p, item)) > 0) continue;
    equips.add(p.uid);
    starved.add(p.uid);
  }
  for (const f of beltFlows) if (starved.has(f.owner.uid)) dry.add(f.link.uid);

  /**
   * ①'' 만들어 놨는데 아무도 안 가져가는 설비.
   * -------------------------------------------------------------------------
   *  출력 자리(한 덩어리치)가 차면 다음 개를 시작할 수 없다 — 벨트가 느리거나,
   *  카트가 안 오거나, 유출부에 아무것도 안 물린 설비다.
   *
   *  **상류로는 안 번진다.** 못 내보낼 뿐 재료는 계속 받을 수 있다(무인과 같은
   *  이유다). 그래서 `jammed` 에 넣지 않는다 — 여기 넣으면 설비가 한 덩어리
   *  낼 때마다 상류 벨트 전체가 섰다 갔다 하며 떨린다.
   *
   *  지표에서는 막힘으로 센다. `equips` 에만 있고 다른 어느 목록에도 없는
   *  설비를 `runMachines` 가 막힘으로 돌리므로(마지막 else) 따로 할 일이 없다.
   */
  for (const m of machines) if (getMade(m.uid) >= m.cap) equips.add(m.uid);

  /**
   * ② 상류로 거슬러 올라간다.
   * -------------------------------------------------------------------------
   *  받지 못하는 설비가 있으면 **그 설비로 들어가던 벨트**도 설 자리가 없고,
   *  그 벨트를 먹이던 앞 설비도 함께 선다. 실제 라인에서 적치대 하나가 차면
   *  그 앞 공정이 줄줄이 서는 것과 같다.
   *
   *  바로 앞 한 대만 세우면 그 뒤 설비들이 계속 자재를 밀어 넣어, 갈 곳 없는
   *  물건이 벨트 위에 계속 흐르는 그림이 된다.
   *
   *  더 붙일 것이 없을 때까지 되풀이한다. 한 번 돌 때마다 최소 한 개의 벨트가
   *  목록에 들어가므로 벨트 수만큼이면 반드시 끝난다(고리로 이어져 있어도).
   */
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of beltFlows) {
      if (links.has(f.link.uid)) continue;
      const dest = f.link.to?.uid;
      if (!dest || !jammed.has(dest)) continue;
      /**
       * **축적형 벨트는 여기서도 안 선다** — 다 쌓일 때까지.
       * -----------------------------------------------------------------------
       *  ①(종점이 찼다)에만 넣었더니 **하류가 고장 났을 때는 그대로 섰다.**
       *  그게 버퍼가 가장 필요한 자리인데 — 앞 설비가 고장 시간을 고스란히
       *  같이 서 버렸다. 실제로 재 보고서야 드러났다(막힌 시간이 안 줄었다).
       */
      if (f.accumulate && !(d.fullOf?.(f.link.uid) ?? false)) continue;
      links.add(f.link.uid);
      equips.add(f.owner.uid);
      jammed.add(f.owner.uid);
      grew = true;
    }
  }
  /* 선 벨트는 새것이 올라탈 수도 없다 — 두 목록을 따로 볼 필요가 없게 합쳐 둔다 */
  for (const uid of links) dry.add(uid);
  return { links, dry, equips, jammed, starved, unmanned };
}
