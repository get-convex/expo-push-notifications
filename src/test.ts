/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import workpool from "@convex-dev/workpool/test";
import type { ComponentApi } from "./component/_generated/component.js";
import schema from "./component/schema.js";
import type { SchemaDefinition, GenericSchema } from "convex/server";
import { componentsGeneric } from "convex/server";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the component with the test convex instance.
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The name of the component, as registered in convex.config.ts.
 * @returns a component api to test via ctx.runMutation or for thick client
 *   usage. Also provides types for convex-test's defineTestApp.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "pushNotifications",
) {
  t.registerComponent(name, schema, modules);
  workpool.register(t, name + "/pushNotificationWorkpool");
  return componentsGeneric()[name] as unknown as ComponentApi;
}
export default { register, schema, modules };
