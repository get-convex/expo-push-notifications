/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the component with the test convex instance.
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The name of the component, as registered in convex.config.ts.
 */
export function register(
  // TypeScript cannot infer that our specific schema type is compatible with
  // the generic SchemaDefinition<GenericSchema> that registerComponent expects.
  // This is a known limitation of the type system with component schemas.
  t: TestConvex<any>,
  name: string = "pushNotifications",
) {
  t.registerComponent(name, schema as any, modules);
}
export default { register, schema, modules };
