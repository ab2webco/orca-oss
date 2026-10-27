# Own identity and services: decisions the owner must make (ORCA-329)

Nothing in ORCA-329 can be built until five decisions are made: the **domain**, the **hosting
target**, the **identity provider**, and who owns the **Apple** and **Google Play** enrollments.
This document lists each decision with its options and tradeoffs and stops there. No code changes
until the owner has chosen, because code that points at a service that does not exist yet would
be an incomplete feature.

Background: [`upstream-runtime-dependencies.md`](./upstream-runtime-dependencies.md) explains
why `login.onorca.dev`, `relay.onorca.dev` and `share.onorca.dev` are still upstream's.

## Decisions at a glance

| # | Decision | Blocks | Recommended default |
| --- | --- | --- | --- |
| D1 | Domain for the three services | IdP, relay, artifacts | One domain for `login.` and `relay.`, plus a **separate registrable domain** for shared artifacts |
| D2 | Identity provider vendor | IdP, and then relay and artifacts | A self-hosted OIDC server behind a small Orca-owned desktop auth gateway |
| D3 | Hosting target | All three services | One VPS for the IdP and the gateway; decide relay hosting after D2 ships |
| D4 | Apple enrollment owner | macOS notarization, iOS | Organization enrollment under Ab2Web |
| D5 | Google Play enrollment owner | Android distribution | Organization account under Ab2Web |

Order of work once decided: **identity, then relay, then artifacts**, because relay and artifacts
both authenticate against the identity service. D4 and D5 run in parallel with everything else.

## What the desktop actually expects from the server

The finding that shapes D2 is that **the desktop does not speak plain OIDC to the server**. It
uses an Orca-specific JSON contract, so no off-the-shelf IdP can stand in for `login.onorca.dev`
without something translating in front of it.

| Step | Endpoint (relative to `ORCA_CLOUD_API_URL`) | Non-standard part |
| --- | --- | --- |
| Browser authorize | `GET /v1/desktop/auth/authorize` | Extra `local_profile_id` parameter; PKCE S256; loopback `http://127.0.0.1:<port>/auth/callback` (`profile-cloud-pkce.ts:128-138`) |
| Code exchange | `POST /v1/desktop/auth/session` | JSON body `{code, codeVerifier, nonce, redirectUri, state, localProfileId}`; returns `{accessToken, refreshToken, expiresAt, cloud, organizations?, capabilities}` (`profile-cloud-client.ts:183-196`, `profile-cloud-session-exchange.ts:7-14`) |
| Refresh, profile, org, capabilities, logout | `/v1/desktop/auth/{refresh,profile,org,capabilities,logout}` | Orca's own response shapes |
| Relay token | `POST /v1/desktop/auth/relay-token` | Bearer access token; body `{relayHostId, hostPublicKeyB64}`; returns `{relayToken, expiresAt}` (`relay-http-client.ts:85-113`) |
| Relay placement | `POST <relay director>/v1/assign` | Bearer relay token; returns `{v: 1, cellUrl, assignmentEpoch, lease}` (`relay-http-client.ts:115-153`) |

Every endpoint can already be overridden by environment variable (`profile-cloud-auth-config.ts:75-121`).
The artifact host cannot: `resolveArtifactCloudApiUrl` rejects any host that is not `onorca.dev`
or loopback (`src/main/artifacts/artifact-cloud-config.ts:21-27`). Moving artifacts therefore
needs a code change, which can only be written once D1 is decided.

### Live probe of upstream (2026-10-27)

Approved by the lead as one unauthenticated read with no credentials and no writes:

- `GET https://login.onorca.dev/.well-known/openid-configuration` at 05:32:21Z returned
  **404**, `content-type: text/plain; charset=UTF-8`, a 13-byte body (`404 Not Found`). There was
  no JSON, so there are no key names to record.

What this shows: upstream does not publish a standard OIDC discovery document on that host, which
fits the custom contract above. What it does **not** show: whether upstream accepts
`client_id=orca-desktop` from a Lab build's loopback redirect, or whether an upstream account can
publish an artifact. Both are still unverified, because answering them needs a real account and
a request with credentials, which this run was not authorized to make.

## D1. Domain

| Option | Pros | Cons |
| --- | --- | --- |
| Subdomains of an existing Ab2Web domain (`login.`, `relay.`, `share.`) | Uses existing DNS and brand; no purchase | User-uploaded artifact HTML on the same registrable domain as `login.` can set cookies on the parent domain, so a shared page could interfere with sign-in sessions |
| A new product domain for Orca Lab | Separates the product from the agency brand; can move to a new owner cleanly | Costs a purchase and DNS setup; same cookie issue if `share.` stays under it |
| **Login and relay on one domain, artifacts on a separate registrable domain** (the pattern behind `githubusercontent.com`) | Isolates untrusted user content from the identity host | Two domains to own and renew |

The owner has to choose the domain names and decide whether artifacts get their own registrable
domain.

## D2. Identity provider

Each option needs the desktop auth gateway described above (the `/v1/desktop/auth/*` contract,
including minting the relay token). The exception is rewriting the desktop client to plain OIDC.
That rewrite diverges from upstream and gets more expensive with every upstream merge.

| Option | Pros | Cons |
| --- | --- | --- |
| **Zitadel**, self-hosted | One Go binary plus Postgres; organizations are built in, which maps onto the `org` endpoint | Smaller community than Keycloak |
| **Keycloak**, self-hosted | Most mature; widest set of protocols and admin features | Heavy JVM footprint; upgrades are operational work |
| **Authentik**, self-hosted | Friendly admin UI; flexible flows | Needs Postgres and Redis; Python stack |
| Managed (Auth0, WorkOS, Clerk) | Nothing to operate; social logins ready on day one | Per-user pricing; vendor lock-in; user identities live with a third party |
| No vendor: the gateway is the IdP | Fewest moving parts at the start | Password storage, MFA, account recovery and email all become Orca's code to secure |

The owner has to choose self-hosted or managed, pick the vendor, and choose which sign-in methods
to offer at launch (email, GitHub, Google).

## D3. Hosting target

Each service puts different load on its host. The IdP and gateway are small and stateful
(Postgres). The relay holds long-lived WebSocket connections and benefits from regions close to
users. Artifacts need object storage and a public origin that serves static files.

| Option | Fits | Tradeoffs |
| --- | --- | --- |
| One VPS (Hetzner, DigitalOcean) with Docker Compose | IdP and gateway; a single first relay cell | Cheapest and simplest; one region and one point of failure; backups, TLS and patching are on us |
| Fly.io | Relay cells in several regions; IdP with a managed Postgres add-on | WebSockets and multi-region come easily; the bill grows with always-on machines |
| Cloudflare (Workers, Durable Objects, R2) | Artifacts (R2 has no egress fees) and possibly the relay | Relay cells would have to be rewritten for Durable Objects; the IdP still needs a database elsewhere |
| Kubernetes | — | Too much for one operator at this scale |

The owner has to choose the provider, who holds the billing account, and how much downtime is
acceptable (one VPS can be down for minutes while it reboots).

The relay cell's wire protocol, meaning what happens after `cellUrl` is returned, lives only on
the client side of this repo (`src/main/runtime/relay/`). The server side has to be rebuilt from
that client code. Treat its size as unknown until someone reads the origin pool end to end.

## D4. Apple enrollment owner

One enrollment covers both macOS notarization and iOS distribution.

Current state, as of the ticket comment from 2026-08-29: signing works with team `44FZN9TC23`
("Developer ID Application: Fabian Altahona"), but notarization hangs on Apple's side and is under
support case 20000151321604. macOS users stay on lab.42. The comment in
`.github/workflows/lab-release.yml:404` still names the earlier ANTAKARANA team. Whether the
support case has been resolved since then has **not** been checked in this run.

| Option | Pros | Cons |
| --- | --- | --- |
| Keep the individual enrollment (`44FZN9TC23`) | Already paid for and signing | The App Store and Gatekeeper show a person's name; no team roles, so only one person can manage it |
| Organization enrollment under Ab2Web | Company name as the publisher; members can have roles | Needs a D-U-N-S number and Apple's review of the legal entity (days to weeks); means re-signing and moving secrets again |

The owner has to choose the legal entity, and decide whether to wait for the support case to
clear before moving to an organization enrollment.

## D5. Google Play enrollment owner

`.github/workflows/mobile-android-release.yml` already builds a signed upload with the
`ANDROID_UPLOAD_*` secrets. What it lacks is a Play Console account to publish to (ORCA-194).

| Option | Pros | Cons |
| --- | --- | --- |
| Personal developer account | Fastest to open | New personal accounts must run a closed test with a minimum number of testers for a minimum period before production (Google policy; check the current numbers before choosing); a person's name as the publisher |
| Organization account under Ab2Web | No closed-testing minimum for production; company as the publisher | Needs a D-U-N-S number and organization verification |

The owner has to choose the legal entity, which should match D4 so that both stores show the
same publisher.

## Next step

The lead takes D1 to D5 to the owner. Once they are answered, ORCA-329 splits into child tickets
in sequence:

1. IdP and desktop auth gateway, deployed on the D3 host and tested with `ORCA_CLOUD_API_URL` overrides.
2. Point packaged builds at the new login host.
3. Relay director and first cell.
4. Artifact store, plus the code change that replaces the `onorca.dev` allowlist with the D1 domain.
5. Apple and Google enrollment, each tracked separately.
