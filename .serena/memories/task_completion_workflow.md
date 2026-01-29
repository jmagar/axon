# Task Completion Workflow

## What to Do When a Task is Completed

### 1. Code Quality Checks

Before considering a task complete, run these commands in order:

```bash
# 1. Format the code
pnpm format

# 2. Type check (ensure no TypeScript errors)
pnpm type-check

# 3. Run tests (ensure all tests pass)
pnpm test
```

**Expected Results:**
- `pnpm format`: Should complete without errors, modifying files if needed
- `pnpm type-check`: Should show "Found 0 errors"
- `pnpm test`: Should show all 326 tests passing (~800ms runtime)

### 2. Build Verification

```bash
# 4. Clean and rebuild
pnpm clean
pnpm build
```

**Expected Results:**
- `pnpm clean`: Removes `dist/` directory
- `pnpm build`: Successfully compiles TypeScript, generates declaration files

### 3. Functional Testing

For command-related changes, test the actual CLI:

```bash
# 5. Test the CLI command locally
pnpm build
pnpm local -- <command> <args>

# Examples:
pnpm local -- scrape https://example.com
pnpm local -- config
pnpm local -- --status
```

### 4. Git Workflow

```bash
# 6. Stage changes
git add <modified-files>

# 7. Commit (Husky will auto-format on commit)
git commit -m "type: description"

# Commit message format:
# - feat: new feature
# - fix: bug fix
# - docs: documentation changes
# - refactor: code refactoring
# - test: test changes
# - chore: build/tooling changes

# 8. Push to branch
git push origin <branch-name>
```

### 5. Documentation Updates

If the change affects user-facing behavior:

```bash
# Update README.md if needed
# Update CLAUDE.md if architecture changed
# Add session log to .docs/sessions/ if significant
```

## Pre-Commit Checklist

- [ ] Code is formatted (`pnpm format`)
- [ ] No TypeScript errors (`pnpm type-check`)
- [ ] All tests pass (`pnpm test`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Functional testing complete (if applicable)
- [ ] Documentation updated (if needed)
- [ ] No hardcoded secrets or credentials
- [ ] No `console.log()` debugging statements left behind
- [ ] Changes follow existing code style and patterns

## Common Issues

### TypeScript Errors
If `pnpm type-check` fails:
1. Check the error message for the file and line number
2. Ensure all function parameters and return types are correctly typed
3. Avoid using `any` - use proper types or interfaces
4. Check for missing imports

### Test Failures
If `pnpm test` fails:
1. Read the test failure message carefully
2. Check if changes broke existing functionality
3. Update tests if behavior intentionally changed
4. Ensure mocks are properly reset between tests

### Build Failures
If `pnpm build` fails:
1. Run `pnpm clean` first
2. Check for syntax errors in TypeScript files
3. Verify `tsconfig.json` is correct
4. Ensure all imports are valid

## Emergency Rollback

If something breaks badly:

```bash
# Revert uncommitted changes
git checkout -- <file>

# Revert last commit (keep changes)
git reset --soft HEAD~1

# Revert last commit (discard changes)
git reset --hard HEAD~1

# Rebuild from clean state
pnpm clean
pnpm install
pnpm build
pnpm test
```
