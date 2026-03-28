# Releasing Codian

BRAT updates from published GitHub releases, not from raw commits on `main`. To ship an update:

1. Verify the workspace is clean.
2. Run the full release check:
   ```bash
   npm run release:check
   ```
3. Bump the version:
   ```bash
   npm version 1.0.1 --no-git-tag-version
   ```
   Or use `patch`, `minor`, or `major` instead of an explicit version.
4. If you used `--no-git-tag-version`, sync plugin metadata:
   ```bash
   node scripts/sync-version.js
   ```
5. Commit the release preparation:
   ```bash
   git add package.json manifest.json versions.json
   git commit -m "Release 1.0.1"
   ```
6. Create the tag:
   ```bash
   git tag 1.0.1
   ```
7. Push the commit and tag:
   ```bash
   git push origin main
   git push origin 1.0.1
   ```

The `Release` GitHub Actions workflow runs on tag pushes, rebuilds the plugin, validates that the tag matches `package.json` and `manifest.json`, and publishes a GitHub release with `main.js`, `manifest.json`, `styles.css`, and `versions.json`.
