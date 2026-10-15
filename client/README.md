# ChatPDF Studio — frontend

React 19 + Vite. See the [project README](../README.md) for setup, architecture and deployment.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api to http://localhost:5000
npm run lint
npm run build    # → dist/
```

`VITE_API_BASE_URL` (build time) points the app at an API on a different origin; leave it unset when
Express serves the built app (`CLIENT_DIST_DIR`) or when using the dev proxy.
