# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [0.1.1] - 2025-09-15
### Added
- New API: `getIpoDetails({ symbol, series })` to fetch IPO details for a given symbol in `EQ` or `SME` series.

### Changed
- Bump package version to 0.1.1.

## [0.1.0] - 2025-09-13
- Initial release of `@bshada/nseapi`.
- Provides Node.js ESM and CommonJS builds.
- Fully typed API surface (`dist/index.d.ts`).
- Automatic NSE cookie handling and persistence.

[0.1.1]: https://github.com/bshada/nseapi/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bshada/nseapi/releases/tag/v0.1.0
