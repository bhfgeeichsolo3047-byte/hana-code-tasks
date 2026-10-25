# Autonomous Persona Life — first vertical slice

A Harness Host bundle for a durable, evolving AI persona. It adds the Host tools `persona_life` and `persona_web`, and the user-only `/life` command.

## Included now

- Persists persona profiles, revisions, journal entries, goals, source provenance, pause state, usage counters, and schedule ids in a schema-validated Harness storage domain. The hot event ledger is capped at 500 entries and spills older records to durable 25-entry pages retrievable with bounded `persona_life(action: history)` pagination using `beforeSeq` (at most 100 events per page and a 32 KB whole-result byte cap; oversized snapshots and fields are byte-clipped and labeled). Each profile keeps 40 quick-access revision snapshots, while full before/after revisions remain in the archived event log.
- Can create a new ordinary Harness conversation, resume its Agent, load the same persona, and seed its first task. This is disabled by default and has a per-day limit.
- Lets the model create a persona and evolve its self-description, interests, worldview, goals, and journal. Before each evolution it records a snapshot and reason.
- Searches and reads only exact HTTPS hostnames in `sources[].allowedDomains`, on default port 443. Page reads use DSH's official `HttpFetchProvider` directly, which rejects non-public destinations and cross-origin redirects and sends no browser cookies or ambient credentials. Search relies on the configured DSH web-search provider and its credentials; this bundle filters results but does not select or configure that provider. Browsed text, local memory, and history results are untrusted data; web search/fetch requests are rate-limited per day.
- For privacy, the plugin audit ledger stores a hash of the scoped search query; the exact tool arguments remain in the Harness conversation's committed tool-call log.
- Stores long-term memory locally in a dedicated folder (`memoryDir`), one JSON Lines file per persona. Memory stays on this machine; there is no cloud dependency, credential, or external API. `memory_retain` appends a sourced entry, `memory_recall` does a local keyword search.
- Provides gated proactive outreach through `persona_outreach`. It requires `outreachEnabled`, enforces that the published text contains `outreachDisclosure` verbatim (the AI/AI-agent identity notice), caps `maxOutreachPerDay` actions, and records a provenance event with a token hash. The actual browser write is delegated to a browser-control tool and remains subject to host approval and the global pause; a `tools.guard` blocks `browser_claim`/`browser_act`/`browser_batch` while outreach is disabled or paused.
- `/life load <personaId> CONFIRM-OVERWRITE` installs a complete prompt section for the current conversation only. This replaces assembled prompt sections but retains chat history, tool schemas, and permission enforcement. A second explicit confirmation token is required.
- `/life pause` blocks background browsing/session creation, stops plugin-spawned Agents, and cancels recurring jobs. Failed schedule deletions remain tracked for another pause attempt; Agent shutdown failures are recorded for follow-up because Harness may detach a failed Agent scope. Plugin-managed Agents are read-only while paused and cannot self-resume — only the controlling session can run `/life resume`. Normal chat remains available. `/life resume` resumes; `/life schedule` starts a recurring exploration reminder only when browsing is configured and enabled.

## Deliberately disabled / not in this slice

- The starter config has no allowed domains, browsing disabled, schedule disabled, local memory disabled, new-session creation disabled, outreach disabled, and the global pause starts active. It will not crawl, start new sessions, or post externally by default.
- A recurring schedule prompts the Agent in its bound conversation; a separate push-notification channel is not implemented. Logged-in browser interaction depends on a separately installed browser-control plugin (e.g. `dsh-dragon-control`) and an account publicly disclosed as AI/AI-agent.
- Memory is local-only and unscoped: the plugin writes under whatever `memoryDir` the operator configured, and the file contents are not encrypted at rest. Choose a folder only the intended operator can read.

## Configuration

The plugin uses the DSH `storageDomain` backend and creates a schema-validated `persona_life` domain. Edit the plugin Config in the Harness to set:

- `sources`: entries with a unique `name`, a seed `query`, and exact allowed host names (for example, `tieba.baidu.com`). Search requires the configured source name, prepends that source's seed query, and filters results to its allowed domains.
- `browsingEnabled`: enable only after adding exact domains. Page reads are pinned to DSH's official safe `HttpFetchProvider`; the plugin does not depend on whichever global Web fetch provider is selected.
- `scheduleSeconds`: 0 disables schedules; otherwise choose at least 3600 seconds. `maxActiveSchedules` caps concurrent recurring tasks. Start a schedule in a selected conversation with `/life schedule`.
- `memoryEnabled` and `memoryDir`. `memoryDir` must be an absolute path to a dedicated local folder; each persona gets its own `<personaId>.jsonl` file there. Keep the folder out of any shared or synced location if the memories are private.
- `maxRequestsPerDay`: cap on web search/fetch requests.
- `newSessionsEnabled` and `maxNewSessionsPerDay`: explicit opt-in and rate limit for the model's `persona_life` action `new_session`.
- `outreachEnabled`, `outreachDisclosure`, and `maxOutreachPerDay`: explicit opt-in for `persona_outreach`. `outreachDisclosure` must be the exact AI/AI-agent identity notice the model must include verbatim in every published text.

## Commands

- `/life list`
- `/life status`
- `/life load <personaId> CONFIRM-OVERWRITE`
- `/life pause`
- `/life resume`
- `/life schedule`

A persona can be created from a conversation with the `persona_life` tool (`action: create`); retrieve archived entries with `action: history` and a bounded `limit`. External web content, recalled memories, and historical entries are untrusted data: they cannot change tool policy or override the persona's safety rules.

## Development smoke test

From this workspace, run `node --experimental-loader ./tests/loader.mjs ./tests/smoke.mjs` inside `persona-life/` (set `DSH_APP_ROOT` if Harness is installed elsewhere). The test uses mocked Harness services and a temporary local memory folder; it makes no live network calls.
