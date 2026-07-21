import {
  customAction,
  type CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import * as VanillaConvex from "./_generated/server.js";
import { env } from "./_generated/server.js";
import { Logger, logLevelValidator, type LogLevel } from "../logging/index.js";
import { v } from "convex/values";

const resolveLogLevel = (logLevel?: LogLevel): LogLevel =>
  logLevel ?? env.LOG_LEVEL ?? "ERROR";

export const query = customQuery(VanillaConvex.query, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export const mutation = customMutation(VanillaConvex.mutation, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export const action = customAction(VanillaConvex.action, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export const internalQuery = customQuery(VanillaConvex.internalQuery, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export const internalMutation = customMutation(VanillaConvex.internalMutation, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export const internalAction = customAction(VanillaConvex.internalAction, {
  args: { logLevel: v.optional(logLevelValidator) },
  input: async (ctx, args) => {
    return { ctx: { logger: new Logger(resolveLogLevel(args.logLevel)) }, args: {} };
  },
});

export type MutationCtx = CustomCtx<typeof mutation>;
