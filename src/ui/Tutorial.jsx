/**
 * =============================================================================
 *  따라 하기 — 처음 여는 사람을 위한 안내
 * =============================================================================
 *  이 편집기에는 화면만 봐서는 알 수 없는 **순서**가 하나 있다.
 *
 *      바닥(영역)을 먼저 그려야 그 위에 설비를 놓을 수 있다.
 *
 *  처음 여는 사람은 대개 기계부터 고른다. 그런데 바닥이 없으면 어디를 눌러도
 *  놓이지 않고, 화면에는 이유가 나오지 않는다 — "이 프로그램은 안 되는구나" 로
 *  끝나기 딱 좋은 자리다. 그래서 순서를 먼저 알려 준다.
 *
 *  ── 왜 슬라이드가 아니라 체크리스트인가 ───────────────────────────────────
 *  안내창을 넘겨 가며 읽어도 닫고 나면 기억해야 할 것이 남는다. 대신 **도면의
 *  상태를 그대로 읽어** 단계를 스스로 체크한다. 바닥을 그리면 1번이 켜지고,
 *  설비를 놓으면 2번이 켜진다. 읽는 것이 아니라 하는 것이고, 어디까지 왔는지가
 *  늘 눈에 보인다. 시키는 말은 **지금 할 단계 하나만** 편다 — 여섯 개를 한꺼번에
 *  펴 놓으면 그것도 결국 읽어야 할 설명서다.
 *
 *  진행도는 저장하지 않는다. 도면을 지우면 체크도 자연히 풀린다 — 그것이 곧
 *  "이 도면에는 아직 그게 없다" 는 사실이기 때문이다. 이 브라우저에 남기는 것은
 *  **환영 창을 이미 봤는가** 하나뿐이다(persistence 의 GUIDE_KEY).
 * ---------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, GraduationCap, X } from 'lucide-react';
import { VIEW, useEditor } from '../core/store.jsx';
import { shippedTotal, useShipped } from '../core/simStore.js';
import { Btn } from './common.jsx';

/**
 * 단계.
 *  done 은 **도면을 보고** 판정한다 — "눌렀는가" 가 아니라 "생겼는가" 다.
 *  버튼을 눌렀는지 세면 실수로 지운 뒤에도 켜진 채로 남아 사실과 어긋난다.
 */
const STEPS = [
  {
    title: '바닥 그리기',
    done: (s) => s.areas.length > 0,
    body: (
      <>
        왼쪽 <b className="text-ink2">작업영역</b> 탭에서 <b className="text-ink2">영역</b>을 고르고
        바닥을 끌어 그리세요. 테두리를 따라 벽이 저절로 섭니다.
        <br />설비는 <b className="text-ink2">바닥 위에만</b> 놓입니다 — 그래서 이것이 첫 단계입니다.
      </>
    ),
  },
  {
    title: '설비 놓기',
    done: (s) => s.placed.length > 0,
    body: (
      <>
        <b className="text-ink2">기계설비</b> 탭에서 항목을 고르고 바닥을 클릭하세요.
        놓기 전에 <kbd className="rounded bg-kbd px-1">R</kbd> 로 90° 돌릴 수 있습니다.
        <br />선반·적치대는 <b className="text-ink2">운송적재</b> 탭에 있습니다.
      </>
    ),
  },
  {
    title: '컨베이어로 잇기',
    done: (s) => s.links.length > 0,
    body: (
      <>
        <b className="text-ink2">연결장치</b> 탭에서 컨베이어를 고른 뒤, 설비의
        <b className="text-orange-500"> 유출부(주황)</b>를 누르고 다음 설비의
        <b className="text-emerald-500"> 유입부(초록)</b>를 누르세요.
        <br />길이와 커브는 두 포트 사이에서 저절로 계산됩니다.
      </>
    ),
  },
  {
    title: '카트 경로 그리기',
    done: (s) => s.carts.length > 0,
    body: (
      <>
        <b className="text-ink2">운송적재</b> 탭에서 카트를 고르고 바닥에 경유점을 찍으세요.
        더블클릭(또는 <kbd className="rounded bg-kbd px-1">Enter</kbd>)으로 끝냅니다.
        <br />선반 앞 <b className="text-ink2">1m</b> 안으로 지나가면 그 자리가 저절로 정차역이 됩니다.
      </>
    ),
  },
  {
    title: '3D 로 보기',
    done: (s) => s.view === VIEW.ISO,
    body: (
      <>
        <kbd className="rounded bg-kbd px-1">Tab</kbd> 또는 툴바의
        <b className="text-ink2"> 3D · 확인</b>을 누르세요. 앞을 가리는 벽은 저절로 감춰집니다.
      </>
    ),
  },
  {
    title: '밖으로 내보내기',
    done: (s, extra) => extra.shipped > 0,
    body: (
      <>
        <b className="text-ink2">작업영역 → 개구부</b>로 벽에 출입구를 뚫고,
        <b className="text-ink2"> 운송적재</b>의 트럭 경로를 그 문 밖까지 그리세요.
        <br />트럭이 문을 지나 나가면 실은 만큼 <b className="text-ink2">왼쪽 위</b>에 쌓입니다.
      </>
    ),
  },
];

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

          <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-ink3">
            <li><b className="text-ink2">작업영역</b> — 바닥·벽·기둥·개구부를 그린다</li>
            <li><b className="text-ink2">기계설비</b> — 클릭 한 번에 한 대</li>
            <li><b className="text-ink2">연결장치</b> — 포트에서 포트로 이으면 길이는 알아서</li>
            <li><b className="text-ink2">운송적재</b> — 선반·적치대, 그리고 카트·트럭 경로</li>
          </ul>

          <p className="text-[11px] leading-relaxed text-ink4">
            여섯 단계를 따라 하면 자재가 도는 도면 하나가 완성됩니다. 하는 대로 저절로
            체크되고, 언제든 툴바의 <GraduationCap size={11} className="inline align-[-1px]" /> 로
            다시 열 수 있습니다.
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

function Checklist({ state, shipped, onClose }) {
  const [folded, setFolded] = useState(false);
  const extra = { shipped };
  const done = STEPS.map((s) => s.done(state, extra));
  const count = done.filter(Boolean).length;
  const allDone = count === STEPS.length;
  /* 시키는 말은 지금 할 단계 하나만 편다 */
  const current = done.findIndex((d) => !d);

  return (
    <div className="absolute bottom-3 left-3 z-10 w-[278px] overflow-hidden rounded-lg border border-line bg-float shadow-lg backdrop-blur">
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
        <button onClick={onClose} title="닫기" className="rounded p-0.5 text-ink4 hover:bg-raiseh hover:text-ink2">
          <X size={13} />
        </button>
      </div>

      {/* 진행 막대 — 숫자보다 먼저 눈에 들어온다 */}
      <div className="h-0.5 w-full bg-kbd">
        <div
          className="h-full bg-sky-500 transition-[width] duration-300"
          style={{ width: `${(count / STEPS.length) * 100}%` }}
        />
      </div>

      {!folded && (
        <div className="max-h-[46vh] overflow-y-auto px-3 py-2">
          <ol className="space-y-1">
            {STEPS.map((step, i) => {
              const isDone = done[i];
              const isNow = i === current;
              return (
                <li key={step.title}>
                  <div className="flex items-start gap-2 py-0.5">
                    <span
                      className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums ${
                        isDone
                          ? 'bg-emerald-500 text-white'
                          : isNow
                            ? 'bg-sky-500 text-white'
                            : 'bg-kbd text-ink4'
                      }`}
                    >
                      {isDone ? <Check size={10} strokeWidth={3.5} /> : i + 1}
                    </span>
                    <span
                      className={`text-[11.5px] leading-5 ${
                        isDone ? 'text-ink4 line-through decoration-ink4/40' : isNow ? 'font-medium text-ink' : 'text-ink3'
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  {isNow && (
                    <p className="mb-1 ml-6 text-[10.5px] leading-relaxed text-ink4">{step.body}</p>
                  )}
                </li>
              );
            })}
          </ol>

          {allDone && (
            <div className="mt-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-ink2 ring-1 ring-emerald-500/25">
              전부 마쳤습니다. 이제 도면을 늘려 가며 어디가 막히는지 보면 됩니다 —
              적치대가 차면 그 앞 공정이 줄줄이 섭니다.
              <div className="mt-2">
                <Btn active onClick={onClose}>닫기</Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */

export default function Tutorial() {
  const { state, dispatch } = useEditor();
  const shipped = shippedTotal(useShipped());

  /* 어디까지 왔는지는 store 가 이 브라우저에 남긴다(EditorProvider 의 효과).
     여기서 저장하지 않는 이유: 툴바에서 열고 닫는 길도 있어서, 저장을 부르는
     자리가 둘이 되면 한쪽을 빠뜨린다. */
  const set = (guide) => dispatch({ type: 'SET', patch: { guide } });
  /* 한 번 닫으면 다음부터는 저절로 뜨지 않는다 — 툴바에서 다시 열 수 있다 */
  const close = () => set(null);

  if (state.guide === 'welcome') {
    return <Welcome onStart={() => set('steps')} onSkip={close} />;
  }
  if (state.guide === 'steps') {
    return <Checklist state={state} shipped={shipped} onClose={close} />;
  }
  return null;
}
