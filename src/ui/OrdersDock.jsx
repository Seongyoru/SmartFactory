/**
 * =============================================================================
 *  생산 오더 — 왼쪽 패널 **아래 절반**의 붙박이
 * =============================================================================
 *  처음에는 인스펙터에 뒀다. 그런데 설비를 하나라도 누르는 순간 진척이 화면에서
 *  사라진다 — 라인을 손보는 동안에도 「지금 몇 개까지 왔고 납기를 맞추는가」 는
 *  계속 보여야 하는 값이다. 그래서 라이브러리 아래에 붙여 두고, 무엇을 고르든
 *  자리를 지킨다.
 *
 *  ── 전부 채워지면 시뮬을 멈춘다 ──────────────────────────────────────────
 *   지금까지는 사람이 눈대중으로 멈췄다. 끝나는 조건이 생겼으니 도구가 멈춘다.
 *   **한 번만** 멈춘다 — 다시 채워질 때마다 되풀이해 멈추면 손을 못 댄다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { arrivedOf, useAllStock, useShipped } from '../core/simStore.js';
import { useElapsed } from '../core/clock.js';
import {
  DEFAULT_ORDER, DONE_AT, ORDER, allDone, formatSpan, normalizeOrders, statusOf,
} from '../core/orders.js';
import { PAYLOAD_ITEMS, isShelf, isStillage } from '../data/library.js';

/** 좁은 칸에 들어가는 숫자 입력 — 스피너를 감춘다(폭을 감당할 수 없다) */
const NUM =
  'w-11 rounded border border-edge bg-field px-1 py-0.5 text-right text-[11px] tabular-nums text-ink '
  + 'outline-none focus:border-sky-500/60 [appearance:textfield] '
  + '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const SEL =
  'min-w-0 flex-1 rounded border border-edge bg-field px-1 py-0.5 text-[11px] text-ink '
  + 'outline-none focus:border-sky-500/60';

export default function OrdersDock() {
  const { state, dispatch, itemOf } = useEditor();
  const elapsed = useElapsed();
  const shipped = useShipped();
  useAllStock();                       // 거쳐 간 수가 바뀌면 다시 그린다
  const stopped = useRef(false);

  const orders = normalizeOrders(state.orders);
  const rows = orders.map((o) => ({ o, r: statusOf(o, { shipped, arrivedOf }, elapsed) }));

  /**
   * 전부 채우면 멈춘다 — 한 번만.
   * -------------------------------------------------------------------------
   *  멈추는 순간 벨트도 카트도 그래프도 전부 얼어붙어서 **페이지가 죽은 것처럼**
   *  보인다. 그래서 「스스로 멈춘 상태」 를 남겨 둔다(`haltedByOrders`) — 왜
   *  멈췄고 어디를 누르면 다시 도는지를 화면이 짚어 줄 수 있어야 한다.
   */
  useEffect(() => {
    const done = allDone(rows.map((x) => x.r));
    if (!done) stopped.current = false;

    if (state.running) {
      /* 다시 돌기 시작했으면 강조를 끈다 — 켠 채로 두면 계속 붉어 보인다 */
      if (state.haltedByOrders) dispatch({ type: 'SET', patch: { haltedByOrders: false } });
      if (done && !stopped.current) {
        stopped.current = true;
        dispatch({
          type: 'SET',
          patch: {
            running: false,
            haltedByOrders: true,
            hint: '오더를 전부 채웠습니다 — 시뮬레이션을 멈췄습니다',
          },
        });
      }
    }
  });

  const stores = state.placed.filter((p) => {
    const it = itemOf(p.itemId);
    return isShelf(it) || isStillage(it);
  });

  const set = (i, patch) =>
    dispatch({ type: 'SET_ORDERS', orders: orders.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const add = () => dispatch({
    type: 'SET_ORDERS',
    orders: [...orders, { ...DEFAULT_ORDER, uid: `O${Date.now().toString(36)}` }],
  });
  const del = (i) => dispatch({ type: 'SET_ORDERS', orders: orders.filter((_, k) => k !== i) });

  const doneCount = rows.filter((x) => x.r.state === ORDER.DONE).length;
  const lateCount = rows.filter((x) => x.r.state === ORDER.LATE).length;

  const halted = state.haltedByOrders && !state.running;

  return (
    <div className={`flex max-h-[46%] min-h-[132px] shrink-0 flex-col border-t transition-colors ${
      halted ? 'border-emerald-500 bg-emerald-500/[0.07]' : 'border-line'
    }`}>
      {/**
        * 멈춘 이유를 **맨 위에서** 말한다.
        *  다 채우면 벨트도 카트도 그래프도 전부 얼어붙어서 화면이 죽은 것처럼
        *  보인다. 「고장이 아니라 끝난 것」 이라는 말과 다시 도는 길이 같이
        *  있어야 사람이 새로고침부터 누르지 않는다.
        */}
      {halted && (
        <div className="shrink-0 bg-emerald-500/15 px-3 py-1.5 text-[10.5px] leading-snug text-emerald-700">
          <b>오더를 전부 채워서 멈췄습니다.</b> 고장이 아닙니다 —
          위쪽 <b>▶</b> 를 누르면 다시 돕니다.
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5" data-guide="dock-orders">
        <span className="text-[11px] font-medium text-ink2">생산 오더</span>
        <span className="text-[10px] tabular-nums text-ink4">
          {orders.length > 0 && (
            <>
              {doneCount}/{orders.length} 완료
              {lateCount > 0 && <b className="ml-1 text-rose-500">{lateCount} 지연</b>}
            </>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {orders.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-ink4">
            오더를 넣으면 <b className="text-ink3">언제 끝나는지</b>와{' '}
            <b className="text-ink3">납기를 맞추는지</b>를 알려 줍니다.
            전부 채워지면 시뮬레이션이 스스로 멈춥니다.
          </p>
        )}

        {rows.map(({ o, r }, i) => {
          const done = r.state === ORDER.DONE;
          const late = r.state === ORDER.LATE;
          return (
            <div key={o.uid} className="mt-1.5 rounded-md border border-edge bg-field px-1.5 py-1 first:mt-0">
              <div className="flex items-center gap-1">
                <select value={o.kind} onChange={(e) => set(i, { kind: e.target.value })} className={SEL}>
                  {/* 라이브러리에 없는 종류가 적혀 있으면 **그것도 보여 준다.**
                      안 넣으면 고르개가 첫 항목으로 보여서, 적힌 것과 보이는 것이
                      달라진다 — 조용히 바꾸지 않으려던 뜻이 화면에서 무너진다. */}
                  {o.unknown && <option value={o.kind}>{o.kind} (모르는 종류)</option>}
                  {Object.entries(PAYLOAD_ITEMS).map(([k, it]) => (
                    <option key={k} value={k}>{it.name}</option>
                  ))}
                </select>
                <input
                  type="number" min="1" value={o.qty} title="목표 수량"
                  onChange={(e) => set(i, { qty: e.target.value })} className={NUM}
                />
                <input
                  type="number" min="0" value={o.dueMin} title="납기 (분) · 0 이면 안 따진다"
                  onChange={(e) => set(i, { dueMin: e.target.value })} className={NUM}
                />
                <span className="shrink-0 text-[10px] text-ink4">분</span>
                <button
                  type="button" onClick={() => del(i)} title="이 오더 삭제"
                  className="shrink-0 rounded p-0.5 text-ink4 hover:bg-raiseh hover:text-rose-500"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {/* 어디를 거쳐 가면 완료인가 — 자리는 **세는 지점**이지 채울 그릇이 아니다 */}
              <select
                value={o.at === DONE_AT.STORE ? (o.atUid ?? '') : DONE_AT.SHIP}
                onChange={(e) => (e.target.value === DONE_AT.SHIP
                  ? set(i, { at: DONE_AT.SHIP, atUid: null })
                  : set(i, { at: DONE_AT.STORE, atUid: e.target.value }))}
                className={`${SEL} mt-1 w-full`}
                title="여기를 거쳐 간 누계로 셉니다 — 쌓인 수가 아닙니다"
              >
                <option value={DONE_AT.SHIP}>출하 — 트럭이 공장 밖으로</option>
                {stores.map((p) => (
                  <option key={p.uid} value={p.uid}>{p.name ?? p.uid} 통과</option>
                ))}
              </select>

              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-edge">
                <div
                  className={`h-full rounded-full ${done ? 'bg-emerald-500' : late ? 'bg-rose-500' : 'bg-sky-500'}`}
                  style={{ width: `${(r.ratio * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="mt-0.5 flex items-baseline justify-between text-[10px] tabular-nums">
                <span className={done ? 'text-emerald-500' : late ? 'text-rose-500' : 'text-ink3'}>
                  {r.done.toLocaleString()} / {o.qty.toLocaleString()}
                </span>
                <span className="text-ink4">{Math.round(r.ratio * 100)}%</span>
              </div>

              {/* 모르는 종류는 **왜 안 차는지**까지 말해 준다. 진척이 0 에 머무는
                  것만 보이면 라인이 잘못됐다고 읽게 된다 — 오더가 잘못된 것이다. */}
              {o.unknown && (
                <p className="mt-1 rounded bg-amber-500/10 px-1.5 py-1 text-[10px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
                  <b>{o.kind}</b> 은(는) 지금 라이브러리에 없는 종류입니다 — 만드는 설비가 없어
                  <b> 영영 안 찹니다.</b> 품목을 지웠거나 이름이 바뀐 도면입니다. 위에서 다시 골라 주세요.
                </p>
              )}

              <p className={`mt-0.5 text-[10px] leading-snug ${late ? 'text-rose-500' : 'text-ink4'}`}>
                {done ? '다 채웠습니다.'
                  : r.state === ORDER.MEASURING ? '속도를 재는 중…'
                  : r.state === ORDER.NO_DUE ? `${formatSpan(r.eta)} 뒤 완료 (${r.rate.toFixed(1)} 개/분)`
                  : late ? `${formatSpan(-r.slackSec)} 늦습니다 · ${r.rate.toFixed(1)} 개/분`
                  : `${formatSpan(r.eta)} 뒤 완료 · 여유 ${formatSpan(r.slackSec)}`}
              </p>
            </div>
          );
        })}

        <button
          type="button"
          onClick={add}
          className="mt-1.5 w-full rounded-md border border-dashed border-edge py-1 text-[11px] text-ink4 hover:border-sky-500/60 hover:text-ink2"
        >
          + 오더 추가
        </button>
      </div>
    </div>
  );
}
