# Telemetry and privacy

This page describes the usage data Orca Lab can send, when it sends it, and where.

## Builds from this repository do not send telemetry

Telemetry transmits only from official release builds that the release pipeline signs with a
build identity and a write key. This repository's release workflow does not set either one, so
builds made from it do not send usage events.

Development and contributor builds never send telemetry.

## When telemetry is on

If telemetry is enabled in an official build:

- Events go to PostHog at `https://us.i.posthog.com`.
- Each event carries the app version, platform, architecture, OS release, a random install ID,
  a session ID that changes on every launch, and the release channel.
- Events are a fixed list of named actions, such as onboarding steps, agent launches and
  settings changes. Each event has a strict schema. Any event with unexpected fields is dropped.
- Prompts, file contents, repository names, paths and URLs are not sent. The one exception is an
  agent-hook install error, which can include a shortened error message.
- Events are not tied to a person profile.

## Turning telemetry off

- Open **Settings > Privacy & Telemetry** and turn off **Share anonymous usage data**.
- Or set the environment variable `DO_NOT_TRACK=1`, or `ORCA_TELEMETRY_DISABLED`, before you start Orca Lab.
- Telemetry is also off when a CI environment variable is set.

When you turn telemetry off, Orca Lab sends one final event that records the opt-out, and then stops.

The random install ID is stored in Orca Lab's data file on your machine.

## Other network requests

Orca Lab makes these requests for features you use. None of them sends telemetry:

- **Update check:** Orca Lab asks GitHub for new releases, every 24 hours.
- **Plugin kill list:** Orca Lab downloads a list of disabled plugins from `onorca.dev`, in packaged builds.
- **Usage and sign-in:** Claude and Codex usage and token refresh requests go to the providers' own
  endpoints. See [Usage tracking and accounts](agents/usage-tracking.md).
- **Artifact sharing:** a shared artifact is uploaded when you share it.
- **SSH:** Orca Lab connects to the hosts you configure. See [SSH](ssh.md).
