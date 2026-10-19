# WAR ROOM — Global Command

> Your staff reads hundreds of reports a minute. You read five. Can you command?

A real-time, browser-based strategy game about **multi-agent command and control**. You command air, sea, land, drone and space forces on a live map of Earth. Seven AI staff agents report everything, and **ATLAS**, your Chief of Staff agent, filters that firehose into a short, prioritized brief with one-click recommended actions. You can ask ATLAS questions or give it orders, by typing or by voice.

- Play against the machine (Recruit, Veteran or Elite) or against a human in a shared room link.
- Works on desktop and mobile browsers.
- Runs on the Cloudflare free plan: a Worker serves the static assets, a Durable Object hosts multiplayer rooms, and Workers AI handles open-ended questions.

Docs: [game spec](docs/SPEC.md) · [implementation plan](docs/IMPLEMENTATION.md)

## Develop

```bash
npm install
npm run build && npx wrangler dev   # http://localhost:8787 (Worker + assets + rooms)
npm test                            # Vitest: engine, AI, pathing, ATLAS, NL parser
npm run e2e                         # Playwright: desktop + mobile UI flows
npm run deploy                      # build + wrangler deploy
```

`npm run geo` regenerates the land/sea mask from Natural Earth data. It takes about 45 seconds and its output is committed.
