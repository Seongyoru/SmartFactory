/* 되돌리기 테스트 도우미 — **편집이 실제로 먹었는지 먼저 확인한다.**
   안 먹은 편집으로 「검사가 통과했다」를 보면 가드가 있는 줄 알게 된다.
   이번 세션에 그걸로 두 번 속았다.

   여러 줄은 `@@` 로 나눈다. 처음에는 `|` 를 썼는데 `||` 를 담은 코드에서
   조용히 어긋났고, 다음에는 역슬래시-n 을 썼는데 셸과 heredoc 을 거치며
   사라졌다 — **구분자는 코드에도 셸에도 흔치 않은 것이라야 한다.** */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, from, to] = process.argv.slice(2);
const s = readFileSync(file, 'utf8');
/* 줄바꿈은 파일 것을 따른다 — CRLF 파일에 LF 를 들이대면 조용히 안 바뀐다 */
const eol = s.includes('\r\n') ? '\r\n' : '\n';
const un = (x) => x.split('@@').join(eol);
const a = un(from);
const b = un(to);
if (!s.includes(a)) {
  console.error('!! 편집이 안 먹었다 — 찾는 글이 없다:', a.slice(0, 60));
  process.exit(2);
}
writeFileSync(file, s.replace(a, b));
