# Axon Incus deployment — native axon + nested Docker sidecars

One Incus system container (`axon-container-profile`) hosts the whole axon
stack, but it is **not** all-Docker. Two distinct process models run side by
side inside the same container:

- **axon itself** runs as a **native systemd service**
  (`axon-native.service`, `/usr/local/bin/axon serve`) — built in place with
  `cargo build --release` (Debian x86_64, same OS/arch as dookie — no
  cross-compilation, no image to build or publish for axon).
- **axon-tei, axon-chrome, and (default mode) axon-qdrant** run as **nested
  Docker containers** via `docker compose`, using `docker-compose.prod.yaml`
  largely unchanged (that file still defines an `axon` service too, but
  `bootstrap.sh` deliberately excludes it from the Incus `up -d` invocation —
  that definition exists for bare-host/non-Incus deployments).

Why the split: axon is a single native binary that already runs correctly on
the container's own OS — building/shipping a Docker image for it is pure
overhead with no upside. TEI, chrome, and qdrant genuinely benefit from their
own containerized runtimes/images (GPU toolkit layering, headless-browser
deps, upstream-maintained images), so those stay on nested Docker.

See `docs/superpowers/plans/2026-07-07-incus-zabbly-upgrade.md`
for the (retained, harmless) Incus 6.3+/Zabbly upgrade this deployment builds
on, and `axon_rust-4m749` (beads epic) for the full architecture history —
including the same-day pivot to native Incus OCI containers and revert back
to nested Docker for the sidecars, after native OCI's GPU-compute path was
found genuinely broken (`CUDA_ERROR_OUT_OF_MEMORY` during TEI warmup) on this
host/Incus version. See bead `axon_rust-4m749.2`'s comments for the full
diagnostic trail if you're wondering why the sidecars aren't native OCI.

## Axon process model (native systemd)

`axon-native.service` (`deploy/incus/axon-native.service`, pushed and enabled
by `bootstrap.sh`) runs `/usr/local/bin/axon serve` directly as root inside
the Incus container, reading `EnvironmentFile=/mnt/axon-data/.env` for
config/secrets — the same `.env` the Docker sidecars use, just consumed via
systemd's own env-file mechanism instead of Compose's.

`bootstrap.sh` builds the binary in place on every run where the installed
`axon --version` doesn't match the checkout's `Cargo.toml` version (or when
`AXON_FORCE_REBUILD=1` is set): it ships the source as a `git archive HEAD`
tarball (never a full git clone, so the container never needs its own git
credentials), builds with `cargo build --release --bin axon` under a
container-local Rust toolchain (installed via `rustup` on first run), and
installs the resulting binary to `/usr/local/bin/axon`. A version match skips
the rebuild — this keeps idempotent re-runs (including the post-reboot
systemd re-run) fast; only an actual version bump or an explicit force
triggers a real rebuild.

Check axon's own health with `systemctl status axon-native` / `journalctl -u
axon-native` inside the container — **not** `docker ps`/`docker compose ps`,
which will correctly show no `axon` entry at all. The service is reachable
from the host through the Incus proxy device declared in the profile (see
`incus config show <container>` for the current `listen`/`connect` mapping —
it forwards a host-side address, not `localhost:8001` on the Incus host
itself, to the container's `127.0.0.1:8001`).

## Profile

`profile.yaml` in this directory is exported directly from the live,
validated Incus profile (`incus profile show axon-container-profile`),
minus the live-only `used_by` field. To apply it fresh:

```bash
incus profile create axon-container-profile
incus profile edit axon-container-profile < deploy/incus/profile.yaml
```

Key config, and why:

- `limits.memory: 24GiB` (hard) — derived as 16GiB qdrant (its own existing
  production cap, justified by its own OOM history) + 2GiB TEI + 2GiB chrome
  + 1GiB axon (native process, not a container, but still budgeted the same)
  + 1GiB dockerd overhead, +~14% headroom. Re-verify this still matches
  dookie's actual available headroom before relying on it — it was derived
  once, not continuously monitored.
- `nvidia.runtime: "true"` + `nvidia.driver.capabilities: all` — gives the
  OUTER Incus container GPU/driver visibility (`nvidia-smi` works directly
  in it). The GPU-compute workload (TEI) runs in a NESTED Docker container
  inside this one, and gets its own GPU access via the nested dockerd's own
  `nvidia-container-toolkit` — this is a real, working double-hop, confirmed
  end-to-end with the actual production TEI image (bead `.2`).
- `security.nesting: "true"`, `security.privileged: "false"`,
  `security.syscalls.intercept.{mknod,setxattr}: "true"` — required for the
  nested Docker Engine to function inside an unprivileged Incus container.
- `security.idmap.isolated: "true"` — per-container isolated UID/GID range,
  not a privileged or shared idmap. Container UID 1000 (what axon's Docker
  images run as) maps to a host UID that's stable per-container-instance but
  **not guaranteed identical across a fresh container recreate** — always
  read it back via `incus config get <name> volatile.idmap.current` after
  creating a container, never hardcode the number.
- `gpu` device (bare, no extra options) — whole-GPU passthrough to the outer
  container.

Not in the shared profile (deployment-specific, managed per-container by
`bootstrap.sh`):

- `mcp-publish` proxy device — forwards a host-side address (e.g. dookie's
  Tailscale IP, a stable port) to the container's `127.0.0.1:8001`, where
  `axon-native.service` listens. Set `AXON_HTTP_PUBLISH_LISTEN` (e.g.
  `100.88.16.79:40090`) before running `bootstrap.sh` for it to manage this
  device idempotently; check the live mapping any time with `incus config
  show <container>`.

## Storage

`~/.axon` (the real host appdata root used by today's bare-host / local-dev
deployment) is **NOT** shared directly with this Incus container. A real
attempt to `raw.idmap` the container's UID 1000 onto the real host UID 1000
(jmagar) fails: `/etc/subuid` deliberately excludes real system UIDs like
1000 from root's delegation range (`newuidmap: uid range [1000-1001) ->
[1000-1001) not allowed` — intentional Linux security policy, not a bug to
work around).

The resolution: two **separate**, dedicated host directories, chowned to
whatever host UID the container's isolated idmap currently shifts container
UID 1000 to:

| Host path | Container path | Purpose |
|---|---|---|
| `~/.axon-incus` | `/mnt/axon-data` | jobs.db, config.toml, .env, qdrant storage, TEI cache, artifacts, logs, screenshots — everything `docker-compose.prod.yaml` expects under `${AXON_HOME}` |
| `~/.axon-incus-gemini` | `/mnt/axon-gemini` (read-only) | Gemini CLI auth (`oauth_creds.json`, `gemini-credentials.json`, etc.) |

**This is a deliberate, permanent fork from `~/.axon`, not a temporary
workaround.** Host-native CLI commands (`axon doctor`, `axon stats` run
directly on the bare host, outside any Incus instance) will **not** see this
deployment's data, and vice versa. If you're debugging and see stale/empty
results, check which tree you're actually looking at before assuming
something is broken.

Both paths live under `/home/jmagar` (ZFS dataset `rpool/USERDATA/home_hon64g`),
so they're automatically covered by whatever snapshot/replication policy
already covers this host's home dataset — no new backup-side configuration
needed.

### Verified 2026-07-07 (real command output, not description)

- Mount visibility: `incus exec axon-bootstrap-temp -- ls -la /mnt/axon-data
  /mnt/axon-gemini` shows all files/dirs correctly owned by UID 1000 *as seen
  from inside the container* (idmap-shifted; the same files show as UID
  `1066536` from the host side).
- UID 1000 read/write: `docker run --rm --user 1000:1000 -v
  /mnt/axon-data:/data alpine sh -c 'touch /data/test.txt'` succeeds; the
  resulting file lands on the host owned by `1066536:1066536`, not root.
- Adversarial path-traversal test: `docker run --rm --user 1000:1000 -v
  /mnt/axon-data:/data alpine sh -c 'touch /data/../escape.txt'` →
  `Permission denied` (the bind mount is its own boundary; `..` doesn't
  escape it).
- Adversarial outer-container test: attempting to `touch
  /home/jmagar/escape-test.txt` from inside the outer Incus container (as
  root) → `No such file or directory` — the outer container's rootfs simply
  has no visibility into the host filesystem outside its declared disk
  devices at all.

### Known fragility — nvidia-procfs device

A third device, `nvidia-procfs` (bind-mounting
`/proc/driver/nvidia/gpus/<pci-address>` from host to the same path in the
container), is required for nested-Docker GPU passthrough specifically — and
does **not** reliably survive a container stop/start cycle. If nested Docker
GPU access breaks after a restart with `nvidia-container-cli: mount error:
stat failed: /proc/driver/nvidia/gpus/...: no such file or directory`,
remove and re-add this device:

```bash
incus config device remove <container> nvidia-procfs
incus config device add <container> nvidia-procfs disk \
  source=/proc/driver/nvidia/gpus/0000:03:00.0 \
  path=/proc/driver/nvidia/gpus/0000:03:00.0
```

This is a required boot-time step in `bootstrap.sh` (bead `.5`), not a
one-time fix — see that bead for the automated version.
