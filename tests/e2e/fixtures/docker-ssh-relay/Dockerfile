FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37

COPY install-pinned-packages.sh /tmp/install-pinned-packages.sh
RUN sh /tmp/install-pinned-packages.sh \
    && rm -rf /var/lib/apt/lists/* /tmp/install-pinned-packages.sh \
    && mkdir -p /run/sshd /root/.ssh \
    && chmod 700 /root/.ssh

EXPOSE 22
