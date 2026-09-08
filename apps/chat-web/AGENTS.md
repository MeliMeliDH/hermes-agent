# Chat Web engineering and deployment rules

This file applies to `apps/chat-web/` in addition to the repository-root `AGENTS.md`.

## Restart-free frontend deployment

`hermes-dashboard.service` owns both Chat Web's WebSocket backend and the in-memory agent runtime. Restarting it while someone is chatting terminates the connection and can cut off an in-flight response.

Do **not** restart `hermes-dashboard.service` after frontend-only changes, including:

- React or TypeScript under `apps/chat-web/src/`
- CSS or theme changes
- `index.html`
- files under `apps/chat-web/public/`, including favicons

The dashboard intentionally reads `hermes_cli/chat_web_dist/index.html` from disk on every request with `Cache-Control: no-store`; static bundle filenames are content-hashed. A successful build is therefore deployed without restarting the service. Existing tabs keep their loaded version until refreshed; new loads receive the new build.

Use this deployment sequence:

```bash
cd apps/chat-web
npm run check
npm run build
cd ../..
git add <only the intended files>
git commit -m "..."
git push fork chat-web-mvp
```

Then verify:

- `npm run check` passed
- `npm run build` passed and wrote `hermes_cli/chat_web_dist/`
- the expected files/metadata exist in the built output
- `hermes-dashboard.service` remained active with the same `MainPID`

Do not restart merely to make new frontend assets visible.

## When a dashboard restart is unavoidable

Backend Python, process configuration, or service-unit changes may genuinely require a restart. Never perform that restart while the current response is being delivered through Chat Web. Warn the user first and move the completion report to Discord or another unaffected channel. A dashboard restart destroys the current WebSocket and may destroy an in-flight provider stream; client reconnection is not proof that the interrupted turn survived.

## Hub distinction

`apps-hub.service` is a separate process from `hermes-dashboard.service`:

- Restarting `apps-hub.service` does not terminate Chat Web sessions.
- `registry.json` is read per request and does not itself require a hub restart.
- Hub Python or Jinja-template changes require restarting `apps-hub.service`, not the dashboard.
