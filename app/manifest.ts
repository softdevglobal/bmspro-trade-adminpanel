import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest (Next links it from every
 * page automatically). next.config.ts also rewrites /manifest.json here, since
 * that is the path installers and audits conventionally probe.
 *
 * `start_url` is /dashboard rather than /: an installed copy belongs to a
 * signed-in operator, and the dashboard redirects to /login when it is not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BMS Pro Trade",
    short_name: "BMS Trade",
    description: "Admin portal for BMS Pro Trade",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#faf8ff",
    theme_color: "#004ac6",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
