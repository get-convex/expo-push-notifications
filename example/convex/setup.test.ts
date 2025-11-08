/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import component from "@convex-dev/expo-push-notifications/test";

const modules = import.meta.glob("./**/*.*s");
// When users want to write tests that use your component, they need to
// explicitly register it with its schema and modules.
export function initConvexTest() {
  const t = convexTest(schema, modules);
  // The component depends on a different version of convex-test (the one in
  // the root node_modules) so we need to cast for now.
  // We likely want this to be a monorepo instead of the current setup.
  component.register(t as any);
  return t;
}

test("setup", () => {});
