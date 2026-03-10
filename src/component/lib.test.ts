import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { setupTest, type Tester } from "./setup.test.js";
import { FINALIZED_EPOCH } from "./schema.js";
import { BASE_BATCH_DELAY, SEGMENT_MS } from "./shared.js";

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
      logLevel: "ERROR",
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
      logLevel: "ERROR",
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
        logLevel: "ERROR",
      }),
    ).rejects.toThrow("Expo API error: 503 Svc oops");
  });

  it("aborts a hung Expo request after the timeout", async () => {
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
      vi.fn((_url, init) => {
        const signal = (init as RequestInit | undefined)?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const action = t.action(internal.expo.callExpoPushApiWithBatch, {
      notificationIds: [id],
      logLevel: "ERROR",
    });
    const expectation = expect(action).rejects.toThrow(
      "Expo API request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("throws when Expo returns the wrong number of result items", async () => {
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
              data: [{ status: "ok", id: "ticket-1" }],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      t.action(internal.expo.callExpoPushApiWithBatch, {
        notificationIds: [id1, id2],
        logLevel: "ERROR",
      }),
    ).rejects.toThrow("Invalid response from Expo API: expected 2 results, got 1");
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
        errorMessage: "previous failure",
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
    expect(notification?.errorMessage).toBeUndefined();
    expect(notification?.finalizedAt).toBe(FINALIZED_EPOCH);
  });

  it("clears stale errors when a notification is delivered", async () => {
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "in_progress",
        numPreviousFailures: 1,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
        errorMessage: "previous failure",
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
          notifications: [{ id, state: "delivered", expoTicketId: "ticket-1" }],
        },
      },
    });

    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("delivered");
    expect(notification?.expoTicketId).toBe("ticket-1");
    expect(notification?.errorMessage).toBeUndefined();
  });

  it("reschedules a deferred partial reloop after the current run", async () => {
    const currentSegment = Math.floor(1_000_000 / SEGMENT_MS);
    const futureSegment = Math.floor(
      (1_000_000 + BASE_BATCH_DELAY + SEGMENT_MS - 1) / SEGMENT_MS,
    );

    await t.run(async (ctx: any) => {
      const runId = await ctx.scheduler.runAfter(0, internal.batch.makeBatch, {
        reloop: true,
        segment: currentSegment,
        logLevel: "ERROR",
      });
      await ctx.db.insert("nextBatchRun", {
        runId,
        segment: currentSegment,
      });
      await ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "awaiting_delivery",
        numPreviousFailures: 0,
        segment: currentSegment,
        finalizedAt: FINALIZED_EPOCH,
      });
    });

    await t.mutation(internal.batch.makeBatch, {
      reloop: true,
      segment: currentSegment,
      logLevel: "ERROR",
    });

    const nextBatchRun = await t.run(async (ctx: any) => {
      return await ctx.db.query("nextBatchRun").unique();
    });

    expect(nextBatchRun?.segment).toBe(futureSegment);
  });

  it("does not enqueue work when a queued batch runs during shutdown", async () => {
    const id = await t.run(async (ctx: any) => {
      await ctx.db.insert("config", { state: "shutting_down" });
      return await ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "awaiting_delivery",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      });
    });

    await t.mutation(internal.batch.makeBatch, {
      reloop: false,
      segment: 1,
      logLevel: "ERROR",
    });

    const notification = await t.run(async (ctx: any) => ctx.db.get(id));
    expect(notification?.state).toBe("awaiting_delivery");
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
