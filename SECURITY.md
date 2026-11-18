# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems, especially anything that could affect wagers, the escrow contract or user funds.

Report privately through GitHub's **Security → Report a vulnerability** (private vulnerability reporting) on this repository. Include what you found, how to reproduce it, and what you think the impact is. We aim to acknowledge reports within 3 working days.

## Suspected malware in a pull request or branch

If you think a pull request, branch or dependency contains malware:

1. Do not check it out, install it or open it in an editor.
2. Report it privately as above, with a link to the PR or commit.
3. If you already ran it, assume your machine is compromised: move any crypto to a new wallet created on a clean device, rotate every token and key (GitHub, npm, cloud, SSH, `.env` secrets) from a clean device, and reinstall the operating system.

How pull requests are checked automatically is described in [`docs/SECURITY_CHECKS.md`](docs/SECURITY_CHECKS.md).

## Supported versions

Only the `main` branch is supported.
