import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

// 모노레포 공용 ESLint 설정 (flat config). 루트에 두면 전 워크스페이스에 적용된다.
// 새 플러그인 패키지를 추가해도 이 파일 하나로 커버된다.
export default tseslint.config(
	{
		// 생성물·벤더·의존성은 린트 대상에서 제외.
		ignores: ["**/node_modules/**", "**/bin/**", "**/vendor/**", "**/logs/**", "**/*.streamDeckPlugin"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: { ...globals.node },
		},
	},
	// 포매팅 관련 룰은 Prettier에 위임 — 충돌 룰 비활성화(항상 마지막).
	eslintConfigPrettier,
);
