/// <reference types="vite/client" />
import { test } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

export const setupTest = () => {
  return convexTest(schema, modules);
};

export type Tester = ReturnType<typeof setupTest>;

test("setup", () => {});
