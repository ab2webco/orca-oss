# Own identity and services: decisions the owner must make (ORCA-329)

ORCA-329 depends on five decisions: the **domain**, the **hosting target**, the **identity
provider**, and who owns the **Apple** and **Google Play** enrollments. This document lists each
decision with its options and tradeoffs, and records where each one stands. Nothing changes in
the code until the owner has chosen, because code that points at a service that does not exist
yet would be an incomplete feature.

**Status.** ORCA-329 comment `79c72dcf-633b-432d-a56d-fb2e9e36653c` (2026-10-30) records what
the owner told the lead on 2026-10-28:

- D4 (Apple) and D5 (Google Play) are resolved. The owner's current accounts stay, and they work:
  macOS builds are notarized, iOS reaches TestFlight, and Android uploads to the Play internal
  track.
- D1 (domain), D2 (identity provider) and D3 (hosting) are paused by the owner until after the
  release. Their sections below keep the options for when the work resumes.

Background: [`upstream-runtime-dependencies.md`](./upstream-runtime-dependencies.md) explains
why `login.onorca.dev`, `relay.onorca.dev` and `share.onorca.dev` are still upstream's.

## Decisions at a glance

| # | Decision | Blocks | Status | Recommended default |
| --- | --- | --- | --- | --- |
| D1 | Domain for the three services | IdP, relay, artifacts | Paused until after the release | One domain for `login.` and `relay.`, plus a **separate registrable domain** for shared artifacts |
| D2 | Identity provider vendor | IdP, and then relay and artifacts | Paused until after the release | A self-hosted OIDC server behind a small Orca-owned desktop auth gateway |
| D3 | Hosting target | All three services | Paused until after the release | One VPS for the IdP and the gateway; decide relay hosting after D2 ships |
| D4 | Apple enrollment owner | macOS notarization, iOS | Resolved: the owner's current account stays | — |
| D5 | Google Play enrollment owner | Android distribution | Resolved: the owner's current account stays | — |

When D1 to D3 resume, the order of work is **identity, then relay, then artifacts**, because relay
and artifacts both authenticate against the identity service.

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

**Paused** by the owner until after the release.

| Option | Pros | Cons |
| --- | --- | --- |
| Subdomains of an existing Ab2Web domain (`login.`, `relay.`, `share.`) | Uses existing DNS and brand; no purchase | User-uploaded artifact HTML on the same registrable domain as `login.` can set cookies on the parent domain, so a shared page could interfere with sign-in sessions |
| A new product domain for Orca Lab | Separates the product from the agency brand; can move to a new owner cleanly | Costs a purchase and DNS setup; same cookie issue if `share.` stays under it |
| **Login and relay on one domain, artifacts on a separate registrable domain** (the pattern behind `githubusercontent.com`) | Isolates untrusted user content from the identity host | Two domains to own and renew |

The owner has to choose the domain names and decide whether artifacts get their own registrable
domain.

## D2. Identity provider

**Paused** by the owner until after the release.

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

**Paused** by the owner until after the release.

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

**Resolved.** The owner's current Apple account stays. It covers both macOS notarization and iOS
distribution: macOS builds are notarized and iOS reaches TestFlight (ORCA-329 comment
`79c72dcf-633b-432d-a56d-fb2e9e36653c`).

## D5. Google Play enrollment owner

**Resolved.** The owner's current Google Play account stays, and Android uploads reach the Play
internal track (same comment). `.github/workflows/mobile-android-release.yml` builds the signed
upload with the `ANDROID_UPLOAD_*` secrets.

## Next step

D4 and D5 need no further work. D1 to D3 wait until after the release. When the owner answers
them, ORCA-329 splits into child tickets in sequence:

1. IdP and desktop auth gateway, deployed on the D3 host and tested with `ORCA_CLOUD_API_URL` overrides.
2. Point packaged builds at the new login host.
3. Relay director and first cell.
4. Artifact store, plus the code change that replaces the `onorca.dev` allowlist with the D1 domain.
