# Deployment Guide (AWS Amplify Full-Stack Hosting)

This app is deployed as a full-stack Express + Vite application. The backend remains active and serves all `/api/*` routes, and in production it serves the frontend from `dist`.

## Local development

```bash
npm run dev
```

This starts `server.ts` directly with `tsx` for local full-stack development.

## Build commands

```bash
# Frontend only (Vite)
npm run build:frontend

# Backend only (TypeScript emit for server.ts)
npm run build:server

# Both frontend + backend
npm run build
```

## Production start command

```bash
npm run start
```

This runs `build/server/server.js` with `NODE_ENV=production`.  
The server listens on port `3000`.

## Required environment variables

Set these in your deployment environment:

- `ACUMATICA_BASE_URL`
- `ACUMATICA_USERNAME`
- `ACUMATICA_PASSWORD`
- `ACUMATICA_COMPANY`
- `SESSION_SECRET`

Use `.env.example` as the template for variable names and expected values.

## Amplify deployment notes

- Amplify build config is in `amplify.yml`.
- Compute routing config is in `deploy-manifest.json`.
- Amplify packaging command:

```bash
npm run build:amplify
```

This produces `.amplify-hosting` with:

- `.amplify-hosting/deploy-manifest.json`
- `.amplify-hosting/compute/default/server.js`
- `.amplify-hosting/compute/default/dist/*`
- `.amplify-hosting/compute/default/node_modules/*`

Deploy this repo in Amplify Hosting and configure your custom domain `financeportal.svjpackaging.com` in Amplify domain management.
