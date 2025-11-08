// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const componentPath = path.resolve(__dirname, "../");
config.resolver.nodeModulesPaths.push(componentPath);
config.watchFolders.push(componentPath);

module.exports = config;
