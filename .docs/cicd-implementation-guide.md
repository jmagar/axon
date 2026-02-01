# CI/CD Implementation Guide
**Date:** 2026-01-31
**Project:** CLI Firecrawl
**Status:** Ready for Implementation

---

## Quick Start

This guide walks you through implementing the CI/CD infrastructure created in the DevOps review.

---

## Files Created

### GitHub Actions Workflows
```
.github/workflows/
├── ci.yml          # Continuous Integration (test, lint, build)
├── security.yml    # Security scanning (audit, secrets, CodeQL)
└── release.yml     # Automated releases (npm publish, GitHub release)
```

### Configuration Files
```
.
├── renovate.json           # Automated dependency updates
├── .editorconfig          # IDE consistency
├── .nvmrc                 # Node version lock
├── SECURITY.md            # Security policy
├── .github/
│   ├── dependabot.yml     # Alternative to Renovate
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.yml
│       └── feature_request.yml
```

---

## Phase 1: Enable CI/CD (Week 1)

### Step 1: Configure GitHub Secrets

Navigate to: **GitHub Repo → Settings → Secrets and variables → Actions**

Add the following secrets:

1. **NPM_TOKEN**
   ```bash
   # Generate token at: https://www.npmjs.com/settings/[username]/tokens
   # Type: Automation
   # Scope: Read and write
   ```

2. **CODECOV_TOKEN** (optional, for coverage reporting)
   ```bash
   # Sign up at: https://codecov.io
   # Add repo and copy token
   ```

### Step 2: Enable GitHub Actions

1. Go to: **GitHub Repo → Settings → Actions → General**
2. Set **Actions permissions:** Allow all actions and reusable workflows
3. Set **Workflow permissions:** Read and write permissions
4. Check **Allow GitHub Actions to create and approve pull requests**

### Step 3: Test CI Workflow

Commit the new workflow files:

```bash
cd /home/jmagar/workspace/cli-firecrawl

# Stage all new files
git add .github/ .editorconfig .nvmrc renovate.json SECURITY.md .docs/

# Commit
git commit -m "feat: add CI/CD infrastructure

- Add GitHub Actions workflows (ci, security, release)
- Add Renovate for dependency updates
- Add security policy (SECURITY.md)
- Add PR/issue templates
- Add .editorconfig and .nvmrc for consistency

Implements recommendations from .docs/cicd-devops-review-2026-01-31.md"

# Push to trigger CI
git push origin feat/async-embeddings-resilience
```

Expected result:
- CI workflow runs on push
- All jobs (test, coverage, build-quality) should pass
- Check: GitHub Actions tab for results

### Step 4: Fix Husky Deprecation Warning

Update .husky/pre-commit to remove deprecated husky.sh:

```bash
# .husky/pre-commit (remove lines 1-2)
pnpm exec lint-staged
pnpm type-check
pnpm test
```

Reinstall Husky:
```bash
pnpm remove husky
pnpm add -D husky
pnpm exec husky init
```

### Step 5: Enable Renovate Bot

**Option A: Renovate (Recommended)**
1. Install: https://github.com/apps/renovate
2. Click "Configure"
3. Select repository: firecrawl-cli
4. Renovate will detect renovate.json and start creating PRs

**Option B: Dependabot (GitHub Native)**
- Already configured in .github/dependabot.yml
- Automatically enabled if file exists
- No additional setup required

---

## Phase 2: Security Hardening (Week 2)

### Step 1: Enable CodeQL

CodeQL is already configured in .github/workflows/security.yml

To view results:
1. Go to: **GitHub Repo → Security → Code scanning alerts**
2. Wait for first security.yml workflow run
3. Review and fix any alerts

### Step 2: Enable Secret Scanning

1. Go to: **GitHub Repo → Settings → Code security and analysis**
2. Enable **Secret scanning**
3. Enable **Push protection** (blocks commits with secrets)

### Step 3: Enable Dependabot Security Updates

1. Go to: **GitHub Repo → Settings → Code security and analysis**
2. Enable **Dependabot alerts**
3. Enable **Dependabot security updates**

### Step 4: Review Security Policy

1. Read SECURITY.md
2. Update contact email: security@firecrawl.dev → your email
3. Commit updates

---

## Phase 3: Release Automation (Week 3)

### Step 1: Install Standard Version (Recommended)

```bash
pnpm add -D standard-version
```

Add scripts to package.json:
```json
{
  "scripts": {
    "release": "standard-version",
    "release:minor": "standard-version --release-as minor",
    "release:major": "standard-version --release-as major",
    "release:patch": "standard-version --release-as patch",
    "release:dry": "standard-version --dry-run"
  }
}
```

### Step 2: Create CHANGELOG.md

```bash
pnpm run release:dry
# Review generated changelog
pnpm run release
```

This will:
- Analyze conventional commits since last tag
- Update package.json version
- Generate/update CHANGELOG.md
- Create git tag
- Commit changes

### Step 3: Configure Release Workflow

The release.yml workflow is already configured to:
1. Validate version consistency
2. Run full test suite
3. Build project
4. Publish to npm
5. Create GitHub release with changelog

### Step 4: Test Release Process

```bash
# 1. Create release with standard-version
pnpm run release:patch

# 2. Push tag to trigger release workflow
git push --follow-tags

# 3. Monitor GitHub Actions
# 4. Verify npm publish: npm view firecrawl-cli
# 5. Verify GitHub release created
```

---

## Phase 4: Coverage Enforcement (Week 4)

### Step 1: Update Vitest Config

Edit vitest.config.mjs:

```javascript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.e2e.test.ts'
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85
      }
    }
  }
});
```

### Step 2: Improve Coverage

Priority files:
1. **src/utils/auth.ts** (currently 4.25%)
2. **src/utils/http.ts** (currently 39.65%)

Create tests:
```bash
# auth.ts tests
touch src/__tests__/utils/auth.test.ts

# http.ts tests (may already exist, needs expansion)
# Edit: src/__tests__/utils/http.test.ts
```

### Step 3: Test Coverage Locally

```bash
pnpm test -- --coverage

# View HTML report
open coverage/index.html
```

### Step 4: Enable Coverage Reporting in CI

Coverage is already configured in ci.yml to:
- Run tests with coverage
- Upload to Codecov (if token configured)
- Upload artifacts (7-day retention)

---

## Phase 5: Monitoring (Optional)

### Recommended Tools

1. **Codecov** (Coverage Tracking)
   - Sign up: https://codecov.io
   - Add repo
   - Configure badge in README.md

2. **Snyk** (Security Monitoring)
   - Sign up: https://snyk.io
   - Add repo
   - Automatic PR comments with vulnerability reports

3. **Shields.io** (Badges)
   Add to README.md:
   ```markdown
   ![CI Status](https://github.com/jmagar/firenotes/workflows/CI/badge.svg)
   ![Code Coverage](https://codecov.io/gh/jmagar/firenotes/branch/main/graph/badge.svg)
   ![npm version](https://img.shields.io/npm/v/firecrawl-cli.svg)
   ![License](https://img.shields.io/npm/l/firecrawl-cli.svg)
   ```

---

## Verification Checklist

### CI/CD
- [ ] CI workflow runs on push/PR
- [ ] All test jobs pass (Node 18, 20, 22)
- [ ] Coverage job uploads artifacts
- [ ] Build quality checks pass

### Security
- [ ] Security workflow runs weekly
- [ ] CodeQL analysis enabled
- [ ] Secret scanning enabled
- [ ] Dependabot alerts enabled

### Release
- [ ] NPM_TOKEN secret configured
- [ ] Release workflow exists
- [ ] standard-version installed
- [ ] CHANGELOG.md exists

### Dependencies
- [ ] Renovate or Dependabot enabled
- [ ] Weekly schedule configured
- [ ] Auto-merge rules set (patch/minor only)

### Documentation
- [ ] SECURITY.md exists
- [ ] PR template exists
- [ ] Issue templates exist
- [ ] .editorconfig exists
- [ ] .nvmrc exists

---

## Troubleshooting

### CI Workflow Fails

**Issue:** Tests fail in CI but pass locally

**Solution:**
- Check Node version consistency (.nvmrc vs CI matrix)
- Verify pnpm version consistency
- Check environment variable differences
- Review test isolation (beforeEach/afterEach)

### CodeQL Analysis Fails

**Issue:** CodeQL timeout or memory errors

**Solution:**
```yaml
# In security.yml, add:
jobs:
  codeql:
    timeout-minutes: 30  # Increase from 15
    steps:
      - name: Initialize CodeQL
        with:
          config-file: ./.github/codeql/codeql-config.yml
```

### Release Workflow Fails

**Issue:** "Version mismatch" error

**Solution:**
```bash
# Ensure version in package.json matches tag
git tag v1.2.1  # Version must match package.json
```

**Issue:** "NPM_TOKEN invalid"

**Solution:**
- Regenerate token at npmjs.com
- Ensure token type is "Automation"
- Update GitHub secret

### Renovate/Dependabot Issues

**Issue:** Too many PRs created

**Solution:**
```json
// renovate.json
{
  "prConcurrentLimit": 3,  // Reduce from 5
  "schedule": ["before 5am on Monday"]  // Group updates
}
```

---

## Post-Implementation

### Week 1 After Implementation
- Monitor CI workflow runs
- Review Renovate/Dependabot PRs
- Check CodeQL alerts

### Week 2 After Implementation
- Perform first release with new workflow
- Verify npm publish succeeded
- Verify GitHub release created

### Week 3 After Implementation
- Review security scan results
- Address any CodeQL findings
- Update SECURITY.md if needed

### Month 1 After Implementation
- Measure CI/CD metrics:
  - Build success rate (target: >95%)
  - Average build time (target: <5min)
  - Coverage trend (target: 85%)
- Document lessons learned

---

## Support

**Questions?**
- GitHub Issues: https://github.com/jmagar/firenotes/issues
- GitHub Discussions: https://github.com/jmagar/firenotes/discussions

**References:**
- GitHub Actions Docs: https://docs.github.com/en/actions
- Renovate Docs: https://docs.renovatebot.com
- CodeQL Docs: https://codeql.github.com/docs

---

**Document Version:** 1.0
**Last Updated:** 2026-01-31
**Author:** Claude (Anthropic)
