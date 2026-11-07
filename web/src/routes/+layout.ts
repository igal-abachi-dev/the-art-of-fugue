// The whole app is canvas + audio, so it is client-only and prerendered
// to a static shell served as-is by Vercel.
export const ssr = false;
export const prerender = true;
