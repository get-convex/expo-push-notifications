import {
  customAction,
  type CustomCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import * as VanillaConvex from "./_generated/server.js";
import { Logger, logLevelValidator } from "../logging/index.js";

const wrapperArgs = {
  logLevel: logLevelValidator,
  expoAccessToken: v.optional(v.string()),
};

export const query = customQuery(VanillaConvex.query, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export const mutation = customMutation(VanillaConvex.mutation, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export const action = customAction(VanillaConvex.action, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export const internalQuery = customQuery(VanillaConvex.internalQuery, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export const internalMutation = customMutation(VanillaConvex.internalMutation, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export const internalAction = customAction(VanillaConvex.internalAction, {
  args: wrapperArgs,
  input: async (_ctx, args) => ({
    ctx: {
      logger: new Logger(args.logLevel),
      expoAccessToken: args.expoAccessToken,
    },
    args: {},
  }),
});

export type MutationCtx = CustomCtx<typeof mutation>;
