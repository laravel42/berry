# Started by Berry when an agent run needs this plugin. Build context is this
# directory; the plugin SDK is the named context `sdk`. Berry sets PORT.
FROM node:22-bookworm-slim

WORKDIR /opt/plugin
COPY --from=sdk / /opt/plugin-sdk
COPY . /opt/plugin
RUN mkdir -p /opt/plugin/node_modules/@berry \
 && ln -s /opt/plugin-sdk /opt/plugin/node_modules/@berry/plugin-sdk \
 && chown -R node:node /opt/plugin

USER node
CMD ["node", "--experimental-strip-types", "server.ts"]
