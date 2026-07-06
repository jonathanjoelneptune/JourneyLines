# JourneyLines v1.1 — Globe + GitHub Actions Fix

## Summary

This repo update is intended to replace the current browser-uploaded JourneyLines repo contents.

## Included fixes and updates

- Keeps the globe-first JourneyLines update.
- Keeps the nested repo structure currently used in GitHub:
  - `.github/workflows/deploy.yml`
  - `journeylines/`
- Adds a complete GitHub Actions Pages workflow at `.github/workflows/deploy.yml`.
- Removes `package-lock.json` to avoid the internal registry URLs that caused `npm ci` to hang.
- Uses `npm install --registry=https://registry.npmjs.org/` in the workflow.
- Uses Node 24 in GitHub Actions.
- Keeps the build artifact path as `./journeylines/dist`.
- Removes the unused `gh-pages` package/script because deployment now uses GitHub Actions.

## Upload instructions

Upload the contents of this folder to the root of the existing `JourneyLines` GitHub repo.

The repo root should look like this after upload:

```text
.github/workflows/deploy.yml
.gitignore
VERSION.md
journeylines/index.html
journeylines/package.json
journeylines/vite.config.js
journeylines/src/...
```

Do not upload a `package-lock.json` file for this version.
