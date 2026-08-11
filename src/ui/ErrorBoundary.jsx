/**
 * =============================================================================
 *  오류 울타리 — 빈 화면 대신 이유를 보여 준다
 * =============================================================================
 *  3D 씬에서 렌더 중 오류가 하나만 나도 React 는 트리 전체를 버린다. 그러면
 *  화면이 통째로 하얗게 남고, 콘솔을 열어 보기 전에는 무엇이 잘못됐는지 알 수
 *  없다. 실제로 정의되지 않은 이름 하나(모델이 아직 로드되지 않았을 때만 닿는
 *  가지)가 그 상태를 만든 적이 있다.
 *
 *  오류를 숨기려는 것이 아니라 **말하게 하려는** 것이다. 메시지를 그대로 띄우고
 *  다시 시도할 길을 준다. 도면은 자동 저장돼 있으므로 새로고침해도 남는다.
 * ---------------------------------------------------------------------------
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 콘솔에도 남긴다 — 스택은 여기가 아니라 개발자 도구에서 봐야 한다
    console.error('렌더 중 오류', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-app p-6">
        <div className="max-w-md rounded-lg border border-red-500/40 bg-panel p-4">
          <p className="text-sm font-semibold text-red-500">화면을 그리는 중 오류가 났습니다</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink3">
            도면은 자동 저장돼 있으니 새로고침해도 남습니다. 아래 메시지를 알려 주시면
            원인을 찾을 수 있습니다.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-field p-2 text-[10.5px] text-ink2">
            {String(error?.message ?? error)}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md bg-raise px-2.5 py-1.5 text-xs text-ink2 ring-1 ring-edge hover:bg-raiseh"
            >
              다시 그리기
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-raise px-2.5 py-1.5 text-xs text-ink2 ring-1 ring-edge hover:bg-raiseh"
            >
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
