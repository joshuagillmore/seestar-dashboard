/**
 * The whole app's client-side navigation state — plain state, not a router
 * library, per design/README.md § State Management. All four are built:
 * `live` shipped in slice 3 and `review` in slice 4, once seestar-mcp
 * stopped stripping the per-sub metric arrays that screen is made of.
 */
export type View = 'tonight' | 'live' | 'review' | 'projects'
