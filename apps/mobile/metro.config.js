const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Scope Metro to apps/mobile + root node_modules (when running inside the monorepo)
// so it never crawls sibling workspaces or Next/PGlite artifacts, while still working
// standalone in EAS Build.
const rootNodeModules = path.resolve(__dirname, '../../node_modules');
config.watchFolders = fs.existsSync(rootNodeModules)
  ? [__dirname, rootNodeModules]
  : [__dirname];

module.exports = config;
