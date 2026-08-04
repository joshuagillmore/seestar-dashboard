/**
 * The whole app's client-side navigation state — plain state, not a router
 * library, per design/README.md § State Management. All four are built:
 * `live` shipped in slice 3 and `review` in slice 4, once seestar-mcp
 * stopped stripping the per-sub metric arrays that screen is made of.
 *
 * `VIEWS` is the runtime list and `View` is derived from it, rather than the
 * union being written out by hand. That exists so a test can enumerate every
 * view: `MobileNav` shipped for months reaching only two of the four, because
 * a TypeScript union is erased at runtime and nothing could assert that the
 * nav covered it. Adding a view here now fails MobileNav's coverage test
 * until the nav can reach it.
 */
export const VIEWS = ['tonight', 'live', 'review', 'projects'] as const

export type View = (typeof VIEWS)[number]
