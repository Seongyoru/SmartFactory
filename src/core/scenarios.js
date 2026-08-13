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
export function captureRun(placed, shipped, cost = null) {
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
    /**
     * 원가 — **밖에서 받아 온다.** cost.js 는 단가(도면)와 교대조까지 봐야 하는데
     * 여기서는 그 둘을 모른다. 여기서 다시 계산하면 화면과 갈릴 자리가 하나 더
     * 생기므로, 화면이 이미 낸 값을 굳히기만 한다.
     *
     * 개당 원가는 **처리량과 반대로 움직일 수 있다** — 설비를 두 배 깔아 처리량을
     * 20% 올린 배치는 여기서 진다. 그게 이 열을 넣은 이유다.
     */
    cost: cost ? { per: cost.per, total: cost.total, perHour: cost.perHour, idleBurn: cost.idleBurn } : null,
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
export const LOWER_IS_BETTER = new Set(['neck', 'wip', 'scrapped', 'costPer']);

/**
 * 비교표를 CSV 한 장으로.
 * ---------------------------------------------------------------------------
 *  **화면과 같은 값을 같은 순서로** 내보낸다. 표에는 없는 값을 CSV 에만 넣거나
 *  반대로 빼면, 붙여 놓고 보는 사람이 화면과 파일 중 어느 쪽을 믿어야 할지
 *  모르게 된다.
 *
 *  숫자는 **가공하지 않고** 그대로 넣는다. 화면은 "97 %" 로 보여 주지만 파일에는
 *  0.9712 가 들어가야 엑셀에서 다시 계산할 수 있다 — 반올림해서 내보내면 받는
 *  사람이 원래 값을 되찾을 수 없다.
 *
 *  아직 안 돌린 시나리오도 **줄은 남긴다.** 빼 버리면 "이 배치는 왜 없지" 가
 *  되는데, 답은 "안 돌렸다" 이고 그게 보여야 한다.
 */
export function scenarioCSV(rows) {
  const head = [
    '이름', '기록 시각', '돌린 시간(초)', '견줄 만한가',
    '출하(개)', '처리량(개/시간)', '재공(개)', '불량(개)',
    'OEE', '가동률', '성능', '양품률',
    '개당 원가(원)', '누적 원가(원)', '시간당 원가(원)', '놀며 탄 돈(원)',
    '병목', '병목 비율', '설비 수',
  ];
  const body = (rows ?? []).map((r) => {
    const n = r.run;
    if (!n) return [r.name, new Date(r.at).toLocaleString('ko-KR'), '', '안 돌림'];
    return [
      r.name,
      new Date(r.at).toLocaleString('ko-KR'),
      n.ran.toFixed(1),
      n.ran >= SHORT_RUN ? '예' : `아니오 (${SHORT_RUN}초 미만)`,
      n.shipped,
      n.throughput.toFixed(1),
      n.wip,
      n.scrapped,
      n.oee ?? '', n.availability ?? '', n.performance ?? '', n.quality ?? '',
      n.cost?.per ?? '', n.cost?.total ?? '', n.cost?.perHour ?? '', n.cost?.idleBurn ?? '',
      n.neck?.name ?? '없음',
      n.neck?.ratio ?? '',
      n.equips,
    ];
  });
  return [head, ...body];
}

/**
 * 생산 추이를 CSV 로 — 시간축 한 줄에 한 표본.
 *  화면의 SVG 그래프는 눈으로 보는 것이고, 이건 엑셀에서 다시 그리거나 다른
 *  실행과 겹쳐 보려고 내보내는 것이다.
 */
export function seriesCSV(series) {
  return [['시뮬 시간(초)', '누적 출하(개)'], ...(series ?? []).map((s) => [s.t.toFixed(1), s.shipped])];
}

export function bestOf(rows, key) {
  const vals = rows
    /* 너무 짧게 돌린 기록은 **우승 후보에서 뺀다.** 1분짜리 기록은 라인이 아직
       채워지지도 않은 상태라 처리량이 터무니없이 높게 나오고, 막힐 틈이 없어
       OEE 도 만점에 가깝다. 표에는 남겨 두되(경고를 달아) 왕관은 주지 않는다 —
       숫자가 거짓말을 하는 자리가 정확히 여기다. */
    .filter((r) => r.run && r.run.ran >= SHORT_RUN)
    /* 중첩된 값 둘은 이름이 따로다 — 표의 열 이름과 저장 구조가 늘 같지는 않다 */
    .map((r) => (key === 'neck' ? r.run?.neck?.ratio
      : key === 'costPer' ? r.run?.cost?.per
        : r.run?.[key]))
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return null;                 // 둘 이상 있어야 견줄 것이 있다
  return LOWER_IS_BETTER.has(key) ? Math.min(...vals) : Math.max(...vals);
}
