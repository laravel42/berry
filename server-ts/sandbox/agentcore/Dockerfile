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
# with it. procps for `ps` and `pkill`. `file` because agents inspect image
# assets with it, and a missing binary is exit 127 on every one of those tasks.
#
# deb.debian.org sometimes publishes a package index before the file behind it
# has finished syncing. apt then refuses the download ("unexpected size") and
# will not retry that file, so the index is fetched again.
RUN set -eu; \
   installed=0; \
   attempt=1; \
   while [ "$attempt" -le 3 ]; do \
      if apt-get update \
         && apt-get install -y --no-install-recommends \
            git ffmpeg ca-certificates openssh-client curl tar unzip gcc g++ make procps file \
            python3 python3-pip python3-venv python-is-python3; then \
         installed=1; \
         break; \
      fi; \
      echo "apt install failed (attempt ${attempt}); refreshing the Debian index" >&2; \
      rm -rf /var/lib/apt/lists/*; \
      attempt=$((attempt + 1)); \
      sleep 5; \
   done; \
   test "$installed" = 1; \
   rm -rf /var/lib/apt/lists/*

# The package managers a repository may have been written for, the same set the
# preview image carries (sandbox/preview): the agent builds with what the
# preview will run. pnpm is pinned because Berry's own install below uses it;
# corepack still gives a repository the version its `packageManager` names.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
   && corepack prepare pnpm@10.12.1 --activate \
   && corepack prepare yarn@stable --activate

# Playwright and a headless Chromium, so an agent can open what it built —
# screenshot a page, run a browser test — without fetching a browser and its
# system libraries mid-run: well over 100 MB, and the libraries need root,
# which a session does not have. Installed globally, so `npx playwright …` and
# `require('playwright')` work anywhere. The browsers folder is writable by
# every user, not just `node`: a session runs as its own uid, and
# `playwright install` waits forever on a lock it cannot take in a folder it
# cannot write — even when the browser is already there. Writable, a redundant
# install returns at once, and a repository pinned to another Playwright
# version can still fetch its own. Each session has its own container, so no
# other session sees what one writes there.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g playwright@1.63.0 \
   && playwright install --with-deps chromium \
   && chmod -R a+rwX /ms-playwright \
   && rm -rf /var/lib/apt/lists/* /root/.npm
# One command for the check nearly every page task makes: the page at phone,
# tablet and desktop widths, and what went wrong while it loaded.
COPY sandbox/agentcore/berry-serve.cjs /usr/local/lib/berry/berry-serve.cjs
COPY sandbox/agentcore/berry-output.cjs /usr/local/lib/berry/berry-output.cjs
COPY sandbox/agentcore/berry-screenshots.cjs /usr/local/bin/berry-screenshots
RUN chmod 755 /usr/local/bin/berry-screenshots

# Lighthouse, on the Chromium headless shell Playwright brought (lighter than
# the full browser, which crashed under a busy session's load), so a task with a performance
# budget audits it in seconds instead of installing Lighthouse (and a browser)
# into its checkout: that install ran several minutes of a run. `chromium` is
# a stable name for the versioned binary, and CHROME_PATH is what Lighthouse's
# launcher reads. berry-lighthouse runs it headless and prints the scores and
# the budget, not the megabytes of JSON.
RUN npm install -g lighthouse@13.5.0 \
   && ln -s "$(ls -d /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell | head -n 1)" /usr/local/bin/chromium \
   && rm -rf /root/.npm
ENV CHROME_PATH=/usr/local/bin/chromium
COPY sandbox/agentcore/berry-lighthouse.cjs /usr/local/bin/berry-lighthouse
RUN chmod 755 /usr/local/bin/berry-lighthouse

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
# line. BASH_ENV still covers a shell started any other way — which now
# includes an agent's command, whose stdin is closed (local-session.ts).
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
