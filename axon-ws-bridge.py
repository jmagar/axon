# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "websockets>=14.0",
#     "docker>=7.0",
# ]
# ///
"""
Axon WebSocket Bridge — streams Docker container stats to the browser.

Connects to the Docker daemon via /var/run/docker.sock, polls stats for all
containers matching the `axon-*` prefix, and broadcasts per-container metrics
plus aggregate totals over WebSocket at ~500ms intervals.

Usage:
    uv run axon-ws-bridge.py
    # or
    python axon-ws-bridge.py
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import time
from dataclasses import dataclass, field
from typing import Any

import docker
import websockets
from websockets.asyncio.server import ServerConnection

# ── Configuration ──────────────────────────────────────────────────────────────

HOST = "0.0.0.0"
PORT = 9876
POLL_INTERVAL = 0.5  # seconds between stats polls
CONTAINER_PREFIX = "axon-"
DOCKER_STATS_TIMEOUT = 2.0  # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-5s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("axon-bridge")


# ── Data Models ────────────────────────────────────────────────────────────────


@dataclass
class ContainerMetrics:
    name: str
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    memory_usage_mb: float = 0.0
    memory_limit_mb: float = 0.0
    net_rx_bytes: int = 0
    net_tx_bytes: int = 0
    net_rx_rate: float = 0.0  # bytes/s
    net_tx_rate: float = 0.0  # bytes/s
    block_read_bytes: int = 0
    block_write_bytes: int = 0
    block_read_rate: float = 0.0  # bytes/s
    block_write_rate: float = 0.0  # bytes/s
    status: str = "running"


@dataclass
class PreviousSnapshot:
    """Stores previous absolute counters for rate calculation."""

    timestamp: float = 0.0
    net_rx: dict[str, int] = field(default_factory=dict)
    net_tx: dict[str, int] = field(default_factory=dict)
    block_read: dict[str, int] = field(default_factory=dict)
    block_write: dict[str, int] = field(default_factory=dict)


# ── Stats Extraction ───────────────────────────────────────────────────────────


def calc_cpu_percent(stats: dict[str, Any]) -> float:
    """Calculate CPU % from Docker stats JSON (same formula as `docker stats`)."""
    cpu = stats.get("cpu_stats", {})
    precpu = stats.get("precpu_stats", {})

    cpu_delta = cpu.get("cpu_usage", {}).get("total_usage", 0) - precpu.get(
        "cpu_usage", {}
    ).get("total_usage", 0)
    system_delta = cpu.get("system_cpu_usage", 0) - precpu.get("system_cpu_usage", 0)

    if system_delta <= 0 or cpu_delta < 0:
        return 0.0

    online_cpus = cpu.get("online_cpus", 1) or 1
    return (cpu_delta / system_delta) * online_cpus * 100.0


def calc_memory(stats: dict[str, Any]) -> tuple[float, float, float]:
    """Returns (usage_mb, limit_mb, percent)."""
    mem = stats.get("memory_stats", {})
    usage = mem.get("usage", 0)
    # Subtract cache for a more accurate "working set" number
    cache = mem.get("stats", {}).get("cache", 0)
    actual = max(usage - cache, 0)
    limit = mem.get("limit", 1)
    usage_mb = actual / (1024 * 1024)
    limit_mb = limit / (1024 * 1024)
    percent = (actual / limit) * 100.0 if limit > 0 else 0.0
    return usage_mb, limit_mb, percent


def calc_network(stats: dict[str, Any]) -> tuple[int, int]:
    """Returns total (rx_bytes, tx_bytes) across all interfaces."""
    networks = stats.get("networks", {})
    rx = sum(iface.get("rx_bytes", 0) for iface in networks.values())
    tx = sum(iface.get("tx_bytes", 0) for iface in networks.values())
    return rx, tx


def calc_block_io(stats: dict[str, Any]) -> tuple[int, int]:
    """Returns (read_bytes, write_bytes) from blkio stats."""
    blkio = stats.get("blkio_stats", {})
    entries = blkio.get("io_service_bytes_recursive") or []
    read_bytes = sum(e.get("value", 0) for e in entries if e.get("op") == "read")
    write_bytes = sum(e.get("value", 0) for e in entries if e.get("op") == "write")
    return read_bytes, write_bytes


# ── Docker Poller ──────────────────────────────────────────────────────────────


class DockerPoller:
    """Polls Docker stats for axon-* containers and computes rates."""

    def __init__(self) -> None:
        self._client: docker.DockerClient | None = None
        self._prev = PreviousSnapshot()

    def _get_client(self) -> docker.DockerClient:
        if self._client is None:
            self._client = docker.DockerClient(
                base_url="unix:///var/run/docker.sock", timeout=5
            )
        return self._client

    def poll(self) -> list[ContainerMetrics]:
        """Synchronous poll — called from a thread via asyncio.to_thread."""
        now = time.monotonic()
        dt = now - self._prev.timestamp if self._prev.timestamp > 0 else POLL_INTERVAL
        self._prev.timestamp = now

        try:
            client = self._get_client()
        except docker.errors.DockerException as exc:
            log.warning("Docker connection failed: %s", exc)
            self._client = None
            return []

        try:
            containers = client.containers.list(
                filters={"name": CONTAINER_PREFIX, "status": "running"}
            )
        except docker.errors.DockerException as exc:
            log.warning("Failed to list containers: %s", exc)
            return []

        results: list[ContainerMetrics] = []

        for container in containers:
            name = container.name or "unknown"
            try:
                stats = container.stats(stream=False)
            except Exception as exc:
                log.debug("Stats failed for %s: %s", name, exc)
                continue

            cpu = calc_cpu_percent(stats)
            mem_usage, mem_limit, mem_pct = calc_memory(stats)
            net_rx, net_tx = calc_network(stats)
            blk_read, blk_write = calc_block_io(stats)

            # Rate calculations (bytes/s)
            prev_rx = self._prev.net_rx.get(name, net_rx)
            prev_tx = self._prev.net_tx.get(name, net_tx)
            prev_br = self._prev.block_read.get(name, blk_read)
            prev_bw = self._prev.block_write.get(name, blk_write)

            net_rx_rate = max(0.0, (net_rx - prev_rx) / dt)
            net_tx_rate = max(0.0, (net_tx - prev_tx) / dt)
            blk_read_rate = max(0.0, (blk_read - prev_br) / dt)
            blk_write_rate = max(0.0, (blk_write - prev_bw) / dt)

            # Store for next delta
            self._prev.net_rx[name] = net_rx
            self._prev.net_tx[name] = net_tx
            self._prev.block_read[name] = blk_read
            self._prev.block_write[name] = blk_write

            results.append(
                ContainerMetrics(
                    name=name,
                    cpu_percent=round(cpu, 2),
                    memory_percent=round(mem_pct, 2),
                    memory_usage_mb=round(mem_usage, 1),
                    memory_limit_mb=round(mem_limit, 1),
                    net_rx_bytes=net_rx,
                    net_tx_bytes=net_tx,
                    net_rx_rate=round(net_rx_rate, 1),
                    net_tx_rate=round(net_tx_rate, 1),
                    block_read_bytes=blk_read,
                    block_write_bytes=blk_write,
                    block_read_rate=round(blk_read_rate, 1),
                    block_write_rate=round(blk_write_rate, 1),
                )
            )

        return results


def build_message(metrics: list[ContainerMetrics]) -> str:
    """Build the JSON message with per-container data + aggregates."""
    containers = {}
    total_cpu = 0.0
    total_mem_pct = 0.0
    total_net_rx_rate = 0.0
    total_net_tx_rate = 0.0
    total_blk_read_rate = 0.0
    total_blk_write_rate = 0.0

    for m in metrics:
        containers[m.name] = {
            "cpu_percent": m.cpu_percent,
            "memory_percent": m.memory_percent,
            "memory_usage_mb": m.memory_usage_mb,
            "memory_limit_mb": m.memory_limit_mb,
            "net_rx_rate": m.net_rx_rate,
            "net_tx_rate": m.net_tx_rate,
            "block_read_rate": m.block_read_rate,
            "block_write_rate": m.block_write_rate,
            "status": m.status,
        }
        total_cpu += m.cpu_percent
        total_mem_pct += m.memory_percent
        total_net_rx_rate += m.net_rx_rate
        total_net_tx_rate += m.net_tx_rate
        total_blk_read_rate += m.block_read_rate
        total_blk_write_rate += m.block_write_rate

    count = len(metrics) or 1

    payload = {
        "type": "stats",
        "timestamp": time.time(),
        "container_count": len(metrics),
        "containers": containers,
        "aggregate": {
            "cpu_percent": round(total_cpu, 2),
            "avg_cpu_percent": round(total_cpu / count, 2),
            "avg_memory_percent": round(total_mem_pct / count, 2),
            "total_net_rx_rate": round(total_net_rx_rate, 1),
            "total_net_tx_rate": round(total_net_tx_rate, 1),
            "total_net_io_rate": round(total_net_rx_rate + total_net_tx_rate, 1),
            "total_block_read_rate": round(total_blk_read_rate, 1),
            "total_block_write_rate": round(total_blk_write_rate, 1),
        },
    }
    return json.dumps(payload, separators=(",", ":"))


# ── WebSocket Server ───────────────────────────────────────────────────────────

connected: set[ServerConnection] = set()
latest_message: str = json.dumps(
    {
        "type": "stats",
        "timestamp": 0,
        "container_count": 0,
        "containers": {},
        "aggregate": {},
    }
)


async def handler(websocket: ServerConnection) -> None:
    """Handle a single WebSocket connection."""
    remote = websocket.remote_address
    log.info("Client connected: %s", remote)
    connected.add(websocket)

    try:
        # Send the latest snapshot immediately so client doesn't wait
        await websocket.send(latest_message)

        # Keep alive — client doesn't send data, so we just wait for close
        async for _ in websocket:
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected.discard(websocket)
        log.info("Client disconnected: %s", remote)


async def broadcast(message: str) -> None:
    """Send message to all connected clients, dropping dead connections."""
    if not connected:
        return
    dead: list[ServerConnection] = []
    for ws in connected:
        try:
            await ws.send(message)
        except websockets.exceptions.ConnectionClosed:
            dead.append(ws)
    for ws in dead:
        connected.discard(ws)


async def poll_loop(poller: DockerPoller) -> None:
    """Main polling loop — runs stats collection in a thread, broadcasts results."""
    global latest_message

    log.info(
        "Polling Docker stats every %.1fs for containers matching '%s*'",
        POLL_INTERVAL,
        CONTAINER_PREFIX,
    )

    while True:
        try:
            metrics = await asyncio.to_thread(poller.poll)
            latest_message = build_message(metrics)
            await broadcast(latest_message)

            if metrics:
                names = ", ".join(m.name for m in metrics)
                total_cpu = sum(m.cpu_percent for m in metrics)
                log.debug(
                    "Broadcast: %d containers [%s] — total CPU %.1f%%",
                    len(metrics),
                    names,
                    total_cpu,
                )
            else:
                log.debug("No axon-* containers found")
        except Exception:
            log.exception("Poll loop error")

        await asyncio.sleep(POLL_INTERVAL)


async def main() -> None:
    """Entry point — start the WebSocket server and polling loop."""
    poller = DockerPoller()

    stop = asyncio.Event()

    def on_signal() -> None:
        log.info("Shutting down...")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, on_signal)

    async with websockets.serve(
        handler,
        HOST,
        PORT,
        origins=None,  # allow all origins for local dev
        compression=None,  # skip per-message deflate for low-latency
    ) as server:
        log.info("Axon WebSocket Bridge listening on ws://%s:%d", HOST, PORT)
        poll_task = asyncio.create_task(poll_loop(poller))

        await stop.wait()
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass

    log.info("Bridge stopped. This is the Way.")


if __name__ == "__main__":
    asyncio.run(main())
