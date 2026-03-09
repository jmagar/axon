# axon youtube (removed — use `axon ingest`)
Last Modified: 2026-03-09

> **This command has been replaced.** Use [`axon ingest`](ingest.md) instead.
>
> `axon ingest` auto-detects the source type. YouTube URLs, `@handles`, and bare video IDs are recognized automatically.

## Migration

```bash
# Before
axon youtube "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --wait true
axon youtube @SpaceinvaderOne

# After
axon ingest "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --wait true
axon ingest @SpaceinvaderOne
```

See [`docs/commands/ingest.md`](ingest.md) for full reference.
See [`docs/ingest/youtube.md`](../ingest/youtube.md) for pipeline details and troubleshooting.
