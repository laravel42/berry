# The image a preview's apps run in, and where the panel's terminal sessions land.
#
# Debian, not Alpine: nvm installs Node builds made for glibc, and the agents
# that wrote the code built it on Debian too (sandbox/agentcore), so "works for
# the agent, fails in the preview" cannot come from the C library.
#
# It carries the package managers a repository may have been written for —
# npm, pnpm and yarn (through corepack, so a repo's `packageManager` field is
# honoured), and bun — nvm, for a repo that pins its Node in `.nvmrc`, and
# Python with pip and venv.
# Nothing here is Berry's: it holds no credential and no source, and every
# container started from it has no capabilities and a ceiling on memory, CPU
# and processes (src/previews/environments.ts).
#
# Built on first use by the preview runner, as `berry-preview:node22`.
FROM node:22-bookworm-slim

# git: dependencies from git URLs. curl, unzip, ca-certificates: bun and nvm
# installers, and what people reach for in a terminal. procps: `ps`, and the
# `pkill` that ends an abandoned command's children. python3, make, g++: the
# toolchain node-gyp needs when a package has no prebuilt binary. Python is
# there in full for the same reason the managers are — a repository may be
# written in it, or script with it: pip, venv, and `python` as well as
# `python3`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl unzip ca-certificates procps make g++ \
      python3 python3-pip python3-venv python-is-python3 \
 && rm -rf /var/lib/apt/lists/*

# Debian marks its Python as externally managed, so a bare `pip install` is
# refused. In a throwaway container there is no system to protect: let it install.
ENV PIP_BREAK_SYSTEM_PACKAGES=1 PIP_ROOT_USER_ACTION=ignore PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_CACHE_DIR=/root/.npm/_pip

# pnpm and yarn, as shims that fetch the version a repository asks for.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable \
 && corepack prepare pnpm@latest --activate \
 && corepack prepare yarn@stable --activate \
 # Run once here, so the first `pnpm install` in a container does not start by downloading pnpm.
 && pnpm --version && yarn --version

ENV BUN_INSTALL=/usr/local/bun
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -s /usr/local/bun/bin/bun /usr/local/bin/bun \
 && ln -s /usr/local/bun/bin/bun /usr/local/bin/bunx

# nvm is a shell function, not a program: it exists in a shell that has sourced
# nvm.sh. The runner sources it for an app with an `.nvmrc` and for every
# terminal command; NVM_DIR is how it finds it.
ENV NVM_DIR=/usr/local/nvm
RUN mkdir -p "$NVM_DIR" \
 && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | PROFILE=/dev/null bash

WORKDIR /work
