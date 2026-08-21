/**
 * =============================================================================
 *  실행 보고서 — 한 번 돌린 결과를 한 장으로
 * =============================================================================
 *  지금까지 내보낼 수 있는 것은 「생산 추이」(시간 × 누적 출하) 하나였다. 그런데
 *  회의에 들고 가는 것은 추이 그래프 하나가 아니라 **이 배치가 무엇을 했는가** 다 —
 *  오더를 맞췄는지, 어느 설비가 얼마나 놀았는지, 어디서 막혔는지.
 *
 *  그래서 한 파일에 구획을 나눠 담는다. 빈 줄과 구획 제목으로 나누면 엑셀에서
 *  그대로 읽히고, 표 하나씩 따로 뜯어 쓰기도 쉽다.
 *
 *  ── 숫자는 **화면과 같은 값**이어야 한다 ──────────────────────────────────
 *   보고서가 화면과 다른 숫자를 말하면 둘 다 못 믿게 된다. 그래서 여기서는
 *   아무것도 다시 계산하지 않는다 — 화면이 이미 구한 값을 받아 **줄로 옮기기만**
 *   한다. 계산이 필요하면 그 계산을 가진 모듈(process · cart · orders · metrics)에
 *   두고 그 결과를 넘겨받는다.
 * ---------------------------------------------------------------------------
 */

import { ORDER, formatSpan } from './orders.js';

/** 소수 자리를 맞춘 문자열 — 엑셀이 숫자로 읽도록 따옴표 없이 */
const fx = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '');
const int = (v) => (Number.isFinite(v) ? Math.round(v) : '');
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) : '');

const ORDER_LABEL = {
  [ORDER.DONE]: '완료',
  [ORDER.LATE]: '납기 초과 예상',
  [ORDER.ON_TIME]: '납기 내 예상',
  [ORDER.NO_DUE]: '납기 없음',
  [ORDER.MEASURING]: '측정 중',
};

/** 초 → 「1시간 23분 45초」 — 사람이 읽는 경과 시간 */
export function hms(sec) {
  const s = Math.max(0, Math.round(sec ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}시간 ${m}분 ${r}초` : m ? `${m}분 ${r}초` : `${r}초`;
}

/**
 * 실행 보고서 한 장.
 *  @param d 화면이 이미 구한 값들. **여기서 다시 계산하지 않는다.**
 *  @returns downloadCSV 에 그대로 넘길 2차원 배열
 */
export function runReportCSV(d = {}) {
  const rows = [];
  const blank = () => rows.push([]);
  const head = (title) => { blank(); rows.push([`■ ${title}`]); };

  /* ---- 요약 ---- */
  rows.push(['Smart Factory — 실행 보고서']);
  rows.push(['내보낸 시각', d.at ?? '']);
  rows.push(['시뮬 경과', hms(d.elapsedSec)]);
  rows.push(['실제로 돈 시간', hms(d.ranSec)]);
  rows.push(['처리량(개/시간)', d.throughput == null ? '측정 중' : fx(d.throughput)]);
  rows.push(['재공(개)', int(d.wip)]);
  rows.push(['리드타임(초)', d.leadSec == null ? '' : Math.round(d.leadSec)]);
  if (d.oee) {
    rows.push(['가동률 A(%)', pct(d.oee.availability)]);
    rows.push(['성능 P(%)', pct(d.oee.performance)]);
    rows.push(['품질 Q(%)', pct(d.oee.quality)]);
    rows.push(['OEE(%)', pct(d.oee.oee)]);
  }

  /* ---- 진단 — 어디를 손봐야 하는가 ---- */
  if (d.diagnosis) {
    head('진단');
    rows.push(['원인 사슬', d.diagnosis]);
    if (d.culprit) rows.push(['손볼 곳', d.culprit]);
  }

  /* ---- 오더 ---- */
  head('생산 오더');
  rows.push(['종류', '목표(개)', '완료(개)', '진척(%)', '완료 지점', '납기(분)', '예상 완료까지', '여유/초과', '상태']);
  for (const o of d.orders ?? []) {
    rows.push([
      o.kindName ?? o.kind,
      int(o.qty),
      int(o.done),
      pct(o.ratio),
      o.atLabel ?? '',
      o.dueMin > 0 ? int(o.dueMin) : '',
      o.eta == null ? '' : formatSpan(o.eta),
      o.slackSec == null ? '' : `${o.slackSec < 0 ? '-' : ''}${formatSpan(Math.abs(o.slackSec))}`,
      ORDER_LABEL[o.state] ?? o.state ?? '',
    ]);
  }
  if (!(d.orders ?? []).length) rows.push(['(오더 없음)']);

  /* ---- 출하 누계 ---- */
  head('출하 누계');
  rows.push(['종류', '개수']);
  for (const [name, n] of d.shipped ?? []) rows.push([name, int(n)]);
  if (!(d.shipped ?? []).length) rows.push(['(출하 없음)']);

  /* ---- 설비 ---- */
  head('설비');
  rows.push(['이름', '공정 시간(초/개)', '능력(개/분)', '가동률(%)', '막힘(초)', '굶음(초)', '무인(초)', '고장(초)', 'OEE(%)']);
  for (const m of d.machines ?? []) {
    rows.push([
      m.name, fx(m.cycleSec), fx(m.rate), pct(m.uptime),
      int(m.blockSec), int(m.starveSec), int(m.crewSec), int(m.downSec), pct(m.oee),
    ]);
  }

  /* ---- 차량 ---- */
  head('차량');
  rows.push(['이름', '종류', '대수', '수송 능력(개/분)', '앞차에 막힌 비율(%)']);
  for (const c of d.carts ?? []) {
    rows.push([c.name, c.kindName ?? '', int(c.count), fx(c.perMinute), pct(c.blockRatio)]);
  }

  /* ---- 쌓이는 곳 ---- */
  head('적치대 · 선반');
  rows.push(['이름', '현재 재고', '수용량', '거쳐 간 누계', '종류별 누계']);
  for (const s of d.stores ?? []) {
    const detail = Object.entries(s.arrived ?? {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');
    rows.push([s.name, int(s.have), int(s.cap), int(s.arrivedTotal), detail]);
  }

  /* ---- 원가 ----
     `cost.js` 의 costOf 결과를 그대로 받는다. 여기서 다시 곱하지 않는다 —
     화면의 개당 원가와 보고서의 개당 원가가 갈리면 둘 다 못 믿게 된다. */
  if (d.cost) {
    const c = d.cost;
    head('원가');
    rows.push(['개당 원가(원)', c.per == null ? '측정 중' : int(c.per)]);
    rows.push(['누적(원)', int(c.total)]);
    rows.push(['시간당(원)', int(c.perHour)]);
    rows.push(['놀면서 탄 돈(원)', int(c.idleBurn)]);
    rows.push(['정지 비중(%)', pct(c.stopShare)]);
    rows.push(['불량으로 버린 돈(원)', int(c.scrapWon)]);
    rows.push(['전력(kWh)', fx(c.kwh, 2)]);
    rows.push(['사람·시간', fx(c.manHours, 2)]);
    blank();
    rows.push(['항목', '금액(원)', '비중(%)']);
    for (const p of c.parts) {
      rows.push([p.label, int(p.won), c.total > 0 ? pct(p.won / c.total) : '']);
    }
    blank();
    rows.push(['단가', '전기(원/kWh)', c.rates.power]);
    rows.push(['', '인건비(원/시간)', c.rates.wage]);
    rows.push(['', '카트 한 대(kW)', c.rates.cartKw]);
    rows.push(['', '자재비(원/개)', c.rates.material]);
    blank();
    rows.push(['설비', '가동(초)', '정지(초)', '전력(kWh)', '전력비(원)', '고정비(원)', '놀며 탄 돈(원)']);
    for (const r of c.rows) {
      rows.push([r.name, fx(r.runSec), fx(r.idleSec), fx(r.kwh, 2), int(r.power), int(r.fixed), int(r.idleBurn)]);
    }
  }

  /* ---- 생산 추이 ---- */
  if ((d.series ?? []).length) {
    head('생산 추이');
    rows.push(['시뮬 시간(초)', '누적 출하(개)']);
    for (const p of d.series) rows.push([fx(p.t), int(p.shipped)]);
  }

  return rows;
}
