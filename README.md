# pi-swarm

A web UI for durable Pi agents on this machine.

The agent runs in `dpi-backend` and commits every step to SQLite before the browser shows it. Close the tab or restart the backend and the session resumes from the last checkpoint. The browser talks to a local hub. The hub holds the device token and proxies the backend.

This tree is a fork of [disler/durable-pi](https://github.com/disler/durable-pi). The interface is the web hub. Models are Grok, through the Pi grok-cli login.

Models: `grok-4.7` (default), `grok-4.7-build-fast`, `grok-build`. Auth is `~/.pi/grok-cli/accounts.json` from Pi's Grok CLI login, or `GROK_CLI_OAUTH_TOKEN`. Pinned to `@earendil-works/pi-durable` 1.0.3.

## Run

Needs Node 24, npm, `just`, and zsh. Sign in to Grok CLI in Pi first.

```bash
cp dpi-network.example.yaml dpi-network.yaml
just install
just net up local          # writes ~/.dpi/backend.env and registers the local device
just backend run           # http://127.0.0.1:4780
just hub dev               # http://localhost:4781 with hot reload
```

`just hub start` serves the built UI. `DPI_PROVIDER=faux` is the deterministic model the tests use.

## Layout

```
apps/dpi-backend/          device server: harness, SQLite, HTTP + SSE
apps/dpi-sdk/              shared API types and client
apps/dpi-playground/       hub (port 4781) and Vue web UI
just/                      net, backend, hub, test
```

The HTTP API the hub uses is documented in [`apps/dpi-backend/API.md`](apps/dpi-backend/API.md).

## Checks

```bash
just check                 # typecheck and unit tests
cd apps/dpi-backend && npm test
```
