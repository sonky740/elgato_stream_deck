import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

// 모노레포 공용 ESLint 설정 (flat config). 루트에 두면 전 워크스페이스에 적용된다.
// 새 플러그인 패키지를 추가해도 이 파일 하나로 커버된다.
export default tseslint.config(
  {
    // 생성물·벤더·의존성은 린트 대상에서 제외.
    ignores: [
      '**/node_modules/**',
      '**/bin/**',
      '**/vendor/**',
      '**/logs/**',
      '**/*.streamDeckPlugin',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // 함수는 화살표로 통일한다 — `function` 이 섞이면 호이스팅 덕에 "정의보다 위에서 호출"이
      // 파일마다 되기도 안 되기도 해서, 선언 순서를 읽는 기준이 한 저장소 안에서 갈린다.
      'func-style': ['error', 'expression'],
      // 콜백 자리의 `function` 표현식은 func-style 이 안 잡는다 — 짝으로 채운다. 객체
      // 프로퍼티(rollup 훅처럼 `this` 가 필요한 자리)는 두 룰 다 대상이 아니라 남는다.
      'prefer-arrow-callback': 'error',
    },
  },
  // 포매팅 관련 룰은 Prettier에 위임 — 충돌 룰 비활성화(항상 마지막).
  eslintConfigPrettier,
);
