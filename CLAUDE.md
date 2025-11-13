# Claude Development Notes

## Codegen Command

After making changes to component functions, run codegen with:

```bash
cd example/ && npm run dev -- --once
```

## Adding New Component Functions Pattern

When adding new functions to this Convex component:

1. **Client function** (`src/client/index.ts`):

   - Add method to `PushNotifications` class that calls
     `ctx.runMutation(this.component.public.functionName, { ...args, logLevel: this.config.logLevel })`
   - Follow existing patterns for argument types and return types

2. **Component function** (`src/component/public.ts`):

   - Define args schema using `v.object()`
   - Export mutation/query with proper return type
   - Call `ensureCoordinator(ctx)` after processing for coordination

3. **Batch functions**:

   - Use existing handler functions (like `sendPushNotificationHandler`) in
     loops
   - Call `ensureCoordinator` once after all processing
   - Return array of results matching individual function return types

4. **Always run codegen** after changes to regenerate types
