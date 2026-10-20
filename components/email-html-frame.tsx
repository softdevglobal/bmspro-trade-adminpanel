"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shows an email's HTML the way it was designed, safely:
 * - `sandbox` without `allow-scripts`, so nothing in the email can run;
 * - a CSP inside the frame that allows images (always shown, like a normal
 *   mail app) but blocks every other network request;
 * - links open in a new tab, never inside the app.
 * The HTML is also cleaned on the server before it gets here.
 */
export function EmailHtmlFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https: http:;">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;}
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2937;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  table{max-width:100%;}
  pre{white-space:pre-wrap;}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid #d1d5db;padding-left:1ex;color:#4b5563;}
  a{color:#004ac6;}
</style></head><body>${html}</body></html>`;

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 60), 20_000));
  }, []);

  // Images change the height after load; measure again a little later.
  useEffect(() => {
    const timers = [300, 1200, 3000].map((delay) => window.setTimeout(measure, delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [srcDoc, measure]);

  return (
    <iframe
      ref={frameRef}
      title="Email message"
      // allow-same-origin (without allow-scripts) only lets this page measure the
      // content height; the email itself still cannot run code.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={measure}
      style={{ height }}
      className="block w-full rounded-lg border-0 bg-white"
    />
  );
}
