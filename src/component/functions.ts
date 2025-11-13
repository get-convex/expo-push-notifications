import {
  customAction,
  type CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import * as VanillaConvex from "./_generated/server.js";
import { Logger, logLevelValidator } from "../logging/index.js";

export const query = customQuery(VanillaConvex.query, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export const mutation = customMutation(VanillaConvex.mutation, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export const action = customAction(VanillaConvex.action, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export const internalQuery = customQuery(VanillaConvex.internalQuery, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export const internalMutation = customMutation(VanillaConvex.internalMutation, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export const internalAction = customAction(VanillaConvex.internalAction, {
  args: { logLevel: logLevelValidator },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(args.logLevel) }, args: {} };
  },
});

export type MutationCtx = CustomCtx<typeof mutation>;
