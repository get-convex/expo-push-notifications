import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { setupTest, type Tester } from "./setup.test.js";
import { FINALIZED_EPOCH } from "./schema.js";

describe("push notification pipeline", () => {
  let t: Tester;

  beforeEach(() => {
    t = setupTest();
    vi.restoreAllMocks();
  });

  it("records notification with compatibility defaults and schedules a batch", async () => {
    await t.mutation(api.public.recordPushNotificationToken, {
      userId: "user-1",
      pushToken: "ExponentPushToken[abc123]",
      logLevel: "ERROR",
    });

    const notificationId = await t.mutation(api.public.sendPushNotification, {
      userId: "user-1",
      notification: { title: "hello" },
      logLevel: "ERROR",
    });

    expect(notificationId).not.toBeNull();

    const notification = await t.run(async (ctx: any) => {
      return await ctx.db.get(notificationId!);
    });

    expect(notification).not.toBeNull();
    expect(notification!.state).toBe("awaiting_delivery");
    expect(notification!.numPreviousFailures).toBe(0);
    expect(notification!.finalizedAt).toBe(FINALIZED_EPOCH);
    expect(typeof notification!.segment).toBe("number");

    const nextBatchRun = await t.run(async (ctx: any) => {
      return await ctx.db.query("nextBatchRun").unique();
    });
    expect(nextBatchRun).not.toBeNull();
  });

  it("maps Expo success/error response items", async () => {
    const id1 = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "in_progress",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );
    const id2 = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[two]",
        metadata: { title: "two" },
        state: "in_progress",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                { status: "ok", id: "ticket-1" },
                { status: "error", message: "invalid token" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const result = await t.action(
      (internal as any).lib.callExpoPushApiWithBatch,
      {
        notificationIds: [id1, id2],
      },
    );

    expect(result).toEqual({
      kind: "success",
      notifications: [
        { id: id1, state: "delivered", expoTicketId: "ticket-1" },
        { id: id2, state: "failed", errorMessage: "invalid token" },
      ],
    });
  });

  it("returns maybe_delivered for non-OK HTTP response", async () => {
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "in_progress",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("oops", { status: 503, statusText: "Svc" }),
      ),
    );

    const result = await t.action(
      (internal as any).lib.callExpoPushApiWithBatch,
      {
        notificationIds: [id],
      },
    );

    expect(result).toEqual({
      kind: "maybe_delivered",
      notificationIds: [id],
      errorMessage: "Expo API error: 503 Svc oops",
    });
  });

  it("returns canceled batches to awaiting_delivery", async () => {
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "in_progress",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    await t.mutation((internal as any).lib.onPushComplete, {
      workId: "work-1",
      context: {
        notificationIds: [id],
      },
      result: { kind: "canceled" },
    });

    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("awaiting_delivery");
    expect(notification?.finalizedAt).toBe(FINALIZED_EPOCH);
  });
});
