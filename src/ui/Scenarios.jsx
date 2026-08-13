/**
 * =============================================================================
 *  시나리오 비교 — 배치를 바꿔 보고 나란히 놓는다
 * =============================================================================
 *  "이 배치가 나은가" 는 혼자서는 답할 수 없다. 무엇과 견주어 나은지가 있어야 한다.
 *
 *  쓰는 흐름은 이렇다.
 *    1. 지금 도면을 「지금 배치 저장」 으로 한 벌 담는다
 *    2. ▶ 로 돌린다 — 지표가 쌓인다
 *    3. 「성적 기록」 을 눌러 지금까지의 결과를 그 시나리오에 박제한다
 *    4. 배치를 고쳐 다시 1~3 을 한다
 *    5. 표에서 나란히 본다. 「불러오기」 로 그때의 도면으로 돌아갈 수 있다
 *
 *  ── 견줄 수 있는 값만 굵게 보여 준다 ──────────────────────────────────────
 *  누적 개수는 오래 돌린 쪽이 무조건 이긴다. 그래서 표의 주인공은 **시간으로 나눈
 *  값**(처리량/시간)과 **비율**(OEE·가동률·성능)이고, 돌린 시간을 함께 적어 둔다.
 *  너무 짧게 돌린 기록에는 경고를 붙인다 — 2분짜리 기록으로 배치를 정하면
 *  숫자에 속는 것이다.
 * ---------------------------------------------------------------------------
 */

import React, { useState } from 'react';
import { Check, Download, GitCompare, Play, Trash2, X } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { useShipped } from '../core/simStore.js';
import { getRan, useMetrics } from '../core/metrics.js';
import { useFaults } from '../core/faults.js';
import { SHORT_RUN, bestOf, captureRun, scenarioCSV } from '../core/scenarios.js';
import { won } from '../core/cost.js';
import { useCostInput } from './useCost.js';
import { formatElapsed } from '../core/clock.js';
import { downloadCSV, downloadJSON, stamp } from '../core/persistence.js';
import { Btn } from './common.jsx';

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(0)}%` : '—');
const num = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '—');

/** 표의 한 칸 — 가장 나은 값이면 도드라지게 */
function Cell({ value, best, children }) {
  const win = typeof value === 'number' && typeof best === 'number' && Math.abs(value - best) < 1e-9;
  return (
    <td className={`px-2 py-1 text-right tabular-nums ${win ? 'font-bold text-emerald-600' : 'text-ink2'}`}>
      {children}
    </td>
  );
}

export default function Scenarios() {
  const { state, dispatch } = useEditor();
  const shipped = useShipped();
  useMetrics();
  useFaults();
  const [name, setName] = useState('');
  const cost = useCostInput();

  if (!state.showScenarios) return null;

  const rows = state.scenarios;
  const ran = getRan();
  const close = () => dispatch({ type: 'SET', patch: { showScenarios: false } });

  /* 지금까지 돌린 성적 — 아직 안 돌렸으면 null */
  /* 원가는 화면이 이미 낸 값 그대로 굳힌다 — 여기서 다시 계산하지 않는다 */
  const current = () => captureRun(state.placed, shipped, cost);

  const best = {
    throughput: bestOf(rows, 'throughput'),
    oee: bestOf(rows, 'oee'),
    availability: bestOf(rows, 'availability'),
    performance: bestOf(rows, 'performance'),
    neck: bestOf(rows, 'neck'),
    costPer: bestOf(rows, 'costPer'),
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-app shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <GitCompare size={15} className="text-sky-500" />
          <h2 className="text-[13px] font-semibold text-ink">배치 비교</h2>
          <span className="text-[11px] text-ink4">{rows.length}벌</span>
          <div className="flex-1" />
          <button onClick={close} className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-ink2" title="닫기">
            <X size={14} />
          </button>
        </div>

        {/* 담기 */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              dispatch({ type: 'SCENARIO_ADD', name, run: current() });
              setName('');
            }}
            placeholder={`배치 ${rows.length + 1}`}
            className="min-w-0 flex-1 rounded-md border border-edge bg-field px-2 py-1.5 text-[11.5px] text-ink outline-none placeholder:text-ink4"
          />
          <Btn
            active
            onClick={() => { dispatch({ type: 'SCENARIO_ADD', name, run: current() }); setName(''); }}
          >
            지금 배치 저장
          </Btn>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11.5px] leading-relaxed text-ink4">
              아직 담아 둔 배치가 없습니다.
              <br />도면을 하나 만들고 ▶ 로 돌린 뒤 <b className="text-ink2">지금 배치 저장</b>을 누르세요.
              <br />배치를 고쳐 다시 담으면 여기서 나란히 견줍니다.
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-panel text-[10.5px] text-ink4">
                <tr className="border-b border-line">
                  <th className="px-2 py-1.5 text-left font-medium">배치</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="시간으로 나눈 값이라 돌린 길이가 달라도 견줄 수 있다">처리량 /시간</th>
                  <th className="px-2 py-1.5 text-right font-medium">OEE</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="고장으로 못 돈 시간을 뺀 비율">가동률</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="막혀서 못 돈 시간을 뺀 비율 — 배치로 푼다">성능</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="처리량과 반대로 움직일 수 있다 — 설비를 잔뜩 깔아 처리량만 올린 배치가 여기서 진다">개당 원가</th>
                  <th className="px-2 py-1.5 text-left font-medium">병목</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const r = s.run;
                  const short = r && r.ran < SHORT_RUN;
                  return (
                    <tr key={s.uid} className="border-b border-line/60 hover:bg-raise">
                      <td className="px-2 py-1.5">
                        <input
                          value={s.name}
                          onChange={(e) => dispatch({ type: 'SCENARIO_RENAME', uid: s.uid, name: e.target.value })}
                          className="w-full min-w-0 bg-transparent text-[11px] font-medium text-ink outline-none"
                        />
                        <div className="text-[10px] text-ink4">
                          {r ? (
                            <>
                              {formatElapsed(r.ran)} 돌림 · 설비 {r.equips}대
                              {short && <span className="ml-1 text-amber-600" title="짧게 돌린 기록은 우연이 섞인다">· 너무 짧음</span>}
                            </>
                          ) : (
                            <span className="text-amber-600">아직 안 돌림</span>
                          )}
                        </div>
                      </td>
                      <Cell value={r?.throughput} best={best.throughput}>{num(r?.throughput)}</Cell>
                      <Cell value={r?.oee} best={best.oee}>{pct(r?.oee)}</Cell>
                      <Cell value={r?.availability} best={best.availability}>{pct(r?.availability)}</Cell>
                      <Cell value={r?.performance} best={best.performance}>{pct(r?.performance)}</Cell>
                      <Cell value={r?.cost?.per} best={best.costPer}>{r?.cost?.per == null ? "—" : won(r.cost.per)}</Cell>
                      <td className="px-2 py-1.5 text-ink2">
                        {r?.neck ? (
                          <span title={`${r.neck.name} — 전체 시간의 ${(r.neck.ratio * 100).toFixed(0)}% 를 막혀서 서 있었다`}>
                            <span className="truncate">{r.neck.name}</span>{' '}
                            <b className={best.neck === r.neck.ratio ? 'text-emerald-600' : 'text-rose-500'}>
                              {pct(r.neck.ratio)}
                            </b>
                          </span>
                        ) : (
                          <span className="text-ink4">없음</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <button
                          onClick={() => dispatch({ type: 'SCENARIO_RECORD', uid: s.uid, run: current() })}
                          disabled={ran <= 0}
                          title={ran > 0 ? '지금까지 돌린 성적을 이 배치에 기록한다 (도면도 지금 것으로 갱신)' : '먼저 ▶ 로 돌려야 기록할 것이 생긴다'}
                          className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => {
                            dispatch({ type: 'LOAD_LAYOUT', data: s.layout });
                            dispatch({ type: 'SET', patch: { showScenarios: false } });
                          }}
                          title="이 배치의 도면을 불러온다 (지금 도면은 덮어쓴다)"
                          className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-sky-500"
                        >
                          <Play size={13} />
                        </button>
                        <button
                          onClick={() => dispatch({ type: 'SCENARIO_DELETE', uid: s.uid })}
                          title="이 배치를 목록에서 지운다"
                          className="rounded p-1 text-ink4 hover:bg-raiseh hover:text-rose-500"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <p className="flex-1 text-[10.5px] leading-relaxed text-ink4">
            <b className="text-ink2">처리량</b>과 비율은 돌린 길이가 달라도 견줄 수 있습니다.
            누적 개수는 오래 돌린 쪽이 이기므로 표에 두지 않았습니다.
          </p>
          {/* CSV 와 JSON 을 나란히 둔다 — 하는 일이 다르다.
              CSV 는 **밖으로 들고 나가는** 것(보고서·엑셀 그래프),
              JSON 은 **이 도구가 다시 읽는** 것(도면까지 통째로 들어 있다). */}
          {rows.length > 0 && (
            <>
              <Btn
                onClick={() => downloadCSV(scenarioCSV(rows), `배치비교-${stamp()}.csv`)}
                title="엑셀·보고서용. 화면의 표와 같은 값을 반올림 없이 담는다"
              >
                <Download size={13} /> CSV
              </Btn>
              <Btn
                onClick={() => downloadJSON(
                  rows.map(({ name: n, at, run }) => ({ name: n, at, ...run })),
                  `배치비교-${stamp()}.json`,
                )}
                title="이 도구가 다시 읽는 형식"
              >
                <Download size={13} /> JSON
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
