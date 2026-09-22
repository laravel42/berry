# The image local development runs in: Node, pnpm and the docker client, and no
# source. The repository is mounted over /repo, so an edit on the host is an
# edit in the container and the watchers restart on it.
#
# The docker client is here because the API starts a preview's containers and
# the session router starts one container per agent session, both through the
# host's Docker socket.
FROM node:22-bookworm-slim

RUN apt-get update \
   && apt-get install -y --no-install-recommends ca-certificates curl gnupg tar gzip git \
   && install -m 0755 -d /etc/apt/keyrings \
   && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
   && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
   && apt-get update \
   && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
   && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
