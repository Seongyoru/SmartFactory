/**
 * =============================================================================
 *  아래 띠 — 이번 실행 · 원가
 * =============================================================================
 *  둘 다 오른쪽 인스펙터에 있었다. 그런데 이 둘은 **무엇을 골랐든 계속 보고
 *  있어야 하는 값**이다 — 설비를 눌러 레시피를 고치는 동안에도 처리량과 개당
 *  원가가 어떻게 움직이는지 봐야 한다. 인스펙터는 「고른 것」을 보여 주는
 *  자리라, 거기 두면 다른 것을 누르는 순간 사라진다(생산 오더를 왼쪽 아래로
 *  내린 것과 같은 이유다).
 *
 *  ── 왜 탭인가 ────────────────────────────────────────────────────────────
 *  처음에는 다섯 칸을 한 줄에 늘어놓았다. 폭이 모자라 **글자가 잘리고 값이
 *  빠졌다** — 항목별 금액도, 설비별 전력도 넣을 자리가 없었다.
 *
 *  띠의 높이는 씬을 16:9 로 남기고 나온 나머지라 늘릴 수 없다. 그러면 남은
 *  방법은 **한 번에 하나씩 보여 주는 것**이고, 그게 탭이다. 탭 하나가 폭을
 *  통째로 쓰니 세 칸이 넉넉해지고, 잘려 나갔던 것이 도로 들어온다.
 *
 *      [이번 실행]  지표 │ 생산 추이 │ 돈 시간 순위 │ 진단
 *      [원가]       요약 │ 어디에 쓰나 │ 손실 │ 단가
 *
 *  ── 스크롤은 만들지 않는다 ────────────────────────────────────────────────
 *  계기판은 흘깃 보는 것이라 스크롤이 있으면 안 보이는 값이 생긴다. 길이가
 *  변하는 것(설비 순위)은 **높이에 맞춰 끊고 「외 n대」로 접는다** — 잘라 놓고
 *  자른 티를 내는 쪽이, 있는데 안 보이는 것보다 낫다.
 * ---------------------------------------------------------------------------
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { formatElapsed, useElapsed } from '../core/clock.js';
import {
  LOSS_FLOOR, getBlocked, getSeries, getStarved, getUnmanned, getRan,
  lossSplit, oeeOverall, useMetrics,
} from '../core/metrics.js';
import { useFaults } from '../core/faults.js';
import {
  KW_RANGE, MATERIAL_RANGE, POWER_RANGE, WAGE_RANGE,
  DEFAULT_RATES, normalizeRates, won,
} from '../core/cost.js';
import { ReportButtons } from './Inspector.jsx';
import { useCostInput } from './useCost.js';
import { MAX_H, MIN_H, dockHeight } from './dockLayout.js';

export { MAX_H, MIN_H, dockHeight };

/** 순위에 몇 대까지 펼 것인가 — 나머지는 「외 n대」로 접는다 */
const RANK_ROWS = 5;
/** 늘어나는 칸이 이보다 좁아지면 그래프가 손톱만 해진다 — 그때는 차라리 가로로 민다 */
const GROW_MIN = 170;

const pct = (v) => `${(v * 100).toFixed(0)} %`;
const tone = (v) => (v < 0.5 ? 'text-rose-500' : v < 0.85 ? 'text-amber-600' : 'text-emerald-600');

/** 띠 안의 한 칸 — 제목은 작게, 내용은 남는 높이를 다 쓴다 */
function Col({ title, width, children }) {
  return (
    <div
      className={`flex flex-col px-3 py-2 ${width ? 'shrink-0' : 'flex-1'}`}
      style={width ? { width } : { minWidth: GROW_MIN }}
    >
      <h3 className="mb-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink4">{title}</h3>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/** 이름 : 값 한 줄 — 띠에서는 인스펙터의 Row 보다 촘촘해야 한다 */
function Line({ label, children, big }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]">
      <span className="shrink-0 text-[10.5px] text-ink4">{label}</span>
      <span className={`truncate text-right tabular-nums ${big ? 'text-[15px] font-semibold text-ink' : 'text-[11.5px] font-medium text-ink2'}`}>
        {children}
      </span>
    </div>
  );
}

/** 값이 오른쪽에 붙는 납작한 슬라이더 — 띠에는 높이가 없다 */
function Knob({ label, value, text, onChange, min, max, step }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] text-ink4">{label}</span>
        <b className="text-[11px] tabular-nums text-ink2">{text}</b>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-3 w-full accent-sky-500"
      />
    </label>
  );
}

/* ==========================================================================
 * 이번 실행
 * ======================================================================== */

/** 라인 전체 성적 — 세 기둥을 곱한 것이 OEE 다. 하나만 나빠도 전체가 무너진다 */
function Kpis({ elapsed, overall }) {
  return (
    <>
      <Line label="돌린 시간">{formatElapsed(elapsed)}</Line>
      {overall ? (
        <>
          <Line label="OEE (라인)" big><span className={tone(overall.oee)}>{pct(overall.oee)}</span></Line>
          <div className="mt-1.5 space-y-1">
            {[
              ['가동률', overall.availability, '고장·무인으로 못 돈 시간 — 정비·인력으로 푼다'],
              ['성능', overall.performance, '막혀서·굶어서 못 돈 시간 — 배치로 푼다'],
              ['양품률', overall.quality, '만들었지만 못 쓰는 것 — 공정으로 푼다'],
            ].map(([label, v, why]) => (
              <div key={label} title={why}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] text-ink4">{label}</span>
                  <b className={`text-[10.5px] tabular-nums ${tone(v)}`}>{pct(v)}</b>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-kbd">
                  <div
                    className={`h-full ${v < 0.5 ? 'bg-rose-500' : v < 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.max(2, v * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[10.5px] leading-snug text-ink4">설비를 놓고 돌리면 OEE 가 나옵니다.</p>
      )}
    </>
  );
}

/** 시간 × 누적 출하. 인스펙터에서는 220px 폭이었다 — 여기서는 칸을 다 쓴다 */
function ProductionChart({ series }) {
  if (series.length < 2) {
    return <p className="text-[10.5px] leading-snug text-ink4">표본을 모으는 중입니다 — 10초에 하나씩 찍힙니다.</p>;
  }
  const W = 220;
  const H = 44;
  const t0 = series[0].t;
  const span = Math.max(1e-6, series[series.length - 1].t - t0);
  const top = Math.max(1, series[series.length - 1].shipped);
  const pts = series
    .map((s) => `${(((s.t - t0) / span) * W).toFixed(1)},${(H - (s.shipped / top) * H).toFixed(1)}`)
    .join(' ');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 높이를 안 박는다 — 띠가 높아지면 그래프도 같이 커진다 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="min-h-0 w-full flex-1" preserveAspectRatio="none">
        {/* 채움은 흐리게, 선은 또렷하게 — 값보다 모양(기울기)이 먼저 읽혀야 한다 */}
        <polyline points={`0,${H} ${pts} ${W},${H}`} fill="rgb(14 165 233 / 0.14)" stroke="none" />
        <polyline points={pts} fill="none" stroke="rgb(14 165 233)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-0.5 flex shrink-0 justify-between text-[10px] tabular-nums text-ink4">
        <span>{formatElapsed(t0)}</span>
        <span>{top.toLocaleString()} 개</span>
      </div>
    </div>
  );
}

/**
 * 선 적이 있는 설비만, **많이 잃은 순서**로.
 * ---------------------------------------------------------------------------
 *  막힌 시간만 세어 줄을 세우면, 라인 전체가 굶어 서 있는 도면이 「아무 문제
 *  없음」 으로 나온다 — 가장 심하게 놀고 있을 때 표가 가장 조용해진다. 잃은
 *  시간은 합쳐 줄을 세우고, **어느 쪽으로 잃었는지는 줄마다 적는다.**
 */
function lossRows(placed) {
  const blocked = getBlocked();
  const starved = getStarved();
  const unmanned = getUnmanned();
  const ran = getRan();
  return placed
    .map((p) => {
      const sec = blocked[p.uid] ?? 0;
      const starve = starved[p.uid] ?? 0;
      const crew = unmanned[p.uid] ?? 0;
      return {
        uid: p.uid,
        name: p.name ?? p.uid,
        sec, starve, crew,
        run: ran > 0 ? Math.max(0, 1 - Math.min(1, (sec + starve + crew) / ran)) : 1,
      };
    })
    .filter((r) => r.sec > LOSS_FLOOR || r.starve > LOSS_FLOOR || r.crew > LOSS_FLOOR)
    .sort((a, b) => a.run - b.run);
}

function LossRank({ rows, empty }) {
  if (!rows.length) {
    return <p className="text-[10.5px] leading-snug text-ink4">{empty}</p>;
  }
  const shown = rows.slice(0, RANK_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="min-h-0 flex-1 space-y-[3px]">
        {shown.map((r) => (
          <li key={r.uid}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] text-ink2">{r.name}</span>
              <b className={`shrink-0 text-[11px] tabular-nums ${tone(r.run)}`}>{(r.run * 100).toFixed(0)}%</b>
            </div>
            {/* 막대가 짧을수록 오래 서 있었다 — 숫자보다 먼저 눈에 들어온다 */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-kbd">
              <div
                className={`h-full ${r.run < 0.5 ? 'bg-rose-500' : r.run < 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max(2, r.run * 100)}%` }}
              />
            </div>
            <div className="truncate text-[9.5px] tabular-nums text-ink4">
              {[
                r.crew > LOSS_FLOOR ? `${formatElapsed(r.crew)} 무인` : null,
                r.sec > LOSS_FLOOR ? `${formatElapsed(r.sec)} 막힘` : null,
                r.starve > LOSS_FLOOR ? `${formatElapsed(r.starve)} 굶음` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </li>
        ))}
      </ul>
      {/* 잘랐으면 **잘랐다고 말한다** — 조용히 감추면 없는 줄 안다 */}
      {hidden > 0 && <p className="shrink-0 text-[9.5px] text-ink4">외 {hidden}대 — 보고서에 전부 들어갑니다</p>}
    </div>
  );
}

/**
 * 어느 쪽으로 더 잃었는지 못 박는다.
 * ---------------------------------------------------------------------------
 *  같은 「성능 40%」 라도 처방이 정반대다. 막힘이 많으면 뒤가 못 받는 것이고
 *  (하류를 늘린다), 굶음이 많으면 앞이 못 대는 것이다(상류를 늘린다). 숫자만
 *  늘어놓고 방향을 안 말하면 반대로 손보게 된다.
 */
function Diagnosis({ hasRows }) {
  const split = lossSplit();
  if (!hasRows || !split) {
    return <p className="text-[10.5px] leading-snug text-ink4">서 있는 설비가 없습니다 — 라인이 흐르고 있습니다.</p>;
  }
  const total = split.block + split.starve + split.crew;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {[
        ['막힘', split.block, 'bg-rose-500', '보낼 곳이 없다'],
        ['굶음', split.starve, 'bg-amber-500', '받을 것이 없다'],
        ['무인', split.crew, 'bg-violet-500', '돌릴 사람이 없다'],
      ].filter(([, v]) => v > LOSS_FLOOR).map(([label, v, bg, why]) => (
        <div key={label} className="mb-1" title={why}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-ink4">{label} <span className="text-ink4/70">— {why}</span></span>
            <b className="shrink-0 text-[10.5px] tabular-nums text-ink2">{formatElapsed(v)}</b>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-kbd">
            <div className={`h-full ${bg}`} style={{ width: `${total > 0 ? (v / total) * 100 : 0}%` }} />
          </div>
        </div>
      ))}

      <div className="flex-1" />

      {/* 사람이 없어 선 시간이 있으면 그게 먼저다 — 배치를 아무리 고쳐도 안 돈다 */}
      {split.crew > LOSS_FLOOR && (
        <p className="mb-1 shrink-0 rounded bg-amber-500/10 px-1.5 py-1 text-[9.5px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
          사람이 없어 선 시간이 {formatElapsed(split.crew)} 있습니다. 배치를 고쳐도 안 풀립니다 —
          「인력」에서 교대 인원을 먼저 보세요.
        </p>
      )}
      <p className="shrink-0 text-[10px] leading-snug text-ink4">
        {split.starvedMore
          ? <><b className="text-ink2">굶음</b>이 더 큽니다 — 재료가 여기까지 못 옵니다. 라인 <b className="text-ink2">앞쪽</b>(투입·앞 공정·나르는 카트)을 늘리세요.</>
          : <><b className="text-ink2">막힘</b>이 더 큽니다 — 만들었는데 보낼 곳이 없습니다. 라인 <b className="text-ink2">뒤쪽</b>(적치대 수용량·다음 공정·반출)을 늘리세요.</>}
        {' '}맨 위를 풀면 그다음이 병목이 됩니다.
      </p>
    </div>
  );
}

/* ==========================================================================
 * 원가
 * ======================================================================== */

const TONE = {
  power: 'bg-amber-500', labor: 'bg-sky-500', cart: 'bg-violet-500',
  fixed: 'bg-slate-400', material: 'bg-emerald-500',
};

/** 숫자 하나로 줄이면 **개당 원가**다. 처리량이 높아도 개당이 비싸면 진 배치다 */
function CostSummary({ c }) {
  return (
    <>
      <Line label="개당 원가" big>{c.per == null ? '측정 중' : won(c.per)}</Line>
      {c.good > 0 && <p className="mb-1 text-right text-[9.5px] text-ink4">양품 {c.good.toLocaleString()}개 기준</p>}
      <Line label="누적">{won(c.total)}</Line>
      <Line label="시간당">{won(c.perHour)}</Line>
      <Line label="전력">{c.kwh.toFixed(1)} kWh</Line>
      <Line label="사람">{c.manHours.toFixed(1)} 사람·시간</Line>
    </>
  );
}

/**
 * 어디에 돈이 가는가 — 비율과 **금액을 같이** 준다.
 *  칸이 좁을 때는 비율만 있었다. 「인건비 93%」 만으로는 그게 큰돈인지 모른다.
 */
function CostParts({ c }) {
  if (!(c.total > 0)) return <p className="text-[10.5px] text-ink4">아직 쓴 것이 없습니다.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-2 shrink-0 overflow-hidden rounded-full bg-panel2">
        {c.parts.map((p) => (
          <div key={p.key} className={TONE[p.key] ?? 'bg-ink4'} style={{ width: `${(p.won / c.total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-1.5 min-h-0 flex-1 space-y-[3px]">
        {c.parts.map((p) => (
          <li key={p.key} className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <i className={`inline-block h-2 w-2 shrink-0 rounded-sm ${TONE[p.key] ?? 'bg-ink4'}`} />
              <span className="truncate text-[10.5px] text-ink4">{p.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <b className="text-[11px] text-ink2">{won(p.won)}</b>
              <span className="ml-1 text-[9.5px] text-ink4">{Math.round((p.won / c.total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 안 만들면서 나간 돈.
 *  「막힘 12%」 는 안 와 닿지만 **「시간당 4만원씩 탄다」 는 와 닿는다** —
 *  진단이 짚은 원인을 고칠지 말지가 여기서 갈린다.
 */
function CostLoss({ c }) {
  return (
    <>
      <Line label="놀면서 탄 돈" big>
        <span className={c.stopShare > 0.15 ? 'text-rose-500' : ''}>{won(c.idleBurn)}</span>
      </Line>
      <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-kbd">
        <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, c.stopShare * 100)}%` }} />
      </div>
      <Line label="정지 비중">{(c.stopShare * 100).toFixed(1)} %</Line>
      <Line label="불량으로 버린 돈">
        <span className={c.scrapWon > 0 ? 'text-rose-500' : ''}>{won(c.scrapWon)}</span>
      </Line>
      {c.total > 0 && (
        <Line label="이 둘이 차지하는 몫">
          {(((c.idleBurn + c.scrapWon) / c.total) * 100).toFixed(1)} %
        </Line>
      )}
      <p className="mt-1.5 text-[9.5px] leading-snug text-ink4">
        서 있어도 <b className="text-ink3">인건비·고정비는 그대로</b> 나가고 전기는 대기 전력만
        나갑니다. 설비마다 가동·대기 kW 는 인스펙터의 「전력 · 고정비」에서 정합니다.
      </p>
    </>
  );
}

function Rates({ rates, set, untouched }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-0.5">
        <Knob
          label="전기" value={rates.power} text={`${rates.power} 원/kWh`}
          min={POWER_RANGE[0]} max={POWER_RANGE[1]} step={POWER_RANGE[2]}
          onChange={(v) => set({ power: v })}
        />
        <Knob
          label="인건비" value={rates.wage} text={`${rates.wage.toLocaleString()} 원/시간`}
          min={WAGE_RANGE[0]} max={WAGE_RANGE[1]} step={WAGE_RANGE[2]}
          onChange={(v) => set({ wage: v })}
        />
        <Knob
          label="카트 한 대" value={rates.cartKw} text={`${rates.cartKw} kW`}
          min={KW_RANGE[0]} max={20} step={0.1}
          onChange={(v) => set({ cartKw: v })}
        />
        <Knob
          label="자재비" value={rates.material}
          text={rates.material ? `${rates.material.toLocaleString()} 원/개` : '안 넣음'}
          min={MATERIAL_RANGE[0]} max={MATERIAL_RANGE[1]} step={MATERIAL_RANGE[2]}
          onChange={(v) => set({ material: v })}
        />
      </div>
      {/* 손대지 않은 기본값으로 낸 원가는 **그 공장의 원가가 아니다.** 액수를 크게
          띄워 놓고 그 사실을 안 밝히면 회의에서 그대로 인용된다. */}
      <p className={`shrink-0 text-[9.5px] leading-snug ${untouched ? 'text-amber-600' : 'text-ink4'}`}>
        {untouched
          ? '아직 기본값입니다 — 그 공장의 원가가 아닙니다. 위 넷을 자기 숫자로 바꾸세요.'
          : '인건비는 교대조 정원에 붙습니다 — 설비가 서 있어도 나갑니다.'}
      </p>
    </div>
  );
}

/* ==========================================================================
 * 띠
 * ======================================================================== */

const TABS = [['run', '이번 실행'], ['cost', '원가']];

export default function RunDock() {
  const { state, dispatch } = useEditor();
  useMetrics();
  useFaults();
  const elapsed = useElapsed();
  const cost = useCostInput();
  const open = state.showRunDock !== false;
  const tab = state.runTab === 'cost' ? 'cost' : 'run';

  const overall = oeeOverall(state.placed.map((p) => p.uid));
  const series = getSeries();
  const rows = lossRows(state.placed);
  const rates = normalizeRates(state.rates);
  const untouched = Object.keys(DEFAULT_RATES).every((k) => rates[k] === DEFAULT_RATES[k]);

  const ref = useRef(null);
  const [h, setH] = useState(MIN_H);
  useLayoutEffect(() => {
    /* 부모(main)를 잰다. 띠는 그 안에 있으므로 띠가 커져도 부모는 안 흔들린다 —
       자기 자신을 재면 크기를 정하는 일이 되먹임으로 돌아 떨린다. */
    const main = ref.current?.parentElement;
    if (!main) return undefined;
    const measure = () => {
      const r = main.getBoundingClientRect();
      setH(dockHeight(r.width, r.height));
    };
    /* 처음 한 번은 **직접** 잰다. ResizeObserver 는 브라우저의 렌더 단계에서
       불려서, 창이 가려져 그리지 않는 동안에는 한 번도 안 온다 — 그러면 띠가
       초기값(MIN_H)에 얼어붙는다. 실제로 개발 환경에서 그렇게 나왔다. */
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative z-10 flex shrink-0 flex-col border-t border-line bg-panel"
      style={open ? { height: h } : undefined}
    >
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line pr-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET', patch: { showRunDock: !open } })}
          className="flex h-full items-center px-2 text-ink4 hover:text-ink2"
          title={open ? '접기 — 도면을 넓게 본다' : '펴기 — 이번 실행과 원가를 본다'}
        >
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>

        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            /* 접힌 채로 탭을 누르면 **펴면서** 그 탭으로 간다 — 두 번 누르게 하지 않는다 */
            onClick={() => dispatch({ type: 'SET', patch: { runTab: id, showRunDock: true } })}
            className={`-mb-px h-full border-b-2 px-3 text-[11px] font-medium transition-colors ${
              open && tab === id
                ? 'border-sky-500 text-ink'
                : 'border-transparent text-ink4 hover:text-ink2'
            }`}
          >
            {label}
          </button>
        ))}

        <div className="flex-1" />
        {/* 보고서·다시 재기는 **실행 쪽 일**이다 — 단가를 만지는 중에 「다시 재기」가
            옆에 있으면 잘못 누르기 쉽고, 누르면 기록이 통째로 날아간다 */}
        {open && tab === 'run' && <ReportButtons />}
      </div>

      {open && tab === 'run' && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          <Col title="지표" width={190}>
            <Kpis elapsed={elapsed} overall={overall} />
          </Col>
          <Col title="생산 추이">
            <ProductionChart series={series} />
          </Col>
          <Col title="돈 시간 (낮은 순)">
            <LossRank
              rows={rows}
              empty={state.placed.length === 0 ? '아직 설비가 없습니다.' : '서 있는 설비가 없습니다 — 라인이 흐르고 있습니다.'}
            />
          </Col>
          <Col title="어디를 손볼까" width={300}>
            <Diagnosis hasRows={rows.length > 0} />
          </Col>
        </div>
      )}

      {open && tab === 'cost' && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          {cost.ranSec ? (
            <>
              <Col title="원가" width={190}>
                <CostSummary c={cost} />
              </Col>
              <Col title="어디에 쓰나">
                <CostParts c={cost} />
              </Col>
              <Col title="안 만들면서 나간 돈" width={250}>
                <CostLoss c={cost} />
              </Col>
              <Col title="단가">
                <Rates rates={rates} set={(patch) => dispatch({ type: 'SET_RATES', rates: patch })} untouched={untouched} />
              </Col>
            </>
          ) : (
            <>
              <Col title="원가">
                <p className="text-[11px] leading-relaxed text-ink4">
                  아직 돌리지 않았습니다. 시뮬레이션을 시작하면 전기·인건비·자재비를 합쳐
                  <b className="text-ink3"> 개당 원가</b>가 나옵니다.
                </p>
              </Col>
              <Col title="단가">
                <Rates rates={rates} set={(patch) => dispatch({ type: 'SET_RATES', rates: patch })} untouched={untouched} />
              </Col>
            </>
          )}
        </div>
      )}
    </div>
  );
}
