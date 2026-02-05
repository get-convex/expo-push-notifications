import {
  customAction,
  type CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import * as VanillaConvex from "./_generated/server.js";
import { Logger, logLevelValidator } from "../logging/index.js";

const expoAccessTokenValidator = v.optional(v.string());

export const query = customQuery(VanillaConvex.query, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export const mutation = customMutation(VanillaConvex.mutation, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export const action = customAction(VanillaConvex.action, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export const internalQuery = customQuery(VanillaConvex.internalQuery, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export const internalMutation = customMutation(VanillaConvex.internalMutation, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export const internalAction = customAction(VanillaConvex.internalAction, {
  args: { logLevel: logLevelValidator, expoAccessToken: expoAccessTokenValidator },
  input: async (ctx, args) => {
    return {
      ctx: {
        logger: new Logger(args.logLevel),
        expoAccessToken: args.expoAccessToken,
      },
      args: {},
    };
  },
});

export type MutationCtx = CustomCtx<typeof mutation>;
