/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

export const setupTest = () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerWorkpool(t, "pushNotificationWorkpool");
  return t;
};

export type Tester = ReturnType<typeof setupTest>;

test("setup", () => {});
