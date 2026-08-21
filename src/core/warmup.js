/**
 * =============================================================================
 *  예열 — **언제부터 잰 값이 뜻을 갖나**
 * =============================================================================
 *  갓 켠 라인의 처리량은 그 배치의 실력이 아니다. 벨트가 비어 있고, 버퍼가 비어
 *  있고, 오븐은 아직 첫 판을 모으는 중이다. 그동안 나온 몇 개로 시간당을 내면
 *  **몇 초 만에 수천 개/시간**이 나온다.
 *
 *  그래서 「데울 시간」을 두고 그전에는 아무 말도 안 했다. 그런데 그 값이
 *  **10초 고정**이었다.
 *
 *  ── 10초는 어떤 라인에서는 터무니없이 짧다 ───────────────────────────────
 *  240초에 한 판을 굽는 오븐은 10초에 아무것도 안 낸다. 30m 벨트는 0.6m/s 로
 *  50초가 걸린다. 20개씩 두 품종을 번갈아 만드는 설비는 한 순환에 몇 분이 든다.
 *  그런 도면에서 11초에 나온 숫자를 「측정 끝」이라고 내놓으면 **도구가 사람을
 *  속이는 것**이다 — 그리고 그 값으로 배치를 견주게 된다.
 *
 *  ── 재지 않고 **도면에서 센다** ──────────────────────────────────────────
 *  값을 보고 「이제 평평해졌다」를 판정하는 방법도 있다(Welch·MSER). 안 쓴다.
 *
 *    · 표본이 모자라면 **아직 오르는 중인 곡선을 평평하다고** 본다
 *    · 같은 도면이 판마다 다른 시점에 「끝났다」고 해서 **되풀이가 안 된다**
 *    · 무엇보다 **왜 그만큼 기다리는지를 화면이 못 말한다**
 *
 *  도면에서 세면 셋이 다 풀린다. 「벨트를 채우는 데 50초 + 가장 느린 설비가 한
 *  판을 내는 데 480초 + 품종 한 순환 240초」처럼 **이유가 그대로 남는다.**
 *
 *  ── 넉넉하게 잡는다 ──────────────────────────────────────────────────────
 *  짧게 잡으면 틀린 값을 내놓고, 길게 잡으면 「측정 중」이 오래 간다. 둘 중
 *  **틀린 값이 훨씬 나쁘다** — 오래 걸리는 것은 화면이 말해 주면 되지만, 틀린
 *  값은 사람이 그걸로 결정을 한다.
 * ---------------------------------------------------------------------------
 */

import { recipesOf } from './bom.js';
import { batchOf, cycleOf, effectiveCycle, lotOf, reworkOf, scrapToOf, setupOf, SCRAP_TO } from './process.js';

/** 아무리 단순한 라인이라도 이만큼은 데운다 (초) — 예전 값이 이것이었다 */
export const WARMUP_MIN = 10;

/**
 * 이보다 오래 기다리라고는 안 한다 (초 · 30분).
 *  손으로 이상한 값을 적은 도면에서 「영영 측정 중」이 되면 도구가 죽은 것처럼
 *  보인다. 넉넉히 잡되 **끝은 있어야** 한다.
 */
export const WARMUP_MAX = 1800;

/**
 * 이 도면은 얼마나 데워야 하나.
 * ---------------------------------------------------------------------------
 *  @param d.placed  설비들
 *  @param d.itemOf  (itemId) => 라이브러리 항목
 *  @param d.flows   `beltFlowsOf` 의 결과 — 길이와 속도를 본다
 *  @param d.makes   (item) => 만드는 설비인가
 *  @returns { sec, fill, slow, cycle, why } · why 는 화면에 그대로 적는 문장
 */
export function warmupOf(d = {}) {
  const placed = d.placed ?? [];
  const itemOf = d.itemOf ?? (() => null);
  const makes = d.makes ?? (() => true);

  /**
   * ① **벨트를 채우는 시간** — 가장 긴 벨트 하나가 아니라 **다 더한다.**
   *  물건은 벨트를 하나씩 차례로 지난다. 라인이 길수록 첫 개가 끝까지 가는 데
   *  오래 걸리고, 그게 예열의 큰 몫이다. 갈래로 나뉜 도면에서는 과대평가지만
   *  **넉넉한 쪽으로 틀리는 것**이 맞다.
   */
  let fill = 0;
  for (const f of d.flows ?? []) {
    const len = f.path?.length ?? 0;
    const v = Math.max(0.01, f.speed ?? 0.6);
    fill += len / v;
  }

  /**
   * ② **가장 느린 설비가 한 판을 내는 시간.**
   *  배치 설비는 판을 모으고(한 판치 재료) 굽는다 — 두 몫이라 두 배로 본다.
   *  한 개짜리 설비는 그냥 한 개 시간이다.
   */
  let slow = 0;
  for (const p of placed) {
    const item = itemOf(p.itemId);
    if (!makes(item)) continue;
    const batch = batchOf(p, item);
    const scrap = Math.min(1, Math.max(0, Number(p.scrapRate) || 0));
    const redo = scrapToOf(p, item) === SCRAP_TO.REDO ? reworkOf(p, item) : 0;
    const per = effectiveCycle(cycleOf(p, item), 0, 0, batch, { scrap, reworkSec: redo });
    /* 한 판이 나오기까지 — 모으고(판 크기 × 개당) 굽는다(한 판) */
    slow = Math.max(slow, per * batch * (batch > 1 ? 2 : 1));
  }

  /**
   * ③ **품종 한 순환.**
   *  20개씩 두 품종을 번갈아 만드는 설비는 한 바퀴를 돌아야 「평균이 이렇다」는
   *  말을 할 수 있다. 한 품종만 보고 잰 값은 그 순간의 값이지 라인의 값이 아니다.
   */
  let cycle = 0;
  for (const p of placed) {
    const item = itemOf(p.itemId);
    if (!makes(item)) continue;
    const kinds = Math.max(1, recipesOf(p).length);
    const lot = lotOf(p, item);
    if (kinds < 2 || lot <= 0) continue;
    const per = effectiveCycle(cycleOf(p, item), lot, setupOf(p, item), batchOf(p, item));
    cycle = Math.max(cycle, per * lot * kinds);
  }

  const raw = fill + slow + cycle;
  const sec = Math.min(WARMUP_MAX, Math.max(WARMUP_MIN, Math.round(raw)));
  return { sec, fill, slow, cycle, capped: raw > WARMUP_MAX };
}

/** 「벨트 채우기 50초 + 한 판 480초 + 품종 한 순환 240초」 */
export function warmupText(w) {
  if (!w) return '';
  const s = (v) => `${Math.round(v)}초`;
  const parts = [];
  if (w.fill >= 1) parts.push(`벨트 채우기 ${s(w.fill)}`);
  if (w.slow >= 1) parts.push(`가장 느린 설비가 한 판 내기 ${s(w.slow)}`);
  if (w.cycle >= 1) parts.push(`품종 한 순환 ${s(w.cycle)}`);
  if (!parts.length) return `${s(w.sec)} — 단순한 라인이라 금방 데워집니다`;
  const tail = w.capped ? ' (여기서 끊었습니다)' : '';
  return `${parts.join(' + ')}${tail}`;
}
