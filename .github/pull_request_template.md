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

## How to test

<!-- Step-by-step instructions for a reviewer to verify the change works. -->

1. ...
2. ...

## Screenshots / logs (if applicable)

<!-- Paste any relevant output, curl responses, or screenshots. -->
