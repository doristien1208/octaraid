# 八方討伐 (octaraid)

FF14-style 3D raid game for colleagues on the office LAN. 1–8 players (usually 3–4) create a room or join one with a 4-character invite code (there is no lobby), pick one of 8 jobs (2 tanks, 2 healers, 4 DPS; 5 skills each plus a shared Limit Break), vote on one of 8 "duty + difficulty" options, and fight a boss whose mechanics follow a fixed timeline. Planning doc (Claude Doc): https://claude.ai/code/artifact/dd4ddb06-eea7-4b00-b1e9-02e6bc31219c — keep it in sync when rules or protocol change.

## Status
- M1 (skeleton) is done: invite-code rooms, the waiting room (jobs with role caps, the 8-option vote, ready, chat), 3D arenas for the 4 duties, client-reported movement checked by the server, test fights the host can end, offline practice. Characters are code-built placeholders until the CC0 KayKit models are downloaded.
- Next: M2 combat core (skills, GCD/CD, casting, enmity, damage, death and raise, LB, training dummy), M3 the mechanic library + 崩岩巨像, M4 the other three duties, M5 balance and deployment.

## Constraints
- Node.js 22.18.0 everywhere (`.nvmrc`): the test machine runs exactly this. Don't rely on newer Node APIs. `CLAUDE.local.md` says how to get this version on the dev machine.
- The GitHub repo is public: the test machine's IP, the share and anything personal stay in `CLAUDE.local.md` (gitignored).
- Numbers are tuned for 3–4 players: boss HP = 4-player HP × Σ role weights ÷ 3.2 (tank 0.65, healer 0.55, DPS 1). Mechanic counts are designed for 4 players and scale with the party. No fight may run past 8 minutes (enrage at most 8:00).
- Test machine: Windows. This game uses port 3100 and lives in the share's `octaraid` folder; the Game Hub (sibling project `../GameHub`) starts and watches it, so updates go through its `maintenance.txt` flow. IP, share and Hub details are in `CLAUDE.local.md` (gitignored). Adding the game to the Hub's live `hub.config.json` changes another project: ask first.
- `deploy/start-server.bat` and `deploy/open-firewall.bat` stay plain ASCII with CRLF (`scripts/package.mjs` enforces both); Chinese text goes in `deploy/README-DEPLOY.txt`.
- Art: CC0 assets (KayKit Adventurers + Character Animations) for animated characters; bosses, arenas, telegraphs and effects are built in code. Ask before every download (file name, source, size), one pack at a time, under 2 GB in total; only ship the `.glb` files that are used and record their sources in CREDITS. Never use Square Enix names, art, music or trademarks.
- Nickname only: no accounts, leaderboard or shop. Text chat is required (colleagues cannot rely on voice).
- `sirv` reads the file list when the server starts: restart the server after rebuilding the client.

## Commands
- `npm run dev` — server on :3100 + Vite on :5174
- `npm test` — vote, invite codes, party and HP scaling, movement validation, key settings, the playback clock, a real WebSocket session
- `npm run typecheck`, `npm run build`, `npm start`, `npm run package` (→ `release/octaraid-server`)

## Layout
- `shared/constants.ts` VERSION and RULES; `shared/jobs.ts` the 8 jobs, skills and LB; `shared/encounters.ts` the 4 duties and the 8 vote options; `shared/party.ts` role caps, HP scale, missing-role notes; `shared/vote.ts`; `shared/roomcode.ts`; `shared/protocol.ts`
- `shared/sim/fight.ts` authoritative fight at 30 Hz: countdown, client-reported movement validated against speed and arena, enrage, end. `shared/sim/arena.ts`: metres, x east, z south, boss at (0, 0), facing f points along (sin f, cos f)
- `server/hub.ts` sessions and rooms by invite code; `server/room.ts` waiting room, tally, fight loop (a snapshot every tick); `server/app.ts` HTTP, `/ws` (Origin check) and `/healthz` (the Hub reads `version`, `online`, `playing`)
- `client/main.ts` screen switching; `client/ui/entry.ts`, `client/ui/room.ts`; `client/game/view.ts` the 3D fight (three.js, CSS2D name plates), `models.ts` code-built characters and the training dummy, `arena.ts`, `camera.ts`, `hud.ts`, `playback.ts` (from 水球大亂鬥); `client/sandbox.ts` offline practice (`?sandbox&boss=0..3&hard&n=1..8&job=<id>`)
- `VERSION` in `shared/constants.ts` shows on the entry screen and in `/healthz`; bump it with `package.json` for each release
