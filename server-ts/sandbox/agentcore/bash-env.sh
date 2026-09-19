# Read by every non-interactive bash an agent's command runs in: through
# /etc/bash.bashrc, which is what bash reads when its stdin is a socket, and
# through BASH_ENV otherwise (see the Dockerfile).
# Silent and cheap: it must never write to a command's output, and most
# commands never touch nvm.
#
# nvm keeps the Node versions it installs under NVM_DIR. Commands run as an
# unprivileged user of their own session, so that is a folder in the session's
# workspace — one session cannot change the Node another runs — while nvm
# itself is read from the image.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# Where `pip install` puts a package's commands for an unprivileged user.
case ":$PATH:" in
   *":$HOME/.local/bin:"*) ;;
   *) export PATH="$HOME/.local/bin:$PATH" ;;
esac

__berry_nvm_load() {
   unset -f nvm __berry_nvm_load
   mkdir -p "$NVM_DIR" 2>/dev/null
   . /usr/local/nvm/nvm.sh --no-use
}

# Loaded the first time it is called, not on every command.
nvm() {
   __berry_nvm_load
   nvm "$@"
}

# A repository that pins its Node runs on it in every later command, once it
# has been installed (`nvm install`). Each command is a new shell, so without
# this an `nvm use` would last exactly one command.
if [ -f .nvmrc ] && [ -d "$NVM_DIR/versions" ]; then
   __berry_nvm_load
   nvm use >/dev/null 2>&1 || true
fi
