/**
 * 우측 인스펙터 — 선택한 설비/연결의 상세, 없으면 도면 요약
 */

import React, { useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw, Trash2 } from 'lucide-react';
import { useEditor } from '../core/store.jsx';
import { getSpec, subscribeModels } from '../core/modelStore.js';
import { MAX_LAYER, layerLift, linkPath, portsOf } from '../core/link.js';
import { cartPath, cartStations } from '../core/cart.js';
import { footprintOf } from '../core/grid.js';
import { sliceCountFor, tileCount } from '../scene/connectorGeometry.js';
import { Btn, Field, Row, Section } from './common.jsx';

function useModelsVersion() {
  const [v, setV] = React.useState(0);
  React.useEffect(() => subscribeModels(() => setV((n) => n + 1)), []);
  return v;
}

const ROT_LABEL = ['0°', '90°', '180°', '270°'];

function EquipmentPanel({ placed }) {
  const { state, dispatch, itemOf } = useEditor();
  const beltSpeed = state.beltSpeed;
  const item = itemOf(placed.itemId);
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  const rect = spec ? footprintOf(placed, spec) : null;
  const ports = spec ? portsOf(placed, item) : [];

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
      </Section>

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

      {/* 출하 — 이 설비가 유출부로 내보내는 자재의 모양과 빈도 */}
      <Section title="출하">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            적재 층수
            <b className="text-ink tabular-nums">{placed.outputCount ?? 3} 층</b>
          </span>
          <input
            type="range"
            min="1"
            max="8"
            step="1"
            value={placed.outputCount ?? 3}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { outputCount: Number(e.target.value) } })
            }
            className="w-full accent-sky-500"
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 flex items-center justify-between text-[11px] text-ink4">
            내보내는 간격
            <b className="text-ink tabular-nums">{(placed.spawnGap ?? 3).toFixed(2)} m</b>
          </span>
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.25"
            value={placed.spawnGap ?? 3}
            onChange={(e) =>
              dispatch({ type: 'UPDATE_PLACED', uid: placed.uid, patch: { spawnGap: Number(e.target.value) } })
            }
            className="w-full accent-sky-500"
          />
          <span className="text-[10px] text-ink4">
            벨트 {beltSpeed.toFixed(2)} m/s 기준 {(60 / ((placed.spawnGap ?? 3) / Math.max(beltSpeed, 0.01))).toFixed(1)} 개/분
          </span>
        </label>

        <p className="mt-2 text-[10.5px] leading-relaxed text-ink4">
          이 설비의 <b className="text-ink3">유출부</b>에서 나가는 컨베이어 위로 이 간격마다
          자재가 흐릅니다. 카트가 유출부 앞을 지날 때 싣는 양도 같은 층수를 따르고,
          <b className="text-ink3"> 유입부</b> 앞에서 내려놓습니다.
        </p>
      </Section>

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

function CartPanel({ cart }) {
  const { state, dispatch, itemOf } = useEditor();
  const version = useModelsVersion();
  const item = itemOf(cart.itemId);
  const path = useMemo(() => cartPath(cart), [cart]);
  const stations = useMemo(
    () => (path ? cartStations(path, state.placed, itemOf) : []),
    [path, state.placed, itemOf, version],
  );

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

  return (
    <>
      <Section title="카트">
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
            앞뒤 반전
          </Btn>
        </div>
        {!state.running && (
          <p className="mt-2 text-[10.5px] text-amber-600">툴바의 ▶ 를 눌러야 움직입니다.</p>
        )}
      </Section>

      <Section title={`정차역 ${stations.length}개`}>
        {stations.length === 0 && (
          <p className="text-[10.5px] leading-relaxed text-ink4">
            경로가 설비 포트 옆(3.5m 이내)을 지나가면 자동으로 역이 됩니다. 유출부면 싣고,
            유입부면 내립니다.
          </p>
        )}
        <ul className="space-y-1">
          {stations.map((st, i) => (
            <li key={i} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-ink2">
                <i
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: st.kind === 'load' ? '#fb923c' : '#34d399' }}
                />
                {st.name}
              </span>
              <span className="tabular-nums text-ink4">
                {st.kind === 'load' ? `싣기 ${st.count}개` : '내리기'} · {st.s.toFixed(1)}m
              </span>
            </li>
          ))}
        </ul>
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

function Summary() {
  const { state, itemOf } = useEditor();
  const version = useModelsVersion();

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
      </Section>

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

  return (
    <aside className="w-[292px] shrink-0 overflow-y-auto border-l border-line bg-panel">
      {placed ? <EquipmentPanel placed={placed} />
        : link ? <LinkPanel link={link} />
          : cart ? <CartPanel cart={cart} />
            : <Summary />}
    </aside>
  );
}
