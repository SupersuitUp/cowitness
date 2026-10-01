# tailor/

Only the fingerprints the private-words check refuses. `forbidden.sha256` holds one SHA-256 per
line of a lowercased word or phrase that must never appear in this public package: the names of
the people and apps that use it. The words themselves are never written down here.

Add one with `node scripts/private-words.mjs --add <word>`. The check, `npm run check:private-words`,
runs in CI and before every publish. The folder is named `tailor/` because the vendored check
(from the living-template framework) skips that folder by design.
