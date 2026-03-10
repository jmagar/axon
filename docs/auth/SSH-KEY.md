# SSH Key Auth — Axon
Last Modified: 2026-03-10

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Setup](#setup)
5. [Client Usage](#client-usage)
6. [Environment Variables](#environment-variables)
7. [Security Model](#security-model)
8. [Troubleshooting](#troubleshooting)

---

## Overview

SSH key challenge-response lets headless or CLI clients authenticate to the WebSocket gate and output/download endpoints using an SSH key pair — no shared API token needed on the client, no Tailscale membership required.

**Auth priority:** SSH key auth is checked first. If `X-SSH-Nonce` is present in the request headers, the server attempts SSH key verification before any other auth method.

**Surfaces:** WebSocket (`/ws`), `/output/*`, `/download/*`.

---

## How It Works

```
[Client]
    │  1. GET /auth/ssh-challenge
    ▼
[Server]
    │  → { "nonce": "<64 hex chars>", "expires_secs": 30 }
    ▼
[Client]
    │  2. Signs nonce with SSH private key:
    │     echo -n "<nonce>" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n axon-auth -
    │
    │  3. Upgrade request headers:
    │     X-SSH-Nonce:     <64-hex nonce>
    │     X-SSH-Pubkey:    ssh-ed25519 AAAA... [comment]
    │     X-SSH-Signature: <base64 armored .sig output>
    ▼
[Server — crates/web/ssh_auth.rs]
    │  ① Reads all three headers (HeaderMissing error if any absent)
    │  ② Consumes nonce atomically (single-use, 30s TTL)
    │  ③ Verifies via: ssh-keygen -Y verify -f <allowed_signers> -I <identity>
    │                                        -n axon-auth -s <sig_file>
    │     (nonce passed via stdin; pubkey and sig written to tempfiles)
    │  ④ Returns SshKeyIdentity { fingerprint } on success
    ▼
[WS/HTTP handler]
    │  AuthOutcome::SshKey(identity) → allowed
```

**Nonces are single-use.** The nonce is consumed atomically on first use — a second request with the same nonce returns `NonceNotFound`. This prevents replay attacks.

**Nonces expire after 30 seconds.** Fetch a new nonce within 30 seconds of signing and sending the request.

**Tempfiles, not shell args.** The public key and signature bytes are written to `tempfile::NamedTempFile` and passed as file paths to `ssh-keygen -Y verify`. They are never interpolated into shell arguments, preventing injection.

---

## Prerequisites

- `ssh-keygen` must be installed and in `PATH` on the server (standard on Linux/macOS).
- The client's public key must be in the server's `authorized_keys` file.
- ED25519 keys are recommended (`ssh-keygen -t ed25519`). RSA 4096+ also works.

---

## Setup

### 1. Ensure the client's public key is in `authorized_keys`

By default, the server reads `~/.ssh/authorized_keys` (the home directory of the user running `axon serve`). Add the client's public key:

```bash
# On the server — append the client's public key
echo "ssh-ed25519 AAAA... client-comment" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2. Configure the authorized keys path (optional)

To use a different file, set `AXON_SSH_AUTHORIZED_KEYS` in `.env`:

```bash
AXON_SSH_AUTHORIZED_KEYS=/etc/axon/authorized_keys
```

Set to empty to disable SSH key auth entirely:

```bash
AXON_SSH_AUTHORIZED_KEYS=
```

If `AXON_SSH_AUTHORIZED_KEYS` is unset and `~/.ssh/authorized_keys` does not exist, SSH key auth is unavailable (requests fall through to other auth methods).

---

## Client Usage

### Shell script — single WS connection

```bash
#!/usr/bin/env bash
set -euo pipefail

HOST="https://<host>"   # e.g. https://myhost.ts.net
KEY="$HOME/.ssh/id_ed25519"

# 1. Fetch challenge
CHALLENGE=$(curl -sf "${HOST}/auth/ssh-challenge")
NONCE=$(echo "$CHALLENGE" | python3 -c "import sys,json; print(json.load(sys.stdin)['nonce'])")

# 2. Sign nonce (armored PEM output goes to stdout)
SIG=$(echo -n "$NONCE" | ssh-keygen -Y sign -f "$KEY" -n axon-auth -)

# 3. Encode signature as base64 (single line)
SIG_B64=$(echo "$SIG" | base64 -w 0)

# 4. Read public key
PUBKEY=$(cat "${KEY}.pub")

# 5. Connect (example: curl WS upgrade check)
curl -s --max-time 2 \
  --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "X-SSH-Nonce: ${NONCE}" \
  -H "X-SSH-Pubkey: ${PUBKEY}" \
  -H "X-SSH-Signature: ${SIG_B64}" \
  "${HOST}/ws" \
  -o /dev/null -w "%{http_code}\n"
# → 101 (WebSocket upgrade accepted)
```

### Python client

```python
import json, subprocess, base64, urllib.request, websocket

HOST = "https://<host>"
KEY = f"{Path.home()}/.ssh/id_ed25519"

# 1. Fetch nonce
with urllib.request.urlopen(f"{HOST}/auth/ssh-challenge") as r:
    nonce = json.load(r)["nonce"]

# 2. Sign
result = subprocess.run(
    ["ssh-keygen", "-Y", "sign", "-f", KEY, "-n", "axon-auth", "-"],
    input=nonce.encode(),
    capture_output=True,
)
result.check_returncode()
sig_b64 = base64.b64encode(result.stdout).decode()

# 3. Read pubkey
pubkey = Path(f"{KEY}.pub").read_text().strip()

# 4. Connect
ws_url = HOST.replace("https://", "wss://") + "/ws"
ws = websocket.WebSocketApp(
    ws_url,
    header={
        "X-SSH-Nonce": nonce,
        "X-SSH-Pubkey": pubkey,
        "X-SSH-Signature": sig_b64,
    },
)
```

### Testing end-to-end

```bash
HOST="https://<machine>.ts.net"

# Get nonce
NONCE=$(curl -sf "${HOST}/auth/ssh-challenge" | python3 -c "import sys,json; print(json.load(sys.stdin)['nonce'])")

# Sign and encode
SIG_B64=$(echo -n "$NONCE" | ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n axon-auth - | base64 -w 0)
PUBKEY=$(cat ~/.ssh/id_ed25519.pub)

# Test WS auth — expect 101
curl -s --max-time 2 --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "X-SSH-Nonce: $NONCE" \
  -H "X-SSH-Pubkey: $PUBKEY" \
  -H "X-SSH-Signature: $SIG_B64" \
  "${HOST}/ws" \
  -o /dev/null -w "%{http_code}\n"
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AXON_SSH_AUTHORIZED_KEYS` | `~/.ssh/authorized_keys` | Path to authorized keys file. Set empty to disable SSH key auth. |

---

## Security Model

**Replay prevention:** Nonces are single-use (consumed atomically on first use) and expire after 30 seconds. A stolen nonce+signature cannot be replayed — the nonce is gone after the first use.

**Injection prevention:** Public key and signature are written to `tempfile::NamedTempFile` objects and passed as file paths to `ssh-keygen`. They are never interpolated into shell command strings.

**Key trust:** The server trusts any key in the `authorized_keys` file. Manage this file carefully — each line grants full WS access.

**Namespace:** The SSH namespace is `axon-auth`. Signatures made for other namespaces are invalid (signatures are namespace-bound in the SSH signature protocol).

**No Tailscale required:** SSH key auth bypasses the Tailscale and dual-auth checks entirely. A valid SSH signature grants access regardless of `AXON_REQUIRE_DUAL_AUTH` or `AXON_TAILSCALE_STRICT` settings. This is intentional — SSH key auth is designed for headless clients that cannot participate in Tailscale auth.

---

## Troubleshooting

### `missing SSH header: x-ssh-nonce`

Not actually an SSH auth attempt — a request with some (but not all) SSH headers. The `X-SSH-Nonce` header was absent. All three headers must be present together.

### `ssh nonce not found (never issued or already used)`

Either:
- The nonce was already consumed (replay attempt or a previous request used it)
- The nonce was never issued by this server instance (server restarted, in-memory store cleared)

Fetch a fresh nonce and retry.

### `ssh nonce expired (>30 s)`

More than 30 seconds elapsed between `/auth/ssh-challenge` and the signed request. Fetch a new nonce and complete signing + connection within 30 seconds.

### `ssh-keygen verification failed: ...`

`ssh-keygen -Y verify` returned non-zero. Common causes:

1. **Public key not in `authorized_keys`** — add the key to the file on the server.
2. **Wrong namespace** — the client signed with a namespace other than `axon-auth`. Ensure `-n axon-auth` is used.
3. **Key type mismatch** — the `X-SSH-Pubkey` header must contain the *same* key used for signing.
4. **`ssh-keygen` not found** — install `openssh-client` on the server (`apt-get install openssh-client`).
5. **`authorized_keys` has wrong permissions** — must be `600`:
   ```bash
   chmod 600 ~/.ssh/authorized_keys
   ```

### `authorized_keys file not found`

`AXON_SSH_AUTHORIZED_KEYS` points to a file that doesn't exist, or the default `~/.ssh/authorized_keys` is absent. Create the file or set the env var to a valid path.
