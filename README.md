# @supersuit/cowitness

Cowitness: you share a photo or video from your day, and the people you share with witness it, one at a time, full screen, and can say something back, typed or spoken. A streak counts the days in a row you shared.

The package knows how the feature works. The app says who the people are and where things are kept.

## Install

```bash
npm install @supersuit/cowitness
```

Peers: `next` 16, `react` and `react-dom` 19, and `firebase-admin` 13 for the server entry.

## Three entry points

- `@supersuit/cowitness`: the types and every rule, pure, safe anywhere.
- `@supersuit/cowitness/server`: the store and the route handlers. Server only.
- `@supersuit/cowitness/client`: the React screens.

## Releasing

A release is a version tag. Bump `version` (`npm version <x.y.z> --no-git-tag-version`), add the CHANGELOG entry, commit `package.json` and `package-lock.json` together (`npm ci` refuses a release whose lockfile does not match the version), push, then `git tag v<x.y.z> && git push origin v<x.y.z>`. GitHub Actions tests, builds and publishes through npm trusted publishing. Nothing is ever published from a laptop.
