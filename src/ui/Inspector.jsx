/**
 * 우측 인스펙터 — 선택한 설비/연결의 상세, 없으면 도면 요약
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, FileText, RotateCcw, RotateCw, Table2, Trash2, Wand2 } from 'lucide-react';
import { VIEW, selItems, useEditor } from '../core/store.jsx';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { MAX_LAYER, layerLift, linkPath, portsOf } from '../core/link.js';
import {
  CART_MARGIN, STATION_ROLE, cartPath, cartStations, fleetFits, haulPerMinute, isLoadStation,
  idleLoads, pickSet, roleOfStation, stationStyle,
} from '../core/cart.js';
import {
  arrivedAt, arrivedOf, clearStock, dropKind, getAllStock, getShipped, setStock, shippedTotal,
  useAllStock, useLots, useShipped, useStock,
} from '../core/simStore.js';
import { formatElapsed, useElapsed, useSimSpeed } from '../core/clock.js';
import { resetRun } from '../core/sim.js';
import { blockChain, chainText, storeCapOf } from '../core/diagnose.js';
import { bottleneckChain, lineBalance, rateText } from '../core/balance.js';
import { deltaText, improvePlan } from '../core/improve.js';
import { gainText, searchLayout } from '../core/optimize.js';
import { runReportCSV } from '../core/report.js';
import { runReportHTML } from '../core/reportHtml.js';
import {
  DEFAULT_ORDER, DONE_AT, ORDER, formatSpan, normalizeOrders, statusOf,
} from '../core/orders.js';
import {
  CYCLE_RANGE, MIN_GAP, VAR_MAX, beltPerMinute, cycleOf, outputCapFor, perMinute,
  spacingClamped, spacingFor, varOf,
} from '../core/process.js';
import {
  CREW_RANGE, HEADCOUNT_RANGE, MINUTES_RANGE,
  assignCrew, crewOf, crewRows, cycleSeconds, isWorkable, joinHM, normalizeShifts, shiftsVary,
  totalCrewNeed,
  shiftAt, shiftLabel, splitHM,
} from '../core/crew.js';
import {
  LOSS_FLOOR, bottleneck, cartBlockRatio, getBlocked, getCartBlocked, getCartRan, getRan, getSeries,
  getStarved, getUnmanned, leadTimeSec, lossSplit, oeeOf, oeeOverall, throughput, uptimeOf,
  resetMetrics, useMetrics,
} from '../core/metrics.js';
import {
  DEFAULT_INPUT_CAP, MAX_QTY, auditRecipes, countKinds, explode, flowEdges,
  inputCapOf, isSource, missingOf, needFor, normalizeRecipe, outputKindOf, recipeOf,
  slotShares, tooSmallFor,
} from '../core/bom.js';
import {
  FAULT_DEFAULTS, MTBF_RANGE, MTTR_RANGE, SCRAP_RANGE,
  getMade, getScrapped, repairsOf, useFaults,
} from '../core/faults.js';
import { FIXED_RANGE, KW_RANGE, fixedOf, idleKwOf, normalizeRates, runKwOf, unitWon, won } from '../core/cost.js';
import {
  PAYLOAD_ITEMS, allowedOutOf, canonKind, isShelf, isStillage, isTruck, isUtility,
} from '../data/library.js';
import {
  MAX_BAYS,
  MAX_BAY_LENGTH,
  MAX_LEVELS,
  MAX_LEVEL_GAP,
  MAX_PER_LEVEL,
  MIN_BAYS,
  MIN_BAY_LENGTH,
  MIN_LEVELS,
  MIN_LEVEL_GAP,
  MIN_ROWS,
  MAX_ROWS,
  MIN_ROW_GAP,
  MAX_ROW_GAP,
  perRow,
  rowGap,
  rowKinds,
  shelfDepth,
  shelfRows,
  bayLength,
  levelGap,
  perLevel,
  shelfBays,
  shelfCapacity,
  shelfHeight,
  shelfLength,
  shelfLevelCount,
  shelfSpec,
  slotPitch,
} from '../core/shelf.js';
import { footprintOf } from '../core/grid.js';
import { shelfBBox } from '../core/shelf.js';
import { ALIGN, AXIS, alignMoves, distributeMoves, gapOf } from '../core/align.js';
import { MAX_CAPACITY, MIN_CAPACITY, stillageCapacity, stillageGrid } from '../core/stillage.js';
import { PILLAR_DEFAULTS, WALL_DEFAULTS, floorOf } from '../core/area.js';
import {
  FLOOR_COLOR,
  MIN_OPENING,
  edgeSpec,
  inZone,
  mpArea,
  mpEdges,
  mpVertices,
  openingsOn,
  wallBox,
  wallLines,
} from '../core/area.js';
import { focusOn } from '../core/focusStore.js';
import { downloadCSV, downloadHTML, layoutSnapshot, stamp } from '../core/persistence.js';
import { layoutInfo } from '../core/layoutInfo.js';
import { zoneInfo } from '../core/zoneInfo.js';
import { flowMatrix, heaviest, metersPerUnit, totalWork, workText } from '../core/flow.js';
import { planReportHTML } from '../core/planReport.js';
import { useCostInput } from './useCost.js';
import { seriesCSV } from '../core/scenarios.js';
import { sliceCountFor, tileCount } from '../scene/connectorGeometry.js';
import { Btn, ColorField, Field, Row, Section, Slider } from './common.jsx';

function useModelsVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

const ROT_LABEL = ['0°', '90°', '180°', '270°'];

/**
 * 쌓여 있는 것의 내역 — 종류별로 몇 개인가.
 * ---------------------------------------------------------------------------
 *  자리마다 다른 물건이 섞여 쌓이므로 총 개수만으로는 무엇이 들어 있는지 알 수
 *  없다. 색 견본을 함께 찍어 화면에서 본 것과 목록을 바로 이을 수 있게 한다.
 *  (한 종류만 있으면 굳이 나누어 보여 주지 않는다 — 총 개수로 충분하다)
 */
function StockBreakdown({ uid, slots = null }) {
  const lots = useLots(uid);

  const rows = useMemo(() => {
    const count = new Map();
    for (const k of lots) count.set(k, (count.get(k) ?? 0) + 1);
    /* 자리를 배정받았지만 아직 하나도 안 들어온 종류도 보여 준다 —
       "이게 안 오고 있다" 가 굶는 이유일 때가 많다 */
    for (const k of Object.keys(slots ?? {})) if (!count.has(k)) count.set(k, 0);
    return [...count.entries()]
      .map(([key, n]) => ({ key, n, item: PAYLOAD_ITEMS[key], slot: slots?.[key] ?? null }))
      .sort((a, b) => b.n - a.n);
  }, [lots, slots]);

  if (rows.length < 2 && !slots) return null;

  return (
    <div className="mt-2">
      <p className="mb-1 text-[10.5px] text-ink4">내역</p>
      <ul className="space-y-0.5">
        {rows.map(({ key, n, item, slot }) => (
          <li key={key} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-1.5 text-ink2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-edge"
                style={{ background: item?.color ?? '#94a3b8' }}
              />
              <span className="truncate">{item?.name ?? key}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* 자리가 나뉘어 있으면 **제 몫 대비**로 보여 준다. 전체 대비
                  퍼센트는 자리다툼이 있던 시절의 숫자라 지금은 뜻이 없다 */}
              <b className="tabular-nums text-ink">
                {slot != null ? `${n} / ${slot} 개` : `${n} 개`}
              </b>
              {slot != null
                ? n >= slot && slot > 0 && <span className="text-[10px] text-amber-600">가득</span>
                : (
                  <span className="text-[10px] font-normal text-ink4 tabular-nums">
                    {Math.round((n / Math.max(1, lots.length)) * 100)}%
                  </span>
                )}
              {/* 이 종류만 버리기 — 엉킨 버퍼를 손으로 푸는 자리 */}
              {n > 0 && (
                <button
                  onClick={() => dropKind(uid, key)}
                  className="rounded px-0.5 text-ink4 hover:text-rose-500"
                  title={`${item?.name ?? key} ${n}개를 버린다`}
                >
                  <Trash2 size={10} />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 이 설비 한 대의 가동률.
 *  전체 순위는 도면 요약의 「이번 실행」에 있고, 여기서는 고른 설비만 본다 —
 *  "이 기계를 손볼까" 를 고민하는 자리에서 바로 근거가 보여야 한다.
 */
/** 지표 하나를 색 있는 퍼센트로 — 세 기둥을 같은 눈금으로 읽게 한다 */
const pct = (v) => `${(v * 100).toFixed(0)} %`;
const tone = (v) => (v < 0.5 ? 'text-rose-500' : v < 0.85 ? 'text-amber-600' : 'text-emerald-600');

function EquipUptime({ uid }) {
  useMetrics();
  useFaults();
  const ran = getRan();
  if (ran <= 0) return null;
  const o = oeeOf(uid);
  if (!o) return null;
  const fixes = repairsOf(uid);

  return (
    <>
      {/* 세 기둥을 곱한 값이 OEE 다 — 하나만 나빠도 전체가 무너진다 */}
      <Row label="OEE">
        <b className={tone(o.oee)}>{pct(o.oee)}</b>
      </Row>
      {/* 고장과 무인은 둘 다 「애초에 못 돈」 시간이라 A 에서 함께 빠지지만,
          사는 것이 다르다 — 하나는 정비, 하나는 사람이다. 그래서 따로 적는다 */}
      <Row label="· 가동률">
        <span className={tone(o.availability)}>{pct(o.availability)}</span>
        {(o.downSec > LOSS_FLOOR || o.crewSec > LOSS_FLOOR) && (
          <span className="ml-1 text-[10px] text-ink4">
            ({[
              o.downSec > LOSS_FLOOR ? `${formatElapsed(o.downSec)} 고장${fixes ? ` · ${fixes}회` : ''}` : null,
              o.crewSec > LOSS_FLOOR ? `${formatElapsed(o.crewSec)} 무인` : null,
            ].filter(Boolean).join(' · ')})
          </span>
        )}
      </Row>
      {/* 막힘과 굶음은 잃은 시간이 같아도 처방이 정반대라, 성능 한 줄 아래에
          어느 쪽으로 잃었는지를 반드시 함께 적는다 — 숫자만 보면 하류를 늘려야
          할 때 상류를 늘리게 된다 */}
      <Row label="· 성능">
        <span className={tone(o.performance)}>{pct(o.performance)}</span>
        {(o.blockSec > LOSS_FLOOR || o.starveSec > LOSS_FLOOR) && (
          <span className="ml-1 text-[10px] text-ink4">
            ({[
              o.blockSec > LOSS_FLOOR ? `${formatElapsed(o.blockSec)} 막힘` : null,
              o.starveSec > LOSS_FLOOR ? `${formatElapsed(o.starveSec)} 굶음` : null,
            ].filter(Boolean).join(' · ')})
          </span>
        )}
      </Row>
      <Row label="· 양품률">
        <span className={tone(o.quality)}>{pct(o.quality)}</span>
        {getScrapped() > 0 && <span className="ml-1 text-[10px] text-ink4">({getScrapped()}개 불량)</span>}
      </Row>
    </>
  );
}

/**
 * 이 설비를 돌릴 사람.
 * ---------------------------------------------------------------------------
 *  기본은 0 = **무인 설비**다. 이미 그린 도면이 인력이 생겼다는 이유로 갑자기
 *  서면 안 되므로, 사람이 필요하다고 말한 설비에만 사람을 붙인다.
 */
function CrewFields({ placed }) {
  const { state, dispatch, itemOf } = useEditor();
  const elapsed = useElapsed();
  const need = crewOf(placed);

  /* 지금 이 설비에 사람이 붙었는가 — 씬과 **같은 함수**로 다시 잰다.
     화면과 인스펙터가 각자 정하면 언젠가 서로 다른 말을 한다(crew.js 의 crewRows). */
  const { shift } = shiftAt(state.shifts, elapsed);
  const rows = crewRows(state.placed, (p) => isWorkable(itemOf(p.itemId)));
  const { manned, unlimited } = assignCrew(rows, shift.headcount);
  const on = manned.has(placed.uid);
  const rank = rows.filter((r) => r.need > 0).findIndex((r) => r.uid === placed.uid) + 1;

  return (
    <Section title="작업자" data-guide="panel-crew">
      <Slider
        label="필요 인원"
        min={CREW_RANGE[0]} max={CREW_RANGE[1]} step={CREW_RANGE[2]}
        value={need}
        text={need > 0 ? `${need} 명` : '무인'}
        onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { crew: v } })}
      />
      {need > 0 && (
        <>
          <Row label="지금">
            {unlimited
              ? <span className="text-ink3">인원을 안 따집니다</span>
              : on
                ? <span className="text-emerald-600">사람이 붙어 있습니다</span>
                : <span className="text-rose-500">사람이 없어 섰습니다</span>}
          </Row>
          <Row label="배정 순서">{rank} 번째</Row>
        </>
      )}
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
        {need > 0
          ? <>
              사람이 모자라면 <b className="text-ink3">배치한 순서대로</b> 배정합니다 —
              병목 순서로 주면 배정이 매 프레임 흔들려 같은 도면이 매번 다른 답을 냅니다.
              <br /><b className="text-ink3">부분 배정은 없습니다</b> — 2명이 필요한데 1명만
              남았으면 그 1명은 다음 설비로 갑니다.
            </>
          : '0 이면 무인 설비입니다 — 사람을 쓰지 않고 계속 돕니다.'}
      </p>
    </Section>
  );
}

/**
 * 이 설비의 고장·불량 성질.
 * ---------------------------------------------------------------------------
 *  MTBF 를 0 으로 두면 고장 나지 않는다 — 기본값이다. 이미 그린 도면이 갑자기
 *  서면 안 되므로, 고장은 **켜겠다고 말한 설비에만** 일어난다.
 */
function FaultFields({ placed }) {
  const { dispatch } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch });
  const mtbf = placed.mtbf ?? 0;

  return (
    <Section title="고장 · 불량" data-guide="panel-fault">
      <Slider
        label="평균 고장 간격 (MTBF)"
        min={MTBF_RANGE[0]} max={MTBF_RANGE[1]} step={MTBF_RANGE[2]}
        value={mtbf}
        text={mtbf > 0 ? formatElapsed(mtbf) : '고장 없음'}
        onChange={(v) => set({ mtbf: v })}
      />
      {mtbf > 0 && (
        <Slider
          label="평균 수리 시간 (MTTR)"
          min={MTTR_RANGE[0]} max={MTTR_RANGE[1]} step={MTTR_RANGE[2]}
          value={placed.mttr ?? FAULT_DEFAULTS.mttr}
          text={formatElapsed(placed.mttr ?? FAULT_DEFAULTS.mttr)}
          onChange={(v) => set({ mttr: v })}
        />
      )}
      <Slider
        label="불량률"
        min={SCRAP_RANGE[0]} max={SCRAP_RANGE[1]} step={SCRAP_RANGE[2]}
        value={placed.scrapRate ?? 0}
        text={`${((placed.scrapRate ?? 0) * 100).toFixed(1)} %`}
        onChange={(v) => set({ scrapRate: v })}
      />
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
        고장 시점은 <b className="text-ink2">지수분포</b>로 뽑습니다 — 주기로 두면 여러 대가
        박자를 맞춰 서서 실제와 다른 그림이 됩니다.
        <br />불량품은 쌓이지 않고 버려집니다. 적치대에 넣으면 자리를 차지해 멀쩡한 라인을
        세우게 되니까요.
      </p>
    </Section>
  );
}

/**
 * 설비 한 대의 전력·고정비.
 * ---------------------------------------------------------------------------
 *  **대기 전력을 따로 두는 것**이 요점이다. 한 값만 쓰면 서 있는 설비가 공짜가
 *  되고, 그러면 「설비를 잔뜩 깔고 놀리는」 배치가 원가에서 이긴다. 실제로는
 *  꺼 두지 않는 한 계속 먹는다.
 *
 *  고정비(감가상각·임차)는 **기본이 0** 이다. 아는 사람만 넣으면 되고, 모르는
 *  숫자를 지어내 넣으면 원가 전체가 그 지어낸 값에 끌려간다.
 */
function PowerFields({ placed }) {
  const { state, dispatch } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch });
  const run = runKwOf(placed);
  const idle = idleKwOf(placed);
  const fixed = fixedOf(placed);
  const price = normalizeRates(state.rates).power;

  return (
    <Section title="전력 · 고정비" data-guide="panel-power">
      <Slider
        label="가동 중" value={run} text={`${run} kW`}
        min={KW_RANGE[0]} max={60} step={0.1}
        onChange={(v) => set({ runKw: v })}
      />
      <Slider
        label="서 있을 때" value={idle} text={`${idle} kW`}
        min={KW_RANGE[0]} max={60} step={0.1}
        onChange={(v) => set({ idleKw: v })}
        hint="가동 kW 를 넘을 수 없다"
      />
      <Slider
        label="고정비" value={fixed} text={fixed ? `${fixed.toLocaleString()} 원/시간` : '안 넣음'}
        min={FIXED_RANGE[0]} max={FIXED_RANGE[1]} step={FIXED_RANGE[2]}
        onChange={(v) => set({ fixedPerHour: v })}
      />
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
        지금 단가({price} 원/kWh)로 이 설비는 <b className="text-ink2">쉬지 않고 돌 때
        시간당 {won(run * price + fixed)}</b>, <b className="text-ink2">서 있을 때
        시간당 {won(idle * price + fixed)}</b> 씁니다.
      </p>
    </Section>
  );
}

/** 반송물 종류 하나 — 색 견본과 이름 */
function KindChip({ kind }) {
  const it = PAYLOAD_ITEMS[kind];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-edge"
        style={{ background: it?.color ?? '#94a3b8' }}
      />
      <span className="truncate">{it?.name ?? kind}</span>
    </span>
  );
}

const KIND_KEYS = Object.keys(PAYLOAD_ITEMS);

/**
 * 이 설비가 무엇을 먹고 무엇을 만드는가 (레시피 · BOM).
 * ---------------------------------------------------------------------------
 *  ── 왜 라이브러리 항목이 아니라 이 자리인가 ──────────────────────────────
 *  같은 기계라도 자리마다 하는 일이 다르다. 라인 앞의 제작기는 제작품 1 을
 *  만들고 뒤의 제작기는 제작품 3 을 만들 수 있다. 라이브러리에 매달면 그 구분이
 *  불가능하므로 **놓인 설비마다** 정한다.
 *
 *  ── 재료를 안 정하면 예전 그대로다 ───────────────────────────────────────
 *  입력이 비면 원자재 공급원 — 아무것도 안 먹고 계속 만든다. 이미 그린 도면이
 *  이 칸이 생겼다는 이유로 갑자기 서면 안 되므로 그것이 기본값이다.
 */
function RecipeSection({ placed, item }) {
  const { dispatch } = useEditor();
  const lots = useLots(placed.uid);
  const stock = useStock(placed.uid);

  const recipe = recipeOf(placed) ?? { in: [], out: null };
  /* 산출물은 **이 기계의 갈래 안에서만** 고른다 — 제작기는 제작품, 조립기는
     조립품. 갈래는 그 기계가 하는 일 자체라 자리마다 달라질 값이 아니다. */
  const outKeys = allowedOutOf(item);
  const out = outputKindOf(placed, item);
  const source = isSource(recipe);
  const cap = inputCapOf(placed);
  const per = Math.max(1, placed.outputCount ?? 3);

  const patch = (next) =>
    dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { recipe: normalizeRecipe(next) } });

  const used = new Set(recipe.in.map((r) => r.kind));
  const addable = KIND_KEYS.filter((k) => !used.has(k));

  /* 지금 한 덩어리(= 적재 층수)를 만들 재료가 있는가 — 없으면 무엇이 없는지까지 */
  const missing = source ? {} : missingOf(countKinds(lots), needFor(recipe, per));
  const short = Object.entries(missing);

  /**
   * 자리는 **종류마다** 나뉘어 있다(bom.js 의 slotShares).
   *  한 버퍼를 여럿이 자리다툼하게 두면 빠른 쪽이 느린 쪽 자리를 먹어 되돌릴 수
   *  없는 교착이 된다. 나눠 두면 그런 일이 아예 안 생기고, 대신 **버퍼가 작을 때**
   *  어느 종류도 한 덩어리치를 못 담는 새 문제가 생기므로 그것을 짚어 준다.
   */
  const slots = source ? null : slotShares(recipe, cap);
  const tight = source ? [] : tooSmallFor(recipe, cap, per);
  /* 한 덩어리치가 다 들어갈 만한 최소 버퍼 — 비율을 지키면서 담으려면 이만큼 */
  const minCap = source ? 0 : recipe.in.reduce((s, r) => s + r.qty, 0) * per;

  return (
    <Section title="만드는 것" data-guide="panel-recipe">
      {/* 무엇을 만드는지는 **도면에만** 적힌다 — 라이브러리로 되돌아가는
          「기본값」 같은 선택지는 없다. 라이브러리가 정하는 것은 갈래뿐이다 */}
      <label className="block py-1">
        <span className="mb-1 block text-[11px] text-ink4">산출물</span>
        <select
          value={out}
          onChange={(e) => patch({ ...recipe, out: e.target.value })}
          className="w-full rounded-md border border-edge bg-field px-2 py-1.5 text-xs text-ink outline-none focus:border-sky-500/60"
        >
          {outKeys.map((k) => (
            <option key={k} value={k}>{PAYLOAD_ITEMS[k].name}</option>
          ))}
        </select>
      </label>
      <Row label="내보내는 것"><KindChip kind={out} /></Row>

      <p className="mb-1 mt-3 text-[10.5px] text-ink4">재료 (완성품 1개당)</p>
      {recipe.in.length === 0 && (
        <p className="rounded bg-raise px-2 py-1.5 text-[10.5px] leading-relaxed text-ink4 ring-1 ring-edge">
          재료가 없습니다 — <b className="text-ink2">원자재 공급원</b>입니다. 아무것도 먹지 않고
          계속 만듭니다(지금까지의 동작).
        </p>
      )}
      <ul className="space-y-1">
        {recipe.in.map((row) => (
          <li key={row.kind} className="flex items-center gap-1.5 text-[11px] text-ink2">
            <KindChip kind={row.kind} />
            <input
              type="number"
              min="1"
              max={MAX_QTY}
              value={row.qty}
              onChange={(e) => patch({
                ...recipe,
                in: recipe.in.map((r) => (r.kind === row.kind ? { ...r, qty: Number(e.target.value) } : r)),
              })}
              className="ml-auto w-12 rounded border border-edge bg-field px-1 py-0.5 text-right text-[11px] tabular-nums text-ink outline-none focus:border-sky-500/60"
            />
            <span className="text-ink4">개</span>
            <button
              onClick={() => patch({ ...recipe, in: recipe.in.filter((r) => r.kind !== row.kind) })}
              className="rounded px-1 text-ink4 hover:text-rose-500"
              title="이 재료를 뺀다"
            >
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && patch({ ...recipe, in: [...recipe.in, { kind: e.target.value, qty: 1 }] })}
          className="mt-1.5 w-full rounded-md border border-dashed border-edge bg-field px-2 py-1 text-[11px] text-ink4 outline-none focus:border-sky-500/60"
        >
          <option value="">+ 재료 추가…</option>
          {addable.map((k) => (
            <option key={k} value={k}>{PAYLOAD_ITEMS[k].name}</option>
          ))}
        </select>
      )}

      {!source && (
        <>
          <Slider
            label="입력 버퍼"
            min={5} max={200} step={5}
            value={cap}
            text={`${cap} 개`}
            onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { inputCap: v } })}
          />
          <Row label="지금 쌓인 재료">
            <span>{stock} / {cap} 개</span>
            {stock > 0 && (
              <button
                onClick={() => clearStock(placed.uid)}
                className="ml-1.5 rounded bg-kbd px-1 py-0.5 text-[10px] font-normal text-ink4 hover:text-rose-500"
                title="쌓인 재료를 전부 버린다"
              >
                전부 비우기
              </button>
            )}
          </Row>
          <StockBreakdown uid={placed.uid} slots={slots} />

          {/* 버퍼가 작아 **어느 종류도 한 덩어리치를 못 담는** 경우.
              자리를 나누고 나면 생길 수 있는 일인데, 화면에 "재료 부족" 이라고만
              뜨면 진짜 원인(버퍼가 작다)을 영영 못 찾는다 */}
          {tight.length > 0 && (
            <p className="mt-2 rounded bg-rose-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-rose-500 ring-1 ring-rose-500/25">
              <b>입력 버퍼가 작습니다.</b>{' '}
              {tight.map((t) => `${PAYLOAD_ITEMS[t.kind]?.name ?? t.kind} 자리 ${t.slots}개 < 필요 ${t.need}개`).join(' · ')}.
              한 덩어리({per}개)를 만들 재료가 **들어올 자리조차** 없어 영원히 굶습니다 —
              버퍼를 최소 <b>{minCap}</b>개로 올리세요.
            </p>
          )}

          {tight.length === 0 && short.length > 0 && (
            <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-600 ring-1 ring-amber-500/25">
              한 덩어리({per}개)를 만들 재료가 모자랍니다 —{' '}
              {short.map(([k, n]) => `${PAYLOAD_ITEMS[k]?.name ?? k} ${n}개`).join(' · ')} 부족.
              이 설비는 <b>굶어서</b> 서 있습니다.
            </p>
          )}
        </>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
        재료는 <b className="text-ink3">만드는 순간</b>에 없어집니다 — 불량품도 재료를 먹습니다.
        <br />설비는 출력 버퍼를 두지 않습니다. 벨트에 올라타거나 카트가 가져가는{' '}
        <b className="text-ink3">그만큼만</b> 만듭니다.
        <br />공정 <b className="text-ink3">순서는 따로 적지 않습니다</b> — 벨트가 이미 그 말을
        하고 있고, 표를 하나 더 두면 도면과 어긋날 수 있습니다.
      </p>
    </Section>
  );
}

function EquipmentPanel({ placed }) {
  const { state, dispatch, itemOf } = useEditor();
  const beltSpeed = state.beltSpeed;
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const rect = spec ? footprintOf(placed, spec) : null;
  const ports = spec ? portsOf(placed, item) : [];

  /* ---- 이 설비가 실제로 몇 개를 내놓는가 --------------------------------
   *  설비 능력과 벨트 수송 능력 중 **작은 쪽**이 한계다. 예전에는 두 값을 두
   *  섹션에 나눠 놓고 사용자가 암산하게 했는데, 그나마도 한쪽은 층수를 빠뜨려
   *  **같은 화면에 서로 다른 개/분이 두 개** 떠 있었다.
   * ---------------------------------------------------------------------- */
  const cycleSec = cycleOf(placed, item);
  const cycleVar = varOf(placed, item);
  const bundle = Math.max(1, Math.round(placed.outputCount ?? 3));
  const machineRate = perMinute(cycleSec);

  /* 벨트 속도는 **실제로 물린 벨트**의 것을 쓴다. 전역 기본값을 쓰면 링크마다
     속도를 따로 준 도면에서 여기 숫자만 조용히 틀린다. */
  const outLink = useMemo(
    () =>
      state.links.find(
        (l) => l.from?.uid === placed.uid && !l.from?.anchor && !l.from?.link
          && !isUtility(itemOf(l.itemId)) && itemOf(l.itemId)?.render !== 'tube',
      ) ?? null,
    [state.links, placed.uid, itemOf],
  );
  const beltV = outLink?.speed ?? beltSpeed;
  /* 간격은 **정하는 값이 아니라 따라 나오는 값이다** (process.js 의 spacingFor) */
  const gap = spacingFor(cycleSec, bundle, beltV);
  const beltRate = beltPerMinute(gap, beltV, bundle);
  /* 벨트가 안 물려 있으면 카트가 실어 간다 — 그때는 설비 능력이 그대로 한계다 */
  const rate = outLink ? Math.min(machineRate, beltRate) : machineRate;
  /* 간격이 최소치에 걸렸을 때만 벨트가 진짜 한계다 — 더 붙여 실을 수가 없다 */
  const beltIsLimit = !!outLink && spacingClamped(cycleSec, bundle, beltV);

  return (
    <>
      <Section title="설비">
        <Field
          label="이름"
          value={placed.name}
          onChange={(e) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? placed.itemId}</Row>
        <Row label="ID">{placed.uid}</Row>
        <EquipUptime uid={placed.uid} />
      </Section>

      <Section title="생산" data-guide="panel-production">
        <div className="rounded-md border border-edge bg-field px-2.5 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-ink4">이 설비의 처리량</span>
            <b className="text-[15px] tabular-nums text-ink">{rate.toFixed(1)} 개/분</b>
          </div>
          <div className="mt-0.5 text-right text-[10px] tabular-nums text-ink4">
            시간당 {Math.round(rate * 60).toLocaleString()} 개
          </div>
          <p className="mt-1.5 border-t border-line pt-1.5 text-[10.5px] leading-relaxed text-ink4">
            {!outLink ? (
              <>벨트가 안 물려 있습니다 — 카트가 실어 가는 만큼 나갑니다.</>
            ) : beltIsLimit ? (
              <>
                <b className="text-amber-400">벨트가 한계</b>입니다 (설비는{' '}
                {machineRate.toFixed(1)} 개/분). 물건이 겹치지 않는 최소 간격
                {' '}{MIN_GAP.toFixed(2)} m 에 걸렸습니다 — 벨트를 빠르게 하거나{' '}
                <b className="text-ink3">한 번에</b> 개수를 늘리세요.
              </>
            ) : (
              <>설비가 낸 만큼 벨트가 그대로 실어 냅니다 — 간격이 자동으로 맞춰집니다.</>
            )}
          </p>
        </div>

        {/* ── 설비가 정하는 것 ── */}
        <div className="mt-3">
          <Slider
            label="만드는 시간"
            text={`${cycleSec.toFixed(1)} 초/개`}
            hint={`설비 혼자서는 ${machineRate.toFixed(1)} 개/분`}
            value={cycleSec}
            min={CYCLE_RANGE[0]}
            max={CYCLE_RANGE[1]}
            step={CYCLE_RANGE[2]}
            onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { cycleSec: v } })}
          />
          <Slider
            label="시간 편차"
            text={`±${Math.round(cycleVar * 100)} %`}
            hint={
              cycleVar > 0
                ? `한 개에 ${(cycleSec * (1 - cycleVar)).toFixed(1)} ~ ${(cycleSec * (1 + cycleVar)).toFixed(1)} 초`
                : '늘 같은 시간 — 편차를 주면 버퍼가 왜 필요한지 드러납니다'
            }
            value={cycleVar}
            min={0}
            max={VAR_MAX}
            step={0.05}
            onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { cycleVar: v } })}
          />
        </div>

        {/* ── 벨트가 정하는 것 ── */}
        <div className="mt-3 border-t border-line pt-2">
          <span className="text-[11px] font-medium text-ink3">벨트로 내보내기</span>
          <Slider
            label="한 번에"
            text={`${bundle} 개씩`}
            hint={`벨트 위에 이만큼 층으로 쌓여 흐릅니다 (카트도 같은 수로 싣습니다) · 설비는 ${outputCapFor(bundle)}개까지 만들어 놓고 기다립니다`}
            value={bundle}
            min={1}
            max={8}
            step={1}
            onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { outputCount: v } })}
          />
          {/**
            * 간격은 **읽기만 한다.**
            * -----------------------------------------------------------------
            *  슬라이더였을 때는 맞출 방법이 없었다. 촘촘히 할수록 좋은 게 아니라
            *  톱니처럼 오르내려서, 4.0m 에서 3.5m 로 좁히면 처리량이 114 → 65 로
            *  반토막 났다(벨트 칸이 빈 채로 먼저 지나가 다음 칸을 기다린다).
            *  설비가 한 덩어리 내는 박자에 맞추는 값 하나만 정답이라, 그건 도구가
            *  계산하는 게 맞다.
            */}
          <Row label="간격 (자동)">
            <span className="text-ink4">{gap.toFixed(2)} m</span>
          </Row>
          <p className="-mt-0.5 text-[10px] leading-snug text-ink4">
            {outLink
              ? `벨트 ${beltV.toFixed(2)} m/s × ${(cycleSec * bundle).toFixed(1)}초(${bundle}개 만드는 시간) — 벨트가 한 덩어리마다 딱 한 번 지나갑니다`
              : '벨트를 물리면 그 벨트 속도에 맞춰 정해집니다'}
          </p>
        </div>
      </Section>

      <RecipeSection placed={placed} item={item} />

      <CrewFields placed={placed} />

      <FaultFields placed={placed} />

      <PowerFields placed={placed} />

      <Section title="배치">
        <Row label="위치 X / Z">
          {placed.pos[0].toFixed(2)} , {placed.pos[1].toFixed(2)} m
        </Row>
        <Row label="회전">{ROT_LABEL[placed.rot]}</Row>
        {rect && (
          <Row label="점유 크기">
            {(rect.maxX - rect.minX).toFixed(2)} × {(rect.maxZ - rect.minZ).toFixed(2)} m
          </Row>
        )}
        {spec && <Row label="높이">{spec.bbox.size[1].toFixed(2)} m</Row>}
        <div className="mt-2 flex gap-2">
          <Btn onClick={() => dispatch({ type: 'ROTATE', uid: placed.uid })}>
            <RotateCw size={13} /> 90° 회전
          </Btn>
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'equip', uid: placed.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>

      {/**
        * 생산 — **결론부터 보여 준다.**
        * -------------------------------------------------------------------
        *  예전에는 「공정 시간」 과 「출하」 두 섹션에 슬라이더 넷이 흩어져 있었고,
        *  개/분 이 두 군데에 서로 다른 값으로 떠 있었다(한쪽이 층수를 빠뜨렸다).
        *  사용자가 초·%·층·m 을 머릿속에서 곱해야 "그래서 몇 개 나오는데?" 를
        *  알 수 있었다 — 그건 도구가 할 일이다.
        *
        *  이제 맨 위에 답이 있고, 아래 슬라이더들은 **그 답을 어떻게 바꾸는지**만
        *  보여 준다. 슬라이더마다 자기 값이 무엇으로 환산되는지 한 줄씩 붙는다.
        */}

      <Section title={`포트 ${ports.length}개`}>
        {ports.length === 0 && <p className="text-[11px] text-ink4">모델 로딩 중…</p>}
        <ul className="space-y-1">
          {ports.map((p) => (
            <li key={p.key}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-ink2">
                  <i
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: p.kind === 'in' ? '#34d399' : p.kind === 'out' ? '#fb923c' : '#38bdf8' }}
                  />
                  {p.id}
                </span>
                <span className="tabular-nums text-ink4">
                  {p.dir[0] ? (p.dir[0] > 0 ? 'X+' : 'X−') : p.dir[1] > 0 ? 'Z+' : 'Z−'} · h{p.world[1].toFixed(2)}
                </span>
              </div>
              {p.warning && (
                <p className="mt-0.5 flex items-start gap-1 pl-3 text-[10px] leading-tight text-amber-600">
                  <AlertTriangle size={10} className="mt-px shrink-0" />
                  {p.warning}
                </p>
              )}
            </li>
          ))}
        </ul>
        {spec && !spec.hasExplicitPorts && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-amber-600">
            자동 생성된 포트입니다. 모델에 PORT_IN / PORT_OUT 더미를 넣으면 정확한 위치·높이로 연결됩니다.
          </p>
        )}
      </Section>
    </>
  );
}

function LinkPanel({ link }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion(); // 모델이 늦게 로드돼도 길이가 갱신되도록
  const item = itemOf(link.itemId);
  const path = useMemo(() => linkPath(link, state.placed, itemOf), [link, state.placed, itemOf, version]);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;

  const endName = (ep) => {
    if (ep.point) return `자유 끝점 (${ep.point[0].toFixed(1)}, ${ep.point[1].toFixed(1)})`;
    const p = state.placed.find((x) => x.uid === ep.uid);
    return `${p?.name ?? ep.uid} · ${ep.portId}`;
  };

  return (
    <>
      <Section title="연결장치">
        <Field
          label="이름"
          value={link.name}
          onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? link.itemId}</Row>
        <Row label="연장 방식">{item?.render === 'tube' ? '튜브 (절차적)' : '모델 반복'}</Row>
      </Section>

      <Section title="경로">
        <Row label="총 길이">{path ? `${path.length.toFixed(2)} m` : '—'}</Row>
        {spec && path && (
          <>
            <Row label="토막 길이">{spec.connector.span.toFixed(2)} m</Row>
            <Row label="타일 개수">
              {tileCount(path, spec.connector.span)} 개 ×{' '}
              {(path.length / tileCount(path, spec.connector.span) / spec.connector.span).toFixed(2)} 배
            </Row>
            <Row label="곡선 분할">{sliceCountFor(path, spec.connector.span, link.radius ?? 1)} 단</Row>
          </>
        )}
        <Row label="꺾임 점">{path ? Math.max(0, path.pts.length - 2) : 0}</Row>

        <label className="mt-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            코너 반경
            <b className="text-ink2 tabular-nums">{(link.radius ?? 1).toFixed(2)} m</b>
          </span>
          <input
            type="range"
            min="0"
            max="4"
            step="0.05"
            value={link.radius ?? 1}
            onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { radius: Number(e.target.value) } })}
            className="w-full accent-sky-500"
          />
        </label>
      </Section>

      {/* 경유점 — 그린 뒤에 라인을 직접 고치는 곳 */}
      <Section title={`경유점 ${(link.waypoints ?? []).length}개`}>
        <p className="text-[10.5px] leading-relaxed text-ink4">
          선택하면 경로 위에 손잡이가 뜹니다. <b className="text-ink3">진한 점</b>을 끌어 옮기고,
          <b className="text-ink3"> 흐린 점</b>을 끌면 그 자리에 경유점이 새로 생깁니다.
          <b className="text-ink3"> Alt+클릭</b>으로 지웁니다.
        </p>
        {(link.waypoints ?? []).length > 0 && (
          <ul className="mt-2 space-y-1">
            {link.waypoints.map((w, i) => (
              <li key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-ink2 tabular-nums">
                  #{i + 1} · {w[0].toFixed(2)} , {w[1].toFixed(2)}
                </span>
                <button
                  onClick={() =>
                    dispatch({
                      type: 'UPDATE_LINK',
                      uid: link.uid,
                      patch: { waypoints: link.waypoints.filter((_, k) => k !== i) },
                    })
                  }
                  className="rounded p-0.5 text-ink4 hover:bg-red-500/15 hover:text-red-500"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
            <li>
              <button
                onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { waypoints: [] } })}
                className="mt-1 text-[10px] text-sky-600 hover:underline"
              >
                경유점 모두 지우고 자동 경로로
              </button>
            </li>
          </ul>
        )}
      </Section>

      {/* 배관·전선 높이 */}
      {item?.utility && (
        <Section title="설치 높이">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
              높이
              <b className="text-ink tabular-nums">{(link.height ?? item.height ?? 1).toFixed(2)} m</b>
            </span>
            <input
              type="range"
              min="0.1"
              max="8"
              step="0.05"
              value={link.height ?? item.height ?? 1}
              onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { height: Number(e.target.value) } })}
              className="w-full accent-sky-500"
            />
          </label>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink4">
            배관·전선은 컨베이어 포트를 쓰지 않고 이 높이에 놓입니다. 겹쳐도 층을 쌓지 않아
            T·+ 자로 만날 수 있습니다.
          </p>
        </Section>
      )}

      {/* 층 ------------------------------------------------------------- */}
      {!item?.utility && (
      <Section title="층 (겹칠 때 쌓이는 높이)">
        <div className="flex items-center gap-2">
          <Btn
            disabled={(link.layer ?? 0) <= 0}
            onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { layer: Math.max(0, (link.layer ?? 0) - 1) } })}
          >
            <ChevronDown size={13} /> 내리기
          </Btn>
          <span className="flex-1 text-center text-sm font-semibold text-ink tabular-nums">
            {link.layer ?? 0}층
          </span>
          <Btn
            disabled={(link.layer ?? 0) >= MAX_LAYER}
            onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { layer: Math.min(MAX_LAYER, (link.layer ?? 0) + 1) } })}
          >
            <ChevronUp size={13} /> 올리기
          </Btn>
        </div>
        <div className="mt-1">
          <Row label="들림 높이">+{layerLift(link.layer ?? 0).toFixed(2)} m</Row>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink4">
          그릴 때 기존 레일과 겹치면 자동으로 위층에 놓입니다. 양 끝은 포트 높이를 지키고
          가운데만 들립니다.
        </p>
      </Section>
      )}

      {/* 벨트 ----------------------------------------------------------- */}
      {spec && item?.render !== 'tube' && (
        <Section title="벨트">
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
              폭
              <b className="text-ink2 tabular-nums">
                {(spec.connector.nativeWidth * (link.widthScale ?? 1)).toFixed(2)} m
              </b>
            </span>
            <input
              type="range"
              min="0.3"
              max="3"
              step="0.05"
              value={spec.connector.nativeWidth * (link.widthScale ?? 1)}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_LINK',
                  uid: link.uid,
                  patch: { widthScale: Number(e.target.value) / spec.connector.nativeWidth },
                })
              }
              className="w-full accent-sky-500"
            />
            <span className="text-[10px] text-ink4">
              모델 원본 {spec.connector.nativeWidth.toFixed(2)} m · 배율 {(link.widthScale ?? 1).toFixed(2)}
            </span>
          </label>

          {spec.connector.belt ? (
            <label className="mt-2 block">
              <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
                구동 속도
                <b className="text-ink2 tabular-nums">
                  {(link.speed ?? state.beltSpeed).toFixed(2)} m/s
                  {link.speed == null && <span className="ml-1 text-ink4">(기본)</span>}
                </b>
              </span>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={link.speed ?? state.beltSpeed}
                onChange={(e) => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { speed: Number(e.target.value) } })}
                className="w-full accent-sky-500"
              />
              {link.speed != null && (
                <button
                  onClick={() => dispatch({ type: 'UPDATE_LINK', uid: link.uid, patch: { speed: null } })}
                  className="mt-1 text-[10px] text-sky-400 hover:underline"
                >
                  전역 기본값으로 되돌리기
                </button>
              )}
            </label>
          ) : (
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
              이 모델에는 벨트 메시가 없어 UV 구동을 하지 않습니다. 벨트 부분을 별도 메시로
              분리하고 이름에 <code className="rounded bg-field px-1">Belt</code> 를 넣어 주세요.
            </p>
          )}
        </Section>
      )}

      <Section title="끝점">
        <Row label="시작">{endName(link.from)}</Row>
        <Row label="끝">{endName(link.to)}</Row>
        <div className="mt-2">
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'link', uid: link.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

function ShelfPanel({ placed }) {
  const { dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const stock = useStock(placed.uid);

  const s = shelfSpec(spec);
  const bays = shelfBays(placed);
  const bayLen = bayLength(placed, spec);
  const levelCount = shelfLevelCount(placed);
  const gap = levelGap(placed, spec);
  const length = shelfLength(placed, spec);
  const per = perLevel(placed, spec);
  const pitch = slotPitch(placed, spec);
  const capacity = shelfCapacity(placed, spec);
  const rows = shelfRows(placed);
  const aisle = rowGap(placed);
  const rowList = rowKinds(placed);
  const shown = Math.min(stock, capacity);   // 수용량이 줄면 표시도 따라 줄어든다

  const set = (patch) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch });

  const num = (label, key, min, max, step, value, text) => (
    <label className="mt-2 block first:mt-0">
      <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
        {label}
        <b className="text-ink tabular-nums">{text}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
        className="w-full accent-sky-500"
      />
    </label>
  );

  return (
    <>
      <Section title="선반">
        <Field
          label="이름"
          value={placed.name}
          onChange={(e) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? placed.itemId}</Row>
        <Row label="위치 X / Z">
          {placed.pos[0].toFixed(2)} , {placed.pos[1].toFixed(2)} m
        </Row>
        <Row label="회전">{['0°', '90°', '180°', '270°'][placed.rot]}</Row>
        <Row label="모델">{spec?.shelf ? 'Shelf.glb' : '절차적 (모델 없음)'}</Row>
      </Section>

      <Section title="크기">
        {num('칸 수', 'bays', MIN_BAYS, MAX_BAYS, 1, bays, `${bays}칸 · 전체 ${length.toFixed(2)} m`)}
        {num('한 칸 길이', 'bayLength', MIN_BAY_LENGTH, MAX_BAY_LENGTH, 0.05, bayLen, `${bayLen.toFixed(2)} m`)}
        {num('단 수', 'levels', MIN_LEVELS, MAX_LEVELS, 1, levelCount, `${levelCount} 단`)}
        {num('단 간격', 'levelGap', MIN_LEVEL_GAP, MAX_LEVEL_GAP, 0.05, gap, `${gap.toFixed(2)} m`)}
        <Row label="전체 높이">{shelfHeight(placed, spec).toFixed(2)} m</Row>
      </Section>

      {/**
        * 줄 — 같은 규격의 랙을 앞뒤로 세운다.
        * ---------------------------------------------------------------------
        *  예전에는 줄을 늘리려면 선반을 새로 그려 위치와 설정을 손으로 맞춰야
        *  했다. 한 덩어리로 다루면 옮길 때도 같이 움직이고 규격도 한 번만 맞춘다.
        */}
      <Section title="줄" data-guide="panel-shelfrows">
        {num('줄 수', 'rows', MIN_ROWS, MAX_ROWS, 1, rows,
          `${rows} 줄 · 전체 깊이 ${shelfDepth(placed, spec).toFixed(2)} m`)}
        {rows > 1 && num('통로 폭', 'rowGap', MIN_ROW_GAP, MAX_ROW_GAP, 0.1, aisle, `${aisle.toFixed(2)} m`)}

        {rows > 1 && (
          <div className="mt-2">
            <p className="mb-1 text-[10.5px] leading-relaxed text-ink4">
              줄마다 받을 종류를 정할 수 있습니다. <b className="text-ink3">안 정한 줄</b>은
              지금처럼 섞어서 받고, 정한 줄은 그 종류만 받습니다.
            </p>
            {rowList.map((kind, r) => (
              <div key={r} className="mt-1 flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[10.5px] tabular-nums text-ink4">{r + 1}번 줄</span>
                <select
                  value={kind ?? ''}
                  onChange={(e) => {
                    const next = [...rowList];
                    next[r] = e.target.value || null;
                    set({ rowKinds: next });
                  }}
                  className="min-w-0 flex-1 rounded border border-edge bg-field px-1 py-0.5 text-[11px] text-ink outline-none focus:border-sky-500/60"
                >
                  <option value="">안 정함 (섞어서)</option>
                  {Object.entries(PAYLOAD_ITEMS).map(([k, it]) => (
                    <option key={k} value={k}>{it.name}</option>
                  ))}
                </select>
                {kind && (
                  <i
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-black/20"
                    style={{ background: PAYLOAD_ITEMS[kind]?.color ?? '#94a3b8' }}
                  />
                )}
              </div>
            ))}
            {rowList.every((k) => k) && (
              <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10.5px] leading-relaxed text-amber-600 ring-1 ring-amber-500/25">
                모든 줄에 종류를 정했습니다 — 여기 없는 종류는 이 선반에 <b>못 들어갑니다.</b>
                한 줄은 비워 두면 나머지가 섞여 들어갑니다.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="수용량">
        <div>
          <Row label="한 단 적재수">{per} 개 · 간격 {pitch.toFixed(2)} m</Row>
          <Row label="한 줄">{per} × {levelCount}단 = {perRow(placed, spec)} 개</Row>
          <Row label="총 수용량">{perRow(placed, spec)} × {rows}줄 = {capacity} 개</Row>
          <div className="mb-1 mt-1 flex items-center justify-between text-[11px]">
            <span className="text-ink4">현재 재고</span>
            <b className="text-ink tabular-nums">{shown} / {capacity}</b>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-kbd">
            <div
              className="h-full bg-emerald-500 transition-[width]"
              style={{ width: `${capacity ? Math.min(100, (shown / capacity) * 100) : 0}%` }}
            />
          </div>
        </div>
        <StockBreakdown uid={placed.uid} />

        <div className="mt-2 flex gap-2">
          <Btn onClick={() => setStock(placed.uid, capacity)}>가득 채우기</Btn>
          <Btn onClick={() => clearStock(placed.uid)}>비우기</Btn>
        </div>
      </Section>

      <Section title="입출고" data-guide="panel-slots">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            빈 카트에 실어 보낼 수량
            <b className="text-ink tabular-nums">{placed.dispatchCount ?? 3} 개</b>
          </span>
          <input
            type="range"
            min="0"
            max="12"
            step="1"
            value={placed.dispatchCount ?? 3}
            onChange={(e) => set({ dispatchCount: Number(e.target.value) })}
            className="w-full accent-sky-500"
          />
        </label>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          선반 앞뒤 바닥에 <b className="text-emerald-600">녹색(내리기)</b> ·
          <b className="text-amber-600"> 주황(싣기)</b> 구역이 반씩 깔려 있습니다.
          카트가 <b className="text-ink3">녹색</b>을 지나면 싣고 있던 자재를 내려놓고,
          <b className="text-ink3"> 주황</b>을 지나면 이 수량만큼 실어 갑니다.
          실어 온 곳에는 도로 내려놓지 않고, 한 번 주고받은 선반은 다른 곳을 거치기
          전까지 다시 반응하지 않습니다.
          재고는 시뮬레이션 값이라 도면 파일에는 저장되지 않습니다.
        </p>
      </Section>

      <Section title="배치">
        <div className="flex gap-2">
          <Btn onClick={() => dispatch({ type: 'ROTATE', uid: placed.uid })}>
            <RotateCw size={13} /> 90° 회전
          </Btn>
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'equip', uid: placed.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

/**
 * 이 경로의 카트가 앞차에 막혀 있던 비율.
 * ---------------------------------------------------------------------------
 *  대수를 늘렸는데 처리량이 안 느는 이유가 대개 여기 있다. 막힘이 크면 **대수가
 *  아니라 경로가 모자란** 것이다 — 한 대를 더 넣어도 그 한 대도 같이 서 있는다.
 *
 *  정차(dwell)는 안 들어간다. 역에서 주고받은 시간은 **일을 한** 시간이라, 그것을
 *  합쳐 세면 잘 도는 라인일수록 숫자가 나빠 보인다.
 */
function CartQueue({ cart }) {
  useMetrics();
  const ran = getCartRan()[cart.uid] ?? 0;
  if (ran <= LOSS_FLOOR) return null;
  const sec = getCartBlocked()[cart.uid] ?? 0;
  if (sec <= LOSS_FLOOR) {
    return <Row label="앞차에 막힘"><span className="text-emerald-600">없음</span></Row>;
  }
  const r = cartBlockRatio(cart.uid);
  return (
    <>
      <Row label="앞차에 막힘">
        <span className={r > 0.35 ? 'text-rose-500' : r > 0.15 ? 'text-amber-600' : 'text-ink2'}>
          {(r * 100).toFixed(0)} %
        </span>
        <span className="ml-1 text-[10px] font-normal text-ink4">({formatElapsed(sec)})</span>
      </Row>
      {r > 0.35 && (
        <p className="mt-1 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-600 ring-1 ring-amber-500/25">
          도는 시간의 {(r * 100).toFixed(0)}% 를 앞차 뒤에서 보냅니다 — <b>대수를 늘려도
          처리량은 거의 안 늘어납니다.</b> 경로를 늘리거나 대수를 줄이세요.
        </p>
      )}
    </>
  );
}

function CartPanel({ cart }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(cart.itemId);
  const path = useMemo(() => cartPath(cart), [cart]);
  const stations = useMemo(
    () => (path ? cartStations(path, state.placed, itemOf, { loadOnly: isTruck(item), roles: cart.roles }) : []),
    [path, state.placed, itemOf, version, item, cart.roles],
  );
  /* 앞차와 지키는 간격 — 씬과 같은 규칙으로 잰다(차체 길이 + 여유) */
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const gap = (spec?.bbox?.size?.[(spec?.connector?.axis ?? 'z') === 'z' ? 2 : 0] ?? 2.2) + CART_MARGIN;
  /* 나르는 능력 — 규칙은 core/cart.js 한 곳에만 둔다 (CartView 와 어긋나면 검사가 잡는다) */
  const haul = useMemo(
    () => haulPerMinute(cart, path, stations, { truck: isTruck(item) }),
    [cart, path, stations, item],
  );

  /** 역 하나의 역할을 자동 → 싣기 → 내리기 → 자동 으로 돌린다 */
  /**
   * 역 하나의 역할을 **곧바로** 정한다 — 자동(null) · 싣기 · 내리기.
   *  「자동」은 값을 **지우는 것**이다. 빈 문자열 같은 것을 넣어 두면 도면에
   *  뜻 없는 값이 쌓이고, 옛 도면과도 달라진다.
   */
  /* 누르면 그 값으로 **못 박는다**. 누르기 전까지는 roles 에 아무것도 없고,
     그때는 경로가 가까이 지나간 쪽을 그때그때 따른다 — 경로를 옮기면 같이 따라온다. */
  const setRole = (key, role) => {
    dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { roles: { ...(cart.roles ?? {}), [key]: role } } });
  };

  const slider = (label, key, min, max, step, unit, fallback) => (
    <label className="mt-2 block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
        {label}
        <b className="text-ink tabular-nums">
          {(cart[key] ?? fallback).toFixed(2)} {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={cart[key] ?? fallback}
        onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { [key]: Number(e.target.value) } })}
        className="w-full accent-sky-500"
      />
    </label>
  );

  const truck = isTruck(item);

  return (
    <>
      <Section title={truck ? '트럭' : '카트'} data-guide="panel-cart">
        <Field
          label="이름"
          value={cart.name}
          onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { name: e.target.value } })}
        />
        <Row label="라이브러리 항목">{item?.name ?? cart.itemId}</Row>
        <Row label="배치 대수">{cart.count ?? 1} 대</Row>
        <Row label="경로 길이">{path ? `${path.length.toFixed(2)} m` : '—'}</Row>
        <Row label="경유점">{cart.points.length} 개</Row>
        <Row label="주행 방식">{cart.closed ? '고리 (계속 순환)' : '왕복'}</Row>
        {/* 앞차에 막혀 못 간 시간 — 대수를 정하는 데 쓰는 값이다.
            정차(dwell)는 안 들어간다. 그건 일을 한 시간이다 */}
        <CartQueue cart={cart} />
        {/* 차끼리 겹치지 못하게 막고 나면 짧은 경로에 여러 대를 올릴 수 없다.
            얼어붙고 나서 이유를 찾게 두지 않는다 */}
        {path && !fleetFits(path.length, cart.count ?? 1, gap).fits && (
          <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-600 ring-1 ring-amber-500/25">
            경로가 짧아 {cart.count} 대가 다 못 돕니다 — 차끼리 겹칠 수 없어 서로 막습니다.
            최소 <b>{fleetFits(path.length, cart.count ?? 1, gap).need.toFixed(1)} m</b> 가
            필요합니다(차체 {(gap - CART_MARGIN).toFixed(1)} m + 여유).
          </p>
        )}
      </Section>

      {/* 한 번에 몇 개를 실을지는 **차가** 정한다 — 선반·적치대는 얼마든지 내줄
          수 있고, 한 번에 실어 낼 양은 차의 성질이기 때문이다.
          트럭은 한 번에 많이 싣고 나가는 물건이라 단위와 폭을 다르게 잡는다. */}
      <Section title={truck ? '출하' : '적재'}>
        {/**
          * 수송 능력 — **설비 능력과 나란히 놓고 보라고 있는 값.**
          * -------------------------------------------------------------------
          *  만드는 속도가 나르는 속도를 넘으면 쌓이는 곳이 차고, 그다음은 라인
          *  전체가 선다. 그런데 그걸 알려면 대수 · 한 번에 싣는 양 · 경로 길이 ·
          *  속도 · 정차 시간을 전부 곱해야 했다. **손으로 재다 20배를 틀린 적이
          *  있다** — 적치대의 값을 썼는데 실제로는 차량 값이 이기고, 대수도
          *  안 봤다. 사람이 암산할 값이 아니다.
          */}
        <div className="mb-2 rounded-md border border-edge bg-field px-2.5 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-ink4">이 {truck ? '트럭' : '카트'}의 수송 능력</span>
            <b className="text-[15px] tabular-nums text-ink">
              {haul ? haul.perMinute.toFixed(1) : '—'} 개/분
            </b>
          </div>
          {haul && haul.perMinute > 0 && (
            <div className="mt-0.5 text-right text-[10px] tabular-nums text-ink4">
              시간당 {Math.round(haul.perMinute * 60).toLocaleString()} 개
            </div>
          )}
          <p className="mt-1.5 border-t border-line pt-1.5 text-[10.5px] leading-relaxed text-ink4">
            {!haul ? (
              <>경로를 먼저 그려 주세요.</>
            ) : haul.loadStations === 0 ? (
              <><b className="text-amber-400">실을 곳이 없습니다</b> — 경로가 설비 유출부나
                선반·적치대 앞을 지나가야 짐을 싣습니다.</>
            ) : haul.perMinute === 0 ? (
              <><b className="text-amber-400">내릴 곳이 없습니다</b> — 한 번 싣고 나면 비울
                데가 없어 그대로 돕니다. 경로가 선반이나 설비 유입부를 지나가야 합니다.</>
            ) : (
              <>
                {haul.fleet}대 × {haul.perLap}개 ÷ {haul.lapSec.toFixed(1)}초(한 바퀴).
                {' '}이 값이 **앞 설비가 만드는 속도**보다 작으면 쌓이는 곳이 차고 라인이 섭니다.
              </>
            )}
          </p>
        </div>

        <Slider
          label="한 번에 싣는 양"
          min={truck ? 10 : 1}
          max={truck ? 200 : 20}
          step={truck ? 10 : 1}
          value={cart.loadCount ?? (truck ? 10 : 3)}
          text={
            cart.loadCount != null
              ? `${cart.loadCount} 개`
              : `${truck ? 10 : 3} 개 · 보낸 곳 설정 따름`
          }
          onChange={(v) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { loadCount: v } })}
        />

        {/* 지정하지 않으면 선반·적치대가 권하는 양(그쪽의 "실어 보낼 수량")을
            따른다. 한 번 정하고 나면 되돌릴 길이 있어야 한다. */}
        {cart.loadCount != null && (
          <div className="mt-2">
            <Btn onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { loadCount: undefined } })}>
              보낸 곳 설정 따르기
            </Btn>
          </div>
        )}

        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          {truck ? (
            <>
              선반·적치대 옆을 지나면 싣고,
              <b className="text-ink3"> 개구부를 지나 건물 밖</b>으로 나가는 순간 출하로 집계됩니다.
              경로 끝을 벽 바깥까지 그려 주세요 — 출하 지점을 따로 지정할 필요는 없습니다.
            </>
          ) : (
            <>
              <b className="text-ink3">비어 있을 때만</b> 싣습니다. 받는 곳의 수용량이 모자라면
              못 내린 만큼은 그대로 싣고 다음 자리로 갑니다.
            </>
          )}
        </p>
      </Section>

      <Section title="배치 대수">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            이 경로에 올릴 카트
            <b className="text-ink tabular-nums">{cart.count ?? 1} 대</b>
          </span>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={cart.count ?? 1}
            onChange={(e) => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { count: Number(e.target.value) } })}
            className="w-full accent-sky-500"
          />
          {path && (
            <span className="text-[10px] text-ink4">
              간격 {(path.length / (cart.count ?? 1)).toFixed(2)} m
            </span>
          )}
        </label>
        {!cart.closed && (cart.count ?? 1) > 1 && (
          <p className="mt-1 text-[10.5px] leading-relaxed text-amber-600">
            왕복 경로에서는 되돌아오는 카트끼리 스쳐 지나갑니다. 여러 대를 굴릴 거라면
            <b> 고리로 순환</b>을 켜는 편이 자연스럽습니다.
          </p>
        )}
      </Section>

      <Section title="주행">
        {slider('이동 속도', 'speed', 0, 5, 0.05, 'm/s', 1.4)}
        {slider('코너 반경', 'radius', 0, 4, 0.05, 'm', 1.2)}
        {slider('정차 시간', 'dwell', 0, 5, 0.1, '초', 1.2)}
        <div className="mt-2 flex gap-2">
          <Btn
            active={cart.closed}
            onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { closed: !cart.closed } })}
          >
            고리로 순환
          </Btn>
          <Btn
            active={cart.reverse}
            onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { reverse: !cart.reverse } })}
          >
            <RotateCw size={13} /> 주행 방향 반전
          </Btn>
        </div>
        {/* 방향은 경유점을 찍은 순서로 정해진다 — 그 순서는 도면에 안 보이므로
            지금 어느 쪽으로 도는지를 글로 적어 준다 */}
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          {cart.closed
            ? cart.reverse
              ? '경유점을 찍은 순서의 반대로 돕니다.'
              : '경유점을 찍은 순서대로 돕니다.'
            : cart.reverse
              ? '경로의 끝에서 출발해 시작점 쪽으로 달립니다.'
              : '경로의 시작점에서 출발합니다.'}
        </p>
        {!state.running && (
          <p className="mt-2 text-[10.5px] text-amber-600">툴바의 ▶ 를 눌러야 움직입니다.</p>
        )}
      </Section>

      {/* 무엇을 나르는 카트인가.
          선반에는 여러 종류가 섞여 쌓인다. 정해 두지 않으면 위에 있던 것이
          잡히는 대로 실리므로, 특정 물건만 옮기려면 여기서 고른다. */}
      {!truck && (() => {
        /* 고른 종류들. 옛 도면의 `pickKind`(하나짜리)도 여기서 받아 준다 —
           안 받으면 골라 둔 버튼이 하나도 안 눌린 것처럼 보인다(cart.js 의 pickSet) */
        const pick = pickSet(cart);
        /** 눌러서 켜고 끈다 — 저장은 늘 배열이다 */
        const toggle = (key) => {
          const next = new Set(pick);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          dispatch({
            type: 'UPDATE_CART',
            uid: cart.uid,
            /* 옛 필드는 지운다 — 둘이 함께 남아 있으면 어느 쪽이 사실인지
               말할 수 없게 된다 */
            patch: { pickKinds: [...next], pickKind: null },
          });
        };
        const names = [...pick].map((k) => PAYLOAD_ITEMS[k].name);
        return (
          <Section title="가져올 물건">
            <div className="flex flex-wrap gap-1">
              <Btn
                active={!pick.size}
                onClick={() => dispatch({ type: 'UPDATE_CART', uid: cart.uid, patch: { pickKinds: [], pickKind: null } })}
              >
                가리지 않음
              </Btn>
              {Object.entries(PAYLOAD_ITEMS).map(([key, it]) => (
                <Btn key={key} active={pick.has(key)} onClick={() => toggle(key)}>
                  <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: it.color }} />
                  {it.name}
                </Btn>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
              {names.length === 0
                ? '위에 있는 것부터 잡히는 대로 싣습니다.'
                : (
                  <>
                    섞여 쌓인 더미에서 <b className="text-ink3">{names.join(' · ')}</b>
                    {names.length > 1 ? ' 를 함께' : ' 만'} 골라 옵니다. 그 밖의 것을 만드는 설비
                    앞은 그냥 지나갑니다.
                    {names.length > 1 && (
                      <>
                        <br />여러 개를 고르면 <b className="text-ink3">한 바퀴에 다 실어 옵니다</b> —
                        재료 가짓수만큼 카트를 따로 놓을 필요가 없습니다.
                      </>
                    )}
                  </>
                )}
            </p>
          </Section>
        );
      })()}

      <Section title={`정차역 ${stations.length}개`}>
        {stations.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-ink4">
            경로가 설비 포트나 선반 앞(1m 이내)을 지나가면 자동으로 역이 됩니다.
            유출부면 싣고, 유입부면 내립니다.
          </p>
        )}
        <ul className="space-y-1">
          {stations.map((st, i) => {
            const style = stationStyle(st.kind);
            const qty = st.kind === 'load' ? ` ${st.count}개` : st.kind === 'shelf-out' ? ` ${st.dispatch}개` : '';
            /* 역할을 고를 수 있는 것은 선반뿐이다(cart.js 의 canRole).
               적치대는 방향이 하나고, 설비 포트는 유입·유출이 형상으로 정해져
               있으며, 트럭은 애초에 싣기만 한다. */
            const pickable = !truck && st.canRole;
            return (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ink2">
                  <i className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: style.color }} />
                  <span className="truncate">{st.name}</span>
                  <span className="shrink-0 tabular-nums text-[10px] text-ink4">
                    {qty && `${qty.trim()} · `}{st.s.toFixed(1)}m
                  </span>
                </span>
                {/**
                  * 「자동」 버튼은 **없다.**
                  * -------------------------------------------------------------
                  *  자동은 고르는 값이 아니라 **처음 값**이다. 경로를 그리는 순간
                  *  가까운 쪽으로 이미 정해져 있으니, 화면은 그 결과(싣기/내리기)를
                  *  켜 놓기만 하면 된다 — 셋을 늘어놓으면 「자동이면 지금 뭐라는
                  *  거지?」 를 한 번 더 묻게 만든다.
                  *
                  *  누르면 그때부터 **못 박힌다**(roles 에 적힌다). 그 전까지는
                  *  아무것도 저장하지 않으므로 경로를 옮기면 다시 따라간다.
                  */}
                {pickable ? (
                  <span className="flex shrink-0 gap-0.5 rounded-md bg-field p-0.5 ring-1 ring-edge">
                    {[
                      [STATION_ROLE.LOAD, '싣기', '여기서 물건을 싣습니다'],
                      [STATION_ROLE.UNLOAD, '내리기', '여기에 물건을 내립니다'],
                    ].map(([role, label, why]) => {
                      /* 못 박은 값이 있으면 그것, 없으면 **지금 하고 있는 일** */
                      const on = (st.role ?? roleOfStation(st.kind)) === role;
                      return (
                        <button
                          key={label}
                          type="button"
                          title={why}
                          onClick={() => setRole(st.key, role)}
                          className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
                            on ? 'bg-sky-500 font-medium text-white' : 'text-ink3 hover:bg-raiseh'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-ink4">{style.label} · 고정</span>
                )}
              </li>
            );
          })}
        </ul>
        {/**
          * **한쪽만 있으면 카트는 한 바퀴를 못 돈다.**
          * ---------------------------------------------------------------------
          *  싣기만 있으면 실은 채로 영원히 돌고, 내리기만 있으면 빈 차로 영원히
          *  돈다. 둘 다 화면에서는 「경로도 있고 역도 여럿」이라 멀쩡해 보이는데
          *  나르는 양만 0 이다 — 왜 0 인지 짚어 주지 않으면 카트 대수를 늘리거나
          *  속도를 올리며 엉뚱한 데를 뒤지게 된다.
          *
          *  판정은 `haulPerMinute` 가 능력을 0 으로 두는 조건 그대로다. 트럭은
          *  실어서 내보내는 것이 일이라 내리는 곳이 없어도 맞다.
          */}
        {(() => {
          if (!stations.length) return null;
          const loads = stations.filter((st) => isLoadStation(st.kind)).length;
          const drops = stations.length - loads;
          const lack = !loads ? '싣는 곳' : (!truck && !drops) ? '내리는 곳' : null;
          if (!lack) return null;
          return (
            <p className="mt-2 flex gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-200 ring-1 ring-amber-500/30">
              <AlertTriangle size={12} className="mt-[3px] shrink-0" />
              <span>
                <b>{lack}이 없습니다.</b> {loads ? '실어 놓고 내려놓을 데가 없어' : '빈 채로'} 돌기만 하므로
                이 경로가 나르는 양은 <b>0</b> 입니다. 역을 하나는 <b>{loads ? '내리기' : '싣기'}</b>로
                바꾸거나, 경로가 {loads ? '유입부' : '유출부'} 앞을 지나가게 하세요.
              </span>
            </p>
          );
        })()}
{/**
          * **잡히기는 했는데 한 번도 안 서는 싣는 역.**
          * ---------------------------------------------------------------------
          *  카트는 비어 있을 때만 싣는다. 그래서 싣는 역이 여럿이면 **내린 뒤
          *  먼저 만나는 하나**만 계속 쓰이고 나머지는 짐을 진 채 지나친다.
          *  화면에는 「역이 넷이고 다 잡혔다」로 보이는데, 한쪽 적치대만 비고
          *  다른 쪽은 차서 그 위 벨트와 설비가 줄줄이 선다 — 카트를 아무리
          *  들여다봐도 원인이 안 보이는 자리다. 값으로 확인하고 넣었다.
          */}
        {(() => {
          if (truck) return null;                 // 트럭은 여러 역에서 나눠 담는다
          const idle = idleLoads(stations, { closed: !!cart.closed });
          if (!idle.length) return null;
          return (
            <p className="mt-2 flex gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-200 ring-1 ring-amber-500/30">
              <AlertTriangle size={12} className="mt-[3px] shrink-0" />
              <span>
                <b>{idle.map((st) => st.name).join(' · ')}</b> 에는 <b>한 번도 안 섭니다.</b>{' '}
                카트는 비어 있을 때만 싣는데, 내려놓고 나서 <b>먼저 만나는 싣는 곳</b>에서 이미
                차 버리기 때문입니다. 경로를 나눠 카트를 따로 두거나, 내리는 곳이 두 싣는 곳
                <b> 사이에</b> 오도록 순서를 바꾸세요.
              </span>
            </p>
          );
        })()}
        
        {stations.some((st) => st.canRole) && !truck && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
            선반은 <b className="text-ink2">싣기 / 내리기</b>를 눌러 바꿀 수 있습니다. 경로를 그릴 때
            더 가까이 지나간 쪽으로 이미 정해 두므로, 그대로 두어도 됩니다.
          </p>
        )}
      </Section>

      <Section title="경로 편집">
        <p className="text-[10.5px] leading-relaxed text-ink4">
          <b className="text-ink3">진한 점</b>을 끌어 옮기고, <b className="text-ink3">흐린 점</b>을 끌면
          경유점이 새로 생깁니다. <b className="text-ink3">Alt+클릭</b>으로 지웁니다.
        </p>
        <div className="mt-2">
          <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'cart', uid: cart.uid })}>
            <Trash2 size={13} /> 삭제
          </Btn>
        </div>
      </Section>
    </>
  );
}

/* ==========================================================================
 * 작업 영역 — 영역 / 벽 / 기둥 / 구역
 * ======================================================================== */

const WALL_RANGE = { thickness: [0.05, 1.5, 0.05], height: [0.3, 12, 0.1] };

/**
 * 이 벽 하나에 뚫린 개구부 목록.
 * ---------------------------------------------------------------------------
 *  개구부는 벽에서 **빠진 자리**라 3D 에서 집을 덩어리가 없다. 바닥의 주황
 *  문지방 띠를 눌러도 되지만, 벽을 고르면 그 벽의 구멍이 함께 나오는 편이
 *  찾기 쉽다 — 문을 손보는 일은 대개 그 벽을 손보는 일과 같이 온다.
 *
 *  @param line { a, b, spec } — 벽의 기준선. 어느 개구부가 이 벽에 얹혔는지는
 *              좌표로 판정하므로, 벽이 조금 움직여도 목록이 따라온다.
 */
function OpeningList({ line }) {
  const { state, dispatch } = useEditor();
  const list = useMemo(
    () => state.openings.filter((o) => openingsOn(line, [o]).length),
    [state.openings, line],
  );

  return (
    <Section title={`개구부 (${list.length})`}>
      {list.length === 0 ? (
        <p className="py-1 text-[11px] leading-relaxed text-ink4">
          이 벽에는 없습니다. 작업영역 탭의 <b className="text-ink3">개구부</b> 도구로
          벽을 클릭해 뚫으세요.
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map((o) => (
            <li key={o.uid}>
              <button
                onClick={() => {
                  dispatch({ type: 'SELECT', selected: { kind: 'opening', uid: o.uid } });
                  focusOn(o.at);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-sky-400" />
                  <span className="truncate">{o.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[10px] text-ink4">
                  {o.width.toFixed(1)} × {o.height.toFixed(1)} m
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 두께·높이·색 — 영역 전체에도, 면 하나에도, 내벽에도 똑같이 쓰인다 */
function WallFields({ spec, onChange }) {
  return (
    <>
      <Slider
        label="두께" min={WALL_RANGE.thickness[0]} max={WALL_RANGE.thickness[1]} step={WALL_RANGE.thickness[2]}
        value={spec.thickness} text={`${spec.thickness.toFixed(2)} m`}
        onChange={(v) => onChange({ thickness: v })}
      />
      <Slider
        label="높이" min={WALL_RANGE.height[0]} max={WALL_RANGE.height[1]} step={WALL_RANGE.height[2]}
        value={spec.height} text={`${spec.height.toFixed(2)} m`}
        onChange={(v) => onChange({ height: v })}
      />
      <ColorField label="색" value={spec.color} onChange={(v) => onChange({ color: v })} />
    </>
  );
}

/**
 * 영역 패널.
 * ---------------------------------------------------------------------------
 *  바닥과 벽은 **서로 다른 대상**이다. 벽 한 장을 골라 이름을 고쳤는데 작업장
 *  이름까지 바뀌면 안 되므로, 면을 고른 상태에서는 영역의 이름·바닥 색을
 *  아예 보여 주지 않고 그 면의 것만 다룬다.
 */
/**
 * 꼭짓점 편집 — 켜고 끄는 스위치.
 * ---------------------------------------------------------------------------
 *  고르기만 하면 손잡이가 나오게 두었더니, 바닥을 누를 때마다 꼭짓점이 우수수
 *  뜨고 그 손잡이가 벽 클릭과 자리를 다퉜다(벽을 고르려던 손이 꼭짓점을 잡는다).
 *  **고치겠다고 말했을 때만** 손잡이를 낸다.
 *
 *  손잡이는 탑뷰(도면)에서만 뜨므로, 3D 로 보던 중에 눌렀다면 탑뷰로 함께
 *  넘긴다 — 버튼을 눌렀는데 아무 일도 안 일어나는 것처럼 보이면 안 된다.
 */
function ShapeEditSection({ kind, uid }) {
  const { state, dispatch } = useEditor();
  const on = state.editShape?.kind === kind && state.editShape.uid === uid;
  const what = kind === 'zone' ? '구역' : '영역';

  const toggle = () => {
    if (on) return dispatch({ type: 'EDIT_SHAPE', target: null });
    if (state.view !== VIEW.TOP) dispatch({ type: 'SET', patch: { view: VIEW.TOP } });
    dispatch({ type: 'EDIT_SHAPE', target: { kind, uid } });
  };

  return (
    <Section
      title="모양 고치기"
      right={
        <button
          onClick={toggle}
          className={`rounded px-1.5 py-0.5 text-[10.5px] ${on ? 'bg-sky-500/15 text-sky-500' : 'bg-kbd text-ink4'}`}
        >
          {on ? '끝내기 (Esc)' : '꼭짓점 편집'}
        </button>
      }
    >
      {on ? (
        <p className="text-[10.5px] leading-relaxed text-ink4">
          · 진한 점(●)을 <b className="text-ink2">끌어</b> 옮깁니다
          <br />· 변 가운데의 흐린 점을 끌면 그 자리에 꼭짓점이 <b className="text-ink2">생깁니다</b>
          <br />· <b className="text-ink2">Alt+클릭</b> 으로 지웁니다 (세 점은 남습니다)
          <br />
          {kind === 'zone'
            ? '구역은 바닥 밖으로 나갈 수 없습니다.'
            : '설비·기둥이 밖으로 나가게 되는 자리로는 줄일 수 없습니다.'}
          <br />편집하는 동안 건물은 클릭을 받지 않습니다.
        </p>
      ) : (
        <p className="text-[10.5px] leading-relaxed text-ink4">
          그린 뒤에 {what}의 모양을 고칩니다. 켜면 탑뷰에서 꼭짓점마다 손잡이가 붙습니다.
        </p>
      )}
    </Section>
  );
}

function AreaPanel({ area, edge }) {
  const { state, dispatch } = useEditor();
  const edges = useMemo(() => mpEdges(area.mp), [area.mp]);
  const picked = edge ? edges.find((e) => e.key === edge) : null;

  const toArea = () => dispatch({ type: 'SELECT', selected: { kind: 'area', uid: area.uid } });

  /* ---- 벽 한 장 -------------------------------------------------------
   *  개구부 목록은 **그 개구부가 뚫린 벽**에 붙는다. 영역(바닥)에 몰아 두면
   *  문이 여럿일 때 어느 벽의 문인지 알 수 없고, 벽을 고쳐야 할 때 두 곳을
   *  오가게 된다. 벽을 고르면 그 벽에 난 구멍이 함께 보이는 편이 자연스럽다. */
  if (picked) {
    const spec = edgeSpec(area, edge);
    const o = area.edges?.[edge] ?? {};
    const idx = edges.indexOf(picked) + 1;
    return (
      <>
        <Section
          title="벽 (한 면)"
          right={
            <button className="text-[11px] text-sky-500 hover:underline" onClick={toArea}>
              영역 전체
            </button>
          }
        >
          <Field
            label="이름"
            value={o.name ?? `${area.name} 벽 ${idx}`}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch: { name: e.target.value } })
            }
          />
          <Row label="소속 영역">{area.name}</Row>
          <Row label="길이">{picked.len.toFixed(2)} m</Row>
        </Section>

        <OpeningList line={{ a: picked.a, b: picked.b, spec }} />

        <Section title="규격">
          <WallFields
            spec={spec}
            onChange={(patch) => dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch })}
          />
          {(o.thickness !== undefined || o.height !== undefined || o.color !== undefined) && (
            <div className="mt-2">
              <Btn onClick={() => dispatch({ type: 'UPDATE_AREA_EDGE', uid: area.uid, edge, patch: null })}>
                영역 기본값으로
              </Btn>
            </div>
          )}
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
            벽은 영역 테두리에서 만들어지므로 따로 지울 수 없습니다. 없애려면 영역의
            모양을 바꾸세요.
          </p>
        </Section>
      </>
    );
  }

  /* ---- 영역(바닥) ------------------------------------------------------ */
  return (
    <>
      <Section title="영역 (바닥)">
        <Field
          label="이름"
          value={area.name}
          onChange={(e) => dispatch({ type: 'UPDATE_AREA', uid: area.uid, patch: { name: e.target.value } })}
        />
        <Row label="바닥 넓이">{mpArea(area.mp).toFixed(1)} ㎡</Row>
        <Row label="벽 면 수">{edges.length} 면</Row>
        <Row label="꼭짓점">{mpVertices(area.mp).length} 개</Row>
        <Row label="바닥 색">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm border border-edge" style={{ background: FLOOR_COLOR }} />
            {FLOOR_COLOR} (고정)
          </span>
        </Row>
      </Section>

      <ShapeEditSection kind="area" uid={area.uid} />

      {/* 벽 규격은 여기서 다루지 않는다.
          바닥과 벽은 서로 다른 대상이고, 벽은 면마다 값이 다를 수 있다.
          한 장만 고치려면 그 벽을 클릭하고, 여러 장을 맞추려면 Ctrl+클릭이나
          마키로 골라 "규격 일괄" 을 쓴다 — 고칠 대상을 눈으로 고르는 쪽이
          "영역 전체" 라는 보이지 않는 범위보다 확실하다. */}
      <Section title="벽 면">
        <ul className="space-y-1">
          {edges.map((e, i) => (
            <li key={e.key}>
              <button
                onClick={() => dispatch({ type: 'SELECT', selected: { kind: 'area', uid: area.uid, edge: e.key } })}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
              >
                <span className="truncate">{area.edges?.[e.key]?.name ?? `${area.name} 벽 ${i + 1}`}</span>
                <span className="shrink-0 tabular-nums text-[10px] text-ink4">{e.len.toFixed(1)} m</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'area', uid: area.uid })}>
          <Trash2 size={13} /> 영역 삭제
        </Btn>
      </Section>
    </>
  );
}

function WallPanel({ wall }) {
  const { dispatch } = useEditor();
  const g = wallBox(wall);
  return (
    <>
      <Section title="내벽">
        <Field
          label="이름"
          value={wall.name}
          onChange={(e) => dispatch({ type: 'UPDATE_WALL', uid: wall.uid, patch: { name: e.target.value } })}
        />
        <Row label="길이">{g.len.toFixed(2)} m</Row>
        <Row label="시작 → 끝">
          {wall.a[0].toFixed(1)},{wall.a[1].toFixed(1)} → {wall.b[0].toFixed(1)},{wall.b[1].toFixed(1)}
        </Row>
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          탑뷰에서 양 끝의 <b className="text-ink3">손잡이</b>를 끌어 옮길 수 있습니다.
          놓을 때와 같이 다른 벽 끝·영역 경계에 달라붙습니다.
        </p>
      </Section>

      <OpeningList line={{ a: wall.a, b: wall.b, spec: wall }} />

      <Section title="규격">
        <WallFields spec={wall} onChange={(patch) => dispatch({ type: 'UPDATE_WALL', uid: wall.uid, patch })} />
      </Section>
      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'wall', uid: wall.uid })}>
          <Trash2 size={13} /> 벽 삭제
        </Btn>
      </Section>
    </>
  );
}

function PillarPanel({ pillar }) {
  const { dispatch } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_PILLAR', uid: pillar.uid, patch });
  return (
    <>
      <Section title="기둥">
        <Field label="이름" value={pillar.name} onChange={(e) => set({ name: e.target.value })} />
        <Row label="위치 X / Z">{pillar.pos[0].toFixed(2)} , {pillar.pos[1].toFixed(2)} m</Row>
      </Section>
      <Section title="규격">
        <Slider
          label="가로" min={0.1} max={3} step={0.05} value={pillar.size[0]}
          text={`${pillar.size[0].toFixed(2)} m`}
          onChange={(v) => set({ size: [v, pillar.size[1]] })}
        />
        <Slider
          label="세로" min={0.1} max={3} step={0.05} value={pillar.size[1]}
          text={`${pillar.size[1].toFixed(2)} m`}
          onChange={(v) => set({ size: [pillar.size[0], v] })}
        />
        <Slider
          label="높이" min={0.3} max={12} step={0.1} value={pillar.height}
          text={`${pillar.height.toFixed(2)} m`}
          onChange={(v) => set({ height: v })}
        />
        <ColorField label="색" value={pillar.color} onChange={(v) => set({ color: v })} />
      </Section>
      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'pillar', uid: pillar.uid })}>
          <Trash2 size={13} /> 기둥 삭제
        </Btn>
      </Section>
    </>
  );
}

/**
 * 스틸리지 패널.
 *  선반과 달리 규격을 늘리지 않는다 — 한 공정의 끝이라 크기는 고정이고,
 *  정하는 것은 **얼마나 쌓이면 라인을 세울 것인가** 하나다.
 */
function StillagePanel({ placed }) {
  const { dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const stock = useStock(placed.uid);
  const capacity = stillageCapacity(placed);
  const grid = stillageGrid(spec?.bbox?.size);
  const full = stock >= capacity;
  /* 빈 차가 오면 실어 보낼 수량. cart.js 의 정차역이 읽는 값과 같은 기본값(3)을
     쓴다 — 여기서 다른 값을 보여 주면 화면과 동작이 어긋난다. */
  const dispatchCount = Math.min(placed.dispatchCount ?? 3, capacity);
  const set = (patch) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch });

  return (
    <>
      <Section title="스틸리지 (적치대)">
        <Field
          label="이름"
          value={placed.name}
          onChange={(e) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { name: e.target.value } })}
        />
        <Row label="위치 X / Z">{placed.pos[0].toFixed(2)} , {placed.pos[1].toFixed(2)} m</Row>
        <Row label="회전">{ROT_LABEL[placed.rot]}</Row>
        <Row label="한 층 적재수">{grid.nx} × {grid.nz} = {grid.perLevel} 개</Row>
      </Section>

      <Section title="적재" data-guide="panel-stillage">
        <Slider
          label="최대 적재량" min={MIN_CAPACITY} max={MAX_CAPACITY} step={1} value={capacity}
          text={`${capacity} 개`}
          onChange={(v) => dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { capacity: v } })}
        />
        <div className="mb-1 mt-1 flex items-center justify-between text-[11px]">
          <span className="text-ink4">현재 적재</span>
          <b className={`tabular-nums ${full ? 'text-red-500' : 'text-ink'}`}>
            {Math.min(stock, capacity)} / {capacity}
          </b>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded bg-kbd">
          <div
            className={`h-full transition-[width] ${full ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${capacity ? Math.min(100, (stock / capacity) * 100) : 0}%` }}
          />
        </div>
        <StockBreakdown uid={placed.uid} />

        <div className="mt-2 flex gap-2">
          <Btn onClick={() => setStock(placed.uid, capacity)}>가득 채우기</Btn>
          <Btn onClick={() => clearStock(placed.uid)}>비우기</Btn>
        </div>
      </Section>

      {/* 반출량 — 선반의 같은 설정과 짝을 이룬다.
          차량이 자기 적재량을 정하지 않았을 때 따르는 값이 이것이라, 여기가
          비어 있으면 "보낸 곳 설정 따름" 이 가리킬 곳이 없다(늘 기본 3개가 된다).
          상한을 수용량에 맞춰 두면, 쌓인 것보다 많이 실어 가라고 적어 둘 수 없다. */}
      <Section title="반출">
        <Slider
          label="빈 차에 실어 보낼 수량"
          min={1}
          max={Math.max(1, capacity)}
          step={1}
          value={dispatchCount}
          text={`${dispatchCount} 개`}
          onChange={(v) => set({ dispatchCount: v })}
        />
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          카트·트럭이 옆을 지나면 이 수량만큼 실어 갑니다. 쌓인 것이 이보다 적으면
          있는 만큼만 갑니다. 차량 쪽에서 <b className="text-ink3">한 번에 싣는 양</b>을
          따로 정해 두었다면 그쪽이 우선합니다.
        </p>
      </Section>

      <Section title="흐름">
        <p className="text-[10.5px] leading-relaxed text-ink4">
          컨베이어로 <b className="text-ink3">들어오기만</b> 합니다 — 여기서 벨트를 다시 뽑을 수는
          없습니다. 물자가 빠지는 길은 <b className="text-ink3">카트가 실어 가는 것</b> 하나뿐입니다.
          {full && (
            <>
              {' '}지금은 <b className="text-red-500">가득 차서</b> 들어오는 벨트와 그 벨트를 먹이던
              설비가 멈춰 있습니다.
            </>
          )}
        </p>
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'equip', uid: placed.uid })}>
          <Trash2 size={13} /> 삭제
        </Btn>
      </Section>
    </>
  );
}

/**
 * 개구부 패널.
 *  개구부는 벽에 붙어 있지만 벽의 일부가 아니라 **벽에서 빠진 자리**다.
 *  그래서 두께·색이 없고, 폭·높이·밑턱만 정한다.
 */
function OpeningPanel({ opening }) {
  const { state, dispatch } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_OPENING', uid: opening.uid, patch });

  /* 어느 벽에 얹혔는지 — 좌표로 찾으므로 벽이 바뀌면 결과도 따라 바뀐다 */
  const host = useMemo(() => {
    for (const line of wallLines(state.areas, state.walls)) {
      if (openingsOn(line, [opening]).length) {
        const area = state.areas.find((a) => a.uid === line.areaUid);
        const wall = state.walls.find((w) => w.uid === line.wallUid);
        return { line, label: area ? `${area.name} 외벽` : wall?.name ?? '내벽', spec: line.spec };
      }
    }
    return null;
  }, [opening, state.areas, state.walls]);

  const wallH = host?.spec?.height ?? 4;
  const over = opening.sill + opening.height > wallH + 1e-6;

  return (
    <>
      <Section title="개구부">
        <Field label="이름" value={opening.name} onChange={(e) => set({ name: e.target.value })} />
        <Row label="붙은 벽">{host ? host.label : '없음 (벽이 사라짐)'}</Row>
        <Row label="위치 X / Z">{opening.at[0].toFixed(2)} , {opening.at[1].toFixed(2)} m</Row>
        {host && <Row label="벽 두께 / 높이">{host.spec.thickness.toFixed(2)} / {wallH.toFixed(2)} m</Row>}
      </Section>

      <Section title="크기">
        <Slider
          label="폭" min={MIN_OPENING} max={20} step={0.1} value={opening.width}
          text={`${opening.width.toFixed(2)} m`}
          onChange={(v) => set({ width: v })}
        />
        <Slider
          label="높이" min={MIN_OPENING} max={12} step={0.1} value={opening.height}
          text={`${opening.height.toFixed(2)} m`}
          onChange={(v) => set({ height: v })}
        />
        <Slider
          label="밑턱" min={0} max={4} step={0.05} value={opening.sill ?? 0}
          text={(opening.sill ?? 0) > 0 ? `${opening.sill.toFixed(2)} m · 창` : '0 · 출입구'}
          onChange={(v) => set({ sill: v })}
        />
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          {over
            ? '벽보다 높아 위쪽이 통째로 트입니다. 인방(문 위 벽)을 남기려면 낮추세요.'
            : '밑턱을 0 으로 두면 바닥까지 트여 트럭이 지나갈 수 있습니다.'}
        </p>
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'opening', uid: opening.uid })}>
          <Trash2 size={13} /> 개구부 삭제
        </Btn>
      </Section>
    </>
  );
}

/**
 * 구역 패널.
 *  "이 구역 안에 무엇이 있는가" 를 목록으로 보여 준다. 구역은 결국 자리를
 *  묶어 부르기 위한 것이라, 이름만 있고 내용물을 못 보면 쓸 데가 없다.
 *  이름을 누르면 그 설비를 선택하고 화면을 그리로 옮긴다.
 */
/**
 * 구역이 말해 주는 것 — **가르려고 그린 것이니 그 단위로 따진다.**
 * ---------------------------------------------------------------------------
 *  넓이와 이름만 있는 색칠이었다. 그런데 「가공 구역」 「출하 구역」 으로 나누는
 *  이유는 색칠이 아니라 그 단위로 묻고 싶어서다 — 여기 더 들어가나, 몇 명이
 *  붙나, 시간당 얼마가 타나, 카트가 얼마나 지나가나.
 *
 *  계산은 `core/zoneInfo.js` 가 한다. 비용은 원가 화면과 **같은 함수**를 쓴다.
 */
function ZoneStats({ zone }) {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();
  const info = useMemo(
    () => zoneInfo(zone, {
      placed: state.placed, carts: state.carts, shifts: state.shifts, rates: state.rates,
      /* 실제 치수는 여기서만 안다 — 모델 규격은 GLB 에서 읽어 캐시되고,
         선반은 칸 수·줄 수 같은 설정값에서 나온다 (정렬 칸과 같은 규칙) */
      bboxOf: (p, it) => (isShelf(it)
        ? shelfBBox(p, it.modelKey ? getSpec(it.modelKey) : null)
        : it?.modelKey ? getSpec(it.modelKey)?.bbox : null),
    }, itemOf),
    [zone, state.placed, state.carts, state.shifts, state.rates, itemOf, version],
  );

  /* 90% 라고 못 다니는 것도, 40% 라고 넉넉한 것도 아니다 — 통로는 사람이
     보고 정할 몫이라 색으로 좋고 나쁨을 말하지 않는다. 눈금만 그린다. */
  const pct = info.fill == null ? null : Math.round(info.fill * 100);

  return (
    <>
      {pct != null && (
        <>
          <Row label="찬 비율">
            <span className="tabular-nums">{pct} %</span>
          </Row>
          <div className="-mt-1 mb-1 h-1 w-full overflow-hidden rounded bg-kbd">
            <div className="h-full bg-ink4" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="-mt-0.5 mb-1.5 text-[9.5px] leading-snug text-ink4">
            설비가 바닥에 깔린 넓이({info.covered.toFixed(1)} ㎡)입니다 —
            <b className="text-ink4"> 통로를 뺀 값이 아닙니다.</b>
          </p>
        </>
      )}
      <Row label="설비">
        {info.machines} 대{info.stores > 0 && <span className="text-ink4"> · 쌓는 곳 {info.stores}</span>}
      </Row>
      <Row label="인원">{info.crew} 명</Row>
      <Row label="시간당 비용">{won(info.hourly)}</Row>
      <Row label="지나는 카트">
        {info.carts === 0 ? <span className="text-ink4">없음</span>
          : <>{info.carts} 경로 · {info.pathM.toFixed(1)} m</>}
      </Row>
      <p className="mt-1 text-[9.5px] leading-snug text-ink4">
        비용은 안에 있는 설비만, <b className="text-ink4">쉬지 않고 돌 때</b> 기준입니다.
        카트 전력은 경로가 여러 구역에 걸쳐 있어 뺐습니다.
      </p>
    </>
  );
}

function ZonePanel({ zone }) {
  const { state, dispatch, itemOf } = useEditor();
  const set = (patch) => dispatch({ type: 'UPDATE_ZONE', uid: zone.uid, patch });

  const contents = useMemo(() => {
    const inside = (pos) => inZone(zone, pos);
    return [
      ...state.placed.filter((p) => inside(p.pos)).map((p) => ({ kind: 'equip', uid: p.uid, name: p.name, at: p.pos })),
      ...state.carts
        .filter((c) => c.points.some(inside))
        .map((c) => ({ kind: 'cart', uid: c.uid, name: c.name, at: c.points.find(inside) })),
    ];
  }, [zone, state.placed, state.carts]);

  return (
    <>
      <Section title="구역">
        <Field label="이름" value={zone.name} onChange={(e) => set({ name: e.target.value })} />
        <Row label="넓이">{mpArea(zone.mp).toFixed(1)} ㎡</Row>
        <Row label="꼭짓점">{mpVertices(zone.mp).length} 개</Row>
        <ZoneStats zone={zone} />
        <ColorField label="색" value={zone.color} onChange={(v) => set({ color: v })} />
        <Slider
          label="투명도" min={0.05} max={0.9} step={0.05} value={zone.opacity ?? 0.28}
          text={`${Math.round((zone.opacity ?? 0.28) * 100)} %`}
          onChange={(v) => set({ opacity: v })}
        />
        <Slider
          label="이름 크기" min={0.5} max={8} step={0.1} value={zone.labelSize ?? 1.6}
          text={`${(zone.labelSize ?? 1.6).toFixed(1)} m`}
          onChange={(v) => set({ labelSize: v })}
        />
      </Section>

      <ShapeEditSection kind="zone" uid={zone.uid} />

      {/* 외곽선 — 반투명 면만으로는 옆 구역과 맞닿는 자리가 흐려진다.
          굵기는 화면 픽셀이 아니라 도면상의 미터라, 확대해도 축척이 유지된다. */}
      <Section
        title="외곽선"
        right={
          <button
            onClick={() => set({ outline: zone.outline === false })}
            className={`rounded px-1.5 py-0.5 text-[10.5px] ${
              zone.outline === false ? 'bg-kbd text-ink4' : 'bg-sky-500/15 text-sky-500'
            }`}
          >
            {zone.outline === false ? '꺼짐' : '켜짐'}
          </button>
        }
      >
        {zone.outline === false ? (
          <p className="py-1 text-[11px] text-ink4">외곽선을 그리지 않습니다</p>
        ) : (
          <>
            <ColorField
              label="선 색"
              value={zone.outlineColor ?? zone.color}
              onChange={(v) => set({ outlineColor: v })}
            />
            <Slider
              label="선 굵기" min={0.02} max={1} step={0.02} value={zone.outlineWidth ?? 0.14}
              text={`${((zone.outlineWidth ?? 0.14) * 100).toFixed(0)} cm`}
              onChange={(v) => set({ outlineWidth: v })}
            />
          </>
        )}
      </Section>

      <Section title={`이 구역 안 (${contents.length})`}>
        {contents.length === 0 ? (
          <p className="py-1 text-[11px] text-ink4">아직 아무것도 없습니다</p>
        ) : (
          <ul className="space-y-1">
            {contents.map((c) => (
              <li key={c.uid}>
                <button
                  onClick={() => {
                    dispatch({ type: 'SELECT', selected: { kind: c.kind, uid: c.uid } });
                    focusOn(c.at);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 text-[10px] text-ink4">
                    {c.kind === 'cart' ? '카트' : isShelf(itemOf(state.placed.find((p) => p.uid === c.uid)?.itemId)) ? '선반' : '설비'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="삭제">
        <Btn danger onClick={() => dispatch({ type: 'DELETE', kind: 'zone', uid: zone.uid })}>
          <Trash2 size={13} /> 구역 삭제
        </Btn>
      </Section>
    </>
  );
}

/* ==========================================================================
 * 여러 개를 골랐을 때 — 정렬 · 등간격
 * ==========================================================================
 *  좌표를 직접 계산해서 한 번의 MOVE_MANY 로 넘긴다. 리듀서가 크기를 알려면
 *  모델 규격(설비)과 설정값(기둥)을 둘 다 알아야 하는데, 그건 씬과 인스펙터가
 *  이미 하는 일이다 — 리듀서는 "어디로 갈지" 만 받는다.
 *
 *  정렬은 **차지하는 네모(풋프린트) 기준**이다. 원점 기준으로 맞추면 모델마다
 *  원점 위치가 달라서 눈에는 안 맞아 보인다.
 *
 *  결과 좌표는 그리드에 다시 스냅하지 않는다. 정렬은 "정확히 맞춰라" 라는
 *  명시적인 지시라서, 스냅으로 반 칸 어긋나면 시킨 일을 안 한 게 된다.
 * ======================================================================== */

const ALIGN_X = [
  { id: ALIGN.MIN, label: '왼쪽' },
  { id: ALIGN.CENTER, label: '가로 가운데' },
  { id: ALIGN.MAX, label: '오른쪽' },
];
const ALIGN_Z = [
  { id: ALIGN.MIN, label: '위쪽' },
  { id: ALIGN.CENTER, label: '세로 가운데' },
  { id: ALIGN.MAX, label: '아래쪽' },
];

/** 종류별 표시 이름 — 목록의 그룹 머리글 */
const KIND_LABEL = {
  equip: '설비',
  pillar: '기둥',
  wall: '내벽',
  area: '영역 벽면',
  opening: '개구부',
  link: '연결장치',
  cart: '차량',
  zone: '구역',
};

/** 벽처럼 두께·높이·색을 함께 고칠 수 있는 것들 */
const SPEC_KINDS = new Set(['wall', 'area', 'pillar']);

function MultiPanel({ items }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();

  /* ---- 이름 붙이기 -------------------------------------------------------
   *  목록에 uid 만 늘어놓으면 무엇을 골랐는지 알 수 없다. 각자 자기 이름을
   *  가진 곳에서 가져오고, 이름이 없는 것(영역 벽면)은 소속과 순번으로 만든다. */
  const named = useMemo(() => {
    const out = [];
    for (const it of items) {
      if (it.kind === 'equip') {
        const p = state.placed.find((x) => x.uid === it.uid);
        if (p) out.push({ ...it, name: p.name, at: p.pos });
      } else if (it.kind === 'pillar') {
        const p = state.pillars.find((x) => x.uid === it.uid);
        if (p) out.push({ ...it, name: p.name, at: p.pos });
      } else if (it.kind === 'wall') {
        const w = state.walls.find((x) => x.uid === it.uid);
        if (w) out.push({ ...it, name: w.name, at: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] });
      } else if (it.kind === 'area') {
        const a = state.areas.find((x) => x.uid === it.uid);
        if (!a) continue;
        const edges = mpEdges(a.mp);
        const idx = edges.findIndex((e) => e.key === it.edge);
        const e = edges[idx];
        out.push({
          ...it,
          name: a.edges?.[it.edge]?.name ?? `${a.name} 벽 ${idx + 1}`,
          at: e ? e.mid : null,
        });
      } else if (it.kind === 'opening') {
        const o = state.openings.find((x) => x.uid === it.uid);
        if (o) out.push({ ...it, name: o.name, at: o.at });
      } else if (it.kind === 'link') {
        const l = state.links.find((x) => x.uid === it.uid);
        if (l) out.push({ ...it, name: l.name, at: null });
      } else if (it.kind === 'cart') {
        const c = state.carts.find((x) => x.uid === it.uid);
        if (c) out.push({ ...it, name: c.name, at: c.points[0] });
      }
    }
    return out;
  }, [items, state]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of named) {
      if (!m.has(it.kind)) m.set(it.kind, []);
      m.get(it.kind).push(it);
    }
    return [...m.entries()];
  }, [named]);

  const only = groups.length === 1 ? groups[0][0] : null;

  /* ---- 정렬 — 설비끼리 · 기둥끼리일 때만 ---------------------------------
   *  섞인 선택에서는 무엇을 기준으로 줄을 맞출지 말할 수 없다. 설비는 모델
   *  바운딩 박스가, 기둥은 설정값이 크기의 근거라 잣대 자체가 다르다. */
  const alignItems = useMemo(() => {
    if (only !== 'equip' && only !== 'pillar') return [];
    const set = new Set(named.map((i) => i.uid));
    if (only === 'pillar') {
      return state.pillars.filter((p) => set.has(p.uid)).map((p) => {
        const [w, d] = p.size;
        return {
          uid: p.uid,
          pos: p.pos,
          rect: { minX: p.pos[0] - w / 2, maxX: p.pos[0] + w / 2, minZ: p.pos[1] - d / 2, maxZ: p.pos[1] + d / 2 },
        };
      });
    }
    return state.placed
      .filter((p) => set.has(p.uid))
      .map((p) => {
        const it = itemOf(p.itemId);
        const bbox = isShelf(it)
          ? shelfBBox(p, it.modelKey ? getSpec(it.modelKey) : null)
          : it?.modelKey ? getSpec(it.modelKey)?.bbox : null;
        return bbox ? { uid: p.uid, pos: p.pos, rect: footprintOf({ ...p, bboxOverride: bbox }, null) } : null;
      })
      .filter(Boolean);
  }, [only, named, state.pillars, state.placed, itemOf, version]);

  const bounds = useMemo(() => {
    if (!alignItems.length) return null;
    return {
      minX: Math.min(...alignItems.map((i) => i.rect.minX)),
      maxX: Math.max(...alignItems.map((i) => i.rect.maxX)),
      minZ: Math.min(...alignItems.map((i) => i.rect.minZ)),
      maxZ: Math.max(...alignItems.map((i) => i.rect.maxZ)),
    };
  }, [alignItems]);

  const apply = (moves) => {
    if (moves.length) dispatch({ type: 'MOVE_MANY', kind: only, moves });
  };

  /* ---- 규격 일괄 수정 ----------------------------------------------------
   *  두께가 제각각인 벽을 골라 두께를 바꾸면 **전부 같은 값**이 된다. 이 기능을
   *  쓰는 상황이 거의 언제나 "저것들 두께 좀 맞춰 줘" 이기 때문이다. */
  const specItems = named.filter((i) => SPEC_KINDS.has(i.kind));
  const hasWall = specItems.some((i) => i.kind === 'wall' || i.kind === 'area');
  const hasPillar = specItems.some((i) => i.kind === 'pillar');
  const patchSpec = (patch) => dispatch({ type: 'PATCH_MANY', items: specItems, patch });

  /* 슬라이더가 어디에 서 있어야 하는가.
     값이 제각각일 수 있으므로 **첫 항목의 현재 값**을 보여 준다. 기본값에
     고정해 두면 손잡이가 움직일 때마다 제자리로 튕겨 나가서 조작이 안 된다. */
  const specNow = useMemo(() => {
    const first = specItems[0];
    const fallback = {
      thickness: WALL_DEFAULTS.thickness,
      height: WALL_DEFAULTS.height,
      color: WALL_DEFAULTS.color,
      w: PILLAR_DEFAULTS.size[0],
      d: PILLAR_DEFAULTS.size[1],
    };
    if (!first) return fallback;
    if (first.kind === 'pillar') {
      const p = state.pillars.find((x) => x.uid === first.uid);
      return { ...fallback, height: p?.height ?? 4, color: p?.color ?? WALL_DEFAULTS.color, w: p?.size?.[0] ?? 0.6, d: p?.size?.[1] ?? 0.6 };
    }
    if (first.kind === 'wall') {
      const w = state.walls.find((x) => x.uid === first.uid);
      return { ...fallback, thickness: w?.thickness ?? 0.3, height: w?.height ?? 4, color: w?.color ?? WALL_DEFAULTS.color };
    }
    const a = state.areas.find((x) => x.uid === first.uid);
    const s = edgeSpec(a, first.edge);
    return { ...fallback, ...s };
  }, [specItems, state.pillars, state.walls, state.areas]);

  const Tile = ({ onClick, disabled, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line bg-raise px-2 py-1.5 text-[11px] text-ink2 transition-colors hover:border-edge hover:bg-raiseh disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );

  const gapX = alignItems.length >= 3 ? gapOf(alignItems, AXIS.X) : null;
  const gapZ = alignItems.length >= 3 ? gapOf(alignItems, AXIS.Z) : null;

  return (
    <>
      <Section title={`${named.length}개 선택`}>
        <p className="text-[10.5px] leading-relaxed text-ink4">
          빈 바닥을 끌면 사각형 안의 것이 종류를 가리지 않고 잡힙니다(바닥·구역 제외).
          <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">Ctrl</kbd>+클릭으로 더하고 뺍니다.
          그룹 이름을 누르면 그 종류만 남습니다.
        </p>
      </Section>

      {/* 무엇이 골라졌는지 — 종류로 묶고, 이름을 눌러 하나만 골라낼 수 있다 */}
      {groups.map(([kind, list]) => (
        <Section
          key={kind}
          title={`${KIND_LABEL[kind] ?? kind} (${list.length})`}
          right={
            groups.length > 1 && (
              <button
                className="text-[11px] text-sky-500 hover:underline"
                onClick={() => dispatch({ type: 'SELECT_FILTER', kind })}
              >
                이것만
              </button>
            )
          }
        >
          <ul className="space-y-0.5">
            {list.map((it) => (
              <li key={`${it.kind}${it.uid}${it.edge ?? ''}`}>
                <button
                  onClick={() => {
                    dispatch({ type: 'SELECT', selected: { kind: it.kind, uid: it.uid, edge: it.edge } });
                    if (it.at) focusOn(it.at);
                  }}
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] text-ink2 hover:bg-raiseh"
                >
                  {it.name ?? it.uid}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {/* 벽·기둥 규격 — 섞여 있어도 공통 항목은 함께 고칠 수 있다 */}
      {specItems.length > 1 && (
        <Section title={`규격 일괄 (${specItems.length})`}>
          {hasWall && (
            <Slider
              label="두께" min={0.05} max={1.5} step={0.05} value={specNow.thickness}
              text={specNow.thickness.toFixed(2) + ' m 로 맞춤'}
              onChange={(v) => patchSpec({ thickness: v })}
            />
          )}
          {hasPillar && (
            <>
              <Slider
                label="기둥 가로" min={0.1} max={3} step={0.05} value={specNow.w}
                text={`${specNow.w.toFixed(2)} m 로 맞춤`}
                onChange={(v) => patchSpec({ sizeX: v })}
              />
              <Slider
                label="기둥 세로" min={0.1} max={3} step={0.05} value={specNow.d}
                text={`${specNow.d.toFixed(2)} m 로 맞춤`}
                onChange={(v) => patchSpec({ sizeZ: v })}
              />
            </>
          )}
          <Slider
            label="높이" min={0.3} max={12} step={0.1} value={specNow.height}
            text={specNow.height.toFixed(2) + ' m 로 맞춤'}
            onChange={(v) => patchSpec({ height: v })}
          />
          <ColorField label="색" value={specNow.color} onChange={(v) => patchSpec({ color: v })} />
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
            슬라이더를 움직이면 고른 것들이 <b className="text-ink3">전부 그 값</b>이 됩니다.
            (각자의 현재 값이 달라도 하나로 맞춰집니다)
          </p>
        </Section>
      )}

      {/* 정렬 — 같은 종류(설비 또는 기둥)만 골랐을 때 */}
      {alignItems.length >= 2 ? (
        <>
          {bounds && (
            <Section title="선택 범위">
              <Row label="전체 크기">
                {(bounds.maxX - bounds.minX).toFixed(2)} × {(bounds.maxZ - bounds.minZ).toFixed(2)} m
              </Row>
            </Section>
          )}

          <Section title="정렬 (가로)">
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_X.map((m) => (
                <Tile key={m.id} onClick={() => apply(alignMoves(alignItems, AXIS.X, m.id))}>
                  {m.label}
                </Tile>
              ))}
            </div>
          </Section>

          <Section title="정렬 (세로)">
            <div className="grid grid-cols-3 gap-1.5">
              {ALIGN_Z.map((m) => (
                <Tile key={m.id} onClick={() => apply(alignMoves(alignItems, AXIS.Z, m.id))}>
                  {m.label}
                </Tile>
              ))}
            </div>
          </Section>

          <Section title="등간격">
            <div className="grid grid-cols-2 gap-1.5">
              <Tile onClick={() => apply(distributeMoves(alignItems, AXIS.X))} disabled={alignItems.length < 3}>
                가로 등간격
              </Tile>
              <Tile onClick={() => apply(distributeMoves(alignItems, AXIS.Z))} disabled={alignItems.length < 3}>
                세로 등간격
              </Tile>
            </div>
            {alignItems.length >= 3 && (
              <Row label="펴면 생기는 틈">
                가로 {gapX.toFixed(2)} · 세로 {gapZ.toFixed(2)} m
              </Row>
            )}
          </Section>
        </>
      ) : (
        <Section title="정렬">
          <p className="text-[10.5px] leading-relaxed text-ink4">
            정렬은 <b className="text-ink3">설비끼리</b> 또는 <b className="text-ink3">기둥끼리</b>
            골랐을 때만 쓸 수 있습니다. 크기의 근거가 서로 달라(모델 vs 설정값) 섞이면 무엇에
            줄을 맞출지 정할 수 없기 때문입니다. 위의 <b className="text-ink3">이것만</b>으로
            한 종류만 남겨 보세요.
          </p>
        </Section>
      )}

      <Section title="삭제">
        <div className="flex flex-wrap gap-2">
          {/* 영역 벽면은 뺀다 — 벽면 하나를 지운다는 것은 곧 그 영역을 통째로
              지우는 일이라, 버튼 문구("영역 벽면 1개")와 실제 결과가 어긋난다.
              영역을 지우려면 바닥을 골라야 한다. */}
          {groups
            .filter(([kind]) => kind !== 'area')
            .map(([kind, list]) => (
              <Btn
                key={kind}
                danger
                onClick={() => dispatch({ type: 'DELETE', kind, uids: list.map((i) => i.uid) })}
              >
                <Trash2 size={13} /> {KIND_LABEL[kind] ?? kind} {list.length}개
              </Btn>
            ))}
        </div>
        {groups.some(([kind]) => kind === 'area') && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
            영역 벽면은 테두리에서 만들어지므로 따로 지울 수 없습니다. 없애려면 영역의
            모양을 바꾸세요.
          </p>
        )}
      </Section>
    </>
  );
}

/**
 * 생산 추이 — 시간축 위의 출하 누계.
 * ---------------------------------------------------------------------------
 *  숫자 하나로는 "지금 얼마나 나갔나" 만 알 수 있다. 라인이 도중에 섰는지,
 *  점점 느려지는지는 **기울기**로만 보인다 — 평평해진 구간이 곧 멈춰 있던 시간이다.
 *
 *  라이브러리를 들이지 않고 SVG 폴리라인 하나로 그린다. 표본은 metrics 가 10
 *  시뮬초에 하나씩 쌓아 두고 있어서 여기서는 그리기만 하면 된다.
 */
/**
 * 이번 실행의 성적표.
 * ---------------------------------------------------------------------------
 *  화면 왼쪽 위의 HUD 는 "지금 어떤가" 한 줄이고, 여기는 **어느 설비가 얼마나
 *  서 있었는가** 를 전부 편다. 병목은 하나만 있는 것이 아니다 — 앞의 것을 풀면
 *  그다음이 병목이 되므로, 순위로 봐야 다음에 무엇을 손볼지 알 수 있다.
 *
 *  가동률은 **막히지 않고 돈 시간의 비율**이다(적치대가 차서 선 시간을 뺀 것).
 *  아직 아무것도 안 돌았으면 나눌 것이 없으므로 통째로 감춘다.
 */
/**
 * 결과를 **꺼내는 버튼**의 생김새.
 * ---------------------------------------------------------------------------
 *  높이를 못 박는 것이 요점이다. 「보고서」(한글)와 「CSV」(라틴)는 글자 높이가
 *  달라서, 안쪽 여백만 맞추면 두 버튼 높이가 1~2px 어긋나 한 줄로 안 보인다.
 *  `leading-none` 으로 글자 높이를 지우고 상자 높이를 직접 준다.
 *
 *  평소에는 테두리만, 손이 닿으면 **채워지고 글자·아이콘이 하얘진다** — 눌리는
 *  것임을 색이 먼저 말해 준다.
 */
export const OUT_H = 'flex h-[26px] items-center';
export const OUT_BTN = `${OUT_H} shrink-0 gap-1.5 whitespace-nowrap rounded-md px-2.5`
  + ' text-[11px] font-medium leading-none text-sky-600 ring-1 ring-sky-500/40'
  + ' transition-colors hover:bg-sky-500 hover:text-white hover:ring-sky-500';

export function ReportButtons() {
  const { state, dispatch, itemOf } = useEditor();
  useMetrics();
  const elapsed = useElapsed();
  const simSpeed = useSimSpeed();
  const ran = getRan();
  const blocked = getBlocked();
  const series = getSeries();
  useFaults();
  /**
   * 원가 패널과 **같은 훅**을 쓴다 — 각자 모으면 두 숫자가 갈린다.
   *
   *  아래 `ran <= 0` 조기 반환보다 **위**에 있어야 한다. 처음엔 아래에 뒀다가
   *  「Rendered more hooks than during the previous render」 로 화면이 통째로
   *  죽었다 — 안 돌았을 때는 훅 넷, 돌기 시작하면 일곱이 되기 때문이다.
   *  값 검사로는 절대 안 잡히는 종류라, 이 주석이 곧 그 검사다.
   */
  const cost = useCostInput();
  const overall = oeeOverall(state.placed.map((p) => p.uid));

  if (ran <= 0) return null;

  /**
   * 보고서에 넣을 값을 모은다 — **여기서 새로 계산하는 것은 없다.**
   *
   *  CSV 판과 HTML 판이 **이 하나를 나눠 쓴다.** 각자 모으면 두 파일이 다른
   *  숫자를 말하게 되고, 그러면 어느 쪽을 믿을지 알 수 없어진다.
   * -------------------------------------------------------------------------
   *  보고서가 화면과 다른 숫자를 말하면 둘 다 못 믿게 된다. 그래서 화면이 이미
   *  쓰는 함수(process · cart · orders · metrics)를 그대로 불러 담기만 한다.
   */
  const buildReport = () => {
    const shipped = getShipped();
    const stock = getAllStock();
    const orders = normalizeOrders(state.orders);
    const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

    const machines = state.placed
      .filter((p) => { const it = itemOf(p.itemId); return it && !isShelf(it) && !isStillage(it) && !isUtility(it); })
      .map((p) => {
        const cyc = cycleOf(p, itemOf(p.itemId));
        const o = oeeOf(p.uid);
        return {
          name: p.name ?? p.uid,
          cycleSec: cyc,
          rate: perMinute(cyc),
          uptime: uptimeOf(p.uid),
          blockSec: o.blockSec, starveSec: o.starveSec, crewSec: o.crewSec, downSec: o.downSec,
          oee: o.oee,
        };
      });

    const carts = state.carts.map((c) => {
      const it = itemOf(c.itemId);
      const truck = isTruck(it);
      const path = cartPath(c);
      const st = path ? cartStations(path, state.placed, itemOf, { loadOnly: truck, roles: c.roles }) : [];
      const h = path ? haulPerMinute(c, path, st, { truck }) : null;
      return {
        name: c.name ?? c.uid,
        kindName: truck ? '트럭' : '카트',
        count: c.count ?? 1,
        perMinute: h?.perMinute,
        blockRatio: cartBlockRatio(c.uid),
      };
    });

    const stores = state.placed
      .filter((p) => { const it = itemOf(p.itemId); return isShelf(it) || isStillage(it); })
      .map((p) => {
        const seen = arrivedAt(p.uid);
        return {
          name: p.name ?? p.uid,
          have: stock[p.uid] ?? 0,
          cap: storeCapOf(p, itemOf, specOf),
          arrivedTotal: Object.values(seen).reduce((s, n) => s + n, 0),
          arrived: seen,
        };
      });

    /* 진단 — 지금 가장 오래 막힌 설비의 원인 사슬 (화면 왼쪽 위와 같은 값) */
    const neck = bottleneck();
    const owner = neck ? state.placed.find((p) => p.uid === neck.uid) : null;
    const chain = owner
      ? blockChain(owner.uid, {
        placed: state.placed, links: state.links, carts: state.carts, itemOf, specOf,
        getStock: (uid) => stock[uid] ?? 0,
      })
      : null;

    const perHour = throughput(shippedTotal(shipped));
    const wip = Object.values(stock).reduce((s, n) => s + n, 0);

    return {
      at: new Date().toLocaleString('ko-KR'),
      elapsedSec: elapsed,
      ranSec: ran,
      throughput: perHour,
      wip,
      /* 셋째 값 — 여기서 나눠 둬야 HTML 과 CSV 가 같은 숫자를 말한다 */
      leadSec: leadTimeSec(wip, perHour),
      oee: overall,
      diagnosis: chain ? chainText(chain.steps) : null,
      culprit: chain?.culprit?.name ?? null,
      orders: orders.map((o) => {
        const r = statusOf(o, { shipped, arrivedOf }, elapsed);
        const target = o.at === DONE_AT.SHIP
          ? '출하'
          : `${state.placed.find((p) => p.uid === o.atUid)?.name ?? o.atUid ?? '(안 정함)'} 통과`;
        return {
          kind: o.kind, kindName: PAYLOAD_ITEMS[o.kind]?.name ?? o.kind,
          qty: o.qty, done: r.done, ratio: r.ratio,
          atLabel: target, dueMin: o.dueMin, eta: r.eta, slackSec: r.slackSec, state: r.state,
        };
      }),
      shipped: Object.entries(shipped).map(([k, n]) => [PAYLOAD_ITEMS[k]?.name ?? k, n]),
      machines,
      carts,
      stores,
      series,
      /* 원가는 cost.js 가 이미 낸 값 그대로 — 화면 패널과 같은 훅을 쓴다 */
      cost,
      /**
       * 「이만큼 돌린 것으로 말이 되는가」 를 보고서가 스스로 판단하는 데 쓴다.
       *  고장이 한 번도 안 났으면 가동률이 100% 로 보이고, 교대가 안 바뀌었으면
       *  사람 부족이 드러나지 않는다 — 둘 다 **그 도면이 정하는 기간**이다.
       */
      mtbfSec: Math.max(0, ...state.placed.map((p) => p.mtbf ?? 0)),
      /* 교대는 **인원이 실제로 달라질 때만** 기간을 정한다. 기본값인 「상시」
         한 조에서는 바뀌는 순간이 없는데도 24시간을 기다리라고 했었다. */
      shiftCycleSec: shiftsVary(state.shifts) ? cycleSeconds(state.shifts) : 0,
      /* 권고 시간을 **실제 몇 분인지**로도 말해 주려고 — 20배속이면 1/20 이다 */
      speed: simSpeed,
    };
  };

  /* 눌렀는데 아무 일도 안 일어나면 사용자는 버튼이 고장 났는지 파일이 어디
     갔는지조차 알 수 없다. 실패하면 **말은 하게** 해 둔다. */
  const save = (kind) => {
    try {
      const d = buildReport();
      if (kind === 'html') downloadHTML(runReportHTML(d), `실행보고서-${stamp()}.html`);
      else downloadCSV(runReportCSV(d), `실행보고서-${stamp()}.csv`);
      dispatch({ type: 'SET', patch: { hint: '실행 보고서를 내려받았습니다' } });
    } catch (e) {
      console.error('[보고서] 만들다 실패', e);
      dispatch({ type: 'SET', patch: { hint: `보고서를 못 만들었습니다 — ${e.message}` } });
    }
  };

  return (
    <span className="flex items-center gap-1">
      {/**
        * 실행 보고서 — **이 배치가 무엇을 했는가** 를 한 장에.
        * ---------------------------------------------------------------------
        *  예전에는 「생산 추이」(시간 × 누적 출하) 하나만 내보낼 수 있었다.
        *  회의에 들고 가는 것은 추이 그래프가 아니라 오더를 맞췄는지, 어느
        *  설비가 얼마나 놀았는지, 어디서 막혔는지다. 추이는 그 안에 들어간다.
        *
        *  눌렀는데 아무 일도 안 일어나면 사용자는 버튼이 고장 났는지 파일이
        *  어디 갔는지조차 알 수 없다. 실패하면 **말은 하게** 해 둔다.
        */}
      {/**
        * 같은 값을 **두 가지 판**으로 내보낸다.
        * ---------------------------------------------------------------------
        *  CSV 는 엑셀에서 다시 계산하려고 만드는 것이라 반올림도 단위도 없다 —
        *  사람이 읽으라고 만든 것이 아니다. 회의에 들고 가는 것은 성질이 정반대라
        *  한눈에 결론이 보이고 나쁜 숫자가 붉어야 한다. 하나로 만들려 들면
        *  **양쪽 다 어중간해지므로** 갈랐다.
        *
        *  둘 다 `buildReport()` 하나에서 나온다 — 두 파일이 다른 숫자를 말할
        *  자리가 없다.
        */}
      <button type="button" onClick={() => save('html')} className={OUT_BTN}
        title="읽는 보고서 — 브라우저로 열어 보고 Ctrl+P 로 PDF 로 만듭니다"
      >
        <FileText size={14} /> 보고서
      </button>
      <button type="button" onClick={() => save('csv')} className={OUT_BTN}
        title="엑셀에서 다시 따지려면 이쪽 — 반올림하지 않은 원래 값이 들어갑니다"
      >
        <Table2 size={14} /> CSV
      </button>
      {/* 아이콘 하나로 줄였다 — 띠의 머리줄은 탭에 자리를 내줘야 한다.
          누르면 기록이 통째로 날아가므로 **말은 툴팁으로 온전히** 남긴다.
          그래서 색도 다르다 — 옆의 둘은 꺼내는 일, 이건 지우는 일이다. */}
      <button
        type="button"
        onClick={resetRun}
        className={`${OUT_H} w-[26px] shrink-0 justify-center rounded-md text-ink3 ring-1 ring-edge transition-colors hover:bg-rose-500 hover:text-white hover:ring-rose-500`}
        title="다시 재기 — 배치를 고친 뒤의 성적을 보려면 이전 기록이 섞이면 안 된다"
        aria-label="다시 재기"
      >
        <RotateCcw size={14} />
      </button>
    </span>
  );
}

/**
 * 레시피가 말이 되는가 — 도면에서 읽는 라우팅.
 * ---------------------------------------------------------------------------
 *  가장 흔한 실수는 **재료가 들어올 길이 없는 조립 설비**다. 그려 놓고 돌리면
 *  아무 일도 안 일어나는데, 화면만 봐서는 벨트가 왜 안 도는지 알 수 없다 —
 *  굶어 서 있는 설비와 아직 안 돌린 설비가 똑같이 보이기 때문이다.
 *
 *  ── 왜 라우팅 표를 따로 두지 않는가 ──────────────────────────────────────
 *  "제품 P 는 공정 1 → 2 → 3" 을 따로 적어 두면, 벨트를 하나 옮기는 순간 표와
 *  도면이 어긋난다. 그리고 어긋났을 때 **어느 쪽이 사실인지 말할 수 없다.**
 *  여기서는 벨트가 곧 라우팅이므로 적지 않고 읽는다 — 옮기면 같이 옮겨 간다.
 */
function BomReport() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();

  const { warnings, finals } = useMemo(() => {
    const byUid = new Map(state.placed.map((p) => [p.uid, p]));
    const edges = flowEdges(state.links, byUid, itemOf);

    /* 카트가 내려놓는 역이 붙은 설비는 진단에서 뺀다 — 카트는 무엇이든 실어 올
       수 있어서 무엇이 올지 도면만으로는 단정할 수 없다. 단정할 수 없는 것을
       경고로 만들면 멀쩡한 도면이 붉어진다. */
    const cartFed = new Set();
    for (const c of state.carts) {
      const path = cartPath(c);
      if (!path) continue;
      const opt = { loadOnly: isTruck(itemOf(c.itemId)), roles: c.roles };
      for (const st of cartStations(path, state.placed, itemOf, opt)) {
        if (st.kind === 'unload') cartFed.add(st.uid);
      }
    }

    const nodes = state.placed
      .filter((p) => {
        const it = itemOf(p.itemId);
        return !isShelf(it) && !isStillage(it);
      })
      .map((p) => ({
        uid: p.uid,
        name: p.name ?? p.uid,
        recipe: recipeOf(p),
        cartFed: cartFed.has(p.uid),
      }));

    /* 완제품 — 만든 것을 **다른 설비가 재료로 쓰지 않는** 자리. 여기서부터
       거슬러 올라가야 "이거 하나에 원자재가 몇 개" 가 나온다. */
    const feeds = new Set();
    for (const e of edges) {
      const r = recipeOf(byUid.get(e.to));
      if (!isSource(r) && r.in.some((x) => x.kind === e.kind)) feeds.add(e.from);
    }

    return {
      warnings: auditRecipes(nodes, edges),
      finals: nodes
        .filter((n) => !isSource(n.recipe) && !feeds.has(n.uid))
        .map((n) => ({ ...n, ...explode(n.uid, byUid, edges) })),
    };
  }, [state.placed, state.links, state.carts, itemOf, version]);

  if (!warnings.length && !finals.length) return null;

  return (
    <Section title="레시피">
      {warnings.map((w) => (
        <p
          key={`${w.uid}:${w.kind}`}
          className="mb-1 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-600 ring-1 ring-amber-500/25"
        >
          <b>{w.name}</b> 은 <b>{PAYLOAD_ITEMS[w.kind]?.name ?? w.kind}</b> 가 필요한데{' '}
          {w.reason === 'none'
            ? '들어오는 컨베이어가 없습니다.'
            : '들어오는 컨베이어가 다른 것을 실어 옵니다.'}
          {' '}이대로 돌리면 이 설비는 영영 굶습니다.
        </p>
      ))}

      {finals.map((f) => {
        const raw = Object.entries(f.raw);
        if (!raw.length) return null;
        return (
          <div key={f.uid} className="py-1">
            <p className="text-[11px] text-ink2">{f.name} — 완성품 1개당 원자재</p>
            <ul className="mt-0.5 space-y-0.5">
              {raw.map(([kind, n]) => (
                <li key={kind} className="flex items-center justify-between gap-2 text-[11px]">
                  <KindChip kind={kind} />
                  <b className="shrink-0 tabular-nums text-ink">{n} 개</b>
                </li>
              ))}
            </ul>
            {f.looped && (
              <p className="mt-0.5 text-[10px] text-amber-600">
                자기 자신으로 돌아오는 고리가 있어 거기서 세는 것을 멈췄습니다.
              </p>
            )}
          </div>
        );
      })}
    </Section>
  );
}

/**
 * 인력 — 교대조를 짜고, 지금 사람이 어디에 붙어 있는지 본다.
 * ---------------------------------------------------------------------------
 *  기본은 「상시」 한 조에 **인원 제한 없음**이다. 인력을 따지겠다고 말한 도면에서만
 *  따진다 — 이미 그린 도면이 이 칸이 생겼다는 이유로 갑자기 서면 안 된다.
 *
 *  총원을 0 으로 두면 "사람이 없다" 가 아니라 **"인력을 안 따진다"** 는 뜻이다.
 *  0 을 "아무도 없음" 으로 읽으면 기본값이 곧 전면 정지가 되어 버린다.
 */
/**
 * 좁은 줄에 들어가는 숫자 칸.
 *  브라우저 기본 스피너(위아래 화살표)를 감춘다 — 한 줄에 숫자 칸이 셋이라
 *  스피너가 먹는 폭(칸마다 ~16px)을 감당할 수 없다. 두 자리면 충분한 값들이라
 *  키보드로 넣는 편이 빠르기도 하다.
 */
const NUM_FIELD =
  'w-9 rounded border border-edge bg-field px-1 py-0.5 text-right text-[11px] tabular-nums text-ink '
  + 'outline-none focus:border-sky-500/60 [appearance:textfield] '
  + '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function CrewPanel() {
  const { state, dispatch, itemOf } = useEditor();
  const elapsed = useElapsed();
  const speed = useSimSpeed();

  const shifts = normalizeShifts(state.shifts);
  const { index, shift, endsIn } = shiftAt(shifts, elapsed);
  const rows = crewRows(state.placed, (p) => isWorkable(itemOf(p.itemId)));
  const { manned, unmanned, idle, need, unlimited } = assignCrew(rows, shift.headcount);

  const set = (i, patch) =>
    dispatch({ type: 'SET_SHIFTS', shifts: shifts.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  /* 새 조는 **바로 위 조와 같은 길이**로 시작한다 — 3교대를 짤 때 8시간을 세 번
     적게 하지 않는다. 인원만 바꾸면 되는 경우가 대부분이다 */
  const add = () => dispatch({
    type: 'SET_SHIFTS',
    shifts: [...shifts, {
      name: `${shifts.length + 1}조`,
      minutes: shifts[shifts.length - 1].minutes,
      headcount: shift.headcount,
    }],
  });
  const drop = (i) => dispatch({ type: 'SET_SHIFTS', shifts: shifts.filter((_, k) => k !== i) });

  const nameOf = (uid) => state.placed.find((p) => p.uid === uid)?.name ?? uid;

  return (
    <Section title="인력" data-guide="panel-shifts">
      <Row label="이 도면에 필요한 인원">{need} 명 / 조</Row>
      {!unlimited && (
        <>
          <Row label="지금 조">
            {shift.name}
            <span className="ml-1 text-[10px] font-normal text-ink4">
              {shiftLabel(shift.minutes)} 중{' '}
              {Number.isFinite(endsIn) ? `${formatElapsed(endsIn)} 남음` : '계속'}
            </span>
          </Row>
          <Row label="배정">
            <span className={unmanned.size ? 'text-rose-500' : 'text-emerald-600'}>
              {shift.headcount - idle} / {shift.headcount} 명
            </span>
            {idle > 0 && <span className="ml-1 text-[10px] font-normal text-ink4">({idle}명 놀고 있음)</span>}
          </Row>
        </>
      )}

      {/* 한 바퀴가 얼마인지, 그리고 **실제로 얼마나 기다려야** 그만큼 도는지.
          뒤엣것이 없으면 8시간 조를 넣어 놓고 왜 안 바뀌는지 모른다. */}
      <p className="mb-1 mt-3 flex items-center justify-between gap-2 text-[10.5px] text-ink4">
        교대조
        <span className="tabular-nums">
          한 바퀴 {formatElapsed(cycleSeconds(shifts))}
          <span className="ml-1 text-ink4/70">· {speed}× 로 {formatElapsed(cycleSeconds(shifts) / speed)}</span>
        </span>
      </p>
      <ul className="space-y-1.5">
        {shifts.map((s, i) => (
          <li
            key={i}
            className={`rounded px-1 py-1 ${i === index && !unlimited ? 'bg-sky-500/10 ring-1 ring-sky-500/30' : ''}`}
          >
            {/* 이름 · 시간 · 분 · 인원 · 지우기 — **한 줄**.
                길이를 시간과 분으로 나눠 받는 것이 핵심이다. 7시간짜리 조를
                넣으려고 420 을 손으로 계산하게 두지 않는다. 저장은 합친 분
                하나이고(crew.js 의 joinHM), 화면에서만 둘로 갈린다. */}
            <div className="flex items-center gap-1 text-[11px]">
              <input
                value={s.name}
                onChange={(e) => set(i, { name: e.target.value })}
                title="조 이름"
                className="min-w-0 flex-1 rounded border border-edge bg-field px-1 py-0.5 text-[11px] text-ink outline-none focus:border-sky-500/60"
              />
              <input
                type="number" min="0" max="24"
                value={splitHM(s.minutes).h}
                onChange={(e) => set(i, { minutes: joinHM(e.target.value, splitHM(s.minutes).m) })}
                title={`${shiftLabel(s.minutes)} · ${speed}× 로 ${formatElapsed((s.minutes * 60) / speed)}`}
                className={NUM_FIELD}
              />
              <span className="text-ink4">시</span>
              <input
                type="number" min="0" max="59" step={MINUTES_RANGE[2]}
                value={splitHM(s.minutes).m}
                onChange={(e) => set(i, { minutes: joinHM(splitHM(s.minutes).h, e.target.value) })}
                title={`${shiftLabel(s.minutes)} · ${speed}× 로 ${formatElapsed((s.minutes * 60) / speed)}`}
                className={NUM_FIELD}
              />
              <span className="text-ink4">분</span>
              <input
                type="number" min={HEADCOUNT_RANGE[0]} max={HEADCOUNT_RANGE[1]}
                value={s.headcount}
                onChange={(e) => set(i, { headcount: Number(e.target.value) })}
                title="이 조에 나오는 사람 수 (0 = 인력을 안 따진다)"
                className={NUM_FIELD}
              />
              <span className="text-ink4">명</span>
              <button
                onClick={() => drop(i)}
                disabled={shifts.length <= 1}
                className="rounded px-0.5 text-ink4 enabled:hover:text-rose-500 disabled:opacity-25"
                title={shifts.length > 1 ? '이 조를 뺀다' : '조는 하나 이상 있어야 한다'}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Btn className="mt-1.5 w-full justify-center" onClick={add}>+ 조 추가</Btn>

      {unmanned.size > 0 && (
        <p className="mt-2 rounded bg-rose-500/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-rose-500 ring-1 ring-rose-500/25">
          사람이 없어 선 설비 {unmanned.size}대 — {[...unmanned].slice(0, 3).map(nameOf).join(' · ')}
          {unmanned.size > 3 ? ` 외 ${unmanned.size - 3}대` : ''}.
          {' '}{need - (shift.headcount - idle)}명이 더 있으면 전부 돕니다.
        </p>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
        인원 <b className="text-ink3">0</b> 은 사람이 없다는 뜻이 아니라{' '}
        <b className="text-ink3">인력을 안 따진다</b>는 뜻입니다.
        <br />작업자는 <b className="text-ink3">걸어 다니지 않습니다</b> — 걷는 시간을 지어내는
        대신 설비에 붙는 자원으로 둡니다. 답하려는 질문은 &ldquo;몇 명이면 도는가&rdquo;니까요.
        <br />모자라면 <b className="text-ink3">배치한 순서대로</b> 배정하고, 못 채우는 설비는
        건너뛰어 다음 설비가 그 사람을 씁니다.
      </p>
    </Section>
  );
}

/**
 * 라인 능력 — **돌리기 전에** 계산으로 나오는 천장.
 * ---------------------------------------------------------------------------
 *  「이번 실행」은 돌린 뒤의 성적이고, 이건 배치를 그리는 동안 보는 값이다.
 *  설비를 하나 옮기거나 공정 시간을 바꾸면 **즉시** 달라지므로, 돌려 보지 않고도
 *  「이 배치의 천장은 얼마인가」 를 알 수 있다.
 *
 *  묶어서 보여 주는 것이 요점이다 — 같은 능력의 고리가 둘이면 **하나만 고쳐
 *  봐야 하나도 안 오른다.** 그것이 이 화면이 말해야 하는 가장 중요한 것이다.
 */
/**
 * 「남는 장사인가」 — **세 갈래다.** 둘로 가르면 가장 흔한 판이 거짓말이 된다:
 *  설비를 통째로 두 배 하면 능력도 돈도 두 배라 개당 원가가 **정확히 같은데**,
 *  그걸 빨갛게 「밑지는 장사」 라고 찍게 된다. 밑지는 게 아니라 본전이다.
 */
const VERDICT = {
  win: { label: '남는 장사', chip: 'bg-emerald-500/15 text-emerald-600', tone: 'text-emerald-600' },
  even: { label: '본전 — 양만 는다', chip: 'bg-sky-500/15 text-sky-600', tone: 'text-ink2' },
  lose: { label: '밑지는 장사', chip: 'bg-rose-500/15 text-rose-600', tone: 'text-rose-600' },
};

function LineCapacity() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();
  const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

  const bal = useMemo(
    () => lineBalance({
      placed: state.placed, links: state.links, carts: state.carts,
      itemOf, specOf, beltSpeed: state.beltSpeed,
    }),
    [state.placed, state.links, state.carts, state.beltSpeed, itemOf, version],
  );
  const chain = useMemo(() => bottleneckChain(bal.rows), [bal.rows]);

  /**
   * 「그래서 얼마 이득인가」 — 능력과 돈을 잇는다.
   * -------------------------------------------------------------------------
   *  단가·교대를 **도면에서 그대로** 가져온다. 여기서 자기 나름의 값을 쓰면
   *  아래 원가 탭과 숫자가 갈리고, 그러면 둘 다 못 믿게 된다.
   */
  const plan = useMemo(
    () => improvePlan({
      rows: bal.rows,
      /* 전기를 먹는 것만 — 선반·적치대에 전기료를 물리면 안 된다 */
      machines: state.placed.filter((p) => isWorkable(itemOf(p.itemId))),
      carts: state.carts,
      shifts: state.shifts,
      crewNeed: totalCrewNeed(state.placed, (p) => isWorkable(itemOf(p.itemId))),
      rates: state.rates,
    }),
    [bal.rows, state.placed, state.carts, state.shifts, state.rates, itemOf],
  );

  if (!bal.rows.length) {
    return (
      <Section title="라인 능력">
        <p className="text-[11px] leading-relaxed text-ink4">
          설비를 놓고 벨트로 이으면 <b className="text-ink3">돌리기 전에</b> 이 배치의 천장이 계산됩니다.
        </p>
      </Section>
    );
  }

  const TONE = { equip: 'text-ink2', belt: 'text-sky-600', cart: 'text-violet-600', truck: 'text-emerald-600' };
  return (
    <Section title="라인 능력">
      <Row label="이 배치의 천장">
        <b className="text-[13px] text-ink">{rateText(bal.capacity)}</b>
      </Row>
      <p className="mb-1.5 text-[10px] leading-snug text-ink4">
        레시피 비율을 반영한 <b className="text-ink3">최종 산출물</b> 기준입니다.
        쌓는 곳(적치대·선반)은 완충이라 능력에 안 들어갑니다.
      </p>

      {chain.map((g, i) => (
        <div key={i} className="mt-1.5 first:mt-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[10.5px] text-ink3">
              {g.items.map((x) => (
                <span key={x.uid} className={TONE[x.kind] ?? ''}>{x.name}{' '}</span>
              ))}
            </span>
            <b className="shrink-0 text-[10.5px] tabular-nums text-ink2">{rateText(g.capacity)}</b>
          </div>
          <div className="text-[9.5px] leading-snug text-ink4">
            {g.last
              ? '여기가 천장 — 이 위로는 다른 고리가 없습니다'
              : <>
                {g.items.length > 1 && <b className="text-ink3">함께 </b>}
                고치면 {rateText(g.then)} <span className="text-emerald-600">(+{rateText(g.gain)})</span>
              </>}
          </div>
        </div>
      ))}

      {/* 같은 능력이 둘 이상이면 하나만 손대는 것이 헛일임을 못 박는다 */}
      {chain[0]?.items.length > 1 && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
          가장 약한 고리가 <b>{chain[0].items.length}개</b>입니다 — 하나만 고치면 하나도 안 오릅니다.
        </p>
      )}
      {/**
        * 「그래서 얼마 이득인가」
        * ---------------------------------------------------------------------
        *  위 목록은 「고치면 10개/분」 까지만 말한다. 그런데 정작 정할 것은
        *  **고칠 값어치가 있는가** 이고, 그건 능력만으로도 돈만으로도 안 나온다.
        *  설비를 한 대 더 놓으면 만드는 개수와 나가는 돈이 **함께** 커지므로,
        *  어느 쪽이 더 크게 커지는지를 개당 원가 하나로 보여 준다.
        */}
      {plan && plan.gain > 0 && (
        <div className="mt-2.5 rounded-md border border-edge bg-field px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium text-ink3">손보면 얼마 이득인가</span>
            {plan.free ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-600">
                돈 안 듦
              </span>
            ) : (
              <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium ${VERDICT[plan.verdict]?.chip ?? ''}`}>
                {VERDICT[plan.verdict]?.label ?? '—'}
              </span>
            )}
          </div>

          {/* 무엇을 손보나 — 종류마다 「푼다」의 뜻이 다르다 */}
          <ul className="mt-1.5 space-y-0.5">
            {plan.steps.map((s) => (
              <li key={s.uid} className="flex items-baseline justify-between gap-2 text-[10.5px]">
                <span className="truncate text-ink3">{s.name}</span>
                <span className="shrink-0 text-ink4">{s.what}</span>
              </li>
            ))}
          </ul>

          <table className="mt-1.5 w-full border-t border-line pt-1 text-[10.5px] tabular-nums">
            <tbody>
              <tr className="text-ink4">
                <td className="py-0.5" />
                <td className="py-0.5 text-right">지금</td>
                <td className="py-0.5 text-right">손본 뒤</td>
              </tr>
              <tr>
                <td className="py-0.5 text-ink4">천장</td>
                <td className="py-0.5 text-right text-ink3">{rateText(plan.now.capacity)}</td>
                <td className="py-0.5 text-right font-medium text-ink">{rateText(plan.after.capacity)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-ink4">시간당 비용</td>
                <td className="py-0.5 text-right text-ink3">{won(plan.now.hourly)}</td>
                <td className="py-0.5 text-right text-ink2">{won(plan.after.hourly)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-ink4">개당 원가</td>
                {/* 원 단위로 반올림하면 3.03원과 2.87원이 똑같이 찍힌다 */}
                <td className="py-0.5 text-right text-ink3">{unitWon(plan.now.unit)}</td>
                <td className={`py-0.5 text-right font-medium ${VERDICT[plan.verdict]?.tone ?? 'text-ink2'}`}>
                  {unitWon(plan.after.unit)}
                </td>
              </tr>
            </tbody>
          </table>

          <p className="mt-1 border-t border-line pt-1 text-[9.5px] leading-snug text-ink4">
            {plan.free
              ? '값만 바꾸면 되는 자리입니다 — 설비를 사기 전에 여기부터 보세요.'
              : <>
                시간당 <b className="text-ink3">{won(plan.addWon)}</b>이 더 듭니다
                {plan.addCrew > 0 && <> (사람 <b className="text-ink3">{plan.addCrew}명</b> 포함)</>}.{' '}
                {plan.verdict === 'even'
                  ? <>개당 원가는 <b className="text-ink3">그대로</b>고 <b className="text-ink3">양만</b> 늡니다.</>
                  : <>개당 <b className={VERDICT[plan.verdict]?.tone}>{deltaText(plan.unitDelta)}</b>.</>}
              </>}
            {/* 위 목록의 「고치면 10개/분」은 고리를 통째로 치웠을 때다. 한 대로는
                거기까지 못 가는 일이 흔한데, 아무 말도 안 하면 모순처럼 읽힌다 */}
            {!plan.reaches && (
              <>
                <br />
                한 대로는 <b className="text-ink3">{rateText(plan.after.capacity)}</b>까지입니다 —
                위에 적힌 <b className="text-ink3">{rateText(plan.ceiling)}</b>까지 올리려면 더 놓아야 합니다.
              </>
            )}
            <br />
            고장도 굶음도 없이 <b className="text-ink3">쉬지 않고 도는</b> 라인의 값입니다 —
            실제로 돌린 원가는 아래 <b className="text-ink3">원가</b> 탭에서 봅니다.
          </p>
        </div>
      )}
    </Section>
  );
}

/**
 * 도면 보고서 — **안 돌려도 나오는 한 장.**
 * ---------------------------------------------------------------------------
 *  실행 보고서는 돌려야 나온다. 그런데 도면을 남에게 건넬 때 필요한 것은 대개
 *  그 앞이다 — 「무엇이 몇 대 놓였고, 이 라인의 천장은 얼마인가」. 그래서 이
 *  버튼은 아래 띠가 아니라 **도면 요약** 안에 있다. 그쪽은 「이번 실행」의 자리다.
 *
 *  값은 전부 화면이 이미 보여 주고 있는 것과 **같은 계산**에서 나온다 —
 *  종이와 화면이 다른 숫자를 말하면 둘 다 못 믿는다.
 */
function PlanReportButton() {
  const { state, dispatch, itemOf } = useEditor();
  const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

  const save = () => {
    try {
      const layout = layoutSnapshot(state);
      const workable = (p) => isWorkable(itemOf(p.itemId));
      const bal = lineBalance({
        placed: state.placed, links: state.links, carts: state.carts,
        itemOf, specOf, beltSpeed: state.beltSpeed,
      });
      const html = planReportHTML({
        at: stamp(),
        layout,
        info: layoutInfo(layout, itemOf),
        rows: bal.rows,
        capacity: bal.capacity,
        plan: improvePlan({
          rows: bal.rows,
          machines: state.placed.filter(workable),
          carts: state.carts,
          shifts: state.shifts,
          crewNeed: totalCrewNeed(state.placed, workable),
          rates: state.rates,
        }),
        /* 화면의 동선 칸과 **같은 계산** — 종이와 화면이 다른 말을 하면 안 된다 */
        flow: (() => {
          const f = flowMatrix({
            rows: bal.rows, capacity: bal.capacity,
            placed: state.placed, links: state.links, carts: state.carts,
            lengthOf: (l) => linkPath(l, state.placed, itemOf)?.length ?? 0,
          }, itemOf);
          return { rows: f, per: metersPerUnit(f, bal.capacity), total: totalWork(f) };
        })(),
        nameOf: (p) => itemOf(p.itemId)?.name ?? '',
      });
      downloadHTML(html, `도면보고서-${stamp()}.html`);
      dispatch({ type: 'SET', patch: { hint: '도면 보고서를 내려받았습니다' } });
    } catch (e) {
      /* 눌렀는데 아무 일도 안 일어나면 버튼이 고장 났는지조차 알 수 없다 */
      console.error('[도면 보고서] 만들다 실패', e);
      dispatch({ type: 'SET', patch: { hint: '도면 보고서를 만들지 못했습니다' } });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={save}
        className={OUT_BTN}
        title="평면도 · 설비 목록 · 라인 능력 · 예상 원가 한 장 — 브라우저로 열고 Ctrl+P 로 PDF"
      >
        <FileText size={14} /> 도면 보고서
      </button>
      <p className="mt-1.5 text-[10px] leading-snug text-ink4">
        <b className="text-ink3">돌리지 않아도</b> 나옵니다 — 평면도와 설비 목록, 라인 천장,
        쉬지 않고 돌 때의 원가. 잰 값은 아래 띠의 <b className="text-ink3">보고서</b>입니다.
      </p>
    </>
  );
}

/**
 * 물류 동선 — **배치를 고쳐서 줄일 수 있는 것.**
 * ---------------------------------------------------------------------------
 *  「얼마나 만드나」(라인 능력)와 「얼마가 드나」(원가)는 있었는데, 정작 설비를
 *  옮겨서 달라지는 값이 없었다. 그게 이것이다 — 물건이 오가는 거리.
 *
 *  **개당 거리**를 크게 띄우는 이유가 있다. 총 작업량은 라인이 빨라지기만 해도
 *  커져서, 배치를 나쁘게 고쳐 놓고도(느려져서) 숫자가 줄어 보인다. 개당 거리는
 *  그 착시가 없다 — 배치가 좋아져야만 내려간다.
 */
/**
 * **배치 손보기** — 도구가 옮겨 보고 값을 잰다.
 * ---------------------------------------------------------------------------
 *  도면을 **마음대로 안 바꾼다.** 찾은 것을 말로 내놓고, 적용은 사람이 누른다.
 *  자동으로 고쳐 놓으면 「내가 그린 것」이 아니게 되고, 그러면 값이 좋아져도
 *  안 쓴다. 적용한 뒤에도 Ctrl+Z 로 되돌아간다(한 번의 MOVE_MANY 다).
 *
 *  줄이는 것은 **개당 거리** 하나다 — 배치를 바꿔서 달라지는 것이 그것이라서다.
 *  라인의 천장은 공정 시간과 벨트 속도가 정하지, 설비가 어디 앉아 있는지가
 *  정하지 않는다. 그 사실을 화면이 말해 준다(안 그러면 「처리량이 왜 그대로냐」).
 */
function Tidy({ per }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const [plan, setPlan] = useState(null);

  /* 도면을 고치면 지난 제안은 더 이상 그 도면의 것이 아니다 */
  const key = `${state.placed.length}:${state.links.length}:${state.carts.length}:${per?.toFixed(3)}`;
  const [keyAt, setKeyAt] = useState(key);
  if (keyAt !== key) { setKeyAt(key); setPlan(null); }

  const go = () => {
    const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);
    setPlan(searchLayout({
      placed: state.placed, links: state.links, carts: state.carts,
      itemOf, specOf, beltSpeed: state.beltSpeed,
      /* 놓을 수 있는가는 **화면과 같은 판정**이다 — 규칙이 갈리면 못 놓는
         자리를 답으로 낸다 */
      bboxOf: (p) => {
        const it = itemOf(p.itemId);
        return isShelf(it) ? shelfBBox(p, specOf(it)) : specOf(it)?.bbox ?? null;
      },
      floor: floorOf(state.areas), walls: state.walls, pillars: state.pillars,
      lengthOf: (l, list) => linkPath(l, list, itemOf)?.length ?? 0,
    }));
  };

  const apply = () => {
    if (!plan?.ok) return;
    /* **한 번의 MOVE_MANY** 다 — Ctrl+Z 한 번으로 통째로 되돌아간다 */
    dispatch({ type: 'MOVE_MANY', moves: plan.placed.map((p) => ({ uid: p.uid, pos: p.pos })) });
    setPlan(null);
  };

  return (
    <div className="mt-2 border-t border-line pt-2">
      <button
        type="button" onClick={go}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-raise px-2 py-1 text-[11px] text-ink2 ring-1 ring-edge hover:bg-raiseh hover:text-ink"
      >
        <Wand2 size={12} /> 배치 손보기
      </button>

      {plan && !plan.ok && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink4">
          {plan.why === 'no-flow'
            ? <>오가는 것이 없어 <b className="text-ink3">잴 수가 없습니다.</b> 벨트나 카트로 이어 주세요.</>
            : plan.why === 'too-few'
              ? <>맞바꿀 상대가 없습니다 — 설비가 <b className="text-ink3">둘 이상</b> 있어야 합니다.</>
              : <><b className="text-ink3">맞바꿔서 줄일 것이 없습니다.</b> 후보 {plan.tried}가지를 재 봤습니다.</>}
        </p>
      )}

      {plan?.ok && (
        <div className="mt-1.5">
          <Row label="손보면">
            <b className="text-[11.5px] text-emerald-600">{gainText(plan.before, plan.after)}</b>
          </Row>
          <ol className="mt-1 space-y-0.5">
            {plan.steps.map((s, k) => (
              <li key={`${s.a}-${s.b}`} className="flex items-baseline justify-between gap-2 text-[10.5px]">
                <span className="min-w-0 truncate text-ink3">
                  <span className="text-ink4">{k + 1}.</span> <b className="text-ink2">{s.aName}</b>
                  {' '}↔{' '}<b className="text-ink2">{s.bName}</b>
                </span>
                <span className="shrink-0 tabular-nums text-ink4">{s.to.toFixed(1)} m</span>
              </li>
            ))}
          </ol>
          <button
            type="button" onClick={apply}
            className="mt-1.5 w-full rounded-md bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-600 ring-1 ring-sky-500/40 hover:bg-sky-500/25"
          >
            이대로 옮기기 ({plan.steps.length}번)
          </button>
          <p className="mt-1 text-[9.5px] leading-snug text-ink4">
            자리만 맞바꿉니다 — <b className="text-ink4">방향도 설정도 그대로</b>입니다.
            마음에 안 들면 <b className="text-ink4">Ctrl+Z</b> 한 번으로 돌아갑니다.
          </p>
        </div>
      )}

      <p className="mt-1.5 text-[9.5px] leading-snug text-ink4">
        <b className="text-ink4">처리량은 안 바뀝니다.</b> 라인의 천장은 공정 시간과 벨트 속도가
        정하지 설비가 어디 앉아 있는지가 정하지 않습니다 — 줄어드는 것은 <b className="text-ink4">거리</b>입니다.
        언덕을 내려가다 멈추는 방식이라 <b className="text-ink4">최선이라는 보장은 없습니다.</b>
      </p>
    </div>
  );
}

function FlowSection() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();
  const specOf = (it) => (it?.modelKey ? getSpec(it.modelKey) : null);

  const { rows, per, total } = useMemo(() => {
    const bal = lineBalance({
      placed: state.placed, links: state.links, carts: state.carts,
      itemOf, specOf, beltSpeed: state.beltSpeed,
    });
    const f = flowMatrix({
      rows: bal.rows, capacity: bal.capacity,
      placed: state.placed, links: state.links, carts: state.carts,
      /* 벨트가 **깔린 길이** — 경로는 모델 규격을 봐야 나오므로 화면 층의 일이다 */
      lengthOf: (l) => linkPath(l, state.placed, itemOf)?.length ?? 0,
    }, itemOf);
    return { rows: f, per: metersPerUnit(f, bal.capacity), total: totalWork(f) };
  }, [state.placed, state.links, state.carts, state.beltSpeed, itemOf, version]);

  if (!rows.length) {
    return (
      <Section title="물류 동선">
        <p className="text-[11px] leading-relaxed text-ink4">
          벨트나 카트로 물건이 오가면 <b className="text-ink3">얼마나 멀리 나르는지</b>가 계산됩니다.
        </p>
      </Section>
    );
  }

  const TONE = { belt: 'text-sky-600', cart: 'text-violet-600', truck: 'text-emerald-600' };
  return (
    <Section title="물류 동선">
      <Row label="한 개가 지나는 거리">
        <b className="text-[13px] text-ink">{per == null ? '—' : `${per.toFixed(1)} m`}</b>
      </Row>
      <Row label="운반 작업량">{workText(total)}</Row>
      <p className="mb-1.5 mt-1 text-[10px] leading-snug text-ink4">
        설비를 옮겨 <b className="text-ink3">개당 거리</b>가 줄면 그 배치가 나은 것입니다.
        아래가 무거운 구간이니 <b className="text-ink3">이 둘부터 붙여</b> 보세요.
      </p>

      <ul className="max-h-[132px] space-y-0.5 overflow-y-auto">
        {heaviest(rows, 8).map((r, i) => (
          <li key={`${r.uid}-${i}`} className="text-[10.5px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`min-w-0 truncate ${TONE[r.kind] ?? 'text-ink3'}`}>
                {r.fromName} → {r.toName}
              </span>
              <span className="shrink-0 tabular-nums text-ink2">{workText(r.work)}</span>
            </div>
            <div className="text-[9.5px] tabular-nums leading-snug text-ink4">
              {Math.round(r.perHour).toLocaleString()} 개/시 × {r.meters.toFixed(1)} m
              {r.via && <span> · {r.via}</span>}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 text-[9.5px] leading-snug text-ink4">
        라인이 <b className="text-ink4">천장까지 돈다고 볼 때</b>의 값입니다. 빈 차로 돌아오는
        구간은 물건이 안 실려 있어 안 셉니다.
      </p>
      <Tidy per={per} />
    </Section>
  );
}

function Summary() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();
  const shipped = useShipped();

  const total = useMemo(
    () =>
      state.links.reduce((sum, l) => {
        const p = linkPath(l, state.placed, itemOf);
        return sum + (p?.length ?? 0);
      }, 0),
    [state.links, state.placed, itemOf, version],
  );

  return (
    <>
      <Section title="도면 요약">
        <Row label="설비">{state.placed.length} 대</Row>
        <Row label="연결장치">{state.links.length} 개</Row>
        <Row label="카트">
          {state.carts.reduce((n, c) => n + (c.count ?? 1), 0)} 대 / 경로 {state.carts.length}
        </Row>
        <Row label="총 연장 길이">{total.toFixed(2)} m</Row>
        <Row label="건물">영역 {state.areas.length} · 개구부 {state.openings.length}</Row>
        {/* 트럭이 개구부로 실어 낸 누계 — 도면이 실제로 물건을 내보내는지 확인용.
            종류별 내역은 화면 왼쪽 위에 늘 떠 있다(ShippedHUD). */}
        <Row label="출하 누계">{shippedTotal(shipped)} 개</Row>
        {Object.entries(shipped).map(([kind, n]) => (
          <Row key={kind} label={`· ${PAYLOAD_ITEMS[kind]?.name ?? kind}`}>{n} 개</Row>
        ))}
        <div className="mt-2.5 border-t border-line pt-2">
          <PlanReportButton />
        </div>
      </Section>


      {/* 돌리기 전에 계산으로 나오는 천장 — 배치를 그리는 동안 본다 */}
      <LineCapacity />

      {/* 배치를 고쳐서 줄일 수 있는 것 — 능력·원가와 함께 보는 셋째 값 */}
      <FlowSection />

      <CrewPanel />

      <BomReport />

      <Section title="조작">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink3">
          <li><b className="text-ink">좌클릭</b> — 배치 / 선택</li>
          <li><b className="text-ink">좌드래그</b> — 선택한 설비 이동 (탑뷰)</li>
          <li><b className="text-ink">우·휠 드래그</b> — 화면 이동</li>
          <li><b className="text-ink">휠</b> — 커서 기준 확대/축소</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">R</kbd> — 90° 회전</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">X</kbd> — 지우개</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Del</kbd> — 선택 삭제</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Esc</kbd> — 도구 해제 / 연결 취소</li>
          <li><kbd className="rounded bg-kbd px-1 text-ink">Tab</kbd> — 탑뷰 ↔ 3D</li>
        </ul>
      </Section>
    </>
  );
}

export default function Inspector() {
  const { state } = useEditor();
  useModelsVersion();
  const sel = state.selected;

  const placed = sel?.kind === 'equip' ? state.placed.find((p) => p.uid === sel.uid) : null;
  const link = sel?.kind === 'link' ? state.links.find((l) => l.uid === sel.uid) : null;
  const cart = sel?.kind === 'cart' ? state.carts.find((c) => c.uid === sel.uid) : null;
  const area = sel?.kind === 'area' ? state.areas.find((a) => a.uid === sel.uid) : null;
  const wall = sel?.kind === 'wall' ? state.walls.find((w) => w.uid === sel.uid) : null;
  const pillar = sel?.kind === 'pillar' ? state.pillars.find((p) => p.uid === sel.uid) : null;
  const zone = sel?.kind === 'zone' ? state.zones.find((z) => z.uid === sel.uid) : null;
  const opening = sel?.kind === 'opening' ? state.openings.find((o) => o.uid === sel.uid) : null;
  const placedItem = placed ? state.library.find((i) => i.id === placed.itemId) : null;
  const shelf = placed && isShelf(placedItem) ? placed : null;
  const stillage = placed && isStillage(placedItem) ? placed : null;

  /* 여러 개를 골랐으면 개별 상세 대신 목록·정렬 도구를 보여 준다 */
  const selected = selItems(sel);
  const multi = selected.length > 1 ? selected : null;

  return (
    <aside className="w-[292px] shrink-0 overflow-y-auto border-l border-line bg-panel">
      {multi ? <MultiPanel items={multi} />
        : area ? <AreaPanel area={area} edge={sel.edge} />
        : wall ? <WallPanel wall={wall} />
          : pillar ? <PillarPanel pillar={pillar} />
            : zone ? <ZonePanel zone={zone} />
              : opening ? <OpeningPanel opening={opening} />
              : stillage ? <StillagePanel placed={stillage} />
                : shelf ? <ShelfPanel placed={shelf} />
                : placed ? <EquipmentPanel placed={placed} />
                  : link ? <LinkPanel link={link} />
                    : cart ? <CartPanel cart={cart} />
                      : <Summary />}
    </aside>
  );
}
