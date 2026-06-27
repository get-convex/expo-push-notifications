import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api.js";
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

  it("records notification with compatibility defaults and pings the worker", async () => {
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
      return await ctx.db.get("notifications", notificationId!);
    });

    expect(notification).not.toBeNull();
    expect(notification!.state).toBe("awaiting_delivery");
    expect(notification!.numPreviousFailures).toBe(0);
    expect(notification!.finalizedAt).toBe(FINALIZED_EPOCH);
    expect(typeof notification!.segment).toBe("number");
    expect(notification!.segment).toBe(expectedSegment);

    const status = await t.run(async (ctx: any) =>
      ctx.runQuery(components.batchWorker.lib.status, { name: "expoPush" }),
    );
    expect(status).not.toBeNull();
    expect(status?.kind).toBe("running");
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

    const notification = await t.run(async (ctx: any) => ctx.db.get("notifications", id));
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

    const notification = await t.run(async (ctx: any) => ctx.db.get("notifications", id));
    expect(notification?.state).toBe("delivered");
    expect(notification?.expoTicketId).toBe("ticket-1");
    expect(notification?.errorMessage).toBeUndefined();
  });

  it("getBatch returns eligible notifications as work", async () => {
    const currentSegment = Math.floor(1_000_000 / SEGMENT_MS);
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "awaiting_delivery",
        numPreviousFailures: 0,
        segment: currentSegment,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    const result = await t.query(internal.batch.getBatch, { name: "expoPush" });
    expect(result.kind).toBe("work");
    expect(result.kind === "work" && result.batch.notificationIds).toEqual([id]);
  });

  it("getBatch goes idle with a timeout when only future work remains", async () => {
    const currentSegment = Math.floor(1_000_000 / SEGMENT_MS);
    const futureSegment = currentSegment + 100;
    await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[future]",
        metadata: { title: "future" },
        state: "needs_retry",
        numPreviousFailures: 1,
        segment: futureSegment,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    const result = await t.query(internal.batch.getBatch, { name: "expoPush" });
    expect(result.kind).toBe("idle");
    expect(result.kind === "idle" && result.timeoutMs).toBeGreaterThan(0);
  });

  it("getBatch goes idle with no timeout when the queue is empty", async () => {
    const result = await t.query(internal.batch.getBatch, { name: "expoPush" });
    expect(result).toEqual({ kind: "idle" });
  });

  it("processBatch reserves deliverable notifications as in_progress", async () => {
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "awaiting_delivery",
        numPreviousFailures: 0,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    await t.mutation(internal.batch.processBatch, { notificationIds: [id] });

    const notification = await t.run(async (ctx: any) =>
      ctx.db.get("notifications", id),
    );
    expect(notification?.state).toBe("in_progress");
  });

  it("processBatch finalizes notifications that exhausted their retries", async () => {
    const id = await t.run(async (ctx: any) =>
      ctx.db.insert("notifications", {
        token: "ExponentPushToken[one]",
        metadata: { title: "one" },
        state: "needs_retry",
        numPreviousFailures: 5,
        segment: 1,
        finalizedAt: FINALIZED_EPOCH,
      }),
    );

    await t.mutation(internal.batch.processBatch, { notificationIds: [id] });

    const notification = await t.run(async (ctx: any) =>
      ctx.db.get("notifications", id),
    );
    expect(notification?.state).toBe("unable_to_deliver");
  });

  it("shutdown stops the worker; restart resumes it", async () => {
    await t.mutation(api.public.recordPushNotificationToken, {
      userId: "user-1",
      pushToken: "ExponentPushToken[abc123]",
      logLevel: "ERROR",
    });
    await t.mutation(api.public.sendPushNotification, {
      userId: "user-1",
      notification: { title: "hello" },
      logLevel: "ERROR",
    });

    const readStatus = () =>
      t.run(async (ctx: any) =>
        ctx.runQuery(components.batchWorker.lib.status, { name: "expoPush" }),
      );

    expect((await readStatus())?.kind).toBe("running");

    await t.mutation(api.public.shutdown, { logLevel: "ERROR" });
    expect((await readStatus())?.kind).toBe("stopped");

    // A ping while stopped is a no-op — the worker stays stopped.
    await t.mutation(api.public.sendPushNotification, {
      userId: "user-1",
      notification: { title: "while stopped" },
      logLevel: "ERROR",
    });
    expect((await readStatus())?.kind).toBe("stopped");

    const restarted = await t.mutation(api.public.restart, {
      logLevel: "ERROR",
    });
    expect(restarted).toBe(true);
    expect((await readStatus())?.kind).toBe("running");
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

    const notification = await t.run(async (ctx: any) => ctx.db.get("notifications", id));
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
    const notification = await t.run(async (ctx: any) => ctx.db.get("notifications", id));
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

    const notification = await t.run(async (ctx: any) => ctx.db.get("notifications", id));
    expect(notification?.state).toBe("failed");
    expect(notification?.errorMessage).toBe("invalid token");
    expect(notification?.finalizedAt).not.toBe(FINALIZED_EPOCH);
  });
});
