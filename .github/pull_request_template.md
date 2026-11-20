## Description

<!-- Summarise what this PR does and why. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing behaviour to change)
- [ ] Documentation update
- [ ] Refactor / code quality improvement
- [ ] Chore (dependency update, tooling, CI)

## Linked issue

Closes #<!-- issue number -->

## Documentation

- [ ] **Docs updated?** (Required for PRs changing routes, environment variables, or system behaviour)
  - [ ] `README.md` updated (for environment variables, configuration settings, or general workflows)
  - [ ] `docs/` updated (for route additions/changes, contract specs, real-time events, or runbooks)
  - [ ] No documentation updates required (explain why below):
    <!-- Rationale if this PR does not modify routes, env vars, or behavior -->

## Scope

<!-- Each issue lists the files it is expected to touch. List any files this PR changes that are NOT in that list, and explain why. Write "None" if the PR stays within scope. -->

Files outside the issue's list and why:

- ...

## Checklist

- [ ] All unit tests pass (`npm test`)
- [ ] Lint passes with no errors (`npm run lint:check`)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] A migration is included if any TypeORM entity was added or changed
- [ ] The migration has been tested against a clean database (`npm run migration:run` from scratch)
- [ ] `npm run migration:check` reports no drift
- [ ] Relevant documentation (README, `docs/`, inline comments) is updated
- [ ] No secrets, credentials, private keys, or `.env` files are committed
- [ ] All acceptance criteria listed on the linked issue are met
- [ ] No public method was removed (or the removal is justified above and documented)
- [ ] **Verified on main at `<sha>`**: <!-- commit hash on main that satisfies the linked issue -->

## How to test

<!-- Step-by-step instructions for a reviewer to verify the change works. -->

1. ...
2. ...

## Screenshots / logs (if applicable)

<!-- Paste any relevant output, curl responses, or screenshots. -->
