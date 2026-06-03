# Setup

Chess Lab is a pure static frontend (vanilla HTML/CSS/JS, no build step) plus a
thin Railway-hosted Node/Express backend that proxies the Anthropic and Lichess
APIs so the keys never reach the client.

## Stockfish — already included

There is **nothing to download**. The engine is committed to the repo:

- `js/stockfish.js`
- `js/stockfish.wasm`

(The old instructions to grab `stockfish.js` from a third-party fork are
obsolete — ignore any reference to that.)

## Run it locally

The frontend is just static files, so any static server works:

```
# from the repo root
python -m http.server 8000
# then open http://localhost:8000/index.html
```

Opening `index.html` directly via `file://` will not work because the WASM
engine and the IIFE scripts need to be served over HTTP.

### Optional: run the backend locally

Claude/Lichess calls go through the Railway backend by default. The frontend's
`SERVER_URL` constant automatically points at `http://localhost:4000` when the
page is served from `localhost`, so to exercise those calls locally:

```
cd server
npm install
# set ANTHROPIC_API_KEY and LICHESS_API_TOKEN in the environment
npm start   # listens on port 4000
```

If you don't run the backend, Chess.com fetches and Stockfish analysis still
work; only the Claude coaching and Lichess explorer features need it.

## Deploy

- **Frontend:** GitHub Pages at https://chesslab.live — auto-deploys on push to
  `main` (the `CNAME` file pins the custom domain). No build, no bundler:
  push to `main` = live.
- **Backend:** Railway at https://chess-lab-production.up.railway.app — auto-deploys
  on push to `main` from the `server/` subdirectory. API keys
  (`ANTHROPIC_API_KEY`, `LICHESS_API_TOKEN`) are set in the Railway dashboard,
  never committed.
