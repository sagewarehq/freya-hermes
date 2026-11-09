# freya-hermes

The Hermes plugin for Freya (formerly Talaria), the iPhone app for Hermes.

- **Inbox:** records every session's attention state (running, waiting on an approval or question, needs you)
  across all Hermes backends, served to the app via `/freya inbox --json`.
- **Apps and routines:** the `/freya:app` skill builds apps Freya opens full screen, and `/freya:routine` sets up
  routines that read well in Freya.
- **Push:** end-to-end encrypted notifications through Freya's relay.

Install from Freya (Apps or Overview → Install), or on the server:

```bash
hermes plugins install sagewarehq/freya-hermes --enable --yes-deps
```

**Coming from Talaria?** This replaces `talaria-hermes`. Freya's "Talaria is now Freya" step installs it, removes the
talaria plugin, and moves its data from `~/.hermes/talaria` to `~/.hermes/freya`. It still answers `/talaria`, so
older builds of the app keep working.

Source of truth: `server/hermes-plugin-freya` in the Freya repo.
