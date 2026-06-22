# Changelog

## 0.4.1 beta

- Switch to workpool + rate limiter instead of custom runner.
- Exclude test files from build.
- Fix test fixture to register nested Workpool
- Improves the `ctx` arg types to be more compatible with convex 1.41+

## 0.3.1

- Fixes handling of non-ok expo response (credit: sanches89)

## 0.3.0

- Adds a batch endpoint for sending push notifications
- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API
