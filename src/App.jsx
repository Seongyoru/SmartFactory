/**
 * =============================================================================
 *  EGIS Smart Factory — 설비 배치 에디터
 * =============================================================================
 *  화면 구성
 *    상단  툴바 (뷰 전환 · 도구 · 스냅 · 저장)
 *    좌측  라이브러리 (설비 / 연결장치 탭)
 *    중앙  3D 캔버스 (탑뷰에서 배치, 3D 에서 확인)
 *    우측  인스펙터 (선택 상세 / 도면 요약)
 *    하단  상태바 (커서 좌표 · 현재 동작 안내)
 * ---------------------------------------------------------------------------
 */

import React, { useEffect } from 'react';
import { Ban, Box as BoxIcon, Building2, Cable, Crosshair, Eraser, Eye, EyeOff, MousePointer2, Truck } from 'lucide-react';
import { EditorProvider, SHAPE, TOOL, VIEW, isBuildTool, useEditor } from './core/store.jsx';
import { getSpec, loadModel, modelOptions } from './core/modelStore.js';
import { useCursor } from './core/cursorStore.js';
import { shippedTotal, useAllStock, useShipped } from './core/simStore.js';
import { bottleneck, getRan, throughput, useMetrics } from './core/metrics.js';
import { blockChain, stepTarget } from './core/diagnose.js';
import { normalizeOrders } from './core/orders.js';
import { focusOn } from './core/focusStore.js';
import { BUILTIN_LIBRARY, PAYLOAD_ITEMS, isShelf, isUtility } from './data/library.js';
import { DEFAULT_BAYS, MAX_BAYS, MIN_BAYS } from './core/shelf.js';
import EditorScene from './scene/EditorScene.jsx';
import LibraryPanel from './ui/LibraryPanel.jsx';
import Toolbar from './ui/Toolbar.jsx';
import Inspector from './ui/Inspector.jsx';
import ZoneLayers from './ui/ZoneLayers.jsx';
import Tutorial from './ui/Tutorial.jsx';
import Scenarios from './ui/Scenarios.jsx';
import ErrorBoundary from './ui/ErrorBoundary.jsx';

/* 기본 제공 모델은 앱이 뜨자마자 받아 둔다 — 라이브러리 카드에 치수를 띄우고,
   첫 배치 때 고스트가 늦게 나타나는 것을 막기 위해.

   옵션은 반드시 `modelOptions(i)` 로 만든다. 여기가 **가장 먼저** 캐시를 채우는
   자리라, 필드를 하나라도 빠뜨리면 뒤에 제대로 넘긴 호출이 통째로 무시된다 —
   실제로 `tint` 를 빠뜨려 반송물이 전부 원본 색으로 나온 적이 있다. */
function usePreloadBuiltins() {
  useEffect(() => {
    [...BUILTIN_LIBRARY, ...Object.values(PAYLOAD_ITEMS)]
      .filter((i) => i.url)
      .forEach((i) => loadModel(i.modelKey, modelOptions(i)).catch(() => {}));
  }, []);
}

function useShortcuts() {
  const { state, dispatch, activeItem } = useEditor();
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      /* 되돌리기 — 글자 입력 중에는 위에서 이미 빠져나가므로 이름 필드의
         네이티브 실행 취소를 가로채지 않는다.
         한글 자판에서도 Ctrl 조합은 대개 라틴 문자로 오지만, 안 그런 경우를
         대비해 같은 자리의 글쇠(ㅋ · ㅛ)도 함께 받는다. */
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'ㅋ') {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
          return;
        }
        if (k === 'y' || k === 'ㅛ') {
          e.preventDefault();
          dispatch({ type: 'REDO' });
          return;
        }
        /* 복사·붙여넣기 — 설비/선반/기둥만, 그리고 **한 종류만**.
           붙여넣기는 곧바로 만들지 않고 손에 든 상태로 넘어간다. 어디에 놓일지
           보고 정하는 편이, 원본 옆 어딘가에 생긴 것을 다시 끌어 옮기는 것보다
           낫다. 무엇을 복사했는지는 클립보드가 기억한다. */
        if (k === 'c' || k === 'ㅊ') {
          e.preventDefault();
          dispatch({ type: 'COPY' });
          return;
        }
        if (k === 'v' || k === 'ㅍ') {
          e.preventDefault();
          if (state.clipboard) dispatch({ type: 'SET_TOOL', tool: TOOL.PASTE });
          else dispatch({ type: 'SET', patch: { hint: '복사해 둔 것이 없습니다' } });
          return;
        }
      }

      switch (e.key) {
        case 'r':
        case 'R':
        case 'ㄱ':
          /* 무언가를 들고 있으면(배치 모드) 항상 손에 든 것을 돌린다.
             방금 놓은 설비가 선택 상태로 남아 있다고 해서 그걸 돌려 버리면
             "놓고 → R → 놓고" 흐름이 끊긴다. */
          if (state.tool === TOOL.PLACE) dispatch({ type: 'ROTATE_GHOST', dir: e.shiftKey ? -1 : 1 });
          else if (state.selected?.kind === 'equip') dispatch({ type: 'ROTATE', uid: state.selected.uid, dir: e.shiftKey ? -1 : 1 });
          break;
        case 'x':
        case 'X':
          dispatch({ type: 'SET_TOOL', tool: state.tool === TOOL.ERASE ? TOOL.SELECT : TOOL.ERASE });
          break;
        /* 선반 길이 — 배치 중에는 손에 든 것을, 선택 중에는 그 선반을 늘린다 */
        case '[':
        case ']': {
          const d = e.key === ']' ? 1 : -1;
          if (state.tool === TOOL.PLACE && isShelf(activeItem)) dispatch({ type: 'SHELF_BAYS', delta: d });
          else if (state.selected?.kind === 'equip') {
            const p = state.placed.find((x) => x.uid === state.selected.uid);
            if (p && isShelf(state.library.find((i) => i.id === p.itemId))) {
              dispatch({
                type: 'UPDATE_PLACED',
                uid: p.uid,
                patch: { bays: Math.max(MIN_BAYS, Math.min(MAX_BAYS, (p.bays ?? DEFAULT_BAYS) + d)) },
              });
            }
          }
          break;
        }
        case 'Enter':
          if (state.tool === TOOL.PATH) dispatch({ type: 'PATH_FINISH', closed: e.shiftKey });
          break;
        case 'Escape':
          /* 꼭짓점 편집이 먼저다 — 편집 중에 Esc 가 도구까지 바꿔 버리면
             "고치던 것만 그만두기" 를 할 수 없다 */
          if (state.editShape) dispatch({ type: 'EDIT_SHAPE', target: null });
          else if (state.polyDraft?.points.length || state.wallDraft) dispatch({ type: 'POLY_CANCEL' });
          else if (state.pathDraft?.points.length) dispatch({ type: 'PATH_CANCEL' });
          else if (state.connectFrom) dispatch({ type: 'CANCEL_CONNECT' });
          else dispatch({ type: 'SET_TOOL', tool: TOOL.SELECT, itemId: null });
          break;
        case 'Delete':
        case 'Backspace':
          // 경로·도형을 찍는 중이면 마지막 점을 물린다
          if (state.tool === TOOL.PATH && state.pathDraft?.points.length) dispatch({ type: 'PATH_UNDO' });
          else if (state.polyDraft?.points.length) dispatch({ type: 'POLY_UNDO' });
          else if (state.selected) {
            dispatch({
              type: 'DELETE',
              kind: state.selected.kind,
              uid: state.selected.uid,
              uids: state.selected.uids,
            });
          }
          break;
        case 'Tab':
          e.preventDefault();
          dispatch({ type: 'SET', patch: { view: state.view === VIEW.TOP ? VIEW.ISO : VIEW.TOP } });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, dispatch, activeItem]);
}

/** 현재 무엇을 하는 중인지 캔버스 위에 띄우는 안내 */
function ModeBanner() {
  const { state, activeItem, dispatch } = useEditor();
  const { tool, connectFrom, view, hint } = state;

  /* 거절 안내는 잠깐만 띄우고 스스로 사라진다 — 닫으라고 시키면 성가시다 */
  useEffect(() => {
    if (!hint) return undefined;
    const t = setTimeout(() => dispatch({ type: 'SET', patch: { hint: null } }), 2600);
    return () => clearTimeout(t);
  }, [hint, dispatch]);

  if (tool === TOOL.SELECT) return null;

  const buildText = () => {
    const pen = state.drawShape === SHAPE.PEN;
    const n = state.polyDraft?.points.length ?? 0;
    if (tool === TOOL.PILLAR) return '기둥을 세울 자리를 클릭하세요';
    if (tool === TOOL.WALL) {
      return state.wallDraft ? '끝점을 클릭하세요 · 다른 벽 끝에 붙습니다' : '내벽 시작점을 클릭하세요';
    }
    const what = tool === TOOL.ZONE ? '구역' : '영역';
    if (!pen) return `${what} — 끌어서 사각형을 그리세요${tool === TOOL.ZONE ? ' (바닥 위에서만)' : ''}`;
    return n === 0
      ? `${what} — 펜: 첫 점을 클릭하세요`
      : `점 ${n}개 · 더블클릭으로 닫기 · 첫 점을 다시 눌러도 됩니다`;
  };

  const info =
    isBuildTool(tool)
      ? { Icon: Building2, color: 'text-emerald-600 ring-emerald-500/40', text: buildText() }
    : tool === TOOL.PASTE
      ? {
          Icon: BoxIcon,
          color: 'text-cyan-600 ring-cyan-500/40',
          text: `복사한 ${state.clipboard?.items.length ?? 0}개 — 놓을 자리를 클릭하세요`,
        }
    : tool === TOOL.PLACE
      ? {
          Icon: BoxIcon,
          color: 'text-cyan-600 ring-cyan-500/40',
          text: isShelf(activeItem)
            ? `${activeItem?.name ?? ''} · 길이 ${state.shelfBays}칸 — [ ] 로 조절 · R 회전`
            : `${activeItem?.name ?? ''} 배치 — 클릭해서 놓기 · R 회전`,
        }
      : tool === TOOL.PATH
        ? {
            Icon: Truck,
            color: 'text-violet-500 ring-violet-500/40',
            text: (state.pathDraft?.points.length ?? 0) === 0
              ? `${activeItem?.name ?? ''} — 순찰 경로를 찍기 시작하세요`
              : `경유점 ${state.pathDraft.points.length}개 · 더블클릭으로 마침 · 첫 점을 다시 누르면 고리`,
          }
        : tool === TOOL.CONNECT
          ? {
              Icon: Cable,
              color: 'text-amber-600 ring-amber-500/40',
              text: connectFrom
                ? isUtility(activeItem)
                  ? '끝점을 클릭하세요 · 설비나 기존 배관 위에 놓으면 붙습니다'
                  : `${connectFrom.kind === 'out' ? '유입부' : connectFrom.kind === 'in' ? '유출부' : '도착 포트'}를 클릭하세요 · 회색 포트는 이을 수 없습니다`
                : isUtility(activeItem)
                  ? `${activeItem?.name ?? ''} — 시작점을 클릭하세요 (높이 ${activeItem?.height ?? 1}m)`
                  : `${activeItem?.name ?? ''} — 출발 포트를 클릭하세요`,
            }
          : { Icon: Eraser, color: 'text-red-500 ring-red-500/40', text: '지울 대상을 클릭하세요' };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {hint && (
        <div className="flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-[11.5px] font-medium text-white shadow-lg">
          <Ban size={13} />
          {hint}
        </div>
      )}
      <div className={`pointer-events-auto flex items-center gap-2 rounded-full bg-float px-3.5 py-1.5 text-[11.5px] font-medium ring-1 backdrop-blur ${info.color}`}>
        <info.Icon size={13} />
        {info.text}
        {view !== VIEW.TOP && <span className="text-ink4">· 탑뷰에서만 배치할 수 있습니다</span>}
        <button
          onClick={() => dispatch({ type: 'SET_TOOL', tool: TOOL.SELECT, itemId: null })}
          className="ml-1 rounded-full bg-kbd px-2 py-0.5 text-[10px] text-ink2 hover:bg-raiseh"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

/**
 * 3D 뷰 옵션 — 캔버스 오른쪽 위.
 *  돌하우스(앞 벽 감추기)는 내부를 보려고 켜 두지만, 건물의 겉모습을 확인해야
 *  할 때도 있다. 툴바가 아니라 캔버스 위에 두는 이유는 이 값이 **지금 보고 있는
 *  화면에만** 영향을 주기 때문이다 — 도면 자체는 달라지지 않는다.
 *  탑뷰에서는 애초에 벽이 감춰지지 않으므로 버튼도 나오지 않는다.
 */
/**
 * 출하 누계 — 화면 왼쪽 위에 종류별로 쌓인다.
 * ---------------------------------------------------------------------------
 *  트럭이 개구부로 빠져나가면 싣고 있던 것이 공장을 떠난다. 그 결과가 인스펙터
 *  안에만 있으면 도면을 보는 동안에는 알 수 없다 — 라인이 도는 것을 지켜보는
 *  일이 곧 이 도면의 목적이므로, 성과는 **늘 보이는 자리**에 있어야 한다.
 *
 *  종류별로 나눠 세는 이유: 총량만으로는 한쪽 공정만 돌고 있어도 숫자가 오른다.
 *  두 값이 나란히 오르는지를 보면 라인이 균형 있게 도는지가 그대로 드러난다.
 *
 *  아무것도 안 나갔으면 띄우지 않는다 — 0 만 적힌 상자는 화면만 가린다.
 */
/**
 * 원인 사슬의 한 줄 — **누르면 데려간다.**
 * ---------------------------------------------------------------------------
 *  "저기가 문제다" 라고 말만 하고 끝나면, 도면이 크면 이름만 보고 그 설비를 찾는
 *  데 또 한참이 걸린다. 짚어 줬으면 데려다도 줘야 한다.
 *
 *  누르면 그 대상을 고르고(인스펙터가 열린다) 카메라가 따라간다. 탑뷰는 당겨
 *  보고, 3D 는 그 둘레를 한 바퀴 돈다 — 어느 것인지 눈에 확 들어오도록.
 */
function StepRow({ step, depth, culprit }) {
  const { state, dispatch } = useEditor();
  const target = stepTarget(step, state);

  const body = (
    <>
      <span className="shrink-0 text-ink4">←</span>
      <span className={culprit ? 'text-rose-500' : 'text-ink4'}>
        <b className={culprit ? 'font-semibold' : 'font-normal'}>{step.name}</b>
        {step.note ? ` ${step.note}` : ''}
      </span>
    </>
  );
  const cls = 'mt-0.5 flex w-full items-start gap-1 text-left text-[10.5px] leading-snug';
  const pad = { paddingLeft: `${depth * 6}px` };

  /* 「빼가는 것이 없습니다」 처럼 가리킬 대상이 없는 칸도 있다 — 그건 글자로 둔다 */
  if (!target) return <div className={cls} style={pad}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: 'SELECT', selected: { kind: target.kind, uid: target.uid } });
        focusOn(target.at, { look: true });
      }}
      style={pad}
      title={`${step.name} 로 이동`}
      className={`${cls} pointer-events-auto cursor-pointer rounded px-0.5 hover:bg-raiseh`}
    >
      {body}
    </button>
  );
}

function ShippedHUD() {
  const { state, itemOf } = useEditor();
  const shipped = useShipped();
  useMetrics();                       // 지표가 갱신되면 다시 그린다
  const stock = useAllStock();
  const ran = getRan();

  const kinds = Object.entries(shipped).filter(([, n]) => n > 0);
  const total = shippedTotal(shipped);
  /** 재공(WIP) — 아직 공장 안에 있는 것. 적치대·선반에 쌓인 것을 센다 */
  const wip = Object.values(stock).reduce((s, n) => s + n, 0);
  /* 지워진 설비가 병목으로 남아 있으면 안 된다 — 기록은 이번 실행의 것이지만
     화면은 지금 있는 도면을 말해야 한다. 도면에 없는 uid 면 없는 것으로 본다. */
  const tp = throughput(total);
  const neckRaw = bottleneck();
  const neckOwner = neckRaw ? state.placed.find((p) => p.uid === neckRaw.uid) : null;
  const neck = neckOwner ? neckRaw : null;
  const neckName = neckOwner?.name ?? null;
  /* 왜 막혔는지 — 사슬 끝이 손볼 곳이다 (core/diagnose.js) */
  const chain = neckOwner
    ? blockChain(neckOwner.uid, {
      placed: state.placed, links: state.links, carts: state.carts, itemOf,
      specOf: (it) => (it?.modelKey ? getSpec(it.modelKey) : null),
      getStock: (uid) => stock[uid] ?? 0,
    })
    : null;

  /* 오더가 있으면 그것만으로도 띄운다 — 진척은 늘 보여야 하는 값이다 */
  const hasOrders = normalizeOrders(state.orders).length > 0;
  if (!kinds.length && !wip && !neck && !hasOrders) return null;

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-[186px] flex-col gap-1">
      {kinds.map(([kind, n]) => {
        const it = PAYLOAD_ITEMS[kind];
        return (
          <div
            key={kind}
            className="flex items-center gap-2 rounded-full bg-float px-2.5 py-1 text-[11.5px] ring-1 ring-edge backdrop-blur"
            title={`${it?.name ?? kind} 출하 누계`}
          >
            <i
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-black/20"
              style={{ background: it?.color ?? '#94a3b8' }}
            />
            <b className="tabular-nums text-ink">{n.toLocaleString()}</b>
            <span className="text-ink4">{it?.name ?? kind}</span>
          </div>
        );
      })}

      {/**
       * 성과 — 도면이 잘 도는지는 이 세 줄로 갈린다.
       *  처리량은 **시간으로 나눈 값**이라 시뮬 시계가 있어야 의미가 있다.
       *  재공은 공장 안에 붙들려 있는 양이고, 병목은 가장 오래 막혀 선 설비다.
       *  아직 아무것도 안 돌았으면(ran = 0) 나눗셈이 성립하지 않으므로 안 띄운다.
       */}
      {ran > 0 && (
        <div className="rounded-lg bg-float px-2.5 py-1.5 text-[11px] ring-1 ring-edge backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink4">처리량</span>
            {/* 라인이 채워지기 전(WARMUP)에는 숫자를 내놓지 않는다 — 몇 초 만에
                한 개만 나가도 수천 개/시간이 되어 사람을 속인다 */}
            {tp == null ? (
              <span className="text-[10.5px] text-ink4">측정 중…</span>
            ) : (
              <b className="tabular-nums text-ink">{tp.toFixed(1)} 개/시간</b>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink4">재공</span>
            <b className="tabular-nums text-ink">{wip.toLocaleString()} 개</b>
          </div>
          {/**
            * 막힌 설비와 **그 원인**.
            * -----------------------------------------------------------------
            *  예전에는 「병목: 제작기 #1 82%」 한 줄이었다. 그런데 막힌 설비는
            *  피해자다 — 보낼 곳이 없어서 서 있을 뿐이다. 그 한 줄 때문에 멀쩡한
            *  제작기를 붙들고 한참을 헤맸다.
            *
            *  이제 사슬을 편다. **마지막 줄이 손볼 곳**이고, 앞의 것들은 결과다.
            */}
          {neck && (
            <div className="mt-0.5 border-t border-line pt-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-rose-500">
                  {chain?.culprit ? '막힘' : '병목'}
                </span>
                <span
                  className="truncate text-right text-ink2"
                  title={`${neckName} — 전체 시간의 ${(neck.ratio * 100).toFixed(0)}% 를 막혀서 서 있었다`}
                >
                  {neckName} <b className="tabular-nums text-rose-500">{(neck.ratio * 100).toFixed(0)}%</b>
                </span>
              </div>
              {chain?.steps?.slice(1).map((s, i) => (
                <StepRow
                  key={`${s.uid ?? s.name}${i}`}
                  step={s}
                  depth={i}
                  culprit={s === chain.culprit}
                />
              ))}
              {chain?.culprit && (
                <div className="mt-1 rounded bg-rose-500/10 px-1.5 py-1 text-[10.5px] leading-snug text-rose-600 ring-1 ring-rose-500/25">
                  손볼 곳은 <b>{chain.culprit.name}</b> 입니다 — 앞의 것들은 그 결과입니다.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewOptions() {
  const { state, dispatch } = useEditor();
  if (state.view !== VIEW.ISO) return null;
  const on = state.dollhouse;

  return (
    <div className="absolute right-3 top-3 z-10">
      <button
        onClick={() => dispatch({ type: 'SET', patch: { dollhouse: !on } })}
        title={on ? '벽을 모두 세워서 본다' : '보는 쪽 벽을 감춘다'}
        className={`flex items-center gap-1.5 rounded-full bg-float px-3 py-1.5 text-[11.5px] font-medium ring-1 backdrop-blur transition-colors ${
          on ? 'text-sky-500 ring-sky-500/40' : 'text-ink2 ring-edge hover:text-ink'
        }`}
      >
        {on ? <EyeOff size={13} /> : <Eye size={13} />}
        {on ? '앞 벽 감춤' : '벽 모두 표시'}
      </button>
    </div>
  );
}

function StatusBar() {
  const { state } = useEditor();
  const cursor = useCursor();
  const toolName =
    state.tool === TOOL.PLACE ? '배치' : state.tool === TOOL.CONNECT ? '연결' : state.tool === TOOL.ERASE ? '지우개' : '선택';

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-head px-3 text-[10.5px] text-ink4">
      <span className="flex items-center gap-1.5">
        <Crosshair size={11} />
        <b className="text-ink2 tabular-nums">
          X {cursor[0].toFixed(2)} / Z {cursor[1].toFixed(2)}
        </b>
      </span>
      <span className="flex items-center gap-1.5">
        <MousePointer2 size={11} /> {toolName}
      </span>
      <span>스냅 {state.gridSize >= 1 ? `${state.gridSize} m` : `${state.gridSize * 100} cm`}</span>
      <span>{state.snapEdge ? '면 맞춤 ON' : '면 맞춤 OFF'}</span>
      <div className="flex-1" />
      <span>설비 {state.placed.length} · 연결 {state.links.length}</span>
      <span className="text-ink4">자동 저장됨</span>
    </footer>
  );
}

function Shell() {
  usePreloadBuiltins();
  useShortcuts();

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="relative min-w-0 flex-1">
          {/* 씬에서 오류가 나도 화면이 통째로 하얘지지 않도록 */}
          <ErrorBoundary>
            <EditorScene />
          </ErrorBoundary>
          <ModeBanner />
          <ShippedHUD />
          <ViewOptions />
          <ZoneLayers />
          {/* 따라 하기 — 캔버스 안에 둔다. 환영 창이 도면만 가리고 라이브러리
              패널은 그대로 보여야, 창이 가리키는 탭을 바로 찾을 수 있다. */}
          <Tutorial />
          {/* 배치 비교 — 도면을 덮는 창이라 캔버스 안에 둔다 */}
          <Scenarios />
        </main>
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}
