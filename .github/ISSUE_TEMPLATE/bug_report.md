---
name: Bug report
about: Report something that is broken or behaving incorrectly
title: "[Bug] "
labels: bug
assignees: ''
---

## Describe the bug

A clear and concise description of what is wrong.

## Steps to reproduce

1. Go to '...'
2. Call endpoint '...' with body '...'
3. See error

## Expected behaviour

What you expected to happen.

## Actual behaviour

What actually happened. Include the full error response body or stack trace if available.

## Environment

| Field | Value |
|---|---|
| Node.js version | <!-- e.g. 20.11.0 --> |
| `STELLAR_SETTLEMENT_MODE` | <!-- mock / stellar --> |
| `STELLAR_NETWORK` | <!-- testnet / public / standalone --> |
| `NODE_ENV` | <!-- development / production --> |
| Deployment | <!-- local / Docker / cloud --> |

## Relevant logs

```
Paste any relevant server logs here (redact secrets and passwords).
```

## Acceptance criteria

- [ ] The bug is fixed and covered by a test (or a documented reason why a test is not feasible)
- [ ] Verified on main at `<sha>` <!-- replace <sha> with the commit on main that verifies the fix -->

## Additional context

Any other context, screenshots, or links that help explain the problem.