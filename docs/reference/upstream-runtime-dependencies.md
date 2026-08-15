# Upstream runtime dependencies that stay (ORCA-192, tier 3)

Tiers 1 and 2 removed or re-pointed everything the fork could host itself (`4eb88fefa1`,
`32049d1529`). Three runtime dependencies remain, and this document is the decision to keep them:
they are **services**, not constants, and hosting them is not a build change — it is running an
identity provider, an object store with a public web front end, and a global WebSocket relay fleet.

| Constant | Host | Kept because |
| --- | --- | --- |
| `src/main/artifacts/artifact-cloud-config.ts:3` | `share.onorca.dev` | Public artifact hosting service |
| `src/main/orca-profiles/profile-cloud-auth-config.ts:19` | `login.onorca.dev` | OIDC/PKCE identity provider |
| `src/main/orca-profiles/profile-cloud-auth-config.ts:21` | `relay.onorca.dev` | Relay director + cell fleet |

All three are behind the same gate: `getOrcaCloudAuthConfig` resolves the production host **only in a
packaged build** (`profile-cloud-auth-config.ts:78-89`). A source or dev build returns
`configured: false` with "Orca Cloud sign-in is not configured for this build." — so every
developer-facing check of this fork sees the clean-failure branch, and only the shipped Lab release
resolves to upstream. That asymmetry is why this was worth auditing at all.

## 1. What happens today if a Lab user uses it

**Artifacts.** Two gates before any byte leaves the machine: `artifactSharingEnabled` defaults to
`false` (`src/shared/constants.ts:286`, enforced for the UI, the CLI and agents alike through
`src/shared/artifact-sharing-gate.ts`), and publishing requires a signed-in Orca Cloud session
(`artifact-cloud-service.ts:276-293`). Without sign-in the operation returns
`reconnect-required` / `unconfigured` — it does not half-upload. With an upstream Orca account, the
file is `POST`ed to `share.onorca.dev` and the returned link is public to anyone holding the URL.

**Sign-in.** `connectCurrentOrcaProfile` runs a standard PKCE flow: a loopback callback server on
`127.0.0.1` and `shell.openExternal` to `login.onorca.dev/v1/desktop/auth/authorize` with
`client_id=orca-desktop` (`profile-cloud-pkce.ts:122-143`). Failures are surfaced as
`status: 'failed'` with the error message, and a user cancel maps to `status: 'cancelled'`
(`profile-cloud-service.ts:90-103`). No silent degradation.

**Relay.** Mobile pairing defaults to the `automatic` path — "Orca Relay"
(`src/shared/mobile-pairing-connection-mode.ts:13`) — but a relay QR cannot be minted while signed
out: `canMintMobilePairingOffer` refuses rather than silently issuing a LAN-only code under the
Relay label (`mobile-pairing-connection-mode.ts:36-41`). Signed in, `RelaySessionBroker.open`
exchanges the cloud access token at `login.onorca.dev/v1/desktop/auth/relay-token`, then requests a
cell assignment from `relay.onorca.dev` (`relay-session-broker.ts:198-230`). The LAN path needs no
account and no upstream host at all.

**Not verified.** Whether upstream's authorization server actually accepts `client_id=orca-desktop`
from a Lab build's loopback redirect, and whether an upstream account can complete a publish — that
needs a real account and a live request against a third party. Everything above is read from the
code; this one line is not.

## 2. Does the user know they are reaching upstream

This is the question that matters, and the three answers differ.

**Artifacts — no, not before the upload.** The publish confirmation says "This publishes the current
file at a link anyone with the URL can view" (`ArtifactPublishButton.tsx:161`) and the account row
says "Sign in to create and manage this link" (`:178`). Settings says "Use your Orca account to
upload artifacts" (`ArtifactsSettingsPane.tsx:129`) — in a Lab build that reads as *this fork's*
account. No hostname appears anywhere in the pre-publish flow. `share.onorca.dev` becomes visible
only in the returned URL, i.e. after the file contents are already on upstream's server. The user
does consent to publishing publicly; they are never told to whom.

**Sign-in — partially.** `shell.openExternal` puts `login.onorca.dev` in the user's own address bar
at consent time, so the domain is visible where it counts. Nothing in the app frames it as a
third-party service rather than the fork's own.

**Relay — mechanism yes, operator no.** The pairing UI names "Orca Relay" as an explicit path,
distinct from "LAN", says it needs sign-in, and shows a live status badge
(`MobilePairingConnectionOptions.tsx:148-184`, LAN alternative at `:243-250`). The user knows their
phone traffic is being brokered by a relay service and can opt out. `directorUrl` is never rendered,
so they are not told whose relay it is.

What upstream can see differs sharply between the three. Artifact publish sends **file contents in
plaintext** to upstream's store. Relay carries payloads sealed with NaCl `secretbox`
(`src/shared/mobile-e2ee-v2-framing.ts:24`) under a key from an X25519 agreement
(`src/shared/e2ee-crypto.ts:16`), where the desktop's public key is pinned out-of-band in the
pairing QR (`src/shared/mobile-relay-pairing-offer.ts:75-77`) — so the relay routes ciphertext and
sees metadata (host id, cell placement, timing, volume), not terminal content. Login sees identity.

**Conclusion:** the disclosure gap worth naming is artifacts, not relay. Relay discloses the
mechanism and offers an account-free alternative in the same radio group. Artifacts discloses the
consequence ("anyone with the URL") but not the destination.

## 3. Can we host these with reasonable effort

**No, for all three — and for artifacts the code additionally forbids it.**

`resolveArtifactCloudApiUrl` accepts an `ORCA_ARTIFACTS_API_URL` override, but rejects any host that
is not `onorca.dev`, a subdomain of it, or loopback (`artifact-cloud-config.ts:21-27`). A Lab
operator who *did* stand up a compatible share service on their own domain cannot point the app at
it: the call throws. The only self-hosting shape the guard permits is HTTPS on loopback. So for
artifacts, "we do not host it" is currently also "the shipped code will not let you host it."

The auth and relay constants have no such allowlist — `ORCA_CLOUD_API_URL` and `ORCA_RELAY_URL`
accept any HTTPS origin (`profile-cloud-auth-config.ts:75-91`, `:119-120`) — but pointing them
somewhere means operating an OIDC provider that mints these exact `/v1/desktop/auth/*` endpoints,
plus a director and cell fleet speaking the relay control protocol. That is infrastructure work, not
configuration.

## Known limits of the fork

1. A Lab user who signs in is authenticating against upstream's identity provider with an upstream
   account. The fork has no accounts of its own.
2. Publishing an artifact sends file contents to upstream-operated storage, and the UI does not name
   that destination before the upload. Default-off is the mitigation that exists today.
3. Relay-brokered mobile sessions transit upstream infrastructure. Contents are end-to-end
   encrypted; metadata is not. LAN pairing avoids it entirely and needs no account.
4. Self-hosting a share endpoint is blocked by the first-party host guard, not merely unimplemented.
