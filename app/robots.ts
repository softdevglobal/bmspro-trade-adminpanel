import type { MetadataRoute } from "next";

/**
 * Nothing here is meant to be indexed.
 *
 * Every route is either behind a login (`/dashboard`, `/account`), reached
 * through a token in the URL (`/pay/...`), or a booking form a business hands
 * to its own customers by direct link (`/booknow/...`) rather than something
 * customers are expected to find through a search engine. Indexing the last two
 * would put customer-facing links with tokens into search results.
 *
 * The exceptions are the public home page and the legal pages (privacy,
 * terms, security). Google's OAuth verification and customers both need to be
 * able to read them, and none carries a token or customer data.
 *
 * If a business ever wants its booking page discoverable, the change is to add
 * `allow: "/booknow/"` here — deliberately, not by default. There is no sitemap
 * for the same reason: with nothing indexable, one would only advertise URLs.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // "/$" is the home page only, not everything under it.
      allow: ["/$", "/privacy", "/terms", "/security"],
      disallow: "/",
    },
  };
}
