---
description: Run Axon infrastructure diagnostics and get AI-powered troubleshooting
allowed-tools: Bash, Read
---

## Context

- Current directory: !`pwd`
- Docker services: !`docker compose ps --format json 2>/dev/null | jq -r '.[] | "\(.Service): \(.State) (\(.Health // "no healthcheck"))"' | head -10`
- Axon CLI available: !`which axon || echo "not in PATH"`

## Task

Run comprehensive diagnostics on the Axon infrastructure stack and provide troubleshooting guidance.

### Steps

1. **Check if we're in the Axon project**
   - If `axon` is not in PATH, check if we're in `/home/jmagar/workspace/cli-firecrawl`
   - If we are, use `pnpm local doctor` instead of `axon doctor`
   - If not in project and `axon` not available, inform user they need to either:
     - Navigate to the Axon project directory
     - Install Axon globally

2. **Run doctor diagnostics**
   ```bash
   # Use the appropriate command based on location
   axon doctor --json --pretty
   # OR
   pnpm local doctor --json --pretty
   ```

3. **Analyze the results**
   - Parse the JSON output to identify:
     - Failed checks (status: "fail")
     - Warnings (status: "warn")
     - Overall system health

4. **If there are failures or warnings:**
   - Summarize the issues in plain language
   - For each failed/warned check, provide:
     - What's wrong
     - Why it matters
     - How to fix it (specific commands when possible)

5. **If AI debugging is available:**
   - Check if `ASK_CLI` or OpenAI fallback is configured
   - If yes and there are failures, offer to run `axon doctor debug` for AI-assisted troubleshooting
   - If user wants debug mode, run:
     ```bash
     axon doctor debug
     # OR
     pnpm local doctor debug
     ```

### Output Format

**System Health: [OK/DEGRADED/FAILED]**

**Summary:**
- ✓ X checks passed
- ⚠ X warnings
- ✗ X failures

**Issues:**
[For each failure/warning, provide actionable guidance]

**Next Steps:**
[Recommended actions to resolve issues]

### Common Issues and Fixes

**Docker services not running:**
```bash
cd /home/jmagar/workspace/cli-firecrawl
docker compose up -d
```

**TEI unreachable:**
- Check if steamy-wsl is accessible: `ping 100.74.16.82`
- Verify TEI is running: `curl http://100.74.16.82:52000/health`

**Qdrant connection issues:**
- Check Qdrant container: `docker logs axon-qdrant --tail 50`
- Verify port 53333: `ss -tuln | grep 53333`

**API connection failures:**
- Check Firecrawl API: `docker logs axon-api --tail 50`
- Verify port 53002: `ss -tuln | grep 53002`

**Permission issues:**
- Storage directories need write permissions
- Run: `chmod -R u+w ~/.axon`

**Missing config files:**
- Run `axon login` to create credentials
- Settings are auto-created on first use

### Notes

- The doctor command checks: Docker services, API endpoints, directories, AI CLI availability, and config files
- All service endpoints are tested for connectivity (HTTP/TCP probes with 3s timeout)
- Docker Compose service health is inspected via `docker compose ps`
- AI debugging requires either `ASK_CLI` (claude/gemini) or OpenAI fallback configured
