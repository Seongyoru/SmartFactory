/**
 * =============================================================================
 *  따라 하기 — 갈래를 고르고, 한 갈래를 따라간다
 * =============================================================================
 *  처음에는 안내가 **한 줄**이었다. 「바닥 → 설비 → 벨트 → 카트 → 출하」. 그때는
 *  그것이 이 도구의 전부였으니 맞았다.
 *
 *  그 사이 공정 시간·레시피·인력·교대·고장·원가·오더·선반 줄·나눠 쓰기가 붙었다.
 *  **한 줄로 꿸 수 있는 양이 아니고, 꿸 필요도 없다** — 원가를 알고 싶은 사람이
 *  카트 경로부터 배울 이유가 없다. 그래서 갈래로 나누고, 궁금한 것을 고르게 한다.
 *
 *      [환영] → [갈래 고르기] → [한 갈래 따라가기] ⇄ [갈래 고르기]
 *
 *  ── 진행도는 저장하지 않는다 ──────────────────────────────────────────────
 *  도면을 보면 알 수 있고, 따로 적어 두면 도면과 어긋난다. 도면을 지우면 체크도
 *  자연히 풀리는 것이 맞다. 이 브라우저에 남기는 것은 **지금 어느 화면인가**
 *  하나뿐이다(`state.guide`).
 *
 *  ── 내용은 여기 없다 ─────────────────────────────────────────────────────
 *  갈래와 단계는 `core/guides.js` 에, 판정 근거는 `core/guideFacts.js` 에 있다.
 *  둘 다 순수 모듈이라 **node 로 값을 확인할 수 있다** — 「없는 버튼을 가리키는
 *  단계」나 「영원히 안 끝나는 단계」는 화면을 띄우지 않고 잡는 편이 낫다.
 * ---------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, GraduationCap, X } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { subscribeModels } from '../core/modelStore.js';
import { GUIDES, guideById, guideProgress, nextStep } from '../core/guides.js';
import { guideFacts } from '../core/guideFacts.js';
import { shippedTotal, useShipped } from '../core/simStore.js';
import { getRan, useMetrics } from '../core/metrics.js';
import { Btn } from './common.jsx';

/* ── 글 ──────────────────────────────────────────────────────────────────
     본문은 문자열이다(그래야 node 가 읽고 검사한다). `**굵게**` 와 줄바꿈만
     표시로 쓰고, 여기서 그것을 렌더한다 — 마크다운 라이브러리를 들일 만큼
     복잡한 글이 아니다.
--------------------------------------------------------------------------- */
function Rich({ text }) {
  return (
    <>
      {String(text ?? '').split('\n').map((line, li) => (
        <React.Fragment key={li}>
          {li > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
            part.startsWith('**') && part.endsWith('**')
              ? <b key={i} className="text-ink2">{part.slice(2, -2)}</b>
              : <React.Fragment key={i}>{part}</React.Fragment>
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

/* ── 짚어 주기 ───────────────────────────────────────────────────────────
     화면에 **있는 첫 번째**를 가리킨다. 탭을 누르면 표시가 저절로 그 안의
     항목으로 옮겨 간다 — 탭만 계속 가리키면 「탭은 열었는데 이제 뭘?」 에서
     다시 막힌다.
--------------------------------------------------------------------------- */
function Spot({ selectors }) {
  const [box, setBox] = useState(null);
  /* 단계마다 배열을 새로 만들어 넘기므로 배열 자체를 의존성으로 삼으면 매
     렌더 타이머가 새로 걸린다. 내용이 같으면 같은 것으로 본다. */
  const key = (selectors ?? []).join('|');

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
        left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8,
        boxShadow: '0 0 0 3px rgba(56,189,248,0.18), 0 0 14px 2px rgba(56,189,248,0.45)',
      }}
    />
  );
}

/* ── 환영 ────────────────────────────────────────────────────────────── */

function Welcome({ onPick, onSkip }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-app shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
            <GraduationCap size={17} />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-ink">처음 오셨나요?</h2>
            <p className="text-[11px] text-ink4">따라 하면 라인 한 벌이 돕니다</p>
          </div>
        </div>
        <div className="px-5 py-4 text-[12px] leading-relaxed text-ink3">
          이 편집기에는 화면만 봐서는 알 수 없는 <b className="text-ink2">순서</b>가 있습니다 —
          <b className="text-ink2"> 바닥을 먼저 그려야</b> 설비가 놓입니다.
          <br /><br />
          배우고 싶은 것을 <b className="text-ink2">골라서</b> 따라갈 수 있습니다.
          도면 그리기 · 설비 다루기 · 원가 · 인력 · 나눠 쓰기 등 {GUIDES.length}가지가 있습니다.
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Btn onClick={onSkip}>혼자 해볼게요</Btn>
          <Btn active onClick={onPick}>안내 고르기</Btn>
        </div>
      </div>
    </div>
  );
}

/* ── 갈래 고르기 ─────────────────────────────────────────────────────── */

function Picker({ facts, onPick, onClose }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-app shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
              <GraduationCap size={15} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold text-ink">따라 하기</h2>
              {/* 체크가 미리 되어 있으면 「고장인가?」 싶다 — 왜 그런지 먼저 말한다 */}
              <p className="text-[10.5px] text-ink4">
                궁금한 것을 고르세요 · <b className="text-ink3">이미 해 둔 것은 도면에서 읽어 체크됩니다</b>
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-ink2" title="닫기">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {GUIDES.map((g) => {
            const p = guideProgress(g, facts);
            /**
             * 셀 것이 없는 갈래(전부 「해 보기」)는 **「다 했습니다」 가 아니다.**
             *  분모가 0이라 비율이 1로 나오는데, 손도 안 댄 안내가 다 한 것으로
             *  보이면 열어 볼 이유가 사라진다 — 읽는 안내라고 말해 준다.
             */
            const readOnly = p.total === 0;
            const done = !readOnly && p.done === p.total;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onPick(g.id)}
                className="block w-full rounded-lg px-3 py-2 text-left ring-1 ring-edge transition-colors hover:bg-raiseh hover:ring-sky-500"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ink">{g.title}</span>
                  <span className={`shrink-0 text-[10.5px] tabular-nums ${done ? 'text-emerald-600' : 'text-ink4'}`}>
                    {readOnly ? '읽어 보기' : done ? '다 했습니다' : `${p.done}/${p.total}`}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-snug text-ink4">{g.blurb}</p>
                {!readOnly && (
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-kbd">
                    <div
                      className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-sky-500'}`}
                      style={{ width: `${p.ratio * 100}%` }}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── 한 갈래 따라가기 ────────────────────────────────────────────────── */

function Track({ guide, facts, onBack, onClose }) {
  const p = guideProgress(guide, facts);
  const current = nextStep(guide, facts);
  /* 다 끝났으면 마지막을 펴 둔다 — 아무것도 안 펴져 있으면 빈 창처럼 보인다 */
  const openIdx = current >= 0 ? current : guide.steps.length - 1;
  const step = guide.steps[openIdx] ?? null;

  return (
    <>
      {step && <Spot selectors={step.spot} />}
      <div className="pointer-events-auto absolute bottom-4 right-4 z-30 w-[320px] overflow-hidden rounded-xl border border-line bg-app shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" onClick={onBack} className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-ink2" title="다른 안내 고르기">
            <ArrowLeft size={14} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[12px] font-semibold text-ink">{guide.title}</h3>
            <p className="text-[10px] tabular-nums text-ink4">{p.done}/{p.total} 단계</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-ink2" title="닫기">
            <X size={14} />
          </button>
        </div>

        <div className="h-1 w-full bg-kbd">
          <div
            className={`h-full transition-all ${p.done === p.total ? 'bg-emerald-500' : 'bg-sky-500'}`}
            style={{ width: `${p.ratio * 100}%` }}
          />
        </div>

        {/* 먼저 갖춰야 할 것이 있으면 말해 준다 — 「고르고 진행하세요」 같은 것 */}
        {guide.need && current >= 0 && (
          <p className="border-b border-line bg-amber-500/10 px-3 py-1.5 text-[10px] leading-snug text-amber-600">
            <Rich text={guide.need} />
          </p>
        )}

        <ul className="max-h-[42vh] overflow-y-auto py-1">
          {guide.steps.map((s, i) => {
            const ok = s.done(facts);
            const here = i === openIdx;
            return (
              <li key={s.id} className={here ? 'bg-sky-500/[0.07]' : ''}>
                <div className="flex gap-2 px-3 py-1.5">
                  <span
                    className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                      ok ? 'bg-emerald-500 text-white'
                        : here ? 'bg-sky-500 text-white' : 'bg-kbd text-ink4'
                    }`}
                  >
                    {ok ? <Check size={10} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11.5px] ${ok ? 'text-ink4 line-through' : here ? 'font-medium text-ink' : 'text-ink3'}`}>
                      {s.title}
                      {s.optional && <span className="ml-1 text-[9px] text-ink4">해 보기</span>}
                    </div>
                    {here && (
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink3">
                        <Rich text={s.body} />
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {current < 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
            <span className="text-[10.5px] text-emerald-600">이 안내를 다 했습니다</span>
            <Btn onClick={onBack}>다른 안내 보기</Btn>
          </div>
        )}
      </div>
    </>
  );
}

/* ── 모델이 늦게 오면 치수가 바뀐다 — 사실을 다시 센다 ─────────────────── */
function useModelsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

export default function Tutorial() {
  const { state, dispatch, itemOf } = useEditor();
  const shipped = shippedTotal(useShipped());
  const version = useModelsVersion();
  useMetrics();

  const facts = useMemo(
    () => guideFacts({
      placed: state.placed, links: state.links, carts: state.carts,
      areas: state.areas, walls: state.walls, pillars: state.pillars,
      zones: state.zones, openings: state.openings,
      shifts: state.shifts, orders: state.orders, rates: state.rates,
      view: state.view, shipped, ranSec: getRan(),
    }, itemOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.placed, state.links, state.carts, state.areas, state.walls, state.pillars,
      state.zones, state.openings, state.shifts, state.orders, state.rates, state.view,
      itemOf, shipped, version,
    ],
  );

  /* 어디까지 왔는지는 store 가 이 브라우저에 남긴다(EditorProvider 의 효과).
     여기서 저장하지 않는 이유: 툴바에서 열고 닫는 길도 있어서, 저장을 부르는
     자리가 둘이 되면 한쪽을 빠뜨린다. */
  const set = (guide) => dispatch({ type: 'SET', patch: { guide } });

  if (!state.guide) return null;
  if (state.guide === 'welcome') return <Welcome onPick={() => set('pick')} onSkip={() => set(null)} />;
  if (state.guide === 'pick') return <Picker facts={facts} onPick={set} onClose={() => set(null)} />;

  const guide = guideById(state.guide);
  /* 모르는 이름이 남아 있으면(옛 저장값 등) 고르는 화면으로 돌린다 */
  if (!guide) return <Picker facts={facts} onPick={set} onClose={() => set(null)} />;
  return <Track guide={guide} facts={facts} onBack={() => set('pick')} onClose={() => set(null)} />;
}
