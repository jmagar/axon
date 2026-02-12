# CLI Firecrawl - Skill Development Patterns

This document defines the architectural patterns and best practices for creating skills in the CLI Firecrawl project.

## Core Architecture Pattern

All skills in this project follow the **Script-First Agent-Spawning Architecture**:

```
User invokes skill (/skill-name)
  ↓
Skill MUST run executable script FIRST
  ↓
Script performs automated checks
  ↓
Script outputs color-coded results + exit code
  ↓
Exit 0 (success) → Display results, done
Exit 1 (failure) → MUST spawn agent for deep analysis
  ↓
Agent provides detailed diagnostics and remediation
```

### Why This Pattern?

1. **Quick Feedback**: Scripts provide instant automated checks
2. **Reusable Utilities**: Scripts can be run standalone outside Claude
3. **Clear Delegation**: Skills orchestrate, scripts execute, agents diagnose
4. **Consistent UX**: All skills follow the same flow
5. **Efficient Context**: Scripts don't load into context, agents only spawn when needed

---

## Directory Structure

### Required Structure

```
.claude/skills/
└── skill-name/
    ├── SKILL.md (REQUIRED)
    └── scripts/
        └── skill-name.sh (REQUIRED for this project)
```

### Complete Structure

```
.claude/skills/
└── skill-name/
    ├── SKILL.md (REQUIRED)
    ├── scripts/ (REQUIRED)
    │   └── skill-name.sh (executable automation script)
    ├── references/ (OPTIONAL)
    │   └── detailed-implementation.md (deep technical details)
    └── examples/ (OPTIONAL)
        └── real-world-outputs.md (example scenarios)
```

---

## SKILL.md Template

### YAML Frontmatter (Required)

```yaml
---
name: skill-name
description: This skill should be used when the user asks to "trigger phrase 1", "trigger phrase 2", "trigger phrase 3". Include specific phrases users would say. Describes what the skill does and when to use it.
disable-model-invocation: false
---
```

**Critical Requirements:**
- Use third-person: "This skill should be used when..."
- Include 3-5 specific trigger phrases users would actually say
- Be concrete and specific, not vague or generic
- Keep under 300 characters for description

### SKILL.md Body Template

```markdown
# Skill Name

Brief description of what this skill does (1-2 sentences).

## Instructions

### When to Use This Skill

**MUST use when:**
- Specific scenario 1 (be concrete)
- Specific scenario 2 (be concrete)
- Specific scenario 3 (be concrete)

**DO NOT use when:**
- Alternative scenario 1 (when to use something else)
- Alternative scenario 2 (when to use something else)

### Required Execution Method

**MUST run the script FIRST:**

```bash
bash .claude/skills/skill-name/scripts/skill-name.sh [args]
```

**This script automatically:**
- Action 1 (what the script does)
- Action 2 (what the script does)
- Action 3 (what the script does)
- Exits 0 if successful, exits 1 if failed

**Examples:**
```bash
bash .claude/skills/skill-name/scripts/skill-name.sh example1
bash .claude/skills/skill-name/scripts/skill-name.sh example2
```

### When to Spawn [agent-name] Agent

**MUST spawn the agent when:**
- Script exits 1 (operation failed)
- User requests detailed diagnostics or root cause analysis
- Specific condition 1 (be concrete)
- Specific condition 2 (be concrete)

**Example trigger:**
```
Script output: "[failure message]"
→ Spawn [agent-name] agent for deep diagnostics
```

### Manual Execution (Alternative)

If script is unavailable or user needs custom execution, see **`references/implementation.md`** for detailed workflow.

## Edge Cases

1. **Edge case 1**: How to handle it
2. **Edge case 2**: How to handle it
3. **Edge case 3**: How to handle it

## Integration with [Agent Name]

This skill spawns the `[agent-name]` agent for deep analysis when:
- Condition 1
- Condition 2

**Agent capabilities:**
- Capability 1
- Capability 2

**Skill provides quick feedback, agent provides deep investigation.**

## Supporting Files

### Scripts (Required)
- **`scripts/skill-name.sh`** - Executable automation script

### References (Optional)
- **`references/implementation.md`** - Detailed implementation workflow

### Examples (Optional)
- **`examples/outputs.md`** - Real-world output examples
```

**Target Word Count**: 500-1500 words for SKILL.md body

---

## Script Development Guide

### Script Template with Required Elements

```bash
#!/bin/bash
# Skill Name - Brief description
# Usage: skill-name.sh [args]

set -e  # Fail-fast behavior

# Colors (only if TTY) - preserves pipe compatibility
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
  BLUE='\033[0;36m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; DIM=''; BOLD=''; NC=''
fi

# Argument validation
ARG="${1:-}"
if [ -z "$ARG" ]; then
  echo -e "${RED}✗ Error: Argument required${NC}"
  echo "Usage: skill-name.sh <arg>"
  exit 1
fi

# Project root resolution (4 levels up: scripts/ → skill/ → skills/ → .claude/ → root)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$PROJECT_ROOT"

# Step-by-step execution with progress messages
echo -e "${BOLD}→ Step 1: Validation...${NC}"
if [ condition ]; then
  echo -e "${GREEN}✓${NC} Validation passed"
else
  echo -e "${RED}✗${NC} Validation failed"
  exit 1
fi

echo ""
echo -e "${BOLD}→ Step 2: Main operation...${NC}"
set +e  # Capture exit code without failing
main_command
EXIT_CODE=$?
set -e

# Color-coded results with agent spawning suggestion
echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✓ Operation successful${NC}"
  echo -e "${BLUE}Success message${NC}"
  exit 0
else
  echo -e "${RED}✗ Operation failed${NC}"
  echo -e "${YELLOW}Failure details${NC}"
  echo -e "${DIM}For detailed diagnostics, ask Claude to spawn the [agent-name] agent${NC}"
  exit 1
fi
```

**Required elements (checklist)**:
- [ ] Shebang + `set -e`
- [ ] TTY-safe colors (no ANSI codes in pipes)
- [ ] Argument validation + usage message
- [ ] Project root resolution (4 levels up)
- [ ] Step-by-step progress (→ ... ✓)
- [ ] Exit codes (0 = success, 1 = failure)
- [ ] Agent spawning suggestion on failure
- [ ] Executable permissions (`chmod +x`)

---

## Directive Language Requirements

### Use MUST/REQUIRED for Critical Actions

**Good Examples:**
- "MUST use when the user asks about..."
- "MUST run the script FIRST before..."
- "MUST spawn the agent when script exits 1"
- "MUST execute steps in this order"
- "REQUIRED: Validate input before processing"

**Bad Examples:**
- "You should use when..." (second person)
- "Can run the script..." (optional, not directive)
- "Consider spawning the agent..." (suggestion, not requirement)
- "Optionally execute..." (unclear if required)

### Use Third-Person in Descriptions

**Good:**
- "This skill should be used when..."
- "The script automatically checks..."
- "The agent provides diagnostics..."

**Bad:**
- "You should use this skill when..." (second person)
- "Use this skill when..." (imperative to wrong audience)
- "I will check..." (first person)

### Be Concrete and Specific

**Good:**
- "MUST use when user asks to 'test the scrape command', 'run tests for crawl', 'check if config tests pass'"
- "MUST spawn agent when script exits 1 (tests failed)"

**Bad:**
- "MUST use when testing" (too vague)
- "MUST spawn agent when needed" (unclear condition)

---

## Progressive Disclosure Strategy

### What Goes in SKILL.md (Always Loaded)

**Include:**
- Core workflow overview (high-level steps)
- When to use / when NOT to use
- Script execution command with examples
- Agent spawning conditions
- Critical edge cases
- References to supporting files

**Keep under 1500 words**

### What Goes in references/ (Loaded as Needed)

**Move detailed content here:**
- Complete implementation details
- Advanced techniques and patterns
- Technical deep-dives
- Comprehensive troubleshooting guides
- Detailed API documentation

**Each reference file can be 2,000-5,000+ words**

### What Goes in examples/ (Loaded as Needed)

**Include real-world scenarios:**
- Successful execution examples
- Failure examples with error messages
- Edge case examples
- Before/after comparisons
- Common usage patterns

**Show actual output, not descriptions**

---

## Agent Integration Pattern

### Skills Orchestrate, Agents Diagnose

**Skill Responsibilities:**
- Run automated scripts
- Interpret exit codes
- Determine when deep analysis is needed
- Spawn appropriate agent with context

**Agent Responsibilities:**
- Perform deep diagnostics
- Analyze logs and errors
- Identify root causes
- Provide detailed remediation steps
- Generate comprehensive reports

### Clear Spawning Conditions

**MUST define specific triggers:**

```markdown
### When to Spawn [agent-name] Agent

**MUST spawn the agent when:**
- Script exits 1 (operation failed)
- Multiple items are failing (need comprehensive analysis)
- User explicitly requests "detailed diagnostics" or "root cause analysis"
- Specific error pattern detected (be concrete)

**DO NOT spawn agent when:**
- Script exits 0 (operation successful)
- Simple errors with clear fixes
- User only needs quick status check
```

---

## Example Skills in This Project

This project includes two reference skills demonstrating the Script-First pattern:

- **test-command**: Automated testing with type-check prerequisite
- **docker-health**: Comprehensive health checks with embedding model banner

**For detailed implementation analysis**, see `references/example-skills.md` which covers:
- Complete directory structures
- Script patterns and techniques
- Agent spawning strategies
- Anti-patterns to avoid
- Real-world output examples

---

## Testing Your Skill

### 1. Make Script Executable

```bash
chmod +x .claude/skills/skill-name/scripts/skill-name.sh
```

### 2. Test Valid Input (Should Exit 0)

```bash
bash .claude/skills/skill-name/scripts/skill-name.sh valid-arg
echo "Exit code: $?"  # Should print: Exit code: 0
```

**Verify:**
- Script runs without errors
- Output shows green ✓ for success
- Exit code is 0

### 3. Test Invalid Input (Should Exit 1)

```bash
# Test missing argument
bash .claude/skills/skill-name/scripts/skill-name.sh
echo "Exit code: $?"  # Should print: Exit code: 1

# Test invalid argument
bash .claude/skills/skill-name/scripts/skill-name.sh invalid-arg
echo "Exit code: $?"  # Should print: Exit code: 1
```

**Verify:**
- Script shows usage message
- Output shows red ✗ for failure
- Suggests spawning agent for diagnostics
- Exit code is 1

### 4. Verify TTY-Safe Colors

```bash
# In terminal (should have colors)
bash .claude/skills/skill-name/scripts/skill-name.sh valid-arg

# Piped (should have NO ANSI codes)
bash .claude/skills/skill-name/scripts/skill-name.sh valid-arg | cat
```

**Verify:**
- Terminal output has colors
- Piped output has no escape sequences (`\033[...m`)

### 5. Test from Different Directories

```bash
# From project root
bash .claude/skills/skill-name/scripts/skill-name.sh valid-arg

# From random directory
cd /tmp
bash /path/to/project/.claude/skills/skill-name/scripts/skill-name.sh valid-arg
cd -
```

**Verify:**
- Script works from any directory
- Project root resolution is correct

### Quick Validation Checklist

**Before committing:**
- [ ] Script executable, TTY-safe colors, proper exit codes
- [ ] SKILL.md: MUST language, 500-1500 words, references supporting files
- [ ] Frontmatter: Third-person, specific triggers, <300 chars
- [ ] Tested: Valid input (exit 0), invalid input (exit 1), piped output

---

## Common Mistakes to Avoid

### ❌ Bloated SKILL.md
Put detailed content in `references/` and `examples/`, keep SKILL.md under 1,500 words.

### ❌ Vague Language
Use "MUST use when user asks to 'test the scrape command'" not "use when testing".

### ❌ Skipping the Script
Always run the script FIRST, don't list manual commands as the primary workflow.

### ❌ Missing Exit Codes
Scripts must exit 0 (success) or 1 (failure) to enable agent spawning logic.

### ❌ Second Person
Use "This skill should be used..." not "You should use..." in descriptions.

---

## Quick Reference

### Skill Creation Workflow

1. **Plan**: Identify what automation is needed
2. **Create Structure**: `mkdir -p .claude/skills/skill-name/scripts`
3. **Write Script**: Create executable automation script
4. **Write SKILL.md**: Lean, directive, script-first
5. **Test**: Run script with valid/invalid inputs
6. **Document**: Add references/examples if needed
7. **Review**: Check against this CLAUDE.md checklist

### File Size Guidelines

- SKILL.md: 500-1,500 words (lean)
- references/*: 2,000-5,000+ words each (detailed)
- examples/*: 1,000-3,000 words each (comprehensive)
- scripts/*: Focus on correctness, not size

### Must-Have Elements

1. ✅ YAML frontmatter with third-person description + triggers
2. ✅ "When to Use This Skill" section (MUST use when...)
3. ✅ "Required Execution Method" section (MUST run script FIRST)
4. ✅ "When to Spawn Agent" section (MUST spawn when...)
5. ✅ Executable script with proper exit codes
6. ✅ Color-coded output (green ✓, red ✗)
7. ✅ Agent spawning suggestion on failures

---

## Getting Help

**Questions about skill patterns?**
- Read this CLAUDE.md thoroughly
- Study existing skills (test-command, docker-health)
- Check `.claude/skills/test-command/references/bash-implementation.md` for script examples

**Need to review a skill?**
- Use the `/skill-reviewer` agent (plugin-dev)
- Check against the Testing Checklist above
- Verify against examples in this project

---

## Version

**Pattern Version**: 1.0.0
**Last Updated**: 2026-02-06
**Project**: CLI Firecrawl

These patterns are specific to the CLI Firecrawl project and align with plugin-dev best practices while adding project-specific requirements (script-first architecture, agent spawning conditions).
