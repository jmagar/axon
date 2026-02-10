# Test Command Bash Implementation

Complete bash implementation for the test-command skill.

## Step 1: Validate Command

Check if the command exists in `src/commands/`:

```bash
COMMAND="$1"

# For single-file commands
if [ -f "src/commands/${COMMAND}.ts" ]; then
  echo "✓ Found command: src/commands/${COMMAND}.ts"
elif [ -d "src/commands/${COMMAND}" ]; then
  echo "✓ Found command directory: src/commands/${COMMAND}/"
else
  echo "✗ Command '${COMMAND}' not found"
  echo ""
  echo "Available commands:"
  ls -1 src/commands/*.ts 2>/dev/null | xargs -n1 basename | sed 's/.ts$//' | sed 's/^/  - /'
  ls -1d src/commands/*/ 2>/dev/null | xargs -n1 basename | sed 's/^/  - /'
  exit 1
fi
```

## Step 2: Run Type Check

Run TypeScript type-checking FIRST (fail fast):

```bash
echo "→ Running type check..."
if pnpm type-check; then
  echo "✓ Type check passed"
else
  echo "✗ Type check failed"
  echo ""
  echo "Fix type errors before running tests"
  exit 1
fi
```

## Step 3: Run Tests

Execute Vitest on the command's test files:

```bash
echo ""
echo "→ Running tests for '${COMMAND}'..."

# Run tests with coverage
pnpm test:unit -- --run "src/__tests__/commands/${COMMAND}"

TEST_EXIT=$?
```

## Step 4: Format Output

Display results with styled output:

```bash
echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo "✓ All tests passed"
  echo ""
  echo "Ready to commit!"
else
  echo "✗ Tests failed"
  echo ""
  echo "Fix failing tests before committing"
  exit 1
fi
```

## Complete Script

Full script combining all steps:

```bash
#!/bin/bash
set -e

COMMAND="${1:-}"

if [ -z "$COMMAND" ]; then
  echo "Usage: test-command <command-name>"
  exit 1
fi

# Change to project root
cd "$(dirname "$0")/../../.."

# Step 1: Validate
if [ -f "src/commands/${COMMAND}.ts" ]; then
  echo "✓ Found command: src/commands/${COMMAND}.ts"
elif [ -d "src/commands/${COMMAND}" ]; then
  echo "✓ Found command directory: src/commands/${COMMAND}/"
else
  echo "✗ Command '${COMMAND}' not found"
  echo ""
  echo "Available commands:"
  ls -1 src/commands/*.ts 2>/dev/null | xargs -n1 basename | sed 's/.ts$//' | sed 's/^/  - /' || true
  ls -1d src/commands/*/ 2>/dev/null | xargs -n1 basename | sed 's/^/  - /' || true
  exit 1
fi

# Step 2: Type check
echo ""
echo "→ Running type check..."
if pnpm type-check; then
  echo "✓ Type check passed"
else
  echo "✗ Type check failed"
  echo ""
  echo "Fix type errors before running tests"
  exit 1
fi

# Step 3: Run tests
echo ""
echo "→ Running tests for '${COMMAND}'..."

# Temporarily disable set -e to capture test exit code
set +e
pnpm test:unit -- --run "src/__tests__/commands/${COMMAND}"
TEST_EXIT=$?
set -e

# Step 4: Format output
echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo "✓ All tests passed"
  echo ""
  echo "Ready to commit!"
  exit 0
else
  echo "✗ Tests failed"
  echo ""
  echo "Fix failing tests before committing"
  exit 1
fi
```
