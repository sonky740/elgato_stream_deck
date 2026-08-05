# Stream Deck + plugin monorepo

Plugins for the **Elgato Stream Deck +**. Each plugin builds self-contained from its own directory, while ESLint, Prettier, vitest and tsconfig are shared from the repository root (npm workspaces).

## Plugins

Both images show the **touch strip (200×100)**. The dark background is the Stream Deck profile background — neither plugin paints its own canvas.

<table>
  <tr>
    <td><img src="media_controller/docs/dial.png" width="200" alt="media_controller touch strip — album art plus title, artist and album on three lines" /></td>
    <td>
      <b><a href="media_controller/">media_controller</a></b><br />
      Show and control the current track through the OS media session (any player)<br />
      <sub>verified on macOS / unverified on Windows</sub>
    </td>
  </tr>
  <tr>
    <td><img src="c_ai_usage/docs/dial-donut.png" width="200" alt="c_ai_usage touch strip — two donuts, 5-hour window at 37% and weekly window at 26%" /></td>
    <td>
      <b><a href="c_ai_usage/">c_ai_usage</a></b><br />
      Show Claude and Codex subscription limits as 5-hour and weekly gauges<br />
      <sub>verified on macOS / unverified on Windows</sub>
    </td>
  </tr>
</table>

The c_ai_usage image is the SVG the plugin actually produces, baked to PNG. **The media_controller image is a reconstruction** — that plugin only sends values and the device's layout renderer draws them, so there is no render output to capture. The image is redrawn from the rect, font and color in the [layout definition](media_controller/com.sonky.media-controller.sdPlugin/layouts/now-playing.json), with placeholder track text.

Installation, usage and per-platform prerequisites live in each plugin's README — [media_controller/README.md](media_controller/README.md) · [c_ai_usage/README.md](c_ai_usage/README.md).

## Language

Both plugins ship Korean and English. The language is not a setting: if the Stream Deck app language is Korean the plugins render Korean, and every other language falls back to English. Changing the app language takes effect after the plugin restarts.

## Target environment

macOS 12+ / Windows 10+ with the **Stream Deck app 7.1+** (manifest `SDKVersion: 3`, `Nodejs.Version: 24`). The Stream Deck app bundles the Node runtime, so your local Node version does not matter.

## Shared commands (from the root)

```bash
npm install          # once — all workspace dependencies plus the shared devtools
npm run lint         # eslint . (all workspaces)
npm run lint:fix
npm run format       # prettier --write .
npm run format:check
npm run build        # build every workspace
npm test             # vitest run — one root runner covers src/**/*.test.ts in every workspace
npm run test:watch
```

To target a single workspace, add `-w <package-name>` (`media-controller` · `c-ai-usage`). Run the per-plugin `streamdeck` commands from that plugin's directory.

There is no separate typecheck script — `npm run build` covers it through rollup's `@rollup/plugin-typescript`.

## Adding a plugin

1. Create a directory at the repository root and add it to `workspaces` in the root [package.json](package.json).
2. **Declare no dependencies** in the workspace `package.json` — keep only its own `build`/`watch` scripts. The runtime SDK (`@elgato/streamdeck`) and the toolchain (rollup plus its plugins, typescript, `@types/node`, `@elgato/cli`, ESLint, Prettier, vitest) all come from the root [package.json](package.json).
3. The workspace `tsconfig.json` must `extends` [tsconfig.base.json](tsconfig.base.json) and add only its own `include`/`exclude`. Do not rename or move it — rollup discovers the `tsconfig.json` in the build cwd.
4. **Always put `src/**/*.test.ts` in `exclude`.** Without it rollup's typecheck also inspects the test files, fails to find the vitest globals (`describe`/`it`) and breaks the build.

The root [eslint.config.mjs](eslint.config.mjs) and `.prettierrc.json` are guarded by the `config-protection` hook, so edits to them are blocked. Formatting is left entirely to Prettier and ESLint only disables the conflicting rules through `eslint-config-prettier`.

## Document map

|                         |                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)  | Repository overview plus **the couplings to know before touching code** (per-plugin gotchas). Written in Korean |
| `<plugin>/SPEC.md`      | Contracts and business rules (SSOT). Written in Korean                                                          |
| `<plugin>/DECISIONS.md` | Design decisions, their reasons and the alternatives considered. Written in Korean                              |
