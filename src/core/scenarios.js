/**
 * =============================================================================
 *  시나리오 — 배치를 바꿔 보고 성적을 나란히 놓는다
 * =============================================================================
 *  "이 배치가 나은가" 는 혼자서는 답할 수 없는 질문이다. **무엇과 견주어** 나은지가
 *  있어야 한다. 상용 시뮬레이터가 파는 what-if 비교가 그것이다 — 레이아웃·대수·
 *  배치크기를 바꿔 가며 돌리고, 지표를 표로 늘어놓고 고른다.
 *
 *  ── 무엇을 저장하는가 ─────────────────────────────────────────────────────
 *  시나리오 하나는 **도면 한 벌과 그 도면으로 돌린 성적표**의 짝이다.
 *
 *      { uid, name, at, layout, run }
 *
 *  layout 은 저장·내보내기와 같은 스냅샷(layoutSnapshot)이라, 시나리오를 고르면
 *  그때의 도면으로 그대로 돌아갈 수 있다.
 *
 *  ── 왜 자동으로 여러 번 돌리지 않는가 ─────────────────────────────────────
 *  이 시뮬레이션은 3D 씬 안에서 프레임 단위로 돈다(벨트·카트가 그렇다). 배경에서
 *  몰래 돌리려면 같은 규칙을 헤드리스로 한 벌 더 구현해야 하는데, 그러면 **두 벌이
 *  반드시 어긋난다** — 화면에서 본 결과와 비교표의 숫자가 다른 도구는 안 쓰느니만
 *  못하다. 그래서 사람이 직접 돌리고, 돌린 결과를 박제한다.
 *
 *  ── 견줄 수 있는 값만 남긴다 ──────────────────────────────────────────────
 *  누적 개수는 **오래 돌린 쪽이 무조건 이긴다.** 30분 돌린 A 와 5분 돌린 B 를
 *  개수로 비교하면 아무 뜻이 없다. 그래서 시간으로 나눈 값(처리량/시간)과 비율
 *  (OEE·가동률·성능·양품률)을 남기고, 돌린 시간도 함께 적어 둔다 — 너무 짧게
 *  돌린 기록은 화면이 경고한다.
 * ---------------------------------------------------------------------------
 */

import { getElapsed } from './clock.js';
import { getRan, bottleneck, oeeOverall, producedInRun, throughput } from './metrics.js';
import { getScrapped, quality } from './faults.js';
import { getAllStock, shippedTotal } from './simStore.js';

/** 이보다 짧게 돌린 기록은 견주기에 모자라다고 본다(시뮬 초) */
export const SHORT_RUN = 120;

/**
 * 지금까지 돌린 결과를 한 장으로 굳힌다.
 *  @param placed 지금 도면의 설비들 (병목 이름과 라인 OEE 를 뽑는 데 쓴다)
 *  @param shipped 종류별 출하 { OBJ: n, … }
 */
export function captureRun(placed, shipped) {
  const ran = getRan();
  if (ran <= 0) return null;

  const total = shippedTotal(shipped);
  const neck = bottleneck();
  const owner = neck ? placed.find((p) => p.uid === neck.uid) : null;
  const oee = oeeOverall(placed.map((p) => p.uid));

  return {
    ran,
    elapsed: getElapsed(),
    /* 이번 실행에 나간 개수 — 누적 총량이 아니다. 「다시 재기」 뒤에도 견줄 수
       있어야 하므로 분자와 분모의 시작점을 맞춘다(metrics 의 shippedStart). */
    shipped: producedInRun(total),
    byKind: { ...shipped },
    throughput: throughput(total) ?? 0,
    wip: Object.values(getAllStock()).reduce((s, n) => s + n, 0),
    scrapped: getScrapped(),
    quality: quality(),
    oee: oee ? oee.oee : null,
    availability: oee ? oee.availability : null,
    performance: oee ? oee.performance : null,
    /* 병목은 이름으로 굳힌다 — 나중에 그 설비를 지워도 기록은 남아야 한다 */
    neck: neck ? { name: owner?.name ?? neck.uid, ratio: neck.ratio } : null,
    equips: placed.length,
  };
}

/** 시나리오 한 벌 만들기 — 아직 돌리지 않았으면 run 은 비어 있다 */
export function makeScenario(uid, name, layout, run) {
  return { uid, name, at: Date.now(), layout, run: run ?? null };
}

/**
 * 비교표에서 어느 칸이 가장 나은가.
 *  값이 없는(아직 안 돌린) 시나리오는 겨루지 않는다. 병목 비율만 **낮을수록**
 *  좋고 나머지는 높을수록 좋다.
 */
export const LOWER_IS_BETTER = new Set(['neck', 'wip', 'scrapped']);

export function bestOf(rows, key) {
  const vals = rows
    /* 너무 짧게 돌린 기록은 **우승 후보에서 뺀다.** 1분짜리 기록은 라인이 아직
       채워지지도 않은 상태라 처리량이 터무니없이 높게 나오고, 막힐 틈이 없어
       OEE 도 만점에 가깝다. 표에는 남겨 두되(경고를 달아) 왕관은 주지 않는다 —
       숫자가 거짓말을 하는 자리가 정확히 여기다. */
    .filter((r) => r.run && r.run.ran >= SHORT_RUN)
    .map((r) => (key === 'neck' ? r.run?.neck?.ratio : r.run?.[key]))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return null;                 // 둘 이상 있어야 견줄 것이 있다
  return LOWER_IS_BETTER.has(key) ? Math.min(...vals) : Math.max(...vals);
}
