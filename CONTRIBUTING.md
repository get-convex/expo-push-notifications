# Developing guide

## Running locally

```sh
npm run setup
npm run dev
```

Setup should:

1. Install dependencies in the root and example directories
1. Build the component
1. Create a Convex project if not already connected, and deploy to it once.
1. Set the `EXPO_PUBLIC_CONVEX_URL` environment variable for the example expo
   app (needs to be set in the example expo app's `.env.local` file)

## Testing

```sh
npm run clean
npm run build
npm run typecheck
npm run lint
npm run test
```

## Deploying

### Building a one-off package

```sh
npm run clean
npm ci
npm pack
```

### Deploying a new version

```sh
npm run release
```

or for alpha release:

```sh
npm run alpha
```
