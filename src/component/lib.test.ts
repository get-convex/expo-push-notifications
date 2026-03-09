import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { setupTest, type Tester } from "./setup.test.js";
import { FINALIZED_EPOCH } from "./schema.js";
import { BASE_BATCH_DELAY, SEGMENT_MS } from "./notifs.js";

describe("push notification pipeline", () => {
  let t: Tester;

  beforeEach(() => {
    t = setupTest();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("records notification with compatibility defaults and schedules a batch", async () => {
    const expectedSegment = Math.floor(
      (1_000_000 + BASE_BATCH_DELAY + SEGMENT_MS - 1) / SEGMENT_MS,
    );

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
    expect(notification!.segment).toBe(expectedSegment);

    const nextBatchRun = await t.run(async (ctx: any) => {
      return await ctx.db.query("nextBatchRun").unique();
    });
    expect(nextBatchRun).not.toBeNull();
    expect(nextBatchRun!.segment).toBe(notification!.segment);
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

    const result = await t.action(internal.expo.callExpoPushApiWithBatch, {
      notificationIds: [id1, id2],
    });

    expect(result).toEqual({
      kind: "success",
      notifications: [
        { id: id1, state: "delivered", expoTicketId: "ticket-1" },
        { id: id2, state: "failed", errorMessage: "invalid token" },
      ],
    });
  });

  it("marks MessageRateExceeded ticket errors as retryable", async () => {
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
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  status: "error",
                  message: "rate exceeded",
                  details: { error: "MessageRateExceeded" },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const result = await t.action(internal.expo.callExpoPushApiWithBatch, {
      notificationIds: [id],
    });

    expect(result).toEqual({
      kind: "success",
      notifications: [
        {
          id,
          state: "needs_retry",
          errorCode: "MessageRateExceeded",
          errorMessage: "rate exceeded",
        },
      ],
    });
  });

  it("throws for non-OK HTTP response so workpool can retry the batch", async () => {
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

    await expect(
      t.action(internal.expo.callExpoPushApiWithBatch, {
        notificationIds: [id],
      }),
    ).rejects.toThrow("Expo API error: 503 Svc oops");
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

    await t.mutation(internal.batch.onPushComplete, {
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

  it("marks exhausted whole-batch failures as maybe_delivered", async () => {
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

    await t.mutation(internal.batch.onPushComplete, {
      workId: "work-1",
      context: {
        notificationIds: [id],
      },
      result: { kind: "failed", error: "Expo API error: 503 Svc oops" },
    });

    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("maybe_delivered");
    expect(notification?.errorMessage).toBe("Expo API error: 503 Svc oops");
  });

  it("schedules retryable ticket failures into a future segment", async () => {
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

    const before = Date.now();
    vi.setSystemTime(before);

    await t.mutation(internal.batch.onPushComplete, {
      workId: "work-1",
      context: {
        notificationIds: [id],
      },
      result: {
        kind: "success",
        returnValue: {
          kind: "success",
          notifications: [
            {
              id,
              state: "needs_retry",
              errorCode: "MessageRateExceeded",
              errorMessage: "rate exceeded",
            },
          ],
        },
      },
    });
    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("needs_retry");
    expect(notification?.numPreviousFailures).toBe(1);
    expect(notification?.finalizedAt).toBe(FINALIZED_EPOCH);
    expect(notification?.segment).toBeGreaterThan(1);
  });

  it("finalizes non-retryable ticket failures as failed", async () => {
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

    await t.mutation(internal.batch.onPushComplete, {
      workId: "work-1",
      context: {
        notificationIds: [id],
      },
      result: {
        kind: "success",
        returnValue: {
          kind: "success",
          notifications: [
            {
              id,
              state: "failed",
              errorMessage: "invalid token",
            },
          ],
        },
      },
    });

    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("failed");
    expect(notification?.errorMessage).toBe("invalid token");
    expect(notification?.finalizedAt).not.toBe(FINALIZED_EPOCH);
  });
});
