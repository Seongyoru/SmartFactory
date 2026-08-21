/**
 * =============================================================================
 *  도면 보고서 — **안 돌려도 나오는 한 장**
 * =============================================================================
 *  실행 보고서(`reportHtml.js`)는 **돌려야** 나온다. 돌린 시간이 없으면 처리량도
 *  OEE 도 원가도 없으니 당연한 일이다. 그런데 도면을 남에게 건넬 때 필요한 것은
 *  대개 그 앞이다 —
 *
 *      「무엇이 몇 대 놓였고, 얼마짜리 건물이며, 이 라인의 천장은 얼마인가」
 *
 *  이건 전부 **도면만 보고 답할 수 있다.** 회의에 들고 갈 종이 한 장이 없어서
 *  화면을 캡처해 붙이는 일을 없애는 것이 이 파일이다.
 *
 *  ── 새로 계산하는 것이 없다 ───────────────────────────────────────────────
 *  `layoutInfo` 가 규모를, `balance` 가 천장을, `improve` 가 그 천장의 원가를
 *  이미 낸다. 여기서 다시 세면 **화면과 종이가 다른 말을 하게 된다** — 그러면
 *  둘 다 못 믿는다. 이 파일은 받아서 **늘어놓기만** 한다.
 *
 *  ── 그림과 표가 서로를 가리킨다 ──────────────────────────────────────────
 *  평면도에는 이름이 아니라 **번호**가 찍힌다(thumb.js 의 labels). 이름을 그대로
 *  얹으면 설비가 조금만 붙어 있어도 글자끼리 겹쳐 둘 다 못 읽기 때문이다. 아래
 *  설비 목록이 같은 번호를 쓰므로, 그림에서 번호를 보고 표에서 이름을 찾는다.
 *
 *  ── 「이 값은 돌린 값이 아니다」 를 못 박는다 ──────────────────────────────
 *  여기 원가는 **고장도 굶음도 없이 쉬지 않고 도는** 라인의 값이다(improve.js).
 *  실제로 돌리면 반드시 이보다 나쁘다. 종이에 적힌 숫자는 혼자 걸어 다니므로,
 *  그 가정을 **문서 안에** 적어 두지 않으면 언젠가 실적으로 읽힌다.
 * ---------------------------------------------------------------------------
 */

import { REPORT_CSS, card, esc, int, num, table } from './reportHtml.js';
import { layoutThumbSVG } from './thumb.js';
import { rateText } from './balance.js';
import { workText } from './flow.js';
import { unitWon, won } from './cost.js';

/** 인쇄물의 평면도 — A4 폭에 맞춘 크기 */
export const PLAN_W = 900;
export const PLAN_H = 520;

const m2 = (v) => (Number.isFinite(v) && v > 0 ? `${Math.round(v).toLocaleString()} m²` : '—');

/** 「푼다」가 종류마다 다르다 — 표에 그대로 적는다 */
const KIND_LABEL = { equip: '설비', belt: '벨트', cart: '카트', truck: '트럭' };

const VERDICT_LABEL = { win: '남는 장사', even: '본전 — 양만 는다', lose: '밑지는 장사' };

/** 도면 보고서에만 있는 것 — 평면도 상자와 그림 설명 */
const PLAN_CSS = `
.lead{margin:0 0 14px;color:var(--ink2);font-size:13px;line-height:1.6}
.plan{margin-top:8px;padding:10px;border:1px solid var(--line);border-radius:10px;background:#f8fafc}
.plan svg{display:block;width:100%;height:auto}
.cap{margin:6px 0 0;color:var(--ink3);font-size:11px;line-height:1.55}
@media print{.plan{break-inside:avoid}}
@media (prefers-color-scheme:dark){.plan{background:#f8fafc}}
`;

/**
 * 도면 한 장.
 *  @param d.name     도면 이름
 *  @param d.note     설명 (없으면 뺀다)
 *  @param d.at       만든 시각 문구
 *  @param d.layout   `layoutSnapshot` 그대로 — 평면도와 설비 목록을 여기서 그린다
 *  @param d.info     `layoutInfo(layout, itemOf)`
 *  @param d.rows     `lineBalance(...).rows` — 느린 순
 *  @param d.capacity 라인 천장 (개/분)
 *  @param d.plan     `improvePlan(...)` — 없으면 그 절을 통째로 뺀다
 *  @param d.flow     { rows, per, total } — `flow.js` 의 값. 없으면 그 절을 뺀다
 *  @param d.nameOf   (placed) => 종류 이름. 라이브러리는 화면 층에 있으므로 받는다
 *  @returns 그대로 파일로 떨굴 수 있는 HTML 문자열
 */
export function planReportHTML(d = {}) {
  const s = [];
  const p = (x) => s.push(x);
  const info = d.info ?? {};
  const layout = d.layout ?? {};
  const nameOf = d.nameOf ?? (() => '');

  /* 이 앱은 도면에 이름을 붙이지 않는다(올릴 때만 받는다). 이름이 없으면
     「이름 없는 도면」 이라고 크게 적는 대신 문서 제목을 그대로 쓴다 */
  p('<div class="wrap">');
  p(`<h1>${esc(d.name || '도면 보고서')}</h1>`);
  p(`<div class="when">${d.name ? '도면 보고서 · ' : ''}${esc(d.at ?? '')}</div>`);
  if (d.note) p(`<p class="lead">${esc(d.note)}</p>`);

  /* ---- 결론 먼저 ---- */
  p('<div class="cards">');
  p(card('라인 천장', d.capacity > 0 ? esc(rateText(d.capacity)) : '—', '돌리기 전 계산'));
  if (d.plan?.now) {
    p(card('개당 원가', unitWon(d.plan.now.unit), '쉬지 않고 돌 때'));
    p(card('시간당 비용', won(d.plan.now.hourly), '전력·인건비·고정비'));
  }
  p(card('설비', `${int(info.scale?.machines)}<small> 대</small>`, `쌓는 곳 ${int(info.scale?.stores)}`));
  p(card('바닥', m2(info.building?.floor), `구역 ${int(info.building?.areas)}개`));
  p(card('한 조 인원', `${int(info.crew?.need)}<small> 명</small>`, `교대 ${info.crew?.shifts?.length ?? 0}조`));
  p('</div>');

  /* ---- 평면도 ---- */
  p('<h2>평면도</h2>');
  p(`<div class="plan">${layoutThumbSVG(layout, { w: PLAN_W, h: PLAN_H, labels: true, scaleBar: true })}</div>`);
  p('<p class="cap">번호는 아래 <b>설비 목록</b>과 같습니다. '
    + '<b style="color:#0ea5e9">파랑</b> 벨트 · <b style="color:#a78bfa">보라 점선</b> 카트 경로.</p>');

  /* ---- 설비 목록 ---- */
  p('<h2>설비 목록</h2>');
  let n = 0;
  const items = (layout.placed ?? []).filter((x) => x.pos).map((x) => {
    n += 1;
    return [`${n}`, esc(x.name ?? x.uid), esc(nameOf(x)), `${num(x.pos[0])}, ${num(x.pos[1])}`];
  });
  p(table(['#', '이름', '종류', '위치 (m)'], items, '놓인 것이 없습니다'));

  if (info.kinds?.length) {
    p('<h2>종류별 대수</h2>');
    p(table(['종류', '대수'], info.kinds.map((k) => [esc(k.name), int(k.n)])));
  }

  /* ---- 라인 능력 ---- */
  p('<h2>라인 능력</h2>');
  p(table(
    ['고리', '갈래', '혼자서', '배수', '지탱하는 능력'],
    (d.rows ?? []).map((r) => [
      esc(r.name),
      KIND_LABEL[r.kind] ?? esc(r.kind),
      esc(rateText(r.own)),
      r.mult > 1 ? `×${num(r.mult, 2)}` : '—',
      esc(rateText(r.capacity)),
    ]),
    '설비를 놓고 벨트로 이으면 여기에 계산됩니다',
  ));
  p('<p class="cap">레시피 비율을 반영한 <b>최종 산출물</b> 기준입니다. '
    + '쌓는 곳(선반·적치대)은 완충이지 속도가 아니라 빠져 있습니다.</p>');

  /* ---- 손보면 ---- */
  if (d.plan && d.plan.gain > 0) {
    p('<h2>손보면 얼마 이득인가</h2>');
    p(table(['무엇을', '어떻게'], d.plan.steps.map((x) => [esc(x.name), esc(x.what)])));
    p(table(
      ['', '지금', '손본 뒤'],
      [
        ['라인 천장', esc(rateText(d.plan.now.capacity)), esc(rateText(d.plan.after.capacity))],
        ['시간당 비용', won(d.plan.now.hourly), won(d.plan.after.hourly)],
        ['개당 원가', unitWon(d.plan.now.unit), unitWon(d.plan.after.unit)],
      ],
    ));
    p(`<p class="cap"><b>${esc(VERDICT_LABEL[d.plan.verdict] ?? '')}</b> — `
      + (d.plan.free
        ? '값만 바꾸면 되는 자리입니다. 설비를 사기 전에 여기부터 보세요.'
        : `시간당 ${won(d.plan.addWon)}이 더 듭니다`
          + (d.plan.addCrew > 0 ? ` (사람 ${int(d.plan.addCrew)}명 포함)` : '') + '.')
      + (d.plan.reaches
        ? ''
        : ` 한 대로는 ${esc(rateText(d.plan.after.capacity))}까지고,`
          + ` ${esc(rateText(d.plan.ceiling))}까지 올리려면 더 놓아야 합니다.`)
      + '</p>');
  }

  /* ---- 물류 동선 ---- */
  if (d.flow?.rows?.length) {
    p('<h2>물류 동선</h2>');
    p(table(
      ['구간', '갈래', '개/시', '거리 (m)', '운반 작업량'],
      d.flow.rows.slice(0, 12).map((r) => [
        `${esc(r.fromName)} → ${esc(r.toName)}${r.via ? ` <small>· ${esc(r.via)}</small>` : ''}`,
        KIND_LABEL[r.kind] ?? esc(r.kind),
        int(r.perHour),
        num(r.meters),
        esc(workText(r.work)),
      ]),
    ));
    p('<p class="cap">'
      + `한 개가 지나는 거리 <b>${d.flow.per == null ? '—' : `${num(d.flow.per)} m</b>`}`
      + ` · 총 <b>${esc(workText(d.flow.total))}</b>. `
      + '설비를 옮겨 <b>개당 거리</b>가 줄면 그 배치가 나은 것입니다 — 총량은 라인이 '
      + '빨라지기만 해도 커지므로 배치를 견주는 잣대가 못 됩니다.</p>');
  }

  /* ---- 사람 · 단가 ---- */
  p('<h2>사람 · 단가</h2>');
  p(table(
    ['조', '길이', '정원'],
    (info.crew?.shifts ?? []).map((x) => [esc(x.name), esc(x.label), x.headcount ? int(x.headcount) : '제한 없음']),
  ));
  p(table(
    ['항목', '단가'],
    [
      ['전기', `${int(info.rates?.power)} 원/kWh`],
      ['인건비', `${int(info.rates?.wage)} 원/인시`],
      ['자재비', `${int(info.rates?.material)} 원/개`],
      ['카트 전력', `${num(info.rates?.cartKw, 2)} kW/대`],
      ['기본 벨트 속도', `${num(info.beltSpeed, 2)} m/s`],
    ],
  ));

  if (info.orders?.length) {
    p('<h2>생산 오더</h2>');
    p(table(
      ['만들 것', '수량', '받는 곳', '납기(분)'],
      info.orders.map((o) => [esc(o.kind), int(o.qty), esc(o.at), o.dueMin ? int(o.dueMin) : '—']),
    ));
  }

  /**
   * 가정을 **문서 안에** 적는다. 종이에 적힌 숫자는 혼자 걸어 다니므로,
   * 여기 없으면 언젠가 「실제로 이만큼 나왔다」 로 읽힌다.
   */
  p('<p class="assume"><b>이 원가는 돌린 값이 아닙니다.</b> 고장도 굶음도 없이 '
    + '쉬지 않고 도는 라인을 놓고 시간당으로 센 값이라, 실제로 돌리면 반드시 이보다 '
    + '나쁩니다. 잰 값은 <b>실행 보고서</b>에 있습니다.</p>');

  p(`<div class="foot">Smart Factory · 도면 보고서 · ${esc(d.at ?? '')}</div>`);
  p('</div>');

  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"/>'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"/>'
    + `<title>도면 보고서${d.name ? ` — ${esc(d.name)}` : ''}</title>`
    + `<style>${REPORT_CSS}${PLAN_CSS}</style></head>`
    + `<body>${s.join('')}</body></html>`;
}
