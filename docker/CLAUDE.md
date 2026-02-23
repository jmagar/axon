# docker/ — Container Build & s6 Supervision

## Files
```
docker/
├── Dockerfile          # Multi-stage: cargo-chef → build → runtime
├── Dockerfile.chrome   # headless_browser + chrome-headless-shell (CDP proxy on 9222)
├── rabbitmq/           # rabbitmq.conf + definitions.json (preconfigured vhost/user)
└── s6/
    ├── cont-init.d/
    │   └── 10-load-axon-env  # Loads .env on container startup (runs as root before services)
    └── s6-rc.d/
        ├── crawl-worker/
        ├── batch-worker/
        ├── extract-worker/
        ├── embed-worker/
        ├── ingest-worker/
        └── user/
            └── contents.d/   # Lists which services are in the user bundle
```

## just Shortcuts

```bash
just up              # docker compose up -d --build (rebuild + start)
just down            # docker compose down
just docker-build    # docker build -f docker/Dockerfile -t axon:local .
just rebuild         # cargo check + test + docker-build (full pre-deploy gate)
```

## s6-overlay: Why USER axon Doesn't Work

s6-overlay requires **PID 1 to run as root** (`/init`). You **cannot** use `USER axon` in the Dockerfile — it breaks the init system.

Instead, each worker's `run` script uses `s6-setuidgid axon` to drop privileges before exec'ing the binary:
```sh
exec s6-setuidgid axon /usr/local/bin/axon crawl worker
```

The `axon` user (UID 1001) owns the data directories but the init process stays root. This is the correct s6-overlay pattern.

## Adding a New Worker

1. Create `docker/s6/s6-rc.d/<name>-worker/`:
   ```
   <name>-worker/
   ├── type        # contains the single word: longrun
   └── run         # startup script (executable)
   ```
2. `run` script template:
   ```sh
   #!/bin/sh
   exec s6-setuidgid axon /usr/local/bin/axon <subcommand> worker
   ```
3. Add to user bundle: create `docker/s6/s6-rc.d/user/contents.d/<name>-worker` (empty file)
4. The worker will auto-start when the container boots.

## Build Context

The `Dockerfile` uses `context: .` (repo root) in `docker-compose.yaml`. Always build from the repo root:
```bash
docker compose build          # correct — runs from axon_rust/
docker build docker/          # WRONG — missing source files
```

The build command inside the container is `cargo build --release --bin axon`.

## Volumes & Data Directory

All data mounts use `${AXON_DATA_DIR:-./data}/axon/...`. Override `AXON_DATA_DIR` in `.env` to point at a persistent path:
```
AXON_DATA_DIR=/home/yourname/appdata
```

Never hardcode `/home/jmagar/appdata` — it's the original dev machine path.

## Chrome Container (`axon-chrome`)

| Port | Purpose |
|------|---------|
| 6000 | headless_browser management API (`AXON_CHROME_REMOTE_URL`) |
| 9222 | Chrome DevTools Protocol (CDP) proxy |

`AXON_CHROME_REMOTE_URL` and `CHROME_URL` both point at port 6000. The crawler uses port 6000 for session management, not 9222 directly.

## Container Introspection

```bash
# Check which s6 workers are running
docker exec axon-workers s6-rc -da list

# Tail a specific worker's log
docker exec axon-workers tail -f /var/log/crawl-worker/current

# Check a worker's exit status / restart count
docker exec axon-workers s6-svstat /run/service/crawl-worker

# Restart a single worker without restarting the container
docker exec axon-workers s6-svc -r /run/service/crawl-worker

# Open a shell as axon user
docker exec -it -u axon axon-workers bash
```

## Port Reference

| Service | Host Port | Container Port |
|---------|-----------|----------------|
| axon-postgres | 53432 | 5432 |
| axon-redis | 53379 | 6379 |
| axon-rabbitmq | 45535 | 5672 |
| axon-rabbitmq mgmt | 15672 | 15672 |
| axon-qdrant HTTP | 53333 | 6333 |
| axon-qdrant gRPC | 53334 | 6334 |
| axon-chrome mgmt | 6000 | 6000 |
| axon-chrome CDP | 9222 | 9222 |

All ports bind to `127.0.0.1:PORT` — not externally exposed.
