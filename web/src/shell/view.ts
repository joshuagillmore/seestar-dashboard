/**
 * The whole app's client-side navigation state — plain state, not a router
 * library, per design/README.md § State Management. `review` is not built
 * yet; its nav row stays disabled until that slice lands. `live` shipped in
 * slice 3.
 */
export type View = 'tonight' | 'live' | 'review' | 'projects'
