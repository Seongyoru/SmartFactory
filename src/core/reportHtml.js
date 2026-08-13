/**
 * =============================================================================
 *  실행 보고서 — 읽는 판 (HTML)
 * =============================================================================
 *  CSV 는 **엑셀에서 다시 계산하려고** 만드는 것이다. 그래서 반올림도 안 하고
 *  단위도 안 붙이며 표를 여럿 이어 붙인다 — 사람이 읽으라고 만든 것이 아니다.
 *
 *  회의에 들고 가는 것은 성질이 정반대다. 한눈에 결론이 보여야 하고, 나쁜
 *  숫자는 붉어야 하고, 인쇄하면 그대로 한 장이 나와야 한다. 둘을 한 파일로
 *  만들려다 보면 **양쪽 다 어중간해진다.** 그래서 갈랐다.
 *
 *  ── 여기서도 다시 계산하지 않는다 ────────────────────────────────────────
 *  `runReportCSV` 와 **똑같은 `d` 를 받는다.** 화면이 이미 낸 값을 옮기기만
 *  하므로 CSV·HTML·화면 셋이 갈릴 자리가 없다. 새 숫자가 필요하면 그것을
 *  가진 모듈(process · cart · orders · metrics · cost)에서 받아 온다.
 *
 *  ── 왜 파일 하나로 닫는가 ────────────────────────────────────────────────
 *  CSS 를 안에 넣고 그래프도 SVG 로 그려 넣는다. 메일에 붙이든 USB 에 담든
 *  **그 파일만 있으면 열린다.** 바깥 것을 하나라도 불러오면 받은 사람 화면에서
 *  깨지고, 깨진 보고서는 안 만든 것만 못하다.
 * ---------------------------------------------------------------------------
 */

import { ORDER, formatSpan } from './orders.js';
import { hms } from './report.js';

/* ---------- 안전하게 글자 넣기 ---------------------------------------------
     설비 이름은 사용자가 적는다. `<b>` 같은 것을 이름에 넣어 두면 보고서
     구조가 통째로 무너지므로, 넣기 전에 반드시 막는다.
--------------------------------------------------------------------------- */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const num = (v, n = 1) => (Number.isFinite(v) ? v.toFixed(n) : '—');
const int = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '—');
const pc = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');

/** 나쁜 값은 붉게, 좋은 값은 푸르게 — 표를 훑을 때 눈이 먼저 잡는 것이 색이다 */
const rate = (v, warn = 0.85, bad = 0.5) =>
  (!Number.isFinite(v) ? '' : v < bad ? ' bad' : v < warn ? ' warn' : ' good');

const ORDER_LABEL = {
  [ORDER.DONE]: '완료',
  [ORDER.LATE]: '납기 초과 예상',
  [ORDER.ON_TIME]: '납기 내 예상',
  [ORDER.NO_DUE]: '납기 없음',
  [ORDER.MEASURING]: '측정 중',
};
const ORDER_TONE = {
  [ORDER.DONE]: 'good', [ORDER.LATE]: 'bad', [ORDER.ON_TIME]: 'good',
  [ORDER.NO_DUE]: '', [ORDER.MEASURING]: '',
};

/** 표 한 장 — 줄이 없으면 「없다」 고 **말한다**. 빈 표는 고장처럼 보인다 */
function table(head, rows, empty = '기록 없음') {
  if (!rows.length) return `<p class="none">${esc(empty)}</p>`;
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows
    .map((r) => `<tr>${r.map((c) => (c && c.html ? `<td class="${c.cls ?? ''}">${c.html}</td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** 값이 큰 칸 — 결론을 먼저 읽게 한다 */
const card = (label, value, sub = '', cls = '') =>
  `<div class="card"><div class="k">${esc(label)}</div>`
  + `<div class="v${cls}">${value}</div>`
  + (sub ? `<div class="s">${esc(sub)}</div>` : '')
  + '</div>';

/** 가로 막대 — 비율은 숫자보다 길이로 먼저 읽힌다 */
const bar = (v, cls = '') =>
  `<span class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, (v ?? 0) * 100)).toFixed(1)}%"></i></span>`;

/** 시간 × 누적 출하 — 그림도 파일 안에 그린다(바깥 것을 안 부른다) */
function chart(series) {
  if ((series ?? []).length < 2) return '';
  const W = 720;
  const H = 150;
  const t0 = series[0].t;
  const span = Math.max(1e-6, series[series.length - 1].t - t0);
  const top = Math.max(1, series[series.length - 1].shipped);
  const pts = series
    .map((s) => `${(((s.t - t0) / span) * W).toFixed(1)},${(H - (s.shipped / top) * H).toFixed(1)}`)
    .join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart">
    <polyline points="0,${H} ${pts} ${W},${H}" fill="rgba(14,165,233,.14)"/>
    <polyline points="${pts}" fill="none" stroke="#0ea5e9" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>
  <div class="axis"><span>${esc(hms(t0))}</span><span>${int(top)} 개 누적</span></div>`;
}

const CSS = `
:root{--ink:#0f172a;--ink2:#334155;--ink3:#64748b;--line:#e2e8f0;--bg:#fff;--raise:#f8fafc}
*{box-sizing:border-box}
body{margin:0;padding:32px 28px 56px;background:var(--bg);color:var(--ink);
  font:14px/1.6 -apple-system,"Segoe UI","Malgun Gothic",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:900px;margin:0 auto}
h1{margin:0;font-size:21px;letter-spacing:-.01em}
.when{margin:2px 0 20px;color:var(--ink3);font-size:12px}
h2{margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--line);
  font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--ink3);text-transform:uppercase}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;margin:12px 0 4px}
.card{padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--raise)}
.card .k{font-size:11px;color:var(--ink3)}
.card .v{margin-top:1px;font-size:19px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.card .s{font-size:10.5px;color:var(--ink3)}
.good{color:#059669}.warn{color:#d97706}.bad{color:#e11d48}
table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12.5px}
th,td{padding:6px 9px;text-align:right;border-bottom:1px solid var(--line);
  font-variant-numeric:tabular-nums;white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}
th{font-size:11px;font-weight:600;color:var(--ink3);background:var(--raise);border-bottom:1px solid #cbd5e1}
tbody tr:hover{background:var(--raise)}
.bar{display:inline-block;width:52px;height:5px;margin-left:7px;border-radius:3px;
  background:var(--line);overflow:hidden;vertical-align:middle}
.bar i{display:block;height:100%;background:#94a3b8}
.bar i.good{background:#10b981}.bar i.warn{background:#f59e0b}.bar i.bad{background:#f43f5e}
.note{margin:8px 0 0;padding:9px 11px;border-radius:8px;background:#fff1f2;
  border:1px solid #fecdd3;color:#9f1239;font-size:12.5px}
.note b{color:#e11d48}
.none{margin:6px 0;color:var(--ink3);font-size:12.5px}
.chart{display:block;width:100%;height:150px;margin-top:8px}
.axis{display:flex;justify-content:space-between;color:var(--ink3);font-size:10.5px}
.foot{margin-top:30px;padding-top:10px;border-top:1px solid var(--line);
  color:var(--ink3);font-size:10.5px}
/* 인쇄 — 표가 장 사이에서 잘리지 않게 */
@page{margin:14mm}
@media print{body{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}.card{break-inside:avoid}}
@media (prefers-color-scheme:dark){
  :root{--ink:#e2e8f0;--ink2:#cbd5e1;--ink3:#94a3b8;--line:#334155;--bg:#0f172a;--raise:#1e293b}
  th{border-bottom-color:#475569}
  .note{background:#4c0519;border-color:#881337;color:#fecdd3}
}
`;

/**
 * 읽는 보고서 한 장.
 *  @param d `runReportCSV` 와 **똑같은 값**. 여기서 새로 계산하지 않는다.
 *  @returns 그대로 파일로 떨굴 수 있는 HTML 문자열
 */
export function runReportHTML(d = {}) {
  const s = [];
  const p = (x) => s.push(x);

  /* ---- 표지 · 결론 먼저 ---- */
  p('<div class="wrap">');
  p('<h1>EGIS Smart Factory — 실행 보고서</h1>');
  p(`<div class="when">${esc(d.at ?? '')} · 시뮬 경과 ${esc(hms(d.elapsedSec))} · 실제로 돈 시간 ${esc(hms(d.ranSec))}</div>`);

  p('<div class="cards">');
  p(card('처리량', d.throughput == null ? '측정 중' : `${num(d.throughput)}<small> 개/시간</small>`));
  p(card('재공(WIP)', `${int(d.wip)}<small> 개</small>`));
  if (d.oee) {
    p(card('OEE', pc(d.oee.oee), 'A × P × Q', rate(d.oee.oee)));
    p(card('가동률 A', pc(d.oee.availability), '고장·무인', rate(d.oee.availability)));
    p(card('성능 P', pc(d.oee.performance), '막힘·굶음', rate(d.oee.performance)));
    p(card('품질 Q', pc(d.oee.quality), '불량', rate(d.oee.quality)));
  }
  if (d.cost) {
    p(card('개당 원가', d.cost.per == null ? '측정 중' : `${int(d.cost.per)}<small> 원</small>`));
    p(card('시간당 원가', `${int(d.cost.perHour)}<small> 원</small>`));
  }
  p('</div>');

  /* ---- 진단 — 「어디를 손볼까」 는 표보다 먼저 나와야 한다 ---- */
  if (d.diagnosis) {
    p(`<p class="note">${esc(d.diagnosis)}${d.culprit ? ` — 손볼 곳은 <b>${esc(d.culprit)}</b> 입니다.` : ''}</p>`);
  }

  /* ---- 오더 ---- */
  p('<h2>생산 오더</h2>');
  p(table(
    ['종류', '목표', '완료', '진척', '완료 지점', '납기', '예상 완료까지', '여유 / 초과', '상태'],
    (d.orders ?? []).map((o) => [
      o.kindName ?? o.kind,
      int(o.qty),
      int(o.done),
      { html: `${pc(o.ratio)}${bar(o.ratio, o.state === ORDER.LATE ? 'bad' : 'good')}` },
      o.atLabel ?? '',
      o.dueMin > 0 ? `${int(o.dueMin)}분` : '—',
      o.eta == null ? '—' : formatSpan(o.eta),
      o.slackSec == null ? '—'
        : { html: `<span class="${o.slackSec < 0 ? 'bad' : 'good'}">${o.slackSec < 0 ? '−' : '+'}${esc(formatSpan(Math.abs(o.slackSec)))}</span>` },
      { html: `<span class="${ORDER_TONE[o.state] ?? ''}">${esc(ORDER_LABEL[o.state] ?? o.state ?? '')}</span>` },
    ]),
    '걸어 둔 오더가 없습니다.',
  ));

  /* ---- 원가 ---- */
  if (d.cost) {
    const c = d.cost;
    p('<h2>원가</h2>');
    p('<div class="cards">');
    p(card('누적', `${int(c.total)}<small> 원</small>`));
    p(card('놀면서 탄 돈', `${int(c.idleBurn)}<small> 원</small>`, `정지 ${pc(c.stopShare)}`, c.stopShare > 0.15 ? ' bad' : ''));
    p(card('불량으로 버린 돈', `${int(c.scrapWon)}<small> 원</small>`, '', c.scrapWon > 0 ? ' bad' : ''));
    p(card('전력 · 사람', `${num(c.kwh)}<small> kWh</small>`, `${num(c.manHours)} 사람·시간`));
    p('</div>');
    p(table(
      ['항목', '금액(원)', '비중'],
      (c.parts ?? []).map((x) => [
        x.label, int(x.won),
        { html: `${pc(c.total > 0 ? x.won / c.total : 0)}${bar(c.total > 0 ? x.won / c.total : 0)}` },
      ]),
      '아직 쓴 것이 없습니다.',
    ));
    p(`<p class="none">단가 — 전기 ${int(c.rates.power)}원/kWh · 인건비 ${int(c.rates.wage)}원/시간`
      + ` · 카트 ${num(c.rates.cartKw, 1)}kW · 자재비 ${c.rates.material ? `${int(c.rates.material)}원/개` : '안 넣음'}</p>`);
  }

  /* ---- 설비 ---- */
  p('<h2>설비</h2>');
  p(table(
    ['이름', '공정 시간(초/개)', '능력(개/분)', '가동률', '막힘', '굶음', '무인', '고장', 'OEE'],
    (d.machines ?? []).map((m) => [
      m.name, num(m.cycleSec), num(m.rate),
      { html: `${pc(m.uptime)}${bar(m.uptime, rate(m.uptime).trim())}`, cls: rate(m.uptime).trim() },
      hms(m.blockSec), hms(m.starveSec), hms(m.crewSec), hms(m.downSec),
      { html: `<span class="${rate(m.oee).trim()}">${pc(m.oee)}</span>` },
    ]),
    '설비가 없습니다.',
  ));

  /* ---- 차량 ---- */
  p('<h2>차량</h2>');
  p(table(
    ['이름', '종류', '대수', '수송 능력(개/분)', '앞차에 막힌 비율'],
    (d.carts ?? []).map((c) => [
      c.name, c.kindName ?? '', int(c.count), num(c.perMinute),
      { html: `${pc(c.blockRatio)}${bar(c.blockRatio, c.blockRatio > 0.3 ? 'bad' : c.blockRatio > 0.1 ? 'warn' : '')}` },
    ]),
    '경로가 없습니다.',
  ));

  /* ---- 쌓이는 곳 ---- */
  p('<h2>적치대 · 선반</h2>');
  p(table(
    ['이름', '현재 재고', '수용량', '참', '거쳐 간 누계', '종류별 누계'],
    (d.stores ?? []).map((s2) => {
      const fill = s2.cap > 0 ? s2.have / s2.cap : 0;
      return [
        s2.name, int(s2.have), int(s2.cap),
        { html: `${pc(fill)}${bar(fill, fill > 0.95 ? 'bad' : fill > 0.8 ? 'warn' : '')}` },
        int(s2.arrivedTotal),
        Object.entries(s2.arrived ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · '),
      ];
    }),
    '쌓이는 곳이 없습니다.',
  ));

  /* ---- 출하 ---- */
  p('<h2>출하 누계</h2>');
  p(table(['종류', '개수'], (d.shipped ?? []).map(([name, n]) => [name, int(n)]), '아직 나간 것이 없습니다.'));

  /* ---- 추이 ---- */
  const svg = chart(d.series);
  if (svg) { p('<h2>생산 추이</h2>'); p(svg); }

  p('<p class="foot">EGIS Smart Factory 에서 자동으로 만든 문서입니다. '
    + '숫자는 화면에 뜬 값과 같습니다 — 이 문서가 다시 계산하지 않습니다. '
    + '엑셀에서 다시 따지려면 같은 자리의 「CSV」 로 받으세요.</p>');
  p('</div>');

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>실행 보고서 — ${esc(d.at ?? '')}</title><style>${CSS}</style></head>`
    + `<body>${s.join('\n')}</body></html>`;
}
