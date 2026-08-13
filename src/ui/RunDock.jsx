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
 *  ── 세로로 길던 것을 가로로 편다 ──────────────────────────────────────────
 *  인스펙터에서는 폭 300px 에 세로로 쌓여 있어서 추이 그래프가 손바닥만 했고,
 *  아래쪽은 스크롤해야 보였다. 여기서는 **폭이 남고 높이가 모자라다** — 성질이
 *  정반대라 그대로 옮기면 안 되고, 칸을 갈라 나란히 놓아야 한다.
 *
 *      지표 │ 생산 추이 │ 돈 시간 순위 │ 원가 │ 단가
 *      └── 이번 실행 ──────────────┘   └── 원가 ──┘
 *
 *  **스크롤을 만들지 않는다.** 계기판은 흘깃 보는 것이라 스크롤이 있으면 안
 *  보이는 값이 생긴다. 그래서 길이가 변하는 것(설비 순위)은 **높이에 맞춰
 *  끊고 「외 n대」로 접는다** — 잘라 놓고 자른 티를 내는 쪽이, 있는데 안
 *  보이는 것보다 낫다.
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
  FIXED_RANGE, KW_RANGE, MATERIAL_RANGE, POWER_RANGE, WAGE_RANGE,
  DEFAULT_RATES, normalizeRates, won,
} from '../core/cost.js';
import { ReportButtons } from './Inspector.jsx';
import { useCostInput } from './useCost.js';
import { MAX_H, MIN_H, dockHeight } from './dockLayout.js';

export { MAX_H, MIN_H, dockHeight };

/** 순위에 몇 대까지 펼 것인가 — 나머지는 「외 n대」로 접는다 */
const RANK_ROWS = 5;

const pct = (v) => `${(v * 100).toFixed(0)} %`;
const tone = (v) => (v < 0.5 ? 'text-rose-500' : v < 0.85 ? 'text-amber-600' : 'text-emerald-600');

/** 늘어나는 칸이 이보다 좁아지면 그래프가 손톱만 해진다 — 그때는 차라리 가로로 민다 */
const GROW_MIN = 150;

/** 띠 안의 한 칸 — 제목은 작게, 내용은 남는 높이를 다 쓴다 */
function Col({ title, right, width, grow, children }) {
  return (
    <div
      className={`flex flex-col px-3 py-2 ${grow ? 'flex-1' : 'shrink-0'}`}
      style={width ? { width } : { minWidth: GROW_MIN }}
    >
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink4">{title}</h3>
        {right}
      </div>
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

/* ---------- 이번 실행 ------------------------------------------------------ */

/** 라인 전체 성적 — 세 기둥을 곱한 것이 OEE 다. 하나만 나빠도 전체가 무너진다 */
function Kpis({ elapsed, overall }) {
  return (
    <>
      <Line label="돌린 시간">{formatElapsed(elapsed)}</Line>
      {overall ? (
        <>
          <Line label="OEE (라인)" big><span className={tone(overall.oee)}>{pct(overall.oee)}</span></Line>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {[
              ['가동률', overall.availability, '고장·무인으로 못 돈 시간 — 정비·인력으로 푼다'],
              ['성능', overall.performance, '막혀서·굶어서 못 돈 시간 — 배치로 푼다'],
              ['양품률', overall.quality, '만들었지만 못 쓰는 것 — 공정으로 푼다'],
            ].map(([label, v, why]) => (
              <div key={label} className="rounded bg-raise px-1 py-1 text-center ring-1 ring-edge" title={why}>
                <div className="text-[9.5px] text-ink4">{label}</div>
                <b className={`text-[11px] tabular-nums ${tone(v)}`}>{pct(v)}</b>
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
function LossRank({ placed }) {
  const blocked = getBlocked();
  const starved = getStarved();
  const unmanned = getUnmanned();
  const ran = getRan();
  const split = lossSplit();

  const rows = placed
    .map((p) => {
      const sec = blocked[p.uid] ?? 0;
      const starve = starved[p.uid] ?? 0;
      const crew = unmanned[p.uid] ?? 0;
      return {
        uid: p.uid,
        name: p.name ?? p.uid,
        sec, starve, crew,
        run: Math.max(0, 1 - Math.min(1, (sec + starve + crew) / ran)),
      };
    })
    .filter((r) => r.sec > LOSS_FLOOR || r.starve > LOSS_FLOOR || r.crew > LOSS_FLOOR)
    .sort((a, b) => a.run - b.run);

  if (!rows.length) {
    return (
      <p className="text-[10.5px] leading-snug text-ink4">
        {placed.length === 0 ? '아직 설비가 없습니다.' : '서 있는 설비가 없습니다 — 라인이 흐르고 있습니다.'}
      </p>
    );
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

      {/**
       * 어느 쪽으로 더 잃었는지 한 줄로 못 박는다.
       *  같은 「성능 40%」 라도 처방이 정반대다. 막힘이 많으면 뒤가 못 받는
       *  것이고(하류를 늘린다), 굶음이 많으면 앞이 못 대는 것이다(상류를 늘린다).
       *  방향을 안 말하면 반대로 손보게 된다.
       */}
      {split?.crew > LOSS_FLOOR ? (
        <p className="mt-1 shrink-0 truncate rounded bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] text-amber-600 ring-1 ring-amber-500/25">
          사람이 없어 선 시간 {formatElapsed(split.crew)} — 「인력」을 먼저 보세요
        </p>
      ) : (
        <p className="mt-1 shrink-0 text-[9.5px] leading-snug text-ink4">
          {split?.starvedMore
            ? <><b className="text-ink2">굶음</b>이 큽니다 — 라인 <b className="text-ink2">앞쪽</b>(투입·앞 공정·카트)을 늘리세요</>
            : <><b className="text-ink2">막힘</b>이 큽니다 — 라인 <b className="text-ink2">뒤쪽</b>(적치대·다음 공정·반출)을 늘리세요</>}
        </p>
      )}
    </div>
  );
}

/* ---------- 원가 ----------------------------------------------------------- */

const TONE = {
  power: 'bg-amber-500', labor: 'bg-sky-500', cart: 'bg-violet-500',
  fixed: 'bg-slate-400', material: 'bg-emerald-500',
};

/** 어디에 돈이 가는지는 액수보다 **비율**로 먼저 보인다 */
function CostBar({ parts, total }) {
  if (!(total > 0)) return null;
  return (
    <div className="mt-1 shrink-0">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-panel2">
        {parts.map((p) => (
          <div key={p.key} className={TONE[p.key] ?? 'bg-ink4'} style={{ width: `${(p.won / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[9.5px] text-ink4">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <i className={`inline-block h-1.5 w-1.5 rounded-sm ${TONE[p.key] ?? 'bg-ink4'}`} />
            {p.label} {Math.round((p.won / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 숫자 하나로 줄이면 **개당 원가**다. 처리량이 높아도 개당이 비싸면 진 배치다.
 *  그 아래 「놀면서 탄 돈」이 고칠 값어치를 액수로 말해 준다.
 */
function CostFigures({ c }) {
  if (!c.ranSec) {
    return (
      <p className="text-[10.5px] leading-snug text-ink4">
        돌리면 전기·인건비·자재비를 합쳐 <b className="text-ink3">개당 원가</b>가 나옵니다.
      </p>
    );
  }
  return (
    <>
      <Line label="개당 원가" big>{c.per == null ? '측정 중' : won(c.per)}</Line>
      <Line label="누적">{won(c.total)}</Line>
      <Line label="시간당">{won(c.perHour)}</Line>
      <CostBar parts={c.parts} total={c.total} />
      <div className="mt-1 shrink-0">
        <Line label="놀면서 탄 돈">
          <span className={c.stopShare > 0.15 ? 'text-rose-500' : ''}>{won(c.idleBurn)}</span>
          <span className="ml-1 text-[9.5px] font-normal text-ink4">정지 {(c.stopShare * 100).toFixed(1)}%</span>
        </Line>
        {c.scrapWon > 0 && <Line label="불량으로 버린 돈"><span className="text-rose-500">{won(c.scrapWon)}</span></Line>}
        <Line label="전력 · 사람">{c.kwh.toFixed(1)} kWh · {c.manHours.toFixed(1)} 사람·시간</Line>
      </div>
    </>
  );
}

function Rates({ rates, set, untouched }) {
  return (
    <div className="space-y-0.5">
      {untouched && <p className="text-[9.5px] text-amber-600">아직 기본값입니다 — 그 공장의 원가가 아닙니다</p>}
      <Knob
        label="전기" value={rates.power} text={`${rates.power} 원/kWh`}
        min={POWER_RANGE[0]} max={POWER_RANGE[1]} step={POWER_RANGE[2]}
        onChange={(v) => set({ power: v })}
      />
      <Knob
        label="인건비" value={rates.wage} text={`${(rates.wage / 1000).toFixed(0)}천 원/시간`}
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
      {/* 인건비는 교대조 **정원**에 물린다 — 이 한 줄이 없으면 왜 0원인지 모른다 */}
      <p className="text-[9.5px] leading-snug text-ink4">
        인건비는 교대조 정원에 붙습니다 — 설비가 서 있어도 나갑니다.
      </p>
    </div>
  );
}

/* ---------- 띠 ------------------------------------------------------------- */

export default function RunDock() {
  const { state, dispatch } = useEditor();
  useMetrics();
  useFaults();
  const elapsed = useElapsed();
  const cost = useCostInput();
  const open = state.showRunDock !== false;

  const overall = oeeOverall(state.placed.map((p) => p.uid));
  const series = getSeries();
  const rates = normalizeRates(state.rates);
  const setRates = (patch) => dispatch({ type: 'SET_RATES', rates: patch });
  /* 손대지 않은 기본값으로 낸 원가는 그 공장의 원가가 아니다. 크게 띄워 놓고
     그 사실을 안 밝히면 회의에서 그대로 인용된다. */
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
      <div className="flex h-6 shrink-0 items-center gap-2 pr-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET', patch: { showRunDock: !open } })}
          className="flex h-full items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-ink4 hover:bg-raiseh"
          title={open ? '접기 — 도면을 넓게 본다' : '펴기 — 이번 실행과 원가를 본다'}
        >
          {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          이번 실행 · 원가
        </button>
        <div className="flex-1" />
        {open && <ReportButtons />}
      </div>

      {open && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          {/* ── 이번 실행 ── 왼쪽. 「무엇이 일어났나」 가 먼저고 「얼마 들었나」 가 뒤다 */}
          <Col title="이번 실행" width={186}>
            <Kpis elapsed={elapsed} overall={overall} />
          </Col>
          <Col title="생산 추이" grow>
            <ProductionChart series={series} />
          </Col>
          <Col title="돈 시간 (낮은 순)" grow>
            <LossRank placed={state.placed} />
          </Col>

          {/* ── 원가 ── 오른쪽 */}
          <Col title="원가" width={216}>
            <CostFigures c={cost} />
          </Col>
          <Col title="단가" width={196}>
            <Rates rates={rates} set={setRates} untouched={untouched} />
          </Col>
        </div>
      )}
    </div>
  );
}
