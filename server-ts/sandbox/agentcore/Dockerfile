# Berry's AgentCore Runtime image: the agent loop and its tools (ADR-0014).
#
# Built from the server-ts context so it runs the same sources the server's
# tests exercise, under --experimental-strip-types, with no build step:
#   docker build -f sandbox/agentcore/Dockerfile -t berry-agent-runtime server-ts
# What it copies is pinned by src/agents/runtime/container/closure.test.ts.
#
# Session lifecycle (spec 2.2a): apply once per deploy, not at every boot —
# UpdateAgentRuntime creates a new runtime version each time it runs:
#   aws bedrock-agentcore-control update-agent-runtime --agent-runtime-id <id> \
#     --lifecycle-configuration idleRuntimeSessionTimeout=3600,maxLifetime=28800 \
#     --agent-runtime-artifact file://artifact.json --role-arn <role> \
#     --network-configuration networkMode=PUBLIC
# A profile's idle timeout on a registered runtime is applied by Berry when the
# profile is saved (src/runtime/runtime-control.ts).
#
# ARM64 is required by AgentCore Runtime. Local x86 hosts can build with
# --build-arg BERRY_RUNTIME_PLATFORM=linux/amd64.
ARG BERRY_RUNTIME_PLATFORM=linux/arm64
FROM --platform=${BERRY_RUNTIME_PLATFORM} node:22-slim

# The toolchain an agent's commands reach for: git to clone and push, ffmpeg for
# media, a compiler for native modules, and Python in full — pip, venv, and
# `python` as well as `python3` — for a repository written in it or scripted
# with it. procps for `ps` and `pkill`.
RUN apt-get update \
   && apt-get install -y --no-install-recommends \
      git ffmpeg ca-certificates openssh-client curl tar unzip gcc g++ make procps \
      python3 python3-pip python3-venv python-is-python3 \
   && rm -rf /var/lib/apt/lists/*

# The package managers a repository may have been written for, the same set the
# preview image carries (sandbox/preview): the agent builds with what the
# preview will run. pnpm is pinned because Berry's own install below uses it;
# corepack still gives a repository the version its `packageManager` names.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
   && corepack prepare pnpm@10.12.1 --activate \
   && corepack prepare yarn@stable --activate

ENV BUN_INSTALL=/usr/local/bun
RUN curl -fsSL https://bun.sh/install | bash \
   && ln -s /usr/local/bun/bin/bun /usr/local/bin/bun \
   && ln -s /usr/local/bun/bin/bun /usr/local/bin/bunx

# nvm, read-only in the image. It is a shell function, so it reaches an agent's
# commands through BASH_ENV, and installs into the session's own workspace: see
# bash-env.sh.
RUN mkdir -p /usr/local/nvm \
   && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | NVM_DIR=/usr/local/nvm PROFILE=/dev/null bash \
   && rm -rf /usr/local/nvm/.git
COPY sandbox/agentcore/bash-env.sh /etc/berry/bash-env.sh
ENV BASH_ENV=/etc/berry/bash-env.sh
# BASH_ENV alone does not reach an agent's command. The runtime starts it with
# pipes for stdio, which on Linux are socket pairs, and a bash whose stdin is a
# socket takes itself to have been started by a remote-shell daemon: it reads
# /etc/bash.bashrc and ~/.bashrc and never looks at BASH_ENV. So the same file
# is sourced from the top of bash.bashrc, ahead of its "not interactive, stop"
# line. BASH_ENV still covers a shell started any other way.
RUN sed -i '1i . /etc/berry/bash-env.sh' /etc/bash.bashrc

# Debian marks its Python as externally managed and refuses a bare `pip
# install`. A session's workspace is disposable and its user unprivileged, so
# pip installs into that user's own site-packages.
ENV PIP_BREAK_SYSTEM_PACKAGES=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /opt/berry
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-workspace
COPY tsconfig.json ./
COPY src/agents ./src/agents
COPY src/execution ./src/execution
COPY src/runtime/envelope.ts src/runtime/lifecycle.ts ./src/runtime/
# Delivery signs its commits with the co-author trailer (GitHub parity).
COPY src/scm/commit-trailer.ts ./src/scm/

# Session workspaces. A persistent filesystem can be mounted here through the
# runtime's filesystemConfigurations so a checkout survives a session stop.
RUN mkdir -p /mnt/workspace && chown node:node /mnt/workspace
USER node
WORKDIR /mnt/workspace

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "/opt/berry/src/agents/runtime/container/main.ts"]
