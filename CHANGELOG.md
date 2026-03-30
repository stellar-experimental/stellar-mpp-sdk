# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-03-30

### Fixed

- Bump `path-to-regexp` (8.3.0 → 8.4.0), `picomatch` (4.0.3 → 4.0.4), and `yaml` (2.8.2 → 2.8.3) to address security vulnerabilities (CVE-2026-4926, CVE-2026-4923, CVE-2026-33671, CVE-2026-33672) [#28](https://github.com/stellar/stellar-mpp-sdk/pull/28)

### Changed

- Rewrote the Install section in the README to focus on npm package consumers, with peer dependency callout and subpath import examples [#29](https://github.com/stellar/stellar-mpp-sdk/pull/29)
- Add CHANGELOG and release structure for v0.2.x [#31](https://github.com/stellar/stellar-mpp-sdk/pull/31)

## [0.2.0] - 2026-03-30

### Added

- Initial release of `@stellar/mpp` — a TypeScript SDK for Stellar blockchain payment methods in the Machine Payments Protocol (MPP)
- **Charge module**: one-time on-chain SAC token transfers with pull (transaction credential) and push (hash credential) modes, following the [draft-stellar-charge-00](https://paymentauth.org/draft-stellar-charge-00) specification
- **Channel module**: off-chain payment commitments via one-way payment channel contracts with batch settlement on close (session spec in progress)
- Subpath exports for selective imports (`@stellar/mpp/charge/client`, `@stellar/mpp/charge/server`, `@stellar/mpp/channel/client`, `@stellar/mpp/channel/server`, `@stellar/mpp/env`)
- Env parsing primitives for Stellar-aware configuration
- Shared utilities: fee bump wrapping, transaction polling with backoff, Soroban simulation, unit conversion, keypair resolution

[0.2.1]: https://github.com/stellar/stellar-mpp-sdk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/stellar/stellar-mpp-sdk/releases/tag/v0.2.0
