# axon reddit (removed — use `axon ingest`)
Last Modified: 2026-03-09

> **This command has been replaced.** Use [`axon ingest`](ingest.md) instead.
>
> `axon ingest` auto-detects the source type. Reddit subreddit prefixes (`r/name`) and URLs are recognized automatically.

## Migration

```bash
# Before
axon reddit r/unraid
axon reddit r/unraid --sort top --time week --wait true

# After
axon ingest r/unraid
axon ingest r/unraid --sort top --time week --wait true
```

See [`docs/commands/ingest.md`](ingest.md) for full reference.
