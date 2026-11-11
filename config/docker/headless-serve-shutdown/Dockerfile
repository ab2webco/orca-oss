FROM ubuntu@sha256:678c6550cc43645e08669028bc177f50be4e7c5b8cca677067b1914d4afc7a03

ENV DEBIAN_FRONTEND=noninteractive

COPY --from=apt-scripts apt-mirror-fallback.sh /usr/local/bin/apt-mirror-fallback

# Why the fallback: apt update only warns when no Ubuntu host resolves, and the install then
# finds no packages (2026-11-11); a failed or warned update retries on another mirror.
RUN apt-get update > /tmp/apt-update.log 2>&1; status=$?; cat /tmp/apt-update.log; \
  if [ "$status" -ne 0 ] || grep -q '^W: Failed to fetch' /tmp/apt-update.log; then \
    bash /usr/local/bin/apt-mirror-fallback && apt-get update; \
  fi \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    dbus-x11 \
    iproute2 \
    jq \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libasound2t64 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    p7zip-full \
    procps \
    util-linux \
    xauth \
    xvfb \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash orca

COPY run-signal-case.sh /usr/local/bin/run-signal-case

ENTRYPOINT ["/usr/local/bin/run-signal-case"]
