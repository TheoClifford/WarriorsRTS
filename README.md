# Warriors: Clans of the Forest — prototype

Browser RTS (TypeScript, Canvas 2D, WebAudio). `npm i` then `node build.mjs --prod` writes a single self-contained `dist/index.html`.

- `src/sim` — deterministic simulation (integer math, seeded RNG, 20 ticks/s). `world.ts` is the whole game rules engine; `map.ts` builds The Forest; `path.ts` is A*.
- `src/data/balance.json` — every number.
- `src/ai` — scripted AI (rush / balanced / boom), plays only through commands, doubles as the balance harness.
- `src/net` — lockstep over "presence" transports: the claude.ai artifact room, BroadcastChannel (two tabs), in-memory loopback (tests).
- `src/render` — mini ray tracer that pre-renders 3D primitive models into iso pixel sprites; seasonal terrain chunks; renderer; minimap.
- `src/ui` — HUD, command grid, input, menus, lobby.

Tests (run with `tsx`): `test/mapcheck.ts` (fairness rules), `test/determinism.ts` (rerun / replay / snapshot), `test/lockstep.ts [mins] [corruptAtTick]` (two worlds over a lossy link, desync + resync), `test/balance.ts N part parts` + `test/balreport.py` (round robin), `test/bench.ts` (economy benchmarks), `test/sim.ts` (one headless match).
