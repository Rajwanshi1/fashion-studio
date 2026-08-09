# socials — link-in-bio SPA (Vite, React 18) · dev port 5175

Flat src/ (no pages/components dirs). Served under `/qr-socials/` in production.
- src/track.ts   scan/click beacons — POST /api/socials/scan with `?src=<placement>`
- src/config.ts  links + contact content

Gotcha: the `INVALID_SOURCE` error code is a stated backend contract
(backend/src/routes/socials.routes.ts).
