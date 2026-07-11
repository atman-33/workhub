# Claude Code Commands — Reference

## $ARGUMENTS Patterns

### Single Argument

```markdown
# Code Review

Review the following file or code for quality, security, and best practices:

$ARGUMENTS

Focus on:
- Code quality issues
- Security vulnerabilities
- Performance concerns
- Best practice violations
```

**Usage**: `/review src/auth.js`

### Multiple Arguments

```markdown
# Compare Files

Compare these two files and explain the differences:

$ARGUMENTS

Provide:
- Line-by-line diff
- Semantic changes
- Impact analysis
```

**Usage**: `/compare old.js new.js`

### Optional Arguments

```markdown
# Run Tests

Run tests for the specified scope.

Scope: $ARGUMENTS

If no scope specified, run all tests.
If scope is a file, run tests for that file.
If scope is a directory, run tests in that directory.
```

**Usage**: `/test` or `/test auth/` or `/test login.test.ts`

### Positional Arguments

Use `$1`, `$2`, etc. for specific slots (like shell scripts):

```markdown
# Compare Files

Compare $1 with $2.

Show:
- Line differences
- Semantic changes
- Which version is preferred
```

**Usage**: `/compare old.js new.js` → `$1 = "old.js"`, `$2 = "new.js"`

---

## Command Patterns

### Agent Invocation

```markdown
# Security Audit

Perform a comprehensive security audit.

Target: $ARGUMENTS

Use the **security-auditor** agent to:
1. Scan for OWASP Top 10 vulnerabilities
2. Check authentication patterns
3. Review data validation
4. Analyze dependencies

Provide a severity-rated findings report.
```

### Multi-Agent Orchestration

```markdown
# Fullstack Feature

Build a complete fullstack feature.

Feature: $ARGUMENTS

Workflow:
1. Use **prd-architect** to clarify requirements
2. Use **system-architect** to design approach
3. Use **backend-engineer** for API implementation
4. Use **frontend-engineer** for UI implementation
5. Use **test-architect** for test coverage

Coordinate between agents and ensure integration.
```

### Validation Command

```markdown
# Pre-Commit Check

Validate changes before commit.

Files: $ARGUMENTS (or all staged files if not specified)

Checklist:
- [ ] All tests pass
- [ ] No linting errors
- [ ] No type errors
- [ ] No console.log statements
- [ ] No TODO comments
- [ ] No hardcoded secrets

Return READY or BLOCKED with details.
```

---

## Advanced Patterns

### Conditional Logic

```markdown
# Smart Review

Review target: $ARGUMENTS

If target is a PR number (e.g., #123):
  - Fetch PR details with `gh pr view`
  - Review all changed files

If target is a file path:
  - Review that specific file

If target is a directory:
  - Review all files in directory
```

### Flag Parsing

```markdown
# Generate Tests

Generate tests for: $ARGUMENTS

Options (parsed from arguments):
- `--unit` - Unit tests only
- `--e2e` - E2E tests only
- `--coverage` - Include coverage report

Default: Generate both unit and E2E tests.
```
