# Security policy

## Report a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: open the [Security tab](https://github.com/onwp/presstrace-wordpress-apm/security) of the repository and click **Report a vulnerability**.

Include the affected part (plugin or app), the version, steps to reproduce, and the impact you expect. You will get a reply within a few days. Once a fix is released, the advisory is published with credit to you unless you ask otherwise.

## Supported versions

Only the latest release gets security fixes.

## Verify a release

The release workflow builds the plugin zip and the app bundle on GitHub Actions and attests their build provenance. With the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify presstrace-0.1.0.zip -R onwp/presstrace-wordpress-apm
gh attestation verify presstrace-app-0.1.0.tar.gz -R onwp/presstrace-wordpress-apm
gh attestation verify oci://ghcr.io/onwp/presstrace:0.1.0 -R onwp/presstrace-wordpress-apm
```

`SHA256SUMS` in each release lists the checksums of the zip and the bundle.

## Scope

The plugin and the app in this repository. How the app handles keys, sessions and data is described on the [security page](https://onwp.github.io/presstrace-wordpress-apm/reference/security) of the docs.

## Audits

- [OWASP Top 10:2025 audit of the app](docs/security/owasp-top10-audit.md) (2026-10-21): test cases per category from OWASP ASVS 5.0.0 level 2 and the WSTG, findings with CVSS scores and fixes, dependency and image scans, and accepted limitations.
