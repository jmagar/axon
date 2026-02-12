# Example Skills - Detailed Implementation Analysis

This document provides deep-dive analysis of example skills in the CLI Firecrawl project, demonstrating the Script-First Agent-Spawning Architecture pattern.

## Overview

Both example skills follow the established pattern:
1. User invokes skill
2. Skill runs executable script FIRST
3. Script performs automated checks with color-coded output
4. Script exits 0 (success) or 1 (failure)
5. On failure, skill spawns specialized agent for deep analysis

---

## Example 1: test-command

### Purpose

Automate testing workflow with type-checking prerequisite and intelligent test failure analysis.

### Directory Structure

```
test-command/
├── SKILL.md (569 words)
├── scripts/
│   └── test-command.sh ✅ (executable)
├── references/
│   └── bash-implementation.md (detailed implementation guide)
└── examples/
    └── test-outputs.md (7 real-world scenarios)
```

### Pattern Demonstrated

#### 1. Script-First Execution

**SKILL.md excerpt:**
```markdown
## Required Execution Method

**MUST run the script FIRST:**

```bash
bash .claude/skills/test-command/scripts/test-command.sh [test-pattern]
```
```

The skill enforces running the script before any manual intervention.

#### 2. Type-Check Before Tests (Fail Fast)

**Script logic:**
```bash
# Step 1: Type check FIRST
pnpm type-check
if [ $? -ne 0 ]; then
  echo "✗ Type check failed - fix types before running tests"
  exit 1
fi

# Step 2: Only run tests if types pass
pnpm test "$TEST_PATTERN"
```

**Why this matters:**
- Fails fast if types are broken
- Prevents wasting time running tests that would fail anyway
- Enforces type safety discipline

#### 3. Spawns cli-tester Agent on Failures

**SKILL.md excerpt:**
```markdown
### When to Spawn cli-tester Agent

**MUST spawn the agent when:**
- Script exits 1 (tests failed)
- Multiple test files are failing (need comprehensive analysis)
- User explicitly requests "detailed test analysis" or "root cause"
```

**Agent capabilities:**
- Deep test failure analysis
- Root cause identification
- Fix suggestions with code examples
- Test pattern recommendations

#### 4. Progressive Disclosure

**What's in SKILL.md (569 words):**
- Core workflow overview
- When to use the skill
- Script execution command
- Agent spawning conditions
- Critical edge cases

**What's in references/bash-implementation.md:**
- Complete manual implementation (if script unavailable)
- Advanced testing techniques
- Vitest configuration details
- Mock patterns and strategies

**What's in examples/test-outputs.md:**
- 7 real-world scenarios:
  1. All tests pass
  2. Type check failure
  3. Single test failure
  4. Multiple test failures
  5. Timeout errors
  6. Test with specific pattern
  7. No tests found

### Key Takeaways

- **Fail fast**: Type-check before tests saves time
- **Color-coded output**: Green ✓, red ✗, yellow ⚠, blue info
- **Clear exit codes**: 0 = success, 1 = failure (triggers agent)
- **Progressive disclosure**: Lean SKILL.md, detailed references/examples
- **Agent delegation**: Script handles automation, agent handles diagnosis

---

## Example 2: docker-health

### Purpose

Automate health checks for all Docker services in the project with embedding model info banner and service metadata.

### Directory Structure

```
docker-health/
├── SKILL.md (1057 words)
└── scripts/
    └── health-check.sh ✅ (executable)
```

### Pattern Demonstrated

#### 1. Comprehensive Automated Checks

**Script checks all 7 services automatically:**
```bash
SERVICES=(
  "firecrawl:53002"
  "firecrawl-embedder:53000"
  "firecrawl-playwright:53006"
  "firecrawl-qdrant:53333"
  "firecrawl-redis:53379"
  "firecrawl-rabbitmq:5672"
  "steamy-wsl-tei:100.74.16.82:52000"
)
```

**No manual intervention required** - script does everything.

#### 2. Embedding Model Info Banner First

**Output structure:**
```bash
════════════════════════════════════════════════════════════
        TEI Embedding Model Information
════════════════════════════════════════════════════════════
Model:      Qwen/Qwen3-Embedding-0.6B
Location:   steamy-wsl (100.74.16.82:52000)
GPU:        RTX 4070
Status:     Active ✓
════════════════════════════════════════════════════════════

→ Checking Docker services...
```

**Why this matters:**
- Critical context displayed immediately
- User knows TEI is remote (not local)
- GPU acceleration confirmed
- Sets expectations for embedding capabilities

#### 3. Color-Coded Status with Metadata

**Output format:**
```
Service: firecrawl
  Status:    ✓ Up (healthy)
  Port:      53002
  Image:     ghcr.io/firecrawl/firecrawl:latest
  Uptime:    3 days
  Memory:    245MB / 2GB

Service: firecrawl-qdrant
  Status:    ✓ Up (healthy)
  Port:      53333
  Image:     qdrant/qdrant:latest
  Uptime:    3 days
  Memory:    180MB / 1GB
  Collections: 2 (firecrawl, test)
```

**Color coding:**
- Green ✓ = Healthy
- Yellow ⚠ = Degraded (up but unhealthy)
- Red ✗ = Down (stopped or missing)

#### 4. Spawns docker-debugger Agent on Degraded Status

**SKILL.md excerpt:**
```markdown
### When to Spawn docker-debugger Agent

**MUST spawn the agent when:**
- Script exits 1 (one or more services unhealthy/down)
- Multiple services are degraded
- User requests "detailed diagnostics" or "root cause analysis"
- Persistent health issues across restarts
```

**Agent capabilities:**
- Log analysis for failed services
- Port conflict detection
- Resource exhaustion diagnosis
- Container configuration review
- Restart strategy recommendations

#### 5. Service Metadata Collection

**Script gathers additional context:**
- Container uptime
- Memory usage
- Image versions
- Port bindings
- Qdrant collection count (if Qdrant is up)
- RabbitMQ queue status (if RabbitMQ is up)

**Why this matters:**
- More context for troubleshooting
- Identify resource issues
- Version tracking
- Understand service relationships

### Key Takeaways

- **Comprehensive automation**: Checks all services in one command
- **Context-first**: TEI banner provides critical info upfront
- **Rich metadata**: Beyond just up/down - memory, uptime, versions
- **Smart agent triggering**: Only spawn agent when actually needed
- **Service awareness**: Special handling for Qdrant (collections) and RabbitMQ (queues)

---

## Common Patterns Across Both Skills

### 1. Executable Scripts with Proper Permissions

```bash
chmod +x .claude/skills/*/scripts/*.sh
```

Both skills ensure scripts are executable and can run standalone outside Claude.

### 2. TTY-Safe Color Codes

```bash
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  # ... more colors
else
  GREEN=''
  RED=''
  # ... no colors for pipes
fi
```

**Why this matters:**
- Colors in terminal for readability
- No ANSI codes when piped to files/tools
- Works in any environment

### 3. Project Root Resolution

```bash
# Scripts are in: .claude/skills/skill-name/scripts/
# Need to get to: project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"
```

**Path traversal:**
- `scripts/` → `skill-name/` → `skills/` → `.claude/` → project root
- Ensures all commands run from correct directory
- Works regardless of where script is invoked from

### 4. Proper Exit Codes

```bash
# Success path
if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ Success"
  exit 0
fi

# Failure path
echo "✗ Failed"
echo "For detailed diagnostics, ask Claude to spawn the [agent-name] agent"
exit 1
```

**Conventions:**
- Exit 0 = Success (skill done, no agent needed)
- Exit 1 = Failure (skill should spawn agent for deep analysis)

### 5. Agent Spawning Suggestions

Both scripts suggest spawning an agent on failure:

**test-command:**
```bash
echo "For detailed test failure analysis, ask Claude to spawn the cli-tester agent"
```

**docker-health:**
```bash
echo "For detailed diagnostics, ask Claude to spawn the docker-debugger agent"
```

**Why this helps:**
- User knows next step
- Clear handoff from script to agent
- Agent name is explicit (no guessing)

### 6. Step-by-Step Progress

Both scripts show progress as they work:

```bash
echo "→ Step 1: Validation..."
# ... work ...
echo "✓ Validation passed"
echo ""
echo "→ Step 2: Main operation..."
# ... work ...
echo "✓ Operation complete"
```

**Benefits:**
- User knows what's happening
- Easy to debug where script fails
- Clear narrative flow

---

## Anti-Patterns to Avoid

Based on these examples, here's what NOT to do:

### ❌ Don't: Skip the Script

**Bad:**
```markdown
## Instructions

Run these manual commands:
1. pnpm type-check
2. pnpm test
3. If tests fail, analyze output
```

**Good:**
```markdown
## Instructions

**MUST run the script FIRST:**
```bash
bash .claude/skills/test-command/scripts/test-command.sh
```
```

### ❌ Don't: Forget TTY Detection

**Bad:**
```bash
# Always output color codes
GREEN='\033[0;32m'
echo -e "${GREEN}Success${NC}"
```

**Good:**
```bash
if [ -t 1 ]; then
  GREEN='\033[0;32m'
else
  GREEN=''
fi
echo -e "${GREEN}Success${NC}"
```

### ❌ Don't: Use Vague Exit Conditions

**Bad:**
```bash
# Unclear when agent should spawn
if something_bad; then
  echo "Something went wrong"
  exit 1
fi
```

**Good:**
```bash
# Clear agent spawning condition
if [ $TEST_FAILURES -gt 0 ]; then
  echo "✗ Tests failed - spawn cli-tester agent for root cause analysis"
  exit 1
fi
```

### ❌ Don't: Make Scripts Dependent on Claude

**Bad:**
```bash
# Script can only run from Claude
if [ -z "$CLAUDE_CONTEXT" ]; then
  echo "Error: Must run from Claude"
  exit 1
fi
```

**Good:**
```bash
# Script is standalone and reusable
# Can run from terminal, CI/CD, or Claude
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"
```

### ❌ Don't: Bloat SKILL.md with Details

**Bad:**
```
skill-name/
└── SKILL.md (5,000 words - everything in one file)
```

**Good:**
```
skill-name/
├── SKILL.md (500-1,500 words - lean overview)
├── references/implementation.md (detailed guide)
└── examples/outputs.md (real-world scenarios)
```

---

## Checklist for New Skills

Based on test-command and docker-health, use this checklist:

### Script Development
- [ ] Shebang: `#!/bin/bash`
- [ ] `set -e` for fail-fast
- [ ] TTY-safe color codes with detection
- [ ] Argument validation with usage message
- [ ] Project root resolution (4 levels up from scripts/)
- [ ] Step-by-step progress messages
- [ ] Color-coded output (✓ ✗ ⚠ for status)
- [ ] Proper exit codes (0 = success, 1 = failure)
- [ ] Agent spawning suggestion on failures
- [ ] Executable permissions (`chmod +x`)

### SKILL.md Structure
- [ ] YAML frontmatter (third-person, specific triggers)
- [ ] "When to Use This Skill" section
- [ ] "Required Execution Method" with script command
- [ ] "When to Spawn Agent" with specific conditions
- [ ] Edge cases documented
- [ ] References to supporting files
- [ ] 500-1,500 words (lean, not bloated)

### Progressive Disclosure
- [ ] SKILL.md = overview and essential workflow
- [ ] references/ = detailed implementation guides
- [ ] examples/ = real-world output scenarios
- [ ] Clear pointers to supporting files

### Testing
- [ ] Script runs successfully with valid input
- [ ] Script fails gracefully with invalid input
- [ ] Exit codes are correct (0 = success, 1 = fail)
- [ ] Colors render in TTY, not in pipes
- [ ] Can run standalone outside Claude
- [ ] Project root resolution works from any location

---

## Conclusion

Both test-command and docker-health demonstrate the Script-First Agent-Spawning Architecture effectively:

- **Scripts handle automation** (checking, running, reporting)
- **Agents handle diagnosis** (analyzing, fixing, guiding)
- **Skills orchestrate** (run script → interpret exit code → spawn agent if needed)

**Key principle:** Quick feedback via scripts, deep analysis via agents, clear handoff between the two.

When creating new skills, follow these patterns for consistency, reusability, and effectiveness.
