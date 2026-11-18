import type { MetadataRoute } from "next"

// Makes the app installable ("Install app" in Chrome/Edge, "Add to Home Screen" on phones),
// so it opens in its own window with a home-screen icon instead of a browser tab.
//
// The name and the "RM" icons are placeholders, like the login mark they copy: the product
// name is undecided (see PRODUCT.md). When the client names it, change the names here and in
// layout.tsx and replace the PNGs in public/icons/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Rental Manager",
    short_name: "Rentals",
    description: "Rent out stock, take it back by scanning, and keep the books straight.",
    // "/" sends a logged-in user to their role's home page and everyone else to /login.
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The light theme's --background, so the splash screen doesn't flash a different colour.
    background_color: "#fafafc",
    theme_color: "#fafafc",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed version that Android crops to a circle or squircle.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
