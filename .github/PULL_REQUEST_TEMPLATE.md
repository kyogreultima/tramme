## What and why

<!-- What does this change, and why? Link the issue if there is one (Closes #123). -->

## How it was tested

<!-- Commands run, browsers and screen sizes checked. Add a screenshot for interface changes. -->

## Checklist

- [ ] The base branch is `develop` (`main` only for a release or an urgent fix)
- [ ] The title follows Conventional Commits (`feat(editor): …`): it becomes the commit
- [ ] `pnpm test` and `pnpm typecheck` pass
- [ ] New interface text goes through `t()` with a key in `en.json` and `fr.json`
- [ ] Works on small screens and touch, if the interface changed
- [ ] `CHANGELOG.md` updated, if users will notice the change
