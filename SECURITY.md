# Security Policy

## Supported Versions

We actively support the following versions with security updates:

| Version | Supported          | End of Support |
| ------- | ------------------ | -------------- |
| 1.2.x   | :white_check_mark: | Current        |
| 1.1.x   | :white_check_mark: | 2026-06-30     |
| 1.0.x   | :warning:          | 2026-03-31     |
| < 1.0   | :x:                | Unsupported    |

## Reporting a Vulnerability

**Please do NOT create public GitHub issues for security vulnerabilities.**

To report a security issue, please email: **security@firecrawl.dev**

Include the following information:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact
- Suggested fix (if available)

### Response Timeline

- **Initial Response:** Within 24-48 hours
- **Triage:** Within 5 business days
- **Fix Development:** Based on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: Next release cycle

### Disclosure Policy

- Security issues will be disclosed after a fix is available
- We will coordinate disclosure with reporters
- CVE IDs will be requested for critical vulnerabilities
- Security advisories will be published on GitHub Security Advisories

## Known Security Issues

### Active Issues

None currently.

### Mitigated Issues

#### SEC-007: Shell Command Injection Risk
**Status:** Mitigated (not fully resolved)
**Location:** src/utils/notebooklm.ts
**Risk Level:** Medium
**Mitigation:** Path validation with allowlist and shell metacharacter blocking

**Description:**
The NotebookLM integration uses `execSync('which notebooklm')` to find the Python interpreter. While the interpreter path is validated against an allowlist and dangerous characters are blocked, the use of `execSync` presents a potential attack surface.

**Mitigation Strategy:**
- Allowlist of valid Python interpreter paths
- Regex validation blocking shell metacharacters: ; & | $ ` ( ) { } < > \n \r
- Safe path pattern: `/^\/[a-zA-Z0-9_\-./]+python[0-9.]*$/`
- Fallback to 'python3' on validation failure

**Recommended Fix:**
Replace `execSync` with the `execa` library for safer subprocess execution.

**Tracking Issue:** #TBD

## Security Best Practices

### For Users

1. **Keep CLI Updated:** Regularly update to the latest version
   ```bash
   npm update -g firecrawl-cli
   ```

2. **Protect API Keys:** Never commit `.env` files to version control
   ```bash
   # Use environment variables
   export FIRECRAWL_API_KEY=your-key-here

   # Or secure credential storage
   firecrawl login --api-key your-key-here
   ```

3. **Validate Output Paths:** The CLI validates output paths to prevent directory traversal
   ```bash
   # Safe - writes to current directory
   firecrawl https://example.com -o output.md

   # Blocked - path traversal attempt
   firecrawl https://example.com -o ../../../etc/passwd
   ```

4. **Use HTTPS:** Always use HTTPS URLs when scraping external sites
   ```bash
   # Secure
   firecrawl https://example.com

   # Insecure (avoid)
   firecrawl http://example.com
   ```

### For Contributors

1. **Never Commit Secrets:**
   - API keys
   - Access tokens
   - Private keys
   - Credentials

2. **Input Validation:**
   - Validate all user inputs
   - Sanitize file paths
   - Use allowlists over blocklists

3. **Subprocess Execution:**
   - Prefer `execa` over `child_process.exec`
   - Never interpolate user input into shell commands
   - Use array arguments instead of strings

4. **Dependency Management:**
   - Review dependency updates
   - Run `pnpm audit` before commits
   - Keep dependencies up to date

5. **Code Review:**
   - All PRs require security review
   - Use CodeQL for automated analysis
   - Follow OWASP guidelines

## Security Testing

### Automated Scans

- **CodeQL:** Static analysis for security vulnerabilities
- **TruffleHog:** Secrets scanning in git history
- **pnpm audit:** Dependency vulnerability scanning
- **Renovate:** Automated dependency updates

### Manual Testing

Before each release, we perform:
- Penetration testing of subprocess execution
- Path traversal testing
- Input validation testing
- Credential storage security review

## Security Features

### Path Traversal Protection

The CLI validates all output file paths to prevent directory traversal attacks:

```typescript
// src/utils/output.ts
export function validateOutputPath(outputPath: string): string {
  const resolvedPath = path.resolve(outputPath);
  const cwd = process.cwd();

  if (!resolvedPath.startsWith(cwd)) {
    throw new Error('Output path must be within current directory');
  }

  return resolvedPath;
}
```

### Credential Storage

API credentials are stored securely:

- **macOS/Linux:** OS keychain (keytar library)
- **Fallback:** Encrypted file with 0600 permissions
- **Environment:** `.env` file (gitignored)

### HTTP Security

- **Timeout Protection:** 30-second default timeout on all HTTP requests
- **Retry Logic:** Exponential backoff with max 3 retries
- **User-Agent:** Configurable to bypass Cloudflare blocks
- **HTTPS Enforcement:** Warns on HTTP URLs

## Compliance

This project follows:
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)

## Security Champions

- **Project Maintainer:** [@jmagar](https://github.com/jmagar)
- **Security Lead:** TBD

## References

- [npm Security Best Practices](https://docs.npmjs.com/security-best-practices)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [OWASP CLI Security](https://owasp.org/www-community/vulnerabilities/)

---

**Last Updated:** 2026-01-31
**Version:** 1.0
