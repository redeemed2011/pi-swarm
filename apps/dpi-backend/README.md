# dpi-backend

The Durable Pi **device server**. Run one on every machine that should host durable agents: your laptop, a Mac mini, a Linux box, an exe.dev VM. It owns the harnesses, the SQLite databases, the tools and the filesystem. Clients connect with the device's **URL and bearer token** through the [v1 API](API.md).

```
web hub ──HTTP + SSE, Bearer──► dpi-backend ──► sessions/<id>/agent.sqlite (pi-durable)
```

## Run it on this machine

Needs Node 22.19 or newer (`.nvmrc` pins 24).

```bash
cd apps/dpi-backend && npm install
npm run token                  # creates ~/.dpi/backend.env with DPI_TOKEN and prints it (npm run token -- --rotate replaces it)
npm start                      # 127.0.0.1:4780; data in ~/.dpi/backend
```

With the repo's network config, `just net up local && just backend run` does the same thing. `just backend run` first stops whatever already listens on the backend's port. Model auth is the Pi grok-cli login at `~/.pi/grok-cli/accounts.json`.

## Configuration: `~/.dpi/backend.env`

| Key | Default | Meaning |
|---|---|---|
| `DPI_TOKEN` | required, ≥32 chars | bearer token for every `/v1` call |
| `DPI_DEVICE_NAME` | hostname | name shown to clients |
| `DPI_PORT` / `DPI_HOST` | `4780` / `127.0.0.1` | listen address. `just net up` writes the YAML `host`, which defaults to `0.0.0.0` for `ssh` and `exe-dev` devices so other machines can reach them |
| `DPI_START_DIRS` | `~/dpi-work` | colon-separated folders where new sessions start, created at startup if missing: the directory browser opens there and relative cwds resolve against the first. Any existing directory is allowed as cwd |
| `DPI_DATA_DIR` | `$DPI_HOME/backend` | catalog, app state, `sessions/`, `archive/` |
| `DPI_HOME` | `~/.dpi` | where `backend.env` is read (set by the service unit) |
| `DPI_ENV_FILE` | `$DPI_HOME/backend.env` | the env file to read |
| `DPI_PROVIDER` | `grok-cli` | `faux` gives a free deterministic model for tests. Any other value is an error |
| `GROK_CLI_OAUTH_TOKEN` | | optional override of the Pi grok-cli vault at `~/.pi/grok-cli/accounts.json`. Without a login or this token, the device lists no models |
| `DPI_AGENTS_FILE` | `$DPI_HOME/agents.json` | saved agents. Each `autostart: true` entry starts through `spawnSession` when the backend boots. The same key returns the same session |

Flags `--port`, `--host`, `--name`, `--start-dirs`, `--data-dir` and `--env-file` override the env.

## Deploy to other devices

Devices are declared in the repo root's `dpi-network.yaml` (gitignored; start from [`dpi-network.example.yaml`](../../dpi-network.example.yaml)). Nothing else names a machine:

```bash
just net up <id>   # (exe.dev: create →) provision → deploy → env → service → (exe.dev: expose →) register → wait online
just net status    # probe every device
just net logs <id>  |  just net restart <id>  |  just net deploy <id>  |  just net down <id>  |  just net destroy <id>
just net rotate <id>   # new token, restart, re-register
just net probe <id>    # /healthz 200 and /v1/device 401 without a token
```

| Kind | Service | Notes |
|---|---|---|
| `local` | none (`just backend run`) or launchd/systemd | binds 127.0.0.1 |
| `ssh` | `launchd` → `~/Library/LaunchAgents/dev.dpi.backend.plist`; `systemd` → `/etc/systemd/system/dpi-backend.service` | binds 0.0.0.0 by default; needs passwordless ssh; systemd needs `sudo -n` |
| `exe-dev` | systemd | VM created on demand; the HTTPS proxy is set public, so the token is the gate |
| `url` | none | connect only: `just net register <id> --token <t>` |

Templates live in [`deploy/`](deploy/).

## Layout on a device

```
~/dpi/apps/dpi-backend, ~/dpi/apps/dpi-sdk     code (rsynced; safe to replace)
~/.dpi/backend.env                              token + config (0600)
~/.dpi/backend/catalog.sqlite                   sessions, agent names, device uid, idempotency keys, compaction thresholds
~/.dpi/backend/app-state.sqlite                 the device's shared App State (demo extension)
~/.dpi/backend/sessions/<uuid>/agent.sqlite     one pi-durable harness per session
~/.dpi/backend/archive/                          archived sessions (DELETE never removes files)
~/.dpi/backend.log                              service log
```

## Guarantees and boundaries

- Closing a client never stops work. A backend restart resumes unfinished tasks from their checkpoints. Replay-safe tools may rerun, and unsafe ones return an interrupted result.
- A token holder has the agent's shell and filesystem access on that device. Start dirs are where sessions begin, not a sandbox.
- macOS `ssh` devices run as a LaunchAgent in the logged-in session, so enable auto-login for unattended reboots. Agents working under `~/Documents` need Full Disk Access for the node binary.
- LAN `ssh` devices speak plain HTTP, so the token crosses the LAN in cleartext. exe.dev devices use HTTPS.

## Web UI

```bash
just net up local
just backend run     # 127.0.0.1:4780
just hub dev         # http://localhost:4781
```

Sign in to Grok CLI in Pi first. The backend reads `~/.pi/grok-cli/accounts.json`. Closing the browser does not stop the agent. Restarting the backend resumes the session from its last checkpoint.

## Development

```bash
npm run dev     # restart on file changes (just backend dev)
npm run check   # strict types, including the pi-durable ↔ SDK wire contract check
npm test        # api, streams, store (jobs, start_session, extensions, read only), search_history, shared state and SIGKILL recovery (faux provider, no network)
```
