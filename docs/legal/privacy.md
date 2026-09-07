# Privacy Policy — Orca Lab (mobile)

**Last updated:** 6 September 2026
**Applies to:** the Orca Lab mobile app for iOS and Android (`com.ab2web.orca.mobile`), published by Ab2Web.

## 1. What this app is

Orca Lab is a companion app. It does not work on its own: it connects to **Orca running on your own
computer**, and every action you take on the phone is executed by that computer. Your repositories,
your files, your terminals and your agent credentials stay on the machine you control. Ab2Web
operates no server that stores them, because no copy of them is ever sent to us.

That is the most important fact in this policy: **there is no Ab2Web database of your work.**

## 2. Permissions the app asks for, and why

| Permission | Why | When |
|---|---|---|
| Camera | Read the pairing QR code shown by Orca on your computer | Only on the pairing screen |
| Photo library | Attach an image to a message you send to an agent | Only when you pick an image |
| Microphone | Dictate text instead of typing | Only while you hold the dictation control |
| Local network (iOS) | Reach your computer directly on the same network | Only while connecting |

Declining any of them leaves the rest of the app working. You can paste a pairing code instead of
scanning it.

## 3. What the app stores on your phone

- **Pairing credentials** for each computer you pair — a device token and that computer's public
  key, held in the operating system keychain.
- **Your view preferences** — filters, grouping, the last workspace you opened.
- **A short local cache** of what the connected computer sent, so screens are not blank while
  reconnecting.

All of it stays on the device. Removing a paired computer in the app deletes its credential.
Uninstalling the app removes everything.

## 4. What leaves your phone, and who can read it

Stated per destination, because the answers differ.

### 4.1 To your own computer — everything you do

Every command, keystroke and file you read travels between the phone and your computer. When the
connection goes through Orca Relay (below), the payloads are **sealed end to end**: encrypted with a
key the phone and your computer agree on directly, using the public key printed in the pairing QR
code. Nobody in between holds that key — not Ab2Web, and not the relay operator.

### 4.2 To Orca Relay — optional, and it cannot read your work

If your phone cannot reach your computer directly, Orca can route the connection through a relay.
The relay forwards **encrypted bytes it cannot open**. It does see the metadata it needs in order to
route: which computer you are reaching, which relay location, when, and how much traffic.

You can avoid the relay entirely by pairing over your own network — a LAN, or a private network such
as Tailscale. That path needs no account and no server operated by anyone else.

**The relay is operated by Stably, the upstream author of Orca, not by Ab2Web.** Orca Lab is a fork
of their open-source app and reuses their relay service.

### 4.3 To Orca Cloud sign-in — optional

Signing in to an Orca account is required only to use the relay or to publish an artifact. The
sign-in happens in your own browser, against a service that sees your identity — your email and
name. **That identity provider is also operated by Stably, not by Ab2Web.**

### 4.4 To artifact sharing — off by default, and it sends file contents

If you enable artifact sharing and publish a file, **the contents of that file are uploaded in
readable form** to a hosting service, and the resulting link is viewable by anyone who holds it.

This is off by default and nothing is uploaded until you explicitly publish. **That hosting service
is operated by Stably, not by Ab2Web.** Do not publish anything you would not put on a public web
page.

## 5. What the app never does

- **No analytics.** No usage tracking, no event collection, no session recording. There is no
  analytics SDK in the app.
- **No crash reporting service.** No third-party crash or performance SDK.
- **No push notifications.** Notifications are generated locally on your device from data your own
  computer sent. There is no push token and no notification server.
- **No advertising identifiers**, no ad networks, no profiling.
- **No selling or sharing of personal data**, under any definition, to anyone.

## 6. Third parties, named

| Service | Operated by | What it can see | Avoidable |
|---|---|---|---|
| Orca Relay | Stably (upstream) | Encrypted traffic plus routing metadata | Yes — pair over your own network |
| Orca Cloud sign-in | Stably (upstream) | Your account identity | Yes — not needed for local pairing |
| Artifact hosting | Stably (upstream) | The contents of files you choose to publish | Yes — off by default |
| App Store / Google Play | Apple, Google | The install and crash data they collect as platforms | No — inherent to app distribution |

Ab2Web operates none of the first three today. If that changes, this policy will be updated before
the change ships.

## 7. Retention

Ab2Web holds no personal data about you, so there is nothing for us to retain or delete. Data on
your phone is under your control and is removed when you unpair a computer or uninstall the app. For
the third-party services above, their own retention terms apply.

## 8. Children

Orca Lab is a developer tool and is not directed at children under 13. We do not knowingly collect
data from children.

## 9. Your rights

Because Ab2Web stores no personal data about you, a request to access, correct, export or delete
such data has nothing to act on — and we will say so plainly rather than pretend otherwise. For data
held by the third parties named in section 6, direct the request to their operator.

If you believe this policy is inaccurate about what the app does, write to us. The app is open
source and can be read.

## 10. Changes

We will update this page when the app's data handling changes, and change the date at the top. The version that applies is the one published on this page at the time you use the app.

## 11. Contact

fabian@ab2web.com

Ab2Web — Barranquilla, Colombia
