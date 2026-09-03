/**
 * 상단 툴바 — 뷰 전환 · 도구 · 스냅 설정 · 저장
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eraser,
  Eye,
  EyeOff,
  GitCompare,
  DraftingCompass,
  GraduationCap,
  Copy,
  Grid3x3,
  Library,
  Magnet,
  Moon,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCw,
  Ruler,
  Share2,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { SPEEDS, formatElapsed, setSpeed, useElapsed, useSimSpeed } from '../core/clock.js';
import { resetRun } from '../core/sim.js';
import { resetMetrics } from '../core/metrics.js';
import { TOOL, VIEW, useEditor } from '../core/store.jsx';
import { GRID_SIZES } from '../core/grid.js';
import { downloadJSON, layoutSnapshot } from '../core/persistence.js';
import { loadGalleryIndex, loadGalleryLayout } from '../core/gallery.js';
import { SHARE_OFF, copyText, fetchShared, listShared, shareLayout } from '../core/share.js';
import { layoutSummary, layoutThumbSVG } from '../core/thumb.js';
import { layoutInfo } from '../core/layoutInfo.js';
import { PAYLOAD_ITEMS } from '../data/library.js';
import { Btn, IconBtn } from './common.jsx';
import CadDialog from './CadDialog.jsx';

const kb = (n) => (n > 0 ? `${(n / 1024).toFixed(1)} KB` : '');
const when = (at) => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
};

/**
 * 도면 카드 하나 — 그림 · 이름 · 언제 · 얼마나.
 *  이름만 늘어놓으면 「어느 도면이었더라」 가 된다. **위에서 본 미니맵**이
 *  한 장 있으면 라인 모양으로 바로 갈린다(core/thumb.js — 화면 캡처가 아니라
 *  도면 데이터로 그린 것이라 언제 봐도 같은 그림이다).
 */
function LayoutCard({ row, selected, disabled, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className={`flex w-full items-stretch gap-3 rounded-lg p-2 text-left ring-1 transition-colors disabled:opacity-50 ${
        selected ? 'bg-sky-500/10 ring-sky-500' : 'ring-edge hover:bg-raiseh'
      }`}
    >
      {/* 그림이 왼쪽 — 목록을 훑을 때 눈이 먼저 잡는 것이 모양이다 */}
      <div className="aspect-[16/9] w-[132px] shrink-0 overflow-hidden rounded bg-field ring-1 ring-edge">
        {row.thumb
          ? <img src={row.thumb} alt="" className="h-full w-full object-cover" />
          : <div className="grid h-full place-items-center text-[10px] text-ink4">미리보기 없음</div>}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-0.5">
        <div className="truncate text-[12.5px] font-medium text-ink">{row.name}</div>
        {/* 설명은 **두 줄까지** 보인다 — 한 줄로 자르면 「테스트 도면입니다. 안녕
            하세요 이 텍스트는…」 처럼 정작 무엇을 시험한 배치인지가 잘려 나간다.
            그렇다고 다 펴면 카드 높이가 제각각이 되어 목록이 훑어지지 않는다. */}
        {(row.note || row.summary) && (
          <div className="line-clamp-2 text-[10.5px] leading-snug text-ink3">{row.note || row.summary}</div>
        )}
        <div className="text-[10px] tabular-nums text-ink4">
          {[
            row.from === 'share' ? '올라온 도면' : '저장소',
            when(row.at),
            kb(row.size),
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
    </button>
  );
}

const InfoRow = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-2 py-[1px]">
    <span className="shrink-0 text-[10px] text-ink4">{label}</span>
    <span className="truncate text-right text-[10.5px] tabular-nums text-ink2">{children}</span>
  </div>
);
const InfoHead = ({ children }) => (
  <h4 className="mb-0.5 mt-2.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink4 first:mt-0">{children}</h4>
);

/**
 * 고른 도면의 **속** — 열지 않고도 무엇인지 알게.
 * ---------------------------------------------------------------------------
 *  여는 순간 지금 그리던 것이 덮이므로, 「열어 보고 아니면 되돌리기」 는 값이
 *  비싸다. 그래서 열기 전에 편다 — 규모 · 건물 · 설비 구성 · 오더 · 인력 · 단가.
 *
 *  **시뮬을 돌려야 나오는 값(처리량·가동률·원가)은 여기 없다.** 도면만 보고
 *  알 수 있는 것이 아니고, 있는 척하면 그게 더 나쁘다.
 */
function LayoutDetail({ row, data, error }) {
  const { itemOf } = useEditor();
  const info = useMemo(() => (data ? layoutInfo(data, itemOf) : null), [data, itemOf]);

  if (error) return <p className="p-3 text-[10.5px] leading-snug text-rose-500">{error}</p>;
  if (!info) return <p className="p-3 text-[10.5px] text-ink4">읽는 중…</p>;

  const { scale: s, building: b, crew } = info;
  return (
    <div className="p-3">
      <div className="aspect-[16/9] w-full overflow-hidden rounded bg-field ring-1 ring-edge">
        {row.thumb
          ? <img src={row.thumb} alt="" className="h-full w-full object-cover" />
          : <div className="grid h-full place-items-center text-[10px] text-ink4">미리보기 없음</div>}
      </div>
      <h3 className="mt-2 text-[12.5px] font-semibold leading-snug text-ink">{row.name}</h3>
      {(row.note) && <p className="mt-0.5 text-[10.5px] leading-snug text-ink3">{row.note}</p>}

      <InfoHead>규모</InfoHead>
      <InfoRow label="설비">{s.machines} 대</InfoRow>
      <InfoRow label="쌓는 곳">{s.stores} 개 (선반·적치대)</InfoRow>
      <InfoRow label="연결장치">{s.links} 개</InfoRow>
      <InfoRow label="차량">
        {s.vehicles} 대 / 경로 {s.paths}{s.trucks > 0 ? ` · 트럭 ${s.trucks}` : ''}
      </InfoRow>

      <InfoHead>건물</InfoHead>
      <InfoRow label="바닥">{Math.round(b.floor).toLocaleString()} m²</InfoRow>
      <InfoRow label="벽 · 기둥">{b.walls} · {b.pillars}</InfoRow>
      <InfoRow label="구역 · 개구부">{b.zones} · {b.openings}</InfoRow>

      {info.kinds.length > 0 && (
        <>
          <InfoHead>설비 구성</InfoHead>
          {info.kinds.slice(0, 6).map((k) => <InfoRow key={k.id} label={k.name}>{k.n} 대</InfoRow>)}
          {info.kinds.length > 6 && (
            <p className="text-[9.5px] text-ink4">외 {info.kinds.length - 6}종</p>
          )}
        </>
      )}

      <InfoHead>생산 오더</InfoHead>
      {info.orders.length ? info.orders.map((o, i) => (
        <InfoRow key={i} label={PAYLOAD_ITEMS[o.kind]?.name ?? o.kind}>
          {o.qty.toLocaleString()}개 · {o.at}
        </InfoRow>
      )) : <p className="text-[10px] text-ink4">걸어 둔 오더가 없습니다</p>}

      <InfoHead>인력 · 설정</InfoHead>
      <InfoRow label="필요 인원">{crew.need} 명 / 조</InfoRow>
      {crew.shifts.map((sh, i) => (
        <InfoRow key={i} label={`· ${sh.name}`}>
          {sh.label} · {sh.headcount ? `${sh.headcount}명` : '제한 없음'}
        </InfoRow>
      ))}
      <InfoRow label="벨트 기본 속도">{info.beltSpeed} m/s</InfoRow>
      <InfoRow label="단가">
        전기 {info.rates.power} · 인건 {(info.rates.wage / 1000).toFixed(0)}천
        {info.rates.material ? ` · 자재 ${info.rates.material.toLocaleString()}` : ''}
      </InfoRow>
    </div>
  );
}

/**
 * 공용 도면 — **저장소에 담아 둔 것**과 **올라온 것**을 한 자리에.
 * ---------------------------------------------------------------------------
 *  둘은 들어오는 길이 다르다. 저장소(`public/layouts/`)는 git push 로 넣는
 *  것이고, 올라온 것은 앱의 「공유」로 들어온다. 그런데 **쓰는 사람에게는 같은
 *  것**이다 — 남이 만든 도면을 열어 보는 일. 그래서 한 목록에 둔다.
 *
 *  **둘 다 비어 있으면 버튼 자체를 안 낸다.** 아무것도 없는 배포에서
 *  「공용 도면」 이 떠 있고 눌러도 빈 창이면 고장 난 것처럼 보인다.
 */
function GalleryButton({ onPick, onExport }) {
  const [rows, setRows] = useState(null);        // null = 아직 안 읽음
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  /* 고른 것 — 여는 것은 한 칸 뒤다(아래 확인 줄) */
  const [sel, setSel] = useState(null);
  /* 고른 것의 속 — 미리 읽어 둔다 */
  const [detail, setDetail] = useState(null);

  /* 한 번 읽은 저장소 도면은 들고 있는다 — 썸네일을 그리려고 읽은 것을
     고를 때 또 읽으면 같은 파일을 두 번 받는다 */
  const cache = useRef(new Map());

  const reload = async () => {
    const [repo, up] = await Promise.all([loadGalleryIndex(), listShared()]);
    /* 올라온 것이 위 — 방금 올린 것을 바로 찾을 수 있어야 한다 */
    setRows([
      ...up.map((r) => ({ ...r, from: 'share' })),
      ...repo.map((r) => ({ ...r, from: 'repo' })),
    ]);

    /**
     * 저장소 도면의 썸네일은 **열 때 그린다.**
     *  SVG 를 같이 커밋해 두면 도면을 고친 뒤 그림만 옛것으로 남아 목록이
     *  거짓말을 한다. 도면은 작고(1~2KB) CDN 이 물고 있으니, 그때그때 그려서
     *  **항상 맞는 그림**을 보여 주는 편이 낫다. 개수·크기도 여기서 나온다.
     */
    for (const e of repo) {
      loadGalleryLayout(e).then((data) => {
        /* 키를 `repo:<id>` 로 맞춰 둔다 — fetchOne 이 같은 열쇠로 찾으므로,
           썸네일을 그리려고 읽은 것이 고를 때 그대로 쓰인다 */
        cache.current.set(`repo:${e.id}`, data);
        setRows((prev) => (prev ?? []).map((r) => (r.from === 'repo' && r.file === e.file
          ? {
            ...r,
            thumb: `data:image/svg+xml;utf8,${encodeURIComponent(layoutThumbSVG(data))}`,
            summary: layoutSummary(data),
          }
          : r)));
      }).catch(() => { /* 못 읽으면 「미리보기 없음」 으로 남는다 */ });
    }
  };
  useEffect(() => { reload(); }, []);
  if (!rows?.length) return null;

  /** 도면 하나를 읽어 온다 — 한 번 읽은 것은 들고 있는다 */
  const fetchOne = async (row) => {
    const key = `${row.from}:${row.id}`;
    if (cache.current.has(key)) return cache.current.get(key);
    const data = row.from === 'share' ? await fetchShared(row.id) : await loadGalleryLayout(row);
    cache.current.set(key, data);
    return data;
  };

  /**
   * 고르면 **미리 읽어 둔다.**
   *  속을 보여 주려면 어차피 도면이 있어야 하고, 그건 열 때도 필요한 그 파일이다.
   *  미리 받아 두면 「덮어쓰고 열기」 가 기다림 없이 열린다.
   */
  const choose = async (row) => {
    setSel(row);
    setDetail(null);
    try {
      setDetail({ row, data: await fetchOne(row) });
    } catch (err) {
      console.error('[공용 도면] 속을 못 읽었다', err);
      setDetail({ row, error: `이 도면을 읽지 못했습니다 — ${err.message}` });
    }
  };

  const open2 = async (row) => {
    setBusy(row.id);
    try {
      onPick(await fetchOne(row), row);
      setOpen(false);
      setSel(null);
      setDetail(null);
    } catch (err) {
      console.error('[공용 도면] 못 열었다', err);
      window.alert(`「${row.name}」 을 열지 못했습니다 — ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const close = () => { setOpen(false); setSel(null); setDetail(null); };

  return (
    <>
      <Btn active={open} onClick={() => { if (!open) reload(); setOpen((v) => !v); }} data-guide="btn-gallery">
        <Library size={13} /> 공용 도면
      </Btn>
      {/**
        * 화면 **가운데 창**으로 띄운다.
        *  툴바에 매달아 두었더니 목록이 길어질수록 화면 밖으로 잘렸다. 도면을
        *  고르는 일은 잠깐 스쳐 가는 것이 아니라 **들여다보는 일**이라, 자리를
        *  제대로 내주는 편이 맞다.
        */}
      {open && (
        /* 가운데 정렬은 **플렉스로** 한다. 그리드에 두면 칸이 항목 크기에 맞춰
           늘어나서 `max-w-full` 의 100% 가 620px 자신을 가리켜 안 먹는다 —
           좁은 창에서 실제로 그렇게 넘쳤다. */
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onClick={close}>
          <div
            className="flex max-h-[78vh] w-[900px] max-w-full flex-col overflow-hidden rounded-xl bg-panel shadow-2xl ring-1 ring-edge"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">공용 도면</h2>
                <p className="text-[10.5px] text-ink4">{rows.length}개 — 눌러서 고르고, 아래에서 불러옵니다</p>
              </div>
              <IconBtn title="닫기" onClick={close}><X size={14} /></IconBtn>
            </div>

            {/* 목록 왼쪽 · 고른 것의 속 오른쪽 — 카드만으로는 「볼 만한
                도면인가」 를 못 가린다 */}
            <div className="flex min-h-0 flex-1">
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                {rows.map((r) => (
                  <LayoutCard
                    key={`${r.from}:${r.id}`}
                    row={r}
                    selected={sel && sel.from === r.from && sel.id === r.id}
                    disabled={busy != null}
                    /* 누르면 **고르기만** 한다 — 여는 것은 아래에서 한 번 더 */
                    onPick={() => choose(r)}
                  />
                ))}
              </div>
              {sel && (
                <div className="w-[262px] shrink-0 overflow-y-auto border-l border-line bg-raise">
                  <LayoutDetail row={sel} data={detail?.data} error={detail?.error} />
                </div>
              )}
            </div>

            {/**
              * 고른 것을 **바로 열지 않는다.**
              *  여는 순간 지금 도면이 덮인다. 모르고 눌렀다가 몇 시간 그린 것이
              *  사라지면 되돌리기를 아는 사람이라도 가슴이 내려앉는다. 그래서
              *  한 칸을 더 두고, 그 자리에 **내보내기**를 같이 놓는다 — 「먼저
              *  꺼내 두세요」 라고 말만 하고 길을 안 주면 소용이 없다.
              */}
            <div className="shrink-0 border-t border-line bg-raise px-3 py-2.5">
              {sel ? (
                <>
                  <p className="mb-2 text-[11px] leading-relaxed text-ink2">
                    <b className="text-ink">{sel.name}</b> 을 엽니다 —
                    <b className="text-rose-500"> 지금 도면은 덮어써집니다.</b>
                    <br />
                    <span className="text-ink4">
                      되돌리기(Ctrl+Z)로 돌아올 수 있지만, 확실하게 하려면 먼저 내보내 두세요.
                    </span>
                  </p>
                  <div className="flex justify-end gap-1.5">
                    <Btn onClick={() => setSel(null)}>취소</Btn>
                    <Btn onClick={onExport}><Download size={12} /> 먼저 내보내기</Btn>
                    <Btn onClick={() => open2(sel)} disabled={busy != null}>
                      {busy ? '여는 중…' : '덮어쓰고 열기'}
                    </Btn>
                  </div>
                </>
              ) : (
                <p className="text-[10.5px] text-ink4">위에서 도면을 하나 고르세요.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 도면 올리기 — 링크 하나로 서로 테스트.
 * ---------------------------------------------------------------------------
 *  **올리기 전에 반드시 묻는다.** 링크를 가진 사람은 누구나 열 수 있고, 한 번
 *  나간 것은 되돌릴 수 없다. 「공유」 를 눌렀다는 것만으로 그 뜻까지 동의한
 *  것으로 치면 안 된다 — 사내 도면이 섞이는 순간 사고가 된다.
 */
function ShareButton({ snapshot }) {
  const [state, setState] = useState(null);   // null · 'ask' · 'busy' · { url, copied }
  /* 이름과 설명을 받는다 — 목록에 「(이름 없음)」 이 늘어서면 고를 수가 없고,
     이름만으로는 「A라인」 이 무엇을 시험한 것인지 한 달 뒤에 모른다 */
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  const upload = async () => {
    setState('busy');
    try {
      const { url, listed } = await shareLayout(snapshot(), { name, note });
      setState({ url, listed, copied: await copyText(url) });
    } catch (e) {
      console.error('[공유] 못 올렸다', e);
      setState(null);
      window.alert(e.code === SHARE_OFF
        ? `공유가 아직 켜져 있지 않습니다.\n\n${e.message}`
        : `올리지 못했습니다 — ${e.message}`);
    }
  };

  return (
    <div className="relative">
      <Btn active={!!state} onClick={() => setState(state ? null : 'ask')} data-guide="btn-share">
        <Share2 size={13} /> 공유
      </Btn>
      {state && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setState(null)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-[290px] rounded-lg bg-panel p-2.5 shadow-xl ring-1 ring-edge">
            {state === 'ask' && (
              <>
                <p className="text-[11.5px] leading-relaxed text-ink2">
                  지금 도면을 올립니다. <b className="text-ink">링크</b>가 나오고,
                  <b className="text-ink"> 「공용 도면」 목록</b>에도 올라갑니다.
                </p>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) upload(); }}
                  placeholder="도면 이름 (예: A라인 조립 2단)"
                  maxLength={60}
                  className="mt-2 w-full rounded bg-field px-2 py-1 text-[11.5px] text-ink2 ring-1 ring-edge focus:ring-sky-500"
                />
                {/* 설명 — 한 달 뒤의 나를 위한 자리다. 「A라인」 만 남으면
                    무엇을 시험해 본 도면이었는지 기억나지 않는다 */}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="설명 — 무엇을 시험한 배치인가요? (없어도 됩니다)"
                  maxLength={140}
                  rows={2}
                  className="mt-1 w-full resize-none rounded bg-field px-2 py-1 text-[11px] leading-snug text-ink2 ring-1 ring-edge focus:ring-sky-500"
                />
                <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-[10.5px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
                  올리면 <b>누구나</b> 목록에서 보고 열 수 있습니다. 한 번 올린 것은 앱에서
                  되돌릴 수 없습니다 — 회사 도면이면 다시 생각해 주세요.
                </p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <Btn onClick={() => setState(null)}>취소</Btn>
                  <Btn onClick={upload}><Share2 size={12} /> 올리기</Btn>
                </div>
              </>
            )}
            {state === 'busy' && <p className="text-[11.5px] text-ink3">올리는 중…</p>}
            {state?.url && (
              <>
                <p className="mb-1 text-[10.5px] text-ink4">
                  {state.copied ? '링크를 복사했습니다 — 그대로 붙여넣으세요.' : '아래 링크를 복사해 보내세요.'}
                </p>
                {/* 올라갔지만 목록에 못 들어간 경우 — 링크는 살아 있다는 것을
                    말해 줘야 같은 도면을 계속 다시 올리지 않는다 */}
                {state.listed === false && (
                  <p className="mb-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] leading-snug text-amber-600 ring-1 ring-amber-500/25">
                    올라갔지만 <b>공용 도면 목록에는 못 넣었습니다.</b> 이 링크로는 열립니다.
                  </p>
                )}
                <input
                  readOnly
                  value={state.url}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded bg-field px-2 py-1 text-[11px] text-ink2 ring-1 ring-edge"
                />
                <div className="mt-2 flex justify-end gap-1.5">
                  <Btn onClick={async () => setState({ ...state, copied: await copyText(state.url) })}>
                    <Copy size={12} /> 복사
                  </Btn>
                  <Btn onClick={() => setState(null)}>닫기</Btn>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Toolbar() {
  const { state, dispatch } = useEditor();
  const simSpeed = useSimSpeed();
  const elapsed = useElapsed();
  const fileRef = useRef(null);
  const [cadOpen, setCadOpen] = useState(false);

  const setView = (view) => dispatch({ type: 'SET', patch: { view } });
  const setTool = (tool) => dispatch({ type: 'SET_TOOL', tool });

  const importLayout = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      dispatch({ type: 'LOAD_LAYOUT', data });
    } catch {
      window.alert('레이아웃 파일을 읽지 못했습니다.');
    }
  };

  /**
   * **넘치면 옆으로 민다.**
   * ---------------------------------------------------------------------------
   *  이 줄의 내용은 **1476px** 로 고정이다(실측). 그보다 좁은 창에서는 오른쪽
   *  끝부터 잘리는데, `index.css` 의 `body { overflow: hidden }` 때문에
   *  **스크롤로도 못 닿았다** — 1280px 노트북에서 「CAD 반입 · 공용 도면 · 공유 ·
   *  초기화」 넷이 통째로 손이 안 닿는 자리에 있었다. 1440px 에서도 초기화가
   *  36px 잘린다.
   *
   *  넓은 창에서는 아무것도 안 바뀐다 — 넘칠 때만 스크롤이 생긴다.
   *  스크롤 막대는 숨긴다. 높이 48px 짜리 줄에 막대가 뜨면 버튼을 덮는다.
   */
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 overflow-x-auto border-b border-line bg-head px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center gap-2 pr-1">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-cyan-400 text-[11px] font-black text-slate-950">
          E
        </span>
        <div className="leading-tight">
          <p className="text-[12.5px] font-semibold text-ink">Smart Factory</p>
          <p className="text-[10px] text-ink4">설비 배치 에디터</p>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 뷰 전환 */}
      <div className="flex rounded-md bg-field p-0.5 ring-1 ring-edge">
        <button
          onClick={() => setView(VIEW.TOP)}
          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
            state.view === VIEW.TOP ? 'bg-sky-500 text-white' : 'text-ink3 hover:text-ink'
          }`}
        >
          탑뷰 · 배치
        </button>
        <button
          onClick={() => setView(VIEW.ISO)}
          data-guide="view-iso"
          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
            state.view === VIEW.ISO ? 'bg-sky-500 text-white' : 'text-ink3 hover:text-ink'
          }`}
        >
          3D · 확인
        </button>
      </div>

      {/* 도구 */}
      <div className="flex items-center gap-1">
        <IconBtn title="선택 / 이동 (Esc)" active={state.tool === TOOL.SELECT} onClick={() => setTool(TOOL.SELECT)}>
          <MousePointer2 size={14} />
        </IconBtn>
        <IconBtn title="지우개 (X)" active={state.tool === TOOL.ERASE} onClick={() => setTool(TOOL.ERASE)}>
          <Eraser size={14} />
        </IconBtn>
        {/* 자 — 배치 에디터인데 거리를 잴 길이 없었다. 통로 폭이 몇 m 인지,
            설비 사이가 카트가 지날 만한지는 눈대중으로 답할 것이 아니다 */}
        <IconBtn
          title="치수 재기 — 두 점을 눌러 거리를 잽니다 (Esc 로 지움)"
          active={state.tool === TOOL.MEASURE}
          onClick={() => setTool(TOOL.MEASURE)}
        >
          <Ruler size={14} />
        </IconBtn>
        <IconBtn
          title="90° 회전 (R)"
          onClick={() =>
            state.selected?.kind === 'equip'
              ? dispatch({ type: 'ROTATE', uid: state.selected.uid })
              : dispatch({ type: 'ROTATE_GHOST' })
          }
        >
          <RotateCw size={14} />
        </IconBtn>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 되돌리기 — 남은 칸 수를 툴팁에 적어 "몇 번 더 갈 수 있는지" 를 보여 준다 */}
      <div className="flex items-center gap-1">
        <IconBtn
          title={`되돌리기 (Ctrl+Z)${state.past.length ? ` · ${state.past.length}단계` : ''}`}
          disabled={!state.past.length}
          onClick={() => dispatch({ type: 'UNDO' })}
        >
          <Undo2 size={14} />
        </IconBtn>
        <IconBtn
          title={`다시 실행 (Ctrl+Y)${state.future.length ? ` · ${state.future.length}단계` : ''}`}
          disabled={!state.future.length}
          onClick={() => dispatch({ type: 'REDO' })}
        >
          <Redo2 size={14} />
        </IconBtn>
      </div>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 스냅 */}
      <label className="flex items-center gap-1.5 text-[11px] text-ink3">
        <Grid3x3 size={13} />
        스냅
        <select
          value={state.gridSize}
          onChange={(e) => dispatch({ type: 'SET', patch: { gridSize: Number(e.target.value) } })}
          className="cursor-pointer rounded border border-edge bg-field px-1.5 py-1 text-[11px] text-ink outline-none transition-colors hover:border-sky-500/60 hover:bg-raiseh focus:border-sky-500"
        >
          {GRID_SIZES.map((g) => (
            <option key={g} value={g}>
              {g >= 1 ? `${g} m` : `${g * 100} cm`}
            </option>
          ))}
        </select>
      </label>

      <IconBtn
        title="인접 설비에 면 맞춤"
        active={state.snapEdge}
        onClick={() => dispatch({ type: 'SET', patch: { snapEdge: !state.snapEdge } })}
      >
        <Magnet size={14} />
      </IconBtn>
      <IconBtn
        title="그리드 표시"
        active={state.showGrid}
        onClick={() => dispatch({ type: 'SET', patch: { showGrid: !state.showGrid } })}
      >
        {state.showGrid ? <Eye size={14} /> : <EyeOff size={14} />}
      </IconBtn>

      <div className="mx-1 h-6 w-px bg-kbd" />

      {/* 벨트 구동 — UV 스크롤 재생/정지 + 전역 기본 속도.
          오더를 다 채워 스스로 멈췄으면 **여기가 다시 도는 문**이라 눈에 띄게
          한다. 안 그러면 화면이 통째로 얼어붙은 것을 고장으로 읽는다. */}
      <div className={state.haltedByOrders && !state.running
        ? 'rounded-md ring-2 ring-emerald-500 ring-offset-1 ring-offset-head'
        : ''}
      >
        <IconBtn
          title={state.haltedByOrders && !state.running
            ? '다시 돌리기 — 오더를 다 채워 멈춰 있습니다'
            : (state.running ? '벨트 정지' : '벨트 구동')}
          active={state.running}
          onClick={() => dispatch({ type: 'SET', patch: { running: !state.running } })}
        >
          {state.running ? <Pause size={14} /> : <Play size={14} className={state.haltedByOrders ? 'text-emerald-600' : ''} />}
        </IconBtn>
      </div>
      {/* 배속 — 지표는 시간으로 나눈 값이라, 시간을 빨리 못 감으면 답이 안 나온다.
          1시간짜리 라인을 실시간으로 보고 있을 수는 없다. */}
      <div className="flex items-center rounded-md bg-raise p-0.5 ring-1 ring-edge" title="시뮬레이션 배속">
        {SPEEDS.map((v) => (
          <button
            key={v}
            onClick={() => setSpeed(v)}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums transition-colors ${
              simSpeed === v ? 'bg-sky-500 text-white' : 'text-ink4 hover:text-ink2'
            }`}
          >
            {v}×
          </button>
        ))}
      </div>
      {/* 경과 시간 — 누르면 지표를 처음부터 다시 잰다.
          배치를 고친 뒤의 성적을 보려면 이전 기록이 섞이면 안 된다. */}
      <button
        onClick={resetRun}
        title="시뮬레이션 안에서 흐른 시간 (▶ 를 켜 둔 동안만 흐른다) — 눌러서 지표 초기화"
        className="w-[86px] rounded px-1 py-0.5 text-left text-[11px] tabular-nums text-ink3 hover:bg-raiseh hover:text-ink"
      >
        ⏱ {formatElapsed(elapsed)}
      </button>

      <label className="flex items-center gap-1.5 text-[11px] text-ink3" title="개별 지정이 없는 벨트의 기본 속도">
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={state.beltSpeed}
          onChange={(e) => dispatch({ type: 'SET', patch: { beltSpeed: Number(e.target.value) } })}
          className="w-20 accent-sky-500"
        />
        <span className="w-14 tabular-nums text-ink2">{state.beltSpeed.toFixed(2)} m/s</span>
      </label>

      {/* 배치 비교 — 담아 둔 벌이 있으면 개수를 배지로 */}
      <IconBtn
        title="배치 비교 — 배치를 바꿔 보고 성적을 나란히 놓는다"
        active={state.showScenarios}
        onClick={() => dispatch({ type: 'SET', patch: { showScenarios: !state.showScenarios } })}
      >
        <GitCompare size={14} />
        {state.scenarios.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-sky-500 px-1 text-[9px] font-bold leading-[13px] text-white">
            {state.scenarios.length}
          </span>
        )}
      </IconBtn>

      {/* 따라 하기 — 처음 한 번은 저절로 뜨고, 그 뒤로는 여기서 다시 연다 */}
      <IconBtn
        title="따라 하기 — 배우고 싶은 것을 골라서"
        active={!!state.guide}
        /* 열면 **고르는 화면**으로 — 갈래가 여럿이니 바로 한 갈래로 들어가면
           나머지가 있다는 것조차 모른다 */
        onClick={() => dispatch({ type: 'SET', patch: { guide: state.guide ? null : 'pick' } })}
      >
        <GraduationCap size={14} />
      </IconBtn>

      <IconBtn
        title={state.appearance === 'light' ? '다크 모드로' : '라이트 모드로'}
        onClick={() =>
          dispatch({ type: 'SET', patch: { appearance: state.appearance === 'light' ? 'dark' : 'light' } })
        }
      >
        {state.appearance === 'light' ? <Moon size={14} /> : <Sun size={14} />}
      </IconBtn>

      <div className="flex-1" />

      {/**
        * 「저장」 버튼은 없앴다.
        * -----------------------------------------------------------------
        *  도면은 고칠 때마다 이 브라우저에 **이미 저장되고 있다**(store 의
        *  효과가 DOC_KEYS 가 바뀔 때마다 saveLayout 을 부른다 — 상태바의
        *  「자동 저장됨」이 그 말이다). 그래서 이 버튼은 **이미 된 일을 한 번
        *  더 하고 알림창을 띄우는 것**뿐이었다.
        *
        *  진짜 「저장」 — 이 브라우저 밖으로 꺼내는 일 — 은 「내보내기」다.
        *  같은 낱말이 두 가지를 가리키면, 정작 내보내야 할 때 저장을 눌러
        *  놓고 안심하게 된다.
        */}
      <Btn
        onClick={() =>
          downloadJSON(
            layoutSnapshot(state),
            `layout-${new Date().toISOString().slice(0, 10)}.json`,
          )
        }
        title="도면을 파일로 꺼냅니다 — 이 브라우저를 지워도 남는 유일한 사본입니다"
        data-guide="btn-export"
      >
        <Download size={13} /> 내보내기
      </Btn>
      <Btn onClick={() => fileRef.current?.click()}>
        <Upload size={13} /> 불러오기
      </Btn>
      {/* 저장소에 담아 둔 공용 도면 — 담긴 것이 없으면 버튼도 안 나온다 */}
      <Btn onClick={() => setCadOpen(true)} title="CAD 도면(DXF)에서 벽·바닥·기둥을 가져옵니다">
        <DraftingCompass size={13} /> CAD 반입
      </Btn>
      {cadOpen && (
        <CadDialog
          onClose={() => setCadOpen(false)}
          onImport={(plan) => dispatch({ type: 'IMPORT_CAD', plan })}
        />
      )}
      <GalleryButton
        onPick={(data) => dispatch({ type: 'LOAD_LAYOUT', data })}
        onExport={() => downloadJSON(layoutSnapshot(state), `layout-${new Date().toISOString().slice(0, 10)}.json`)}
      />
      {/* 올리기 — 링크 하나로 서로 테스트. 올리기 전에 반드시 묻는다 */}
      <ShareButton snapshot={() => layoutSnapshot(state)} />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => importLayout(e.target.files?.[0])}
      />
      <Btn
        danger
        onClick={() => {
          if (window.confirm('배치를 모두 지울까요? (라이브러리는 유지됩니다)')) dispatch({ type: 'CLEAR' });
        }}
      >
        <Trash2 size={13} /> 초기화
      </Btn>
    </header>
  );
}
