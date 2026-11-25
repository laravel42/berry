const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Scope Metro to apps/mobile + root node_modules so it never crawls sibling workspaces or Next/PGlite artifacts.
const monorepoRoot = path.resolve(__dirname, '../..');
config.watchFolders = [__dirname, path.join(monorepoRoot, 'node_modules')];

module.exports = config;
