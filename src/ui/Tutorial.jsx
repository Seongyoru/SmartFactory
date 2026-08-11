/**
 * =============================================================================
 *  따라 하기 — 처음 여는 사람을 위한 안내
 * =============================================================================
 *  이 편집기에는 화면만 봐서는 알 수 없는 **순서**가 있다.
 *
 *      바닥 → 설비 → 적치대 → 컨베이어 → 선반 → 카트 경로 → 출하
 *
 *  자재가 흐르는 길 그대로다. 앞의 것이 없으면 뒤의 것이 성립하지 않는다 —
 *  바닥이 없으면 설비를 놓을 수 없고, 적치대가 없으면 벨트가 갈 곳이 없고,
 *  적치대와 선반이 없으면 카트 경로를 그려도 **아무 일도 일어나지 않는다.**
 *
 *  ── 왜 "놓았는가" 가 아니라 "이어졌는가" 를 보는가 ────────────────────────
 *  처음에는 개수만 셌다(설비 하나 · 연결 하나 · 카트 하나). 그랬더니 설비 한 대에
 *  컨베이어만 물려도 다음 단계로 넘어갔고, 정작 카트 차례에는 실을 곳도 내릴 곳도
 *  없어 경로를 그려도 아무 반응이 없었다 — **틀린 것을 맞다고 말하는 안내**였다.
 *  그래서 지금은 벨트가 적치대에 닿았는지, 카트 경로가 싣는 곳과 내리는 곳을
 *  실제로 잡았는지까지 본다. 못 잡았으면 그 이유를 그 자리에서 알려 준다.
 *
 *  ── 진행도는 저장하지 않는다 ──────────────────────────────────────────────
 *  도면을 보면 알 수 있고, 따로 적어 두면 도면과 어긋난다. 도면을 지우면 체크도
 *  자연히 풀리는 것이 맞다. 이 브라우저에 남기는 것은 어디까지 왔는가 하나뿐이다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GraduationCap, X } from 'lucide-react';
import { VIEW, useEditor } from '../core/store.jsx';
import { subscribeModels } from '../core/modelStore.js';
import { cartPath, cartStations } from '../core/cart.js';
import { CATEGORY, isShelf, isStillage, isTruck } from '../data/library.js';
import { shippedTotal, useShipped } from '../core/simStore.js';
import { Btn } from './common.jsx';

/**
 * 단계.
 *  done 은 **도면을 보고** 판정한다 — "눌렀는가" 가 아니라 "이루어졌는가" 다.
 *
 *  spot 은 지금 눌러야 할 곳을 **손이 가는 순서대로** 적는다. 화면에 있는 첫
 *  번째를 가리키므로, 탭을 누르면 표시가 저절로 그 안의 항목으로 옮겨 간다 —
 *  탭만 계속 가리키고 있으면 "탭은 열었는데 이제 뭘?" 에서 다시 막힌다.
 */
const STEPS = [
  {
    title: '바닥 그리기',
    spot: () => ['[data-guide="tool-area"]', '[data-guide="tab-build"]'],
    done: (f) => f.areas > 0,
    body: () => (
      <>
        <b className="text-ink2">작업영역</b> 탭의 <b className="text-ink2">영역</b>을 고르고 바닥을
        끌어 그리세요. 테두리를 따라 벽이 저절로 섭니다.
        <br />설비는 <b className="text-ink2">바닥 위에만</b> 놓입니다 — 그래서 이것이 첫 단계입니다.
      </>
    ),
  },
  {
    title: '설비 놓기',
    spot: () => ['[data-guide="item-MACHINE_1"]', '[data-guide="tab-equipment"]'],
    done: (f) => f.equip > 0,
    body: () => (
      <>
        <b className="text-ink2">기계설비</b> 탭에서 Machine 을 고르고 바닥을 클릭하세요.
        놓기 전에 <kbd className="rounded bg-kbd px-1">R</kbd> 로 90° 돌릴 수 있습니다.
        <br />자재를 만들어 내보내는 쪽입니다.
      </>
    ),
  },
  {
    title: '적치대 놓기',
    spot: () => ['[data-guide="item-STILLAGE"]', '[data-guide="tab-logistics"]'],
    done: (f) => f.stillage > 0,
    body: () => (
      <>
        <b className="text-ink2">운송적재</b> 탭에서 <b className="text-ink2">스틸리지(적치대)</b>를
        골라 설비 옆에 놓으세요.
        <br />벨트가 <b className="text-ink2">도착할 곳</b>입니다. 이것이 없으면 다음 단계에서
        컨베이어를 이을 데가 없습니다.
      </>
    ),
  },
  {
    title: '컨베이어로 잇기',
    spot: () => ['[data-guide="item-CONVEYOR"]', '[data-guide="tab-connector"]'],
    done: (f) => f.beltToStillage,
    body: (f) => (
      <>
        <b className="text-ink2">연결장치</b> 탭에서 컨베이어를 고른 뒤, 설비의
        <b className="text-orange-500"> 유출부(주황)</b>를 누르고 적치대의
        <b className="text-emerald-500"> 유입부(초록)</b>를 누르세요.
        {f.links > 0 && (
          <>
            <br />
            <span className="text-amber-600">
              컨베이어는 이었지만 아직 <b>적치대까지</b> 닿지 않았습니다. 끝이 적치대여야
              자재가 쌓이고, 그래야 카트가 실어 갈 것이 생깁니다.
            </span>
          </>
        )}
      </>
    ),
  },
  {
    title: '선반 놓기',
    spot: () => ['[data-guide="item-SHELF"]', '[data-guide="tab-logistics"]'],
    done: (f) => f.shelf > 0,
    body: () => (
      <>
        <b className="text-ink2">운송적재</b> 탭에서 <b className="text-ink2">선반(랙)</b>을 골라
        조금 떨어진 자리에 놓으세요.
        <br />카트가 적치대에서 실어다 <b className="text-ink2">내려놓을 곳</b>입니다.
      </>
    ),
  },
  {
    title: '카트 경로 그리기',
    spot: () => ['[data-guide="item-CART"]', '[data-guide="tab-logistics"]'],
    done: (f) => f.cartLinked > 0,
    body: (f) => (
      <>
        <b className="text-ink2">운송적재</b> 탭에서 카트를 고르고, <b className="text-ink2">적치대
        앞과 선반 앞을 지나가도록</b> 바닥에 경유점을 찍으세요. 더블클릭(또는
        <kbd className="mx-0.5 rounded bg-kbd px-1">Enter</kbd>)으로 끝냅니다.
        {f.carts === 0 ? (
          <><br />적치대에서 싣고 선반에 내리는 한 바퀴가 되면 됩니다.</>
        ) : f.cartWithStations === 0 ? (
          <>
            <br />
            <span className="text-amber-600">
              카트는 있지만 <b>정차역이 하나도 안 잡혔습니다.</b> 경로가 적치대·선반의
              <b> 앞면에서 1m</b> 안으로 지나가야 그 자리가 정차역이 됩니다. 카트를 골라
              경유점을 끌어 더 가까이 붙여 보세요.
            </span>
          </>
        ) : (
          <>
            <br />
            <span className="text-amber-600">
              정차역이 잡혔지만 아직 <b>싣는 곳과 내리는 곳이 둘 다</b> 있지는 않습니다.
              적치대(싣기)와 선반(내리기)을 모두 지나가야 자재가 실제로 옮겨집니다.
            </span>
          </>
        )}
      </>
    ),
  },
  {
    title: '밖으로 내보내기',
    spot: (f) => (f.openings === 0
      ? ['[data-guide="tool-opening"]', '[data-guide="tab-build"]']
      : ['[data-guide="item-TRUCK"]', '[data-guide="tab-logistics"]']),
    done: (f) => f.shipped > 0,
    body: () => (
      <>
        <b className="text-ink2">작업영역 → 개구부</b>로 벽에 출입구를 뚫은 다음,
        <b className="text-ink2"> 운송적재</b>의 <b className="text-ink2">출하 트럭</b>을 고르세요.
        <br />경로는 <b className="text-ink2">건물 밖에서 시작해</b> 문으로 들어와 선반 앞을
        지나고, <b className="text-ink2">다시 문 밖으로</b> 나가게 찍습니다.
        <br />트럭은 문을 지나 밖으로 나가는 순간 출하합니다 — 안에서만 도는 경로면 실은
        채로 계속 돌기만 합니다. 나간 만큼 <b className="text-ink2">왼쪽 위</b>에 쌓입니다.
      </>
    ),
  },
];

/* ── 지금 눌러야 할 곳 표시 ─────────────────────────────────────────────── */

/**
 * 가리키는 자리에 테두리를 씌워 깜빡인다.
 * ---------------------------------------------------------------------------
 *  화면을 통째로 어둡게 덮지 않는다. 이 안내는 **그리는 동안에도 계속 떠 있는데**,
 *  바닥을 끄는 내내 도면이 어두우면 정작 그리는 것이 안 보인다. 눌러야 할 곳만
 *  밝게 두르는 편이 방해가 없다.
 *
 *  자리는 주기적으로 다시 잰다 — 탭을 바꾸거나 창을 줄이면 버튼이 움직이는데,
 *  그때마다 테두리가 따라와야 한다. 값이 실제로 달라졌을 때만 다시 그린다.
 */
function Spot({ selectors }) {
  const [box, setBox] = useState(null);
  /* 단계마다 목록을 새로 만들어 넘기므로 배열 자체를 의존성으로 삼으면 매 렌더
     타이머가 새로 걸린다. 내용이 같으면 같은 것으로 본다. */
  const key = selectors.join('|');

  useEffect(() => {
    const list = key.split('|').filter(Boolean);
    if (!list.length) { setBox(null); return undefined; }
    const measure = () => {
      const el = list.map((s) => document.querySelector(s)).find(Boolean);
      const r = el?.getBoundingClientRect();
      const next = r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      setBox((prev) => {
        if (!prev && !next) return prev;
        if (prev && next && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h) return prev;
        return next;
      });
    };
    measure();
    const t = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); };
  }, [key]);

  if (!box) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-40 animate-pulse rounded-lg ring-2 ring-sky-400"
      style={{
        left: box.x - 4,
        top: box.y - 4,
        width: box.w + 8,
        height: box.h + 8,
        boxShadow: '0 0 0 3px rgba(56,189,248,0.18), 0 0 14px 2px rgba(56,189,248,0.45)',
      }}
    />
  );
}

/* ── 환영 창 ────────────────────────────────────────────────────────────── */

function Welcome({ onStart, onSkip }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-line bg-app shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
            <GraduationCap size={17} />
          </span>
          <div>
            <h2 className="text-[13.5px] font-semibold text-ink">EGIS Smart Factory</h2>
            <p className="text-[11px] text-ink4">공장 도면을 그리고 물류를 돌려 봅니다</p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          {/* 이 한 줄이 이 창의 존재 이유다 */}
          <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink2 ring-1 ring-amber-500/25">
            먼저 <b className="text-ink">바닥(영역)</b>을 그리세요. 설비는 바닥 위에만 놓입니다 —
            바닥이 없으면 어디를 눌러도 놓이지 않습니다.
          </p>

          <p className="text-[11.5px] leading-relaxed text-ink3">
            자재가 흐르는 길을 그대로 따라갑니다.
          </p>
          <p className="rounded-lg bg-raise px-3 py-2 text-center text-[11px] leading-relaxed text-ink2 ring-1 ring-edge">
            작업영역 → 설비 → 컨베이어 → <b className="text-ink">적치대</b>
            <br />→ 카트 경로 → <b className="text-ink">선반</b> → 출하
          </p>

          <p className="text-[11px] leading-relaxed text-ink4">
            일곱 단계를 마치면 자재가 스스로 도는 도면 하나가 완성됩니다. 하는 대로 저절로
            체크되고, 지금 눌러야 할 곳은 <span className="text-sky-500">파란 테두리</span>로
            깜빡입니다. 언제든 툴바의
            <GraduationCap size={11} className="mx-0.5 inline align-[-1px]" /> 로 다시 열 수 있습니다.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Btn onClick={onSkip}>혼자 해볼게요</Btn>
          <Btn active onClick={onStart}>따라 하며 시작하기</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── 체크리스트 ─────────────────────────────────────────────────────────── */

function Checklist({ facts, canClose, onClose }) {
  const [folded, setFolded] = useState(false);
  const done = STEPS.map((s) => s.done(facts));
  const count = done.filter(Boolean).length;
  const allDone = count === STEPS.length;
  /* 시키는 말도, 가리키는 곳도 **지금 할 단계 하나만** */
  const current = done.findIndex((d) => !d);
  const step = current >= 0 ? STEPS[current] : null;

  /* 3D 를 한 번 보기 전에는 닫지 못한다.
     탑뷰만 보고 끄면 이 편집기가 **도면이자 3D 모형**이라는 것을 모른 채 끝난다.
     한 번 보고 나면 계속 열려 있고, 탑뷰로 돌아가도 다시 잠기지 않는다. */
  const closeBtn = (label) => (
    <button
      onClick={canClose ? onClose : undefined}
      disabled={!canClose}
      title={canClose ? '닫기' : '3D 로 한 번 본 뒤에 닫을 수 있습니다 (Tab 또는 툴바의 3D · 확인)'}
      className={
        label
          ? `rounded-md px-2.5 py-1.5 text-xs font-medium ${
            canClose ? 'bg-sky-500 text-white' : 'cursor-not-allowed bg-kbd text-ink4'
          }`
          : `rounded p-0.5 ${
            canClose ? 'text-ink4 hover:bg-raiseh hover:text-ink2' : 'cursor-not-allowed text-ink4/40'
          }`
      }
    >
      {label ?? <X size={13} />}
    </button>
  );

  return (
    <>
      {!folded && step && <Spot selectors={step.spot(facts)} />}

      <div className="absolute bottom-3 left-3 z-10 w-[286px] overflow-hidden rounded-lg border border-line bg-float shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <GraduationCap size={13} className="shrink-0 text-sky-500" />
          <span className="text-[11.5px] font-medium text-ink">따라 하기</span>
          <span className="tabular-nums text-[11px] text-ink4">{count}/{STEPS.length}</span>
          <div className="flex-1" />
          <button
            onClick={() => setFolded((v) => !v)}
            title={folded ? '펼치기' : '접기'}
            className="rounded p-0.5 text-ink4 hover:bg-raiseh hover:text-ink2"
          >
            {folded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {closeBtn(null)}
        </div>

        {/* 진행 막대 — 숫자보다 먼저 눈에 들어온다 */}
        <div className="h-0.5 w-full bg-kbd">
          <div
            className="h-full bg-sky-500 transition-[width] duration-300"
            style={{ width: `${(count / STEPS.length) * 100}%` }}
          />
        </div>

        {!folded && (
          <div className="max-h-[48vh] overflow-y-auto px-3 py-2">
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const isDone = done[i];
                const isNow = i === current;
                return (
                  <li key={s.title}>
                    <div className="flex items-start gap-2 py-0.5">
                      <span
                        className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums ${
                          isDone ? 'bg-emerald-500 text-white' : isNow ? 'bg-sky-500 text-white' : 'bg-kbd text-ink4'
                        }`}
                      >
                        {isDone ? <Check size={10} strokeWidth={3.5} /> : i + 1}
                      </span>
                      <span
                        className={`text-[11.5px] leading-5 ${
                          isDone ? 'text-ink4 line-through decoration-ink4/40' : isNow ? 'font-medium text-ink' : 'text-ink3'
                        }`}
                      >
                        {s.title}
                      </span>
                    </div>
                    {isNow && <p className="mb-1 ml-6 text-[10.5px] leading-relaxed text-ink4">{s.body(facts)}</p>}
                  </li>
                );
              })}
            </ol>

            {allDone && (
              <div className="mt-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-ink2 ring-1 ring-emerald-500/25">
                전부 마쳤습니다. 이제 도면을 늘려 가며 어디가 막히는지 지켜보세요 —
                적치대가 차면 그 앞 공정이 줄줄이 섭니다.
                <div className="mt-2">{closeBtn('닫기')}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ========================================================================== */

/** 모델 캐시가 갱신되면 다시 잰다 — 정차역 판정이 모델 치수를 본다 */
function useModelsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

export default function Tutorial() {
  const { state, dispatch, itemOf } = useEditor();
  const shipped = shippedTotal(useShipped());
  const version = useModelsVersion();

  /**
   * 도면에서 읽어 낸 사실들.
   *  단계마다 이걸 보고 판정한다. 카트는 **경로가 실제로 역을 잡았는지**까지 본다 —
   *  경로를 그렸다는 것만으로는 자재가 오간다고 말할 수 없기 때문이다.
   */
  const facts = useMemo(() => {
    const kindOf = (p) => itemOf(p.itemId);
    const equip = state.placed.filter((p) => kindOf(p)?.category === CATEGORY.EQUIPMENT).length;
    const stillage = state.placed.filter((p) => isStillage(kindOf(p))).length;
    const shelf = state.placed.filter((p) => isShelf(kindOf(p))).length;

    /* 벨트의 끝이 적치대인가 — 자재가 쌓일 곳에 닿아야 그 다음이 성립한다 */
    const beltToStillage = state.links.some((l) =>
      isStillage(itemOf(state.placed.find((p) => p.uid === l.to?.uid)?.itemId)),
    );

    let carts = 0;
    let cartWithStations = 0;
    let cartLinked = 0;
    for (const c of state.carts) {
      if (isTruck(itemOf(c.itemId))) continue;      // 트럭은 마지막 단계에서 본다
      carts++;
      const path = cartPath(c);
      if (!path) continue;
      const st = cartStations(path, state.placed, itemOf, { roles: c.roles });
      if (st.length) cartWithStations++;
      const takes = st.some((x) => x.kind === 'shelf-out' || x.kind === 'load');
      const gives = st.some((x) => x.kind === 'shelf-in' || x.kind === 'unload');
      if (takes && gives) cartLinked++;
    }

    return {
      areas: state.areas.length,
      equip, stillage, shelf, beltToStillage,
      links: state.links.length,
      openings: state.openings.length,
      carts, cartWithStations, cartLinked,
      shipped,
      view: state.view,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.areas, state.placed, state.links, state.carts, state.openings, state.view, itemOf, shipped, version]);

  /* 어디까지 왔는지는 store 가 이 브라우저에 남긴다(EditorProvider 의 효과).
     여기서 저장하지 않는 이유: 툴바에서 열고 닫는 길도 있어서, 저장을 부르는
     자리가 둘이 되면 한쪽을 빠뜨린다. */
  const set = (guide) => dispatch({ type: 'SET', patch: { guide } });
  const close = () => set(null);

  /* 3D 를 한 번이라도 봤는가 — 보고 나면 탑뷰로 돌아와도 다시 잠기지 않는다.
     "지금 3D 인가" 로 두면 도면을 그리러 탑뷰로 온 순간 다시 못 닫게 된다. */
  const [seenIso, setSeenIso] = useState(state.view === VIEW.ISO);
  useEffect(() => {
    if (state.view === VIEW.ISO) setSeenIso(true);
  }, [state.view]);

  if (state.guide === 'welcome') return <Welcome onStart={() => set('steps')} onSkip={close} />;
  if (state.guide === 'steps') return <Checklist facts={facts} canClose={seenIso} onClose={close} />;
  return null;
}
