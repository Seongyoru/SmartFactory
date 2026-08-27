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
 *  통째로 쓰니 네 칸이 넉넉해지고, 잘려 나갔던 것이 도로 들어온다.
 *
 *      [실행]  지표 │ 생산 추이 │ 작동 시간 │ 병목 시간
 *      [원가]  원가 │ 원가 구성 │ 손실 원가 │ 단가
 *
 *  ── 높이가 없다, 그러니 **폭으로 푼다** ───────────────────────────────────
 *  띠에 남는 높이는 200px 남짓이다. 세로로 쌓는 것은 무엇이든 서너 줄에서
 *  잘린다 — 설비 순위가 세 대에서 끊겼고, 단가 슬라이더는 넷째가 잘려 그
 *  자리에 아래 설명이 겹쳐 찍혔다. 둘 다 **두 열로 나눠** 풀었다. 폭은 남으니까.
 *
 *  ── 스크롤은 **넘치는 칸만** ──────────────────────────────────────────────
 *  계기판은 흘깃 보는 것이라 띠 전체가 스크롤되면 안 된다. 다만 설비 목록처럼
 *  **길이가 도면에 따라 변하는 것**은 접어 감추면 볼 방법이 없어지므로, 그
 *  칸 안에서만 스크롤한다.
 *
 *  ── 이름을 보여 줬으면 **가는 길도** 준다 ─────────────────────────────────
 *  설비 목록은 누르면 그리로 카메라가 가고 선택까지 된다(왼쪽 위 알람과 같은
 *  몸짓). 이름만 있으면 스무 대 놓인 도면에서 그걸 눈으로 다시 찾아야 하고,
 *  그 수고가 목록을 보는 값어치를 깎는다.
 * ---------------------------------------------------------------------------
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Repeat, RotateCcw } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { focusOn } from '../core/focusStore.js';
import { formatElapsed, useElapsed } from '../core/clock.js';
import {
  LOSS_FLOOR, getBlocked, getSeries, getStarved, getUnmanned, getRan,
  WARMUP, getPlanned, getSetup, getWarmup, leadTimeSec, lossSplit, oeeOverall, throughput,
  useMetrics, warmupLeft,
} from '../core/metrics.js';
import { useFaults } from '../core/faults.js';
import { getShipped, shippedTotal, useAllStock, useShipped } from '../core/simStore.js';
import {
  KW_RANGE, MATERIAL_MAX, MATERIAL_RANGE, POWER_RANGE, WAGE_RANGE,
  DEFAULT_RATES, normalizeRates, won,
} from '../core/cost.js';
import { OUT_BTN, ReportButtons } from './Inspector.jsx';
import { useCostInput } from './useCost.js';
import { useLineWorld } from './useLineWorld.js';
import { ciText, replicate } from '../core/replicate.js';
import { resetRun } from '../core/sim.js';
import { bestOf, kneeOf, kneeText, knobOf, knobsFor, sweep } from '../core/sweep.js';
import { fitOf, fitText, matchOf, matchText, movedFrom } from '../core/calibrate.js';
import { rankOf, stepsOf, swingOf, swingText, tornadoText } from '../core/sensitivity.js';
import { warmupText } from '../core/warmup.js';
import { worldOf } from '../core/lineup.js';
import { specReader } from './useLineWorld.js';
import { isStillage } from '../data/library.js';
import { MAX_H, MIN_H, dockHeight } from './dockLayout.js';

export { MAX_H, MIN_H, dockHeight };

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
function Line({ label, children, big, title }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[1px]" title={title}>
      <span className="shrink-0 text-[10.5px] text-ink4">{label}</span>
      <span className={`truncate text-right tabular-nums ${big ? 'text-[15px] font-semibold text-ink' : 'text-[11.5px] font-medium text-ink2'}`}>
        {children}
      </span>
    </div>
  );
}

/**
 * 납작한 슬라이더 + **손으로 적는 칸**.
 * ---------------------------------------------------------------------------
 *  슬라이더만으로는 정확한 값을 못 맞춘다. 12,000 을 맞추려고 손잡이를 픽셀
 *  단위로 미는 것은 일이 아니라 고역이고, 슬라이더 범위 밖의 값(비싼 자재)은
 *  아예 넣을 수가 없다. 그래서 **두 길을 다 연다** — 슬라이더는 어림잡을 때,
 *  숫자 칸은 아는 값을 그대로 적을 때.
 *
 *  @param hardMax 손으로 적을 때의 한계. 없으면 슬라이더 최대와 같다
 */
function Knob({ label, value, unit, onChange, min, max, step, hardMax }) {
  const cap = hardMax ?? max;
  /* 타이핑 중에는 **적은 그대로** 둔다. 한 글자 칠 때마다 정규화해서 되돌리면
     「1」 을 지우고 「2」 를 못 치거나 앞자리가 튀어 오른다. */
  const [draft, setDraft] = useState(null);

  const commit = (raw) => {
    const n = Number(String(raw).replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && raw !== '') onChange(Math.min(cap, Math.max(min, n)));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="shrink-0 text-[10.5px] text-ink4">{label}</span>
        <span className="flex min-w-0 items-baseline gap-0.5">
          <input
            type="text"
            inputMode="decimal"
            value={draft ?? value.toLocaleString()}
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
            onBlur={() => setDraft(null)}
            /* 엔터로 확정 — 슬라이더로 갔다가 돌아오는 사람이 없게 */
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="w-[68px] rounded bg-raise px-1 py-px text-right text-[11px] tabular-nums text-ink2 ring-1 ring-edge focus:ring-sky-500"
            aria-label={`${label} 값`}
          />
          <span className="shrink-0 text-[9.5px] text-ink4">{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        /* 슬라이더는 자기 범위 안에서만 논다. 손으로 더 크게 적었으면 끝에 붙는다 */
        value={Math.min(max, value)}
        onChange={(e) => { setDraft(null); onChange(Number(e.target.value)); }}
        className="h-3 w-full accent-sky-500"
      />
    </div>
  );
}

/* ==========================================================================
 * 여러 번 돌려 보기
 * ======================================================================== */

/**
 * **한 번 돌린 값은 사실 아무 말도 안 한다.**
 * ---------------------------------------------------------------------------
 *  고장과 공정 편차가 든 모델에서는 다시 돌리면 다른 값이 나온다. 그런데 이
 *  화면은 지금까지 한 번 돌린 숫자 하나를 「이 배치의 처리량」이라고 말해 왔다.
 *
 *  여기서는 **화면 없이** 여러 판을 굴려 평균과 신뢰구간을 낸다. 시뮬 틱이
 *  core 로 나와 있어서(core/sim.js) 30분짜리 한 판이 몇 ms 다.
 *
 *  ── 지금 실행을 건드린다, 그래서 비운다 ──────────────────────────────────
 *  스토어가 모듈 전역이라 반복 실행이 **화면의 실행을 덮어쓴다.** 끝나면
 *  `resetRun()` 으로 비우고, 그 사실을 화면이 말해 준다 — 값이 반쯤 섞인 채
 *  남는 것보다 낫고, 말없이 비우면 「내 기록이 왜 사라졌지」가 된다.
 */
function Replicate() {
  const { world, flow, ready, capacity } = useLineWorld();
  const [reps, setReps] = useState(10);
  const [mins, setMins] = useState(30);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);

  const go = () => {
    setBusy(true);
    /* 한 틱 쉬어 「돌리는 중」이 실제로 그려지게 한다 — 안 그러면 멈춘 듯 보인다 */
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const r = replicate({
          reps, seconds: mins * 60, seed: 1, world, flow,
          pick: () => throughput(shippedTotal(getShipped())) ?? 0,
        });
        setOut({ ...r, ms: performance.now() - t0 });
      } catch (e) {
        console.error('[반복 실행] 실패', e);
        setOut(null);
      } finally {
        resetRun();
        setBusy(false);
      }
    }, 30);
  };

  if (!ready) {
    return <p className="text-[10.5px] leading-relaxed text-ink4">설비를 놓으면 여러 번 돌려 볼 수 있습니다.</p>;
  }

  return (
    <>
      <div className="flex items-end gap-1.5">
        <label className="flex-1">
          <span className="block text-[10px] text-ink4">판 수</span>
          <input
            type="number" min={2} max={50} value={reps}
            onChange={(e) => setReps(Math.max(2, Math.min(50, Number(e.target.value) || 2)))}
            className="w-full rounded bg-raise px-1 py-px text-right text-[11px] tabular-nums text-ink2 ring-1 ring-edge focus:ring-sky-500"
          />
        </label>
        <label className="flex-1">
          <span className="block text-[10px] text-ink4">한 판 (분)</span>
          <input
            type="number" min={1} max={480} value={mins}
            onChange={(e) => setMins(Math.max(1, Math.min(480, Number(e.target.value) || 1)))}
            className="w-full rounded bg-raise px-1 py-px text-right text-[11px] tabular-nums text-ink2 ring-1 ring-edge focus:ring-sky-500"
          />
        </label>
      </div>
      <button type="button" onClick={go} disabled={busy} className={`${OUT_BTN} mt-1.5 w-full justify-center disabled:opacity-50`}>
        <Repeat size={13} /> {busy ? '돌리는 중…' : '여러 번 돌려 보기'}
      </button>

      {out && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {/**
            * **0 을 「0 ± 0」 이라고 하면 안 된다.**
            *  처리량은 **밖으로 나간 것**을 센다(app 의 다른 곳과 같은 정의다).
            *  트럭과 개구부가 없는 도면은 나가는 것이 없어 늘 0 이 나오는데,
            *  그걸 「0 ± 0 개/시」 라고 찍으면 기능이 고장 난 것처럼 보인다.
            *  0 인 이유를 말해 주는 편이 낫다 — 정의를 하나 더 만드는 것보다.
            */}
          {out.mean > 0 ? (
            <>
              <Line label="처리량" big>{ciText(out, 0)}<span className="text-[10px] text-ink4"> 개/시</span></Line>
              <p className="mt-0.5 text-[9.5px] leading-snug text-ink4">
                {out.n}판 · 95% 구간 <b className="text-ink3">{out.lo.toFixed(0)} ~ {out.hi.toFixed(0)}</b>
                {' · '}{Math.round(out.ms)}ms
              </p>
              {/**
                * **천장과 잰 값을 나란히 놓는다.**
                * -----------------------------------------------------------
                *  「라인 능력」은 계산으로 나오는 천장이고(고장도 없고 굶지도
                *  않는 라인), 여기 값은 실제로 돌려서 **잰** 것이다. 두 숫자가
                *  각자 다른 화면에 있으면 사람이 머리로 빼야 하는데, 정작
                *  **그 차이가 곧 손실**이라 그게 이 도구가 답해야 할 값이다.
                *
                *  천장이 0 이면 (벨트가 안 물려 계산이 안 되는 도면) 안 그린다 —
                *  「0% 」 는 잰 값이 있는데도 아무 말도 못 하는 것보다 나쁘다.
                */}
              {capacity > 0 && (
                <p className="mt-1 text-[9.5px] leading-snug text-ink4">
                  천장 <b className="text-ink3">{(capacity * 60).toFixed(0)} 개/시</b> 의{' '}
                  <b className="text-ink2">{Math.round((out.mean / (capacity * 60)) * 100)}%</b> 입니다 —
                  나머지는 고장 · 굶음 · 막힘으로 샌 것입니다.
                </p>
              )}

          <p className="mt-1 text-[9.5px] leading-snug text-ink4">
            <b className="text-ink3">± 가 큰 것은 배치가 나쁜 게 아니라</b> 그만큼 흔들린다는 뜻입니다.
            판 수를 늘리면 구간이 좁아집니다.
          </p>
            </>
          ) : (
            <p className="text-[10px] leading-relaxed text-ink4">
              {out.n}판을 돌렸지만 <b className="text-ink3">밖으로 나간 것이 없습니다</b>({Math.round(out.ms)}ms).
              처리량은 트럭이 개구부로 실어 낸 것을 셉니다 — 출하 경로를 놓아야 잡힙니다.
            </p>
          )}
          <p className="mt-1 text-[9.5px] leading-snug text-amber-600">
            화면의 이번 실행은 <b>비워졌습니다</b> — 여러 판이 같은 자리를 쓰기 때문입니다.
          </p>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
 * 이번 실행
 * ======================================================================== */

/** 라인 전체 성적 — 세 기둥을 곱한 것이 OEE 다. 하나만 나빠도 전체가 무너진다 */
function Kpis({ elapsed, overall, flow, warmup }) {
  return (
    <>
      <Line label="경과 시간">{formatElapsed(elapsed)}</Line>
      {/**
        * 예열 — **언제부터 잰 값이 뜻을 갖나.**
        * ---------------------------------------------------------------------
        *  예전에는 10초 고정이었다. 240초에 한 판을 굽는 오븐이 있는 라인에서
        *  11초에 나온 값을 「측정 끝」이라고 내놓으면 도구가 사람을 속이는 것이다.
        *  이제 도면에서 세고(`core/warmup.js`), **왜 그만큼인지도 적는다.**
        */}
      {warmup?.sec > WARMUP && (
        <Line label="예열" title="이만큼은 돌아야 처리량이 뜻을 갖습니다 — 도면에서 셉니다">
          <span className={warmupLeft() > 0 ? 'text-amber-600' : 'text-ink3'}>
            {formatElapsed(warmup.sec)}
          </span>
          {warmupLeft() > 0 && (
            <span className="ml-1 text-[10px] tabular-nums text-ink4">{formatElapsed(warmupLeft())} 남음</span>
          )}
        </Line>
      )}
      {warmup?.sec > WARMUP && (
        <p className="-mt-0.5 mb-1 text-[9.5px] leading-snug text-ink4">{warmupText(warmup)}</p>
      )}
      {/**
        * 계획정지 — **부하시간 밖의 시간.**
        * ---------------------------------------------------------------------
        *  쉬는 조(주말 · 정기보전)가 있으면 시계는 8시간인데 지표의 분모는
        *  6시간이다. 그 차이를 안 적으면 「경과 시간과 성적표가 안 맞는다」가
        *  되어, 도구를 못 믿게 된다.
        */}
      {getPlanned() > 1 && (
        <Line label="계획정지" title="주말 · 정기보전 — OEE 의 분모(부하시간)에서 뺀 시간">
          <span className="text-amber-600">{formatElapsed(getPlanned())}</span>
          <span className="ml-1 text-[10px] text-ink4">부하 {formatElapsed(getRan())}</span>
        </Line>
      )}
      {/**
        * 리드타임 — **셋 중 하나가 비어 있었다.**
        * ---------------------------------------------------------------------
        *  재공도 세고 처리량도 셌는데 정작 「한 개가 몇 분 걸려 나오나」 를 안
        *  말하고 있었다. 셋은 리틀의 법칙으로 묶여 있어서 둘만 보여 주면 읽는
        *  사람이 머릿속으로 나눠야 한다 — 그건 도구가 할 일이다.
        */}
      {flow.lead != null && (
        <Line label="리드타임" title="재공 ÷ 처리량 (리틀의 법칙) — 한 개가 들어와 나가기까지">
          {formatElapsed(flow.lead)}
        </Line>
      )}
      {flow.wip > 0 && flow.lead == null && (
        <Line label="리드타임"><span className="text-ink4">측정 중</span></Line>
      )}
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
  const setup = getSetup();
  const ran = getRan();
  return placed
    .map((p) => {
      const sec = blocked[p.uid] ?? 0;
      const starve = starved[p.uid] ?? 0;
      const crew = unmanned[p.uid] ?? 0;
      const change = setup[p.uid] ?? 0;
      return {
        uid: p.uid,
        name: p.name ?? p.uid,
        sec, starve, crew, change,
        run: ran > 0 ? Math.max(0, 1 - Math.min(1, (sec + starve + crew + change) / ran)) : 1,
      };
    })
    .filter((r) => r.sec > LOSS_FLOOR || r.starve > LOSS_FLOOR || r.crew > LOSS_FLOOR)
    .sort((a, b) => a.run - b.run);
}

/**
 * 설비마다 얼마나 돌았나 — **두 열로 반씩 나눠** 담는다.
 * ---------------------------------------------------------------------------
 *  한 열로 늘어놓았더니 띠 높이(약 210px)에 세 대밖에 안 들어가고 네 번째가
 *  잘렸다. 「외 n대」 로 접어 봐야 그 n대를 볼 방법이 없다. 두 열로 나누면
 *  같은 높이에 곱절이 들어가고, 그래도 넘치면 **이 칸만** 스크롤한다.
 */
function LossRank({ rows, empty, onPick }) {
  if (!rows.length) {
    return <p className="text-[10.5px] leading-snug text-ink4">{empty}</p>;
  }
  return (
    <ul className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-1 overflow-y-auto pr-1">
      {rows.map((r) => (
        <li key={r.uid}>
          <button
            type="button"
            onClick={() => onPick(r.uid)}
            className="block w-full rounded px-1 py-px text-left hover:bg-raiseh"
            title={`${r.name} 로 이동`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[10.5px] text-ink2">{r.name}</span>
              <b className={`shrink-0 text-[10.5px] tabular-nums ${tone(r.run)}`}>{(r.run * 100).toFixed(0)}%</b>
            </div>
            {/* 막대가 짧을수록 오래 서 있었다 — 숫자보다 먼저 눈에 들어온다 */}
            <div className="h-1 w-full overflow-hidden rounded-full bg-kbd">
              <div
                className={`h-full ${r.run < 0.5 ? 'bg-rose-500' : r.run < 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max(2, r.run * 100)}%` }}
              />
            </div>
            <div className="truncate text-[9px] tabular-nums text-ink4">
              {[
                r.crew > LOSS_FLOOR ? `${formatElapsed(r.crew)} 무인` : null,
                r.sec > LOSS_FLOOR ? `${formatElapsed(r.sec)} 막힘` : null,
                r.starve > LOSS_FLOOR ? `${formatElapsed(r.starve)} 굶음` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 어느 쪽으로 더 잃었는지 못 박는다.
 * ---------------------------------------------------------------------------
 *  같은 「성능 40%」 라도 처방이 정반대다. 막힘이 많으면 뒤가 못 받는 것이고
 *  (하류를 늘린다), 굶음이 많으면 앞이 못 대는 것이다(상류를 늘린다). 숫자만
 *  늘어놓고 방향을 안 말하면 반대로 손보게 된다.
 */
/** 정지 이유 셋 — 색과 처방이 이 표 하나에서만 나온다 */
const REASONS = [
  { key: 'crew', label: '무인', bg: 'bg-violet-500', chip: 'bg-violet-500/15 text-violet-600', why: '돌릴 사람이 없다' },
  { key: 'change', label: '전환', bg: 'bg-sky-500', chip: 'bg-sky-500/15 text-sky-600', why: '로트를 바꾸는 중이다 — 로트를 키우거나 빠르게(SMED)' },
  { key: 'sec', label: '막힘', bg: 'bg-rose-500', chip: 'bg-rose-500/15 text-rose-600', why: '보낼 곳이 없다' },
  { key: 'starve', label: '굶음', bg: 'bg-amber-500', chip: 'bg-amber-500/15 text-amber-600', why: '받을 것이 없다' },
];

/**
 * 어느 쪽으로 잃었고 **누가** 잃었나.
 * ---------------------------------------------------------------------------
 *  같은 「성능 40%」 라도 처방이 정반대다. 막힘이 많으면 뒤가 못 받는 것이고
 *  (하류를 늘린다), 굶음이 많으면 앞이 못 대는 것이다(상류를 늘린다). 숫자만
 *  늘어놓고 방향을 안 말하면 반대로 손보게 된다.
 *
 *  방향만으로는 어느 설비인지 모르므로 **가장 크게 잃은 순서로 이름을 낸다.**
 *  누르면 그 설비로 카메라가 가고 선택까지 된다 — 왼쪽 위 알람과 같은 몸짓이라
 *  따로 배울 것이 없다.
 */
function Bottleneck({ rows, onPick }) {
  const split = lossSplit();
  if (!rows.length || !split) {
    return <p className="text-[10.5px] leading-snug text-ink4">서 있는 설비가 없습니다 — 라인이 흐르고 있습니다.</p>;
  }
  const total = split.block + split.starve + split.crew + split.change;
  const sum = { crew: split.crew, change: split.change, sec: split.block, starve: split.starve };

  /* 설비마다 **가장 크게 잃은 이유 하나**로 줄을 세운다. 한 대가 세 줄을
     차지하면 목록이 금세 길어져 정작 다른 설비가 안 보인다. */
  const worst = rows
    .map((r) => {
      const top = REASONS.reduce((a, b) => (r[b.key] > r[a.key] ? b : a));
      return { uid: r.uid, name: r.name, reason: top, sec: r[top.key] };
    })
    .filter((r) => r.sec > LOSS_FLOOR)
    .sort((a, b) => b.sec - a.sec);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 한 줄 요약 — 막대 셋을 쌓으면 정작 설비 목록이 들어갈 자리가 없다 */}
      <div className="shrink-0">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-kbd">
          {REASONS.filter((x) => sum[x.key] > LOSS_FLOOR).map((x) => (
            <div key={x.key} className={x.bg} style={{ width: `${total > 0 ? (sum[x.key] / total) * 100 : 0}%` }} />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2.5 text-[9.5px] text-ink4">
          {REASONS.filter((x) => sum[x.key] > LOSS_FLOOR).map((x) => (
            <span key={x.key} className="flex items-center gap-1" title={x.why}>
              <i className={`inline-block h-1.5 w-1.5 rounded-sm ${x.bg}`} />
              {x.label} <b className="tabular-nums text-ink2">{formatElapsed(sum[x.key])}</b>
            </span>
          ))}
        </div>
      </div>

      {/* 넘치면 여기만 스크롤한다 — 목록이 길다고 조언이 밀려나면 안 된다 */}
      <ul className="mt-1.5 min-h-0 flex-1 space-y-px overflow-y-auto pr-1">
        {worst.map((r) => (
          <li key={r.uid}>
            <button
              type="button"
              onClick={() => onPick(r.uid)}
              className="flex w-full items-baseline gap-1.5 rounded px-1 py-px text-left hover:bg-raiseh"
              title={`${r.name} 로 이동 — ${r.reason.why}`}
            >
              <span className={`shrink-0 rounded px-1 text-[9px] font-medium ${r.reason.chip}`}>{r.reason.label}</span>
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink2">{r.name}</span>
              <b className="shrink-0 text-[10px] tabular-nums text-ink4">{formatElapsed(r.sec)}</b>
            </button>
          </li>
        ))}
      </ul>

      {/* 사람이 없어 선 시간이 있으면 그게 먼저다 — 배치를 아무리 고쳐도 안 돈다 */}
      {split.crew > LOSS_FLOOR ? (
        <p className="mt-1 shrink-0 rounded bg-amber-500/10 px-1.5 py-1 text-[9.5px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
          사람이 없어 선 시간이 {formatElapsed(split.crew)} 있습니다 — 배치를 고쳐도 안 풀립니다.
        </p>
      ) : split.change > split.block && split.change > split.starve ? (
        /* **전환이 제일 크면 배치 이야기를 하면 안 된다.** 처방이 다르다 —
           라인 앞뒤를 늘려도 전환 시간은 그대로다. 이 줄이 없을 때 화면은
           「전환 4분 · 막힘 2분」을 보여 주면서 「막힘이 큽니다」라고 했다. */
        <p className="mt-1 shrink-0 text-[9.5px] leading-snug text-ink4">
          <b className="text-ink2">전환</b>이 큽니다 — <b className="text-ink2">로트를 키우거나</b> 전환을
          빠르게 하세요(SMED). 라인 앞뒤를 늘려도 이 시간은 그대로입니다.
        </p>
      ) : (
        <p className="mt-1 shrink-0 text-[9.5px] leading-snug text-ink4">
          {split.starvedMore
            ? <><b className="text-ink2">굶음</b>이 큽니다 — 라인 <b className="text-ink2">앞쪽</b>(투입·앞 공정·카트)을 늘리세요.</>
            : <><b className="text-ink2">막힘</b>이 큽니다 — 라인 <b className="text-ink2">뒤쪽</b>(적치대·다음 공정·반출)을 늘리세요.</>}
          {' '}맨 위를 풀면 그다음이 병목이 됩니다.
        </p>
      )}
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
        서 있어도 <b className="text-ink3">인건비·고정비는 그대로</b> 나가고, 전기는 대기 전력만
        나갑니다. 설비별 가동·대기 kW 는 인스펙터의 「전력 · 고정비」에서 정합니다.
      </p>
    </>
  );
}

function Rates({ rates, set, untouched }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* **2 × 2 로 놓는다.** 한 줄로 쌓았더니 네 번째(자재비)가 띠 높이를 넘어
          잘리고 그 자리에 아래 설명이 겹쳐 찍혔다. 폭은 남고 높이가 없다. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-1">
        <Knob
          label="전기" value={rates.power} unit="원/kWh"
          min={POWER_RANGE[0]} max={POWER_RANGE[1]} step={POWER_RANGE[2]}
          onChange={(v) => set({ power: v })}
        />
        <Knob
          label="인건비" value={rates.wage} unit="원/시간"
          min={WAGE_RANGE[0]} max={WAGE_RANGE[1]} step={WAGE_RANGE[2]}
          onChange={(v) => set({ wage: v })}
        />
        <Knob
          label="카트 한 대" value={rates.cartKw} unit="kW"
          min={KW_RANGE[0]} max={20} step={0.1}
          onChange={(v) => set({ cartKw: v })}
        />
        {/* 슬라이더는 1만원까지, 그보다 비싼 부품은 손으로 적는다 (cost.js 주석) */}
        <Knob
          label="자재비" value={rates.material} unit="원/개"
          min={MATERIAL_RANGE[0]} max={MATERIAL_RANGE[1]} step={MATERIAL_RANGE[2]}
          hardMax={MATERIAL_MAX}
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

/* 따라 하기가 짚는 손잡이 — 문자열로 못 박아 두면 검사가 「없는 곳을 가리키는 단계」를 잡는다 */
export const DOCK_RUN = 'dock-run';
export const DOCK_COST = 'dock-cost';

/** 손잡이 하나의 한 값에 몇 판 · 한 판 몇 분 — **곡선의 모양**을 보는 자리라 짧다 */
const SWEEP_REPS = 6;
const SWEEP_MIN = 20;

/**
 * **손잡이 돌리기** — 「얼마가 좋은가」.
 * ---------------------------------------------------------------------------
 *  「카트를 몇 대 두면 되나?」 지금까지는 값을 손으로 바꾸고 다시 돌리기를
 *  되풀이해야 답할 수 있었다. 여섯 번 바꾸려면 여섯 번 손을 움직이고, 그
 *  사이에 앞의 값이 뭐였는지 잊는다.
 *
 *  ── **한 값씩 잘라 돌린다** ──────────────────────────────────────────────
 *  여섯 값 × 여섯 판이면 한 덩어리로 1초가 넘는다. 배치 탐색에서 배운 그대로,
 *  값 하나를 돌리고 `setTimeout(0)` 으로 숨을 쉰다 — 화면이 안 멈추고 표가
 *  **한 줄씩 채워지는 것이 보인다.**
 */
/**
 * **민감도** — 「어느 손잡이를 잡을까」.
 * ---------------------------------------------------------------------------
 *  손잡이 돌리기는 한 손잡이를 골라 값을 훑는다. 그 앞의 물음 —— **애초에 어느
 *  손잡이가 결과를 흔드나** —— 에는 답하지 못했다. 손잡이가 여섯이면 여섯 번
 *  훑고 표 여섯 개를 눈으로 견줘야 했다.
 *
 *  손잡이마다 **한 칸 아래와 한 칸 위**를 돌려 보고 크게 흔드는 순으로 세운다.
 *  「±20%」가 아니라 이웃 값인 이유는 `sensitivity.js` 에 적어 뒀다.
 */
function Tornado() {
  const { state, itemOf } = useEditor();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const layout = {
    placed: state.placed, links: state.links, carts: state.carts,
    areas: state.areas, walls: state.walls, openings: state.openings,
    shifts: state.shifts, orders: state.orders, beltSpeed: state.beltSpeed,
    isStillage: (p) => isStillage(itemOf(p.itemId)),
  };
  const knobs = knobsFor(layout);

  const go = () => {
    setBusy(true);
    setRows([]);
    const specOf = specReader();
    const acc = [];
    /* **손잡이 하나씩 잘라 돌린다** — 한 덩어리로 하면 화면이 몇 초씩 멈춘다
       (손잡이 돌리기에서 배운 그대로) */
    let i = 0;
    const tick = () => {
      try {
        const k = knobs[i];
        const steps = stepsOf(k, layout);
        if (steps) {
          const at = (v) => (v == null ? null : sweep({
            knob: k.id, layout, values: [v],
            build: (d) => worldOf({ ...d, itemOf, specOf }),
            pick: () => throughput(shippedTotal(getShipped())) ?? 0,
            seconds: TORNADO_MIN * 60, reps: TORNADO_REPS, seed: 1,
          }).rows?.[0] ?? null);
          const got = { base: at(steps.base), low: at(steps.low), high: at(steps.high) };
          resetRun();
          const swing = swingOf(got);
          if (swing) acc.push({ knob: k, steps, swing });
          setRows([...acc]);
        }
      } catch (e) {
        console.error('[민감도] 실패', e);
      }
      if (++i < knobs.length) { setTimeout(tick, 0); return; }
      setBusy(false);
    };
    setTimeout(tick, 30);
  };

  if (!knobs.length) {
    return (
      <p className="text-[10.5px] leading-relaxed text-ink4">
        흔들어 볼 손잡이가 없습니다 — 카트나 벨트, 교대조를 두면 <b className="text-ink3">어느 것이
        결과를 가장 크게 흔드는지</b>를 재 봅니다.
      </p>
    );
  }

  const ranked = rankOf(rows);
  const wide = Math.max(0.01, ...ranked.map((r) => r.swing.span));

  return (
    <>
      <p className="text-[9.5px] leading-snug text-ink4">
        손잡이마다 <b className="text-ink3">한 칸 아래와 한 칸 위</b>를 돌려 보고, 결과를 크게
        흔드는 순으로 세웁니다 — 어느 것을 먼저 손볼지가 여기서 갈립니다.
      </p>
      <button type="button" onClick={go} disabled={busy} className={`${OUT_BTN} mt-1.5 w-full justify-center disabled:opacity-50`}>
        <Repeat size={13} /> {busy ? `흔드는 중… (${rows?.length ?? 0}/${knobs.length})` : '손잡이마다 한 칸씩 흔들기'}
      </button>

      {ranked.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {ranked.map((r) => (
            <div key={r.knob.id} className="mb-1">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-16 shrink-0 truncate text-right text-ink3" title={r.knob.label}>{r.knob.label}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-kbd">
                  <span
                    className={`block h-full rounded-full ${r.swing.span > 0 ? 'bg-amber-500' : 'bg-kbd'}`}
                    style={{ width: `${Math.min(100, (r.swing.span / wide) * 100)}%` }}
                  />
                </span>
                <span className="w-28 shrink-0 text-right tabular-nums text-ink4">{swingText(r)}</span>
              </div>
            </div>
          ))}
          {!busy && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink2">
              <b className="text-amber-600">{tornadoText(ranked)}</b>
            </p>
          )}
          <p className="mt-1 text-[9.5px] leading-snug text-ink4">
            <b className="text-ink4">—</b> 는 <b className="text-ink3">흔들림 안</b>이라는 뜻입니다 —
            바꿔도 눈에 띄게 안 변합니다. 값마다 {TORNADO_REPS}판 × {TORNADO_MIN}분, 씨앗은 같습니다.
          </p>
        </div>
      )}
    </>
  );
}

/** 민감도는 손잡이 수만큼 돌리므로 판을 줄인다 — 순서를 가리는 데는 이만큼이면 된다 */
const TORNADO_REPS = 4;
const TORNADO_MIN = 10;

function Sweep() {
  const { state, itemOf } = useEditor();
  const [knob, setKnob] = useState(null);
  const [rows, setRows] = useState(null);
  /** 실제 라인의 처리량(개/시) — 적으면 모델과 견준다 (calibrate.js) */
  const [actual, setActual] = useState(0);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(null);

  /* 이 도면으로 만들 수 있는 손잡이 — 도면이 바뀌면 다시 본다 */
  const layout = {
    placed: state.placed, links: state.links, carts: state.carts,
    areas: state.areas, walls: state.walls, openings: state.openings,
    shifts: state.shifts, orders: state.orders, beltSpeed: state.beltSpeed,
    isStillage: (p) => isStillage(itemOf(p.itemId)),
  };
  const knobs = knobsFor(layout);
  const pick = knob && knobs.some((k) => k.id === knob) ? knob : knobs[0]?.id ?? null;

  const go = () => {
    if (!pick) return;
    setBusy(true);
    setRows([]);
    setWhy(null);
    const k = knobOf(pick);
    const values = k.values(layout);
    const acc = [];
    const specOf = specReader();
    let i = 0;
    const tick = () => {
      try {
        /* 값 하나만 돌린다 — 그래야 화면이 숨을 쉰다 */
        const r = sweep({
          knob: pick, layout, values: [values[i]],
          build: (d) => worldOf({ ...d, itemOf, specOf }),
          pick: () => throughput(shippedTotal(getShipped())) ?? 0,
          seconds: SWEEP_MIN * 60, reps: SWEEP_REPS, seed: 1,
        });
        /* 굳힌 뒤에 비운다 — 여러 판이 화면의 이번 실행과 같은 자리를 쓴다 */
        resetRun();
        if (r.rows?.length) acc.push(r.rows[0]);
        setRows([...acc]);
        if (++i < values.length) { setTimeout(tick, 0); return; }
        if (!acc.some((x) => x.mean > 0)) setWhy('all-zero');
      } catch (e) {
        console.error('[손잡이 돌리기] 실패', e);
        setWhy('error');
      }
      setBusy(false);
    };
    setTimeout(tick, 30);
  };

  if (!knobs.length) {
    return (
      <p className="text-[10.5px] leading-relaxed text-ink4">
        돌려 볼 손잡이가 없습니다 — 카트나 벨트, 교대조를 두면 <b className="text-ink3">얼마가 좋은지</b>를
        값을 바꿔 가며 재 봅니다.
      </p>
    );
  }

  const k = knobOf(pick);
  const knee = rows?.length ? kneeOf(rows) : null;
  const top = rows?.length ? bestOf(rows) : null;
  /* 실적 보정 — 훑어 본 표를 「실적에 가장 가까운 값」으로 읽는다 */
  const match = actual > 0 && top ? matchOf(top.mean, actual) : null;
  const fit = actual > 0 ? fitOf(rows, actual) : null;
  const moved = fit ? movedFrom(rows, k?.now?.(layout), fit) : null;
  const wide = top ? Math.max(1, top.mean + top.half) : 1;

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {knobs.map((one) => (
          <button
            key={one.id}
            type="button"
            onClick={() => { setKnob(one.id); setRows(null); setWhy(null); }}
            className={`rounded px-1.5 py-0.5 text-[10px] ring-1 transition-colors ${
              pick === one.id
                ? 'bg-sky-500/15 text-sky-600 ring-sky-500/40'
                : 'bg-raise text-ink4 ring-edge hover:bg-raiseh hover:text-ink3'
            }`}
          >
            {one.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[9.5px] leading-snug text-ink4">{k?.why}</p>

      <button type="button" onClick={go} disabled={busy} className={`${OUT_BTN} mt-1.5 w-full justify-center disabled:opacity-50`}>
        <Repeat size={13} /> {busy ? `돌리는 중… (${rows?.length ?? 0}/${k.values(layout).length})` : '값을 바꿔 가며 돌리기'}
      </button>

      {/**
        * 실적 보정 — **이 모델이 실제와 얼마나 맞나.**
        * ---------------------------------------------------------------------
        *  컨설팅에서 제일 먼저 받는 질문이다. 안 맞는 모델로 배치를 바꾸면 안
        *  되니까 맞는 물음이기도 하다.
        *
        *  **새 엔진을 안 만든다.** 위에서 이미 값을 훑어 표를 냈다 — 그 표를
        *  「가장 큰 값」이 아니라 **「실적에 가장 가까운 값」**으로 읽으면 그게
        *  보정이다(`calibrate.js`).
        */}
      <label className="mt-2 flex items-center gap-1.5 border-t border-line pt-1.5 text-[10px] text-ink4">
        실제 라인은
        <input
          type="number" min="0" step="10"
          value={actual || ''}
          onChange={(e) => setActual(Number(e.target.value) || 0)}
          placeholder="—"
          className="w-20 rounded border border-edge bg-field px-1 py-0.5 text-right text-[10px] tabular-nums text-ink outline-none focus:border-sky-500/60"
        />
        개/시
        <span className="ml-auto text-[9.5px] text-ink4/70">적으면 모델과 견줍니다</span>
      </label>

      {rows?.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {rows.map((r) => (
            <div key={r.v} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-12 shrink-0 text-right tabular-nums text-ink3">{r.v}{k.unit}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-kbd">
                <span
                  className={`block h-full rounded-full ${knee && r.v === knee.v ? 'bg-emerald-500' : 'bg-sky-500'}`}
                  style={{ width: `${Math.min(100, (r.mean / wide) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums text-ink2">
                {r.mean.toFixed(0)}{r.n > 1 && <span className="text-ink4"> ± {r.half.toFixed(0)}</span>}
              </span>
            </div>
          ))}
          {!busy && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink2">
              <b className="text-emerald-600">{kneeText(knee, k)}</b>
            </p>
          )}
          {!busy && actual > 0 && (
            <div className="mt-1.5 rounded bg-raise px-2 py-1.5 ring-1 ring-edge">
              <p className="text-[10px] leading-snug text-ink2">
                <b className={match?.ok ? 'text-emerald-600' : 'text-amber-600'}>
                  {matchText(match, top?.mean ?? 0, actual)}
                </b>
              </p>
              <p className="mt-1 text-[10px] leading-snug text-ink3">{fitText(fit, k, actual)}</p>
              {moved && !moved.sure && (
                <p className="mt-1 text-[9.5px] leading-snug text-amber-600">
                  다만 지금 값과 <b>구별할 만큼 다르지 않습니다</b> — 바꿀 이유가 못 됩니다.
                </p>
              )}
              <p className="mt-1 text-[9.5px] leading-snug text-ink4">
                숫자만 맞추려 들면 아무 손잡이나 비틀어 맞출 수 있습니다.
                <b className="text-ink3"> 도면과 현장이 실제로 다른 것</b>을 짚을 때만 뜻이 있습니다.
              </p>
            </div>
          )}
          <p className="mt-1 text-[9.5px] leading-snug text-ink4">
            값마다 <b className="text-ink4">{SWEEP_REPS}판 × {SWEEP_MIN}분</b>, 씨앗은 같습니다 —
            값 사이의 차이만 남게 하려는 것입니다.
          </p>
        </div>
      )}

      {why === 'all-zero' && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink4">
          어느 값에서도 <b className="text-ink3">밖으로 나간 것이 없습니다</b>. 처리량은 트럭이 개구부로
          실어 낸 것을 셉니다 — 출하 경로를 놓아야 잡힙니다.
        </p>
      )}
      <p className="mt-1.5 text-[9.5px] leading-snug text-amber-600">
        화면의 이번 실행은 <b>비워집니다</b> — 여러 판이 같은 자리를 쓰기 때문입니다.
      </p>
    </>
  );
}

const TABS = [['run', '실행'], ['cost', '원가'], ['reps', '여러 판'], ['sweep', '얼마나']];

export default function RunDock() {
  const { state, dispatch } = useEditor();
  useMetrics();
  useFaults();
  const elapsed = useElapsed();
  const cost = useCostInput();
  const stock = useAllStock();
  const shipped = useShipped();
  const open = state.showRunDock !== false;
  /* 모르는 값이 저장돼 있어도 실행 탭으로 떨어진다 — 빈 띠보다 낫다 */
  const tab = TABS.some(([id]) => id === state.runTab) ? state.runTab : 'run';

  const overall = oeeOverall(state.placed.map((p) => p.uid));
  const series = getSeries();
  const rows = lossRows(state.placed);

  /* 리드타임 — 재공과 처리량은 이미 세고 있다. 셋째는 나눗셈 하나다(리틀의 법칙).
     재공은 원가가 이미 모은 값을 쓰지 않는다 — 저기는 「돈」을 모으는 자리다. */
  const wip = Object.values(stock).reduce((s, n) => s + n, 0);
  const flow = { wip, lead: leadTimeSec(wip, throughput(shipped)) };

  /**
   * 목록의 설비를 누르면 그리로 간다 — 왼쪽 위 알람과 **같은 몸짓**이다.
   *  이름만 보여 주면 도면에서 그걸 다시 찾아야 한다. 스무 대쯤 놓인 도면에서
   *  「Machine 2 #1 사본」 을 눈으로 찾는 것이 이 목록을 보는 값어치를 깎는다.
   */
  const pick = (uid) => {
    const p = state.placed.find((x) => x.uid === uid);
    if (!p) return;
    dispatch({ type: 'SELECT', selected: { kind: 'equip', uid } });
    if (p.pos) focusOn([p.pos[0], p.pos[1]], { look: true });
  };
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
            data-guide={id === 'cost' ? DOCK_COST : DOCK_RUN}
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
        <span data-guide="dock-report">
          {open && tab === 'run' && <ReportButtons />}
        </span>
      </div>

      {open && tab === 'run' && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          <Col title="지표" width={190}>
            <Kpis elapsed={elapsed} overall={overall} flow={flow} warmup={getWarmup()} />
          </Col>
          <Col title="생산 추이">
            <ProductionChart series={series} />
          </Col>
          <Col title="작동 시간 (낮은 순)">
            <LossRank
              rows={rows}
              onPick={pick}
              empty={state.placed.length === 0 ? '아직 설비가 없습니다.' : '서 있는 설비가 없습니다 — 라인이 흐르고 있습니다.'}
            />
          </Col>
          <Col title="병목 시간" width={300}>
            <Bottleneck rows={rows} onPick={pick} />
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
              <Col title="원가 구성">
                <CostParts c={cost} />
              </Col>
              <Col title="손실 원가" width={330}>
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

      {open && tab === 'reps' && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          <Col title="여러 번 돌려 보기" width={220}>
            <Replicate />
          </Col>
          <Col title="왜 여러 번인가">
            <p className="text-[10.5px] leading-relaxed text-ink3">
              고장과 공정 편차가 들어 있으면 <b className="text-ink2">같은 배치도 돌릴 때마다 다른 값</b>이
              나옵니다. 한 번 돌린 숫자 하나로 배치를 견주면 다시 돌렸을 때 뒤집힐 수 있습니다.
            </p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink4">
              여러 판을 돌려 <b className="text-ink3">평균 ± 구간</b>을 내면 「이만큼은 확실하다」를
              말할 수 있습니다. 화면 없이 도는 계산이라 30분짜리 한 판이 몇 ms 입니다.
            </p>
            <p className="mt-1.5 text-[9.5px] leading-snug text-ink4">
              판마다 <b className="text-ink4">처음부터</b> 시작합니다. 씨앗은 고정이라 같은 도면을
              다시 돌리면 같은 결과가 나옵니다.
            </p>
          </Col>
        </div>
      )}

      {open && tab === 'sweep' && (
        <div className="flex min-h-0 flex-1 divide-x divide-line overflow-x-auto">
          <Col title="값을 바꿔 가며" width={300}>
            <Sweep />
          </Col>
          {/* **어느 손잡이를 잡을까** — 값을 훑기 전의 물음이다. 왼쪽 옆에 두어
              「먼저 이걸 보고 그다음 저기서 훑는다」가 몸짓으로 읽히게 한다 */}
          <Col title="어느 손잡이가 흔드나" width={280}>
            <Tornado />
          </Col>
          <Col title="무엇을 답하나">
            <p className="text-[10.5px] leading-relaxed text-ink3">
              「<b className="text-ink2">카트를 몇 대 두면 되나</b>」 「버퍼를 얼마로 잡아야 하나」 —
              계획하는 사람이 실제로 묻는 질문입니다. 값을 손으로 바꾸고 다시 돌리기를 되풀이하는
              대신, 도구가 <b className="text-ink2">값을 바꿔 가며 돌려 보고</b> 표로 냅니다.
            </p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink4">
              값마다 <b className="text-ink3">같은 난수</b>를 먹입니다. 다른 운을 주면 곡선이 들쭉날쭉해서
              「여기서 꺾인다」가 운인지 실력인지 알 수 없습니다.
            </p>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink4">
              답은 <b className="text-ink3">무릎</b>입니다 — 「이만큼이면 충분하다」. 표에서 제일 큰 값이
              아닙니다: 흔들림 안에서 우연히 위로 튄 값을 최고라고 하면 <b className="text-ink3">필요 없는
              카트를 더 사게</b> 됩니다.
            </p>
            <p className="mt-1.5 text-[9.5px] leading-snug text-ink4">
              한 값씩 잘라 돌리므로 화면이 안 멈추고 표가 한 줄씩 채워집니다.
            </p>
          </Col>
        </div>
      )}
    </div>
  );
}
