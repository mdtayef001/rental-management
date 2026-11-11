/**
 * Re-mounted on every navigation, so each screen arrives with the same short settle.
 * It says "you moved" without making anyone wait: 160ms, and none at all for people who
 * have asked their device for less motion (see `.page-enter` in globals.css).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter space-y-6">{children}</div>
}
