# Book Club

Vite + React SPA on a Convex backend. Auth via `@convex-dev/auth` (component
mounted at `/auth`). The frontend is served by the `@convex-dev/static-hosting`
component, which owns `/` on the deployment's `.convex.site` domain.

## Deploying (hosting)

The app is hosted on Convex static hosting. **Dev deployment** is live at
https://secret-barracuda-975.convex.site.

Re-deploy **only when your changes are stable** — i.e. `npm run typecheck`
passes and you've verified the change works. Then:

```bash
npm run deploy:dev
```

This pushes the backend (`convex dev --once`) and then builds + uploads the
frontend to the **dev** deployment (`static-hosting upload --build`). The
`--build` step runs `npm run build`, which typechecks first, so a broken build
will not ship.

Notes for agents:
- **Don't re-deploy after every edit.** Static hosting is a publish target, not
  a dev server. During active work use `npm run dev` (Vite HMR + `convex dev`).
  Deploy once when a unit of work is stable.
- **Coordinate in shared workspaces.** If another thread is mid-edit on backend
  files (e.g. `convex/books.ts`) the typecheck in `npm run build` may fail.
  Don't deploy until the tree is stable. To ship just the frontend past a known
  backend type error, bypass the typecheck:
  `static-hosting upload --build-command "npx vite build"`.
- **Production** (separate `descriptive-bullfrog-96` deployment) is not wired to
  a script yet. Ship prod deliberately with `static-hosting deploy` (targets
  prod, runs the full typechecked build).
- Static routing: the component owns `/`; auth keeps `/auth`; any app-owned
  `convex/http.ts` routes live under `/api` (see `convex/convex.config.ts`).
