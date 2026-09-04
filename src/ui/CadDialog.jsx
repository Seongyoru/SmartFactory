/**
 * =============================================================================
 *  CAD 도면 반입
 * =============================================================================
 *  실무 도면에는 벽만 있는 게 아니라 치수선·해칭·문자·가구가 전부 들어 있다.
 *  전부 벽으로 만들면 쓸 수 없는 결과가 나오므로 **레이어를 사람이 배정한다.**
 *  자동으로 알아맞히려 하면 도면마다 다르게 틀린다 — 짐작은 초깃값까지다.
 *
 *  고른 즉시 **미리보기**로 보여 준다. 이 반입에는 조용한 실패가 둘 있는데
 *  (축척이 1000배 어긋나는 것, 좌우가 뒤집히는 것) 둘 다 값으로는 그럴듯해
 *  보이고 **그림으로만 드러난다.**
 *
 *  미리보기는 앱의 탑뷰와 **같은 좌표로** 그린다(x → 오른쪽, z → 아래).
 *  다른 방식으로 그리면 미리보기는 멀쩡한데 반입 결과가 뒤집히는, 가장 나쁜
 *  종류의 어긋남이 생긴다.
 * ---------------------------------------------------------------------------
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, X } from 'lucide-react';
import { boundsOf, parseDxf, UNIT_LABEL } from '../core/dxf.js';
import { PAIR_MAX, ROLE, ROLE_LABEL, guessRoles, planOf, planText, scaleFromSpan, scaleOf } from '../core/cad.js';
import { Btn } from './common.jsx';

/** 이보다 큰 파일은 읽는 동안 화면이 멈춘다 — 먼저 알린다 (MB) */
const BIG_MB = 20;

export default function CadDialog({ onClose, onImport }) {
  const fileRef = useRef(null);
  const [name, setName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [roles, setRoles] = useState({});
  const [scale, setScale] = useState(1);
  const [flipY, setFlipY] = useState(true);
  /** 평행한 두 줄을 벽 하나로 볼 최대 두께 (m). 0 이면 안 짝짓는다 */
  const [pair, setPair] = useState(PAIR_MAX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [why, setWhy] = useState(null);

  const take = useCallback(async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.size > BIG_MB * 1024 * 1024) {
        setError(`파일이 ${(file.size / 1048576).toFixed(0)} MB 입니다 — 읽는 동안 잠시 멈출 수 있습니다`);
      }
      const text = await file.text();
      const r = parseDxf(text);
      if (!r.ok) { setParsed(null); setError(r.error); return; }
      const s = scaleOf(r);
      setName(file.name);
      setParsed(r);
      setRoles(guessRoles(r.layers));
      setScale(s.scale);
      setWhy(s.why);
      setFlipY(true);
    } catch (e) {
      setParsed(null);
      setError(`읽지 못했습니다 — ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const plan = useMemo(
    () => (parsed ? planOf(parsed, { roles, scale, flipY, pair }) : null),
    [parsed, roles, scale, flipY, pair],
  );

  /** 가로폭을 사람이 고쳐 넣으면 축척이 따라온다 — 아는 치수 하나로 바로잡는 길 */
  const fixWidth = (meters) => {
    const b = boundsOf(parsed?.entities);
    if (!b) return;
    const next = scaleFromSpan([b.minX, 0], [b.maxX, 0], meters);
    if (next) { setScale(next); setWhy('given'); }
  };

  const done = () => {
    if (plan) onImport(plan);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-6" onClick={onClose}>
      <div
        className="flex max-h-[calc(88vh/var(--z,1))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-head shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">CAD 도면 반입 (DXF)</h2>
          <button onClick={onClose} className="text-ink4 hover:text-ink"><X size={16} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* ---- 파일 고르기 ---- */}
          <div className="flex items-center gap-2">
            <Btn onClick={() => fileRef.current?.click()}>
              <FileUp size={13} /> DXF 파일 고르기
            </Btn>
            <span className="truncate text-xs text-ink4">{busy ? '읽는 중…' : name || '고른 파일 없음'}</span>
            <input
              ref={fileRef}
              type="file"
              accept=".dxf,application/dxf,image/vnd.dxf"
              className="hidden"
              onChange={(e) => take(e.target.files?.[0])}
            />
          </div>

          <p className="text-xs text-ink4">
            <b className="text-ink3">DWG 는 못 읽습니다.</b> 비공개 이진 형식이라 브라우저에서 열 방법이 없습니다.
            CAD 에서 <b className="text-ink3">「다른 이름으로 저장 → DXF」</b> 로 내보낸 뒤 그 파일을 넣어 주세요.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-ink2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <span>{error}</span>
            </div>
          )}

          {parsed?.truncated && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-ink2">
              파일 중간에서 형식이 어긋나 <b>거기까지만</b> 읽었습니다. 도면이 일부만 들어올 수 있습니다.
            </div>
          )}

          {parsed && (
            <>
              {/* ---- 축척 ---- */}
              <section className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold text-ink2">축척</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink3">
                  <span>
                    {why === 'header' && <>도면이 <b className="text-ink">{UNIT_LABEL[parsed.units]}</b> 라고 적어 두었습니다</>}
                    {why === 'guess' && <>단위 표시가 없어 크기로 <b className="text-ink">짐작</b>했습니다</>}
                    {why === 'given' && <>직접 넣은 값입니다</>}
                    {why === 'fallback' && <><b className="text-amber-600">단위를 모르겠습니다</b> — 아래에 실제 가로폭을 넣어 주세요</>}
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-ink3">
                  가로폭이 실제로
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={plan?.size.w ? Number(plan.size.w.toFixed(2)) : ''}
                    onChange={(e) => fixWidth(Number(e.target.value))}
                    className="w-24 rounded border border-line bg-panel px-2 py-1 text-ink"
                  />
                  m 입니다
                </label>
              </section>

              {/* ---- 벽 두께 ---- */}
              <section className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold text-ink2">벽 두께</div>
                <p className="text-xs text-ink4">
                  도면의 벽은 대개 <b className="text-ink3">양쪽 면 두 줄</b>로 그려집니다.
                  그대로 두면 벽이 두 장씩 나란히 섭니다. 아래 값보다 가까운 두 줄은
                  <b className="text-ink3"> 벽 하나로</b> 접고, 잰 간격을 그 벽의 두께로 씁니다.
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-ink3">
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    value={pair}
                    onChange={(e) => setPair(Math.max(0, Number(e.target.value) || 0))}
                    className="w-24 rounded border border-line bg-panel px-2 py-1 text-ink"
                  />
                  m 까지 — <b className="text-ink3">0 이면 접지 않습니다</b>
                </label>
                <p className="mt-1 text-xs text-ink4">
                  {plan?.dropped.paired > 0
                    ? <>두 줄짜리 벽 <b className="text-ink3">{plan.dropped.paired}개</b>를 하나로 접었습니다 — 남은 벽 {plan.walls.length}개</>
                    : <>접힌 것이 없습니다. 벽이 두 겹으로 보이면 이 값을 올려 보세요 — 다만 <b className="text-ink3">사람이 지나다니는 통로까지 메우지 않게</b> 조금씩 올리세요.</>}
                </p>
              </section>

              {/* ---- 레이어 배정 ---- */}
              <section className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs font-semibold text-ink2">
                  레이어 {parsed.layers.length}개 — 무엇으로 가져올까요
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                  {parsed.layers.map((l) => (
                    <div key={l.name} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 truncate font-mono text-ink" title={l.name}>{l.name}</span>
                      <span className="w-40 shrink-0 text-ink4">{countText(l)}</span>
                      <select
                        value={roles[l.name] ?? ROLE.SKIP}
                        onChange={(e) => setRoles((r) => ({ ...r, [l.name]: e.target.value }))}
                        className="flex-1 rounded border border-line bg-panel px-2 py-1 text-ink"
                      >
                        {Object.keys(ROLE).map((k) => (
                          <option key={k} value={k}>{ROLE_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>

              {/* ---- 미리보기 ---- */}
              <section className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink2">미리보기</span>
                  <label className="flex items-center gap-1.5 text-xs text-ink3">
                    <input type="checkbox" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} />
                    위아래 뒤집기
                  </label>
                </div>
                <Preview plan={plan} />
                <div className="mt-2 text-xs text-ink3">{planText(plan)}</div>
                {plan?.marks.length > 0 && (
                  <div className="mt-1 text-xs text-ink4">
                    설비 자리 {plan.marks.length}곳 — {plan.marks.slice(0, 4).map((m) => m.name).join(', ')}
                    {plan.marks.length > 4 ? ' …' : ''}
                    <b className="text-ink3"> (자리만 알려 드립니다 — 설비는 직접 놓아 주세요)</b>
                  </div>
                )}
                {plan?.dropped.merged > 0 && (
                  <div className="mt-1 text-xs text-ink4">
                    같은 자리에 겹쳐 있던 벽 {plan.dropped.merged}개를 한 줄로 합쳤습니다
                  </div>
                )}
                {(plan?.dropped.wall > 0 || plan?.dropped.area > 0) && (
                  <div className="mt-1 text-xs text-ink4">
                    너무 작아 버린 것 — 벽 {plan.dropped.wall} · 바닥 {plan.dropped.area}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="text-xs text-ink4">얹기만 합니다 — 이미 그린 것은 안 지웁니다</span>
          <div className="flex gap-2">
            <Btn onClick={onClose}>취소</Btn>
            <Btn active disabled={!plan || planText(plan).startsWith('가져올')} onClick={done}>
              도면에 얹기
            </Btn>
          </div>
        </footer>
      </div>
    </div>
  );
}

const countText = (l) => {
  const bits = [];
  if (l.lines) bits.push(`선 ${l.lines}`);
  if (l.polys) bits.push(`다각형 ${l.polys}${l.closed ? `(닫힘 ${l.closed})` : ''}`);
  if (l.circles) bits.push(`원 ${l.circles}`);
  if (l.inserts) bits.push(`블록 ${l.inserts}`);
  return bits.join(' · ');
};

/**
 * 2D 윤곽 — 앱의 탑뷰와 **같은 좌표**로 그린다.
 *  SVG 는 y 가 아래로 자라고 탑뷰도 z 가 아래로 자라므로, `z` 를 그대로 `y` 에
 *  넣으면 화면에 보이는 그대로가 반입 결과가 된다.
 */
function Preview({ plan }) {
  const box = useMemo(() => {
    const pts = [];
    for (const w of plan?.walls ?? []) { pts.push(w.a); pts.push(w.b); }
    for (const a of plan?.areas ?? []) for (const ring of a.mp[0]) pts.push(...ring);
    for (const p of plan?.pillars ?? []) pts.push(p.at);
    if (!pts.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    const pad = Math.max(1, (maxX - minX + maxY - minY) * 0.03);
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }, [plan]);

  if (!box) {
    return (
      <div className="grid h-44 place-items-center rounded border border-dashed border-line text-xs text-ink4">
        가져올 레이어를 골라 주세요
      </div>
    );
  }
  const stroke = Math.max(box.w, box.h) / 300;
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="h-44 w-full rounded border border-line bg-panel"
      preserveAspectRatio="xMidYMid meet"
    >
      {plan.areas.map((a, i) => (
        <polygon
          key={`a${i}`}
          points={a.mp[0][0].map(([x, y]) => `${x},${y}`).join(' ')}
          className="fill-sky-500/15 stroke-sky-500/50"
          strokeWidth={stroke}
        />
      ))}
      {plan.walls.map((w, i) => (
        <line
          key={`w${i}`}
          x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]}
          className="stroke-ink2"
          strokeWidth={stroke * 2}
        />
      ))}
      {plan.pillars.map((p, i) => (
        <circle key={`p${i}`} cx={p.at[0]} cy={p.at[1]} r={Math.max(p.r, stroke * 3)} className="fill-ink3" />
      ))}
      {plan.doors.map((d, i) => (
        <circle key={`d${i}`} cx={d.at[0]} cy={d.at[1]} r={stroke * 4} className="fill-amber-500" />
      ))}
      {plan.marks.map((m, i) => (
        <rect
          key={`m${i}`}
          x={m.at[0] - stroke * 4} y={m.at[1] - stroke * 4}
          width={stroke * 8} height={stroke * 8}
          className="fill-none stroke-emerald-500" strokeWidth={stroke}
        />
      ))}
    </svg>
  );
}
