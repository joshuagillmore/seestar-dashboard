/**
 * The whole app's client-side navigation state — plain state, not a router
 * library, per design/README.md § State Management. `live` and `review` are
 * not built yet; their nav rows stay disabled until those slices land.
 */
export type View = 'tonight' | 'live' | 'review' | 'projects'
