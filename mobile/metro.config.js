// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// The app imports the shared Convex API from OUTSIDE this directory
// (`../../convex/_generated/api`). That resolves fine locally and for
// type-checking, but EAS Build uploads only `mobile/`, so the parent
// `convex/` is absent in the cloud and Metro's bundle phase fails with
// "Unable to resolve module ../convex/_generated/api". The generated runtime
// is fully generic, so we redirect just that runtime import to a local copy
// (convex-generated/api.js). The `import type` of `dataModel` is stripped by
// the compiler and never hits the resolver.
const localApi = path.resolve(__dirname, "convex-generated/api.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith("convex/_generated/api")) {
    return { type: "sourceFile", filePath: localApi };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
