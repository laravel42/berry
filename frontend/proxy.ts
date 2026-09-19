import { NextResponse, type NextRequest } from 'next/server';

/**
 * A Berry page asked for inside a frame is a site preview that lost its way.
 *
 * A built app runs in the preview at its own routes (`/`, `/pricing`) on
 * Berry's host, because its router has no other way to see them. As long as
 * it moves by history.pushState nothing is fetched. But when the browser has
 * to reload one of those entries (a cross-document Back, an entry it did not
 * keep), it asks Berry for `/pricing` — and Berry's own app would render inside
 * the preview. Berry is never framed itself, so a page request marked
 * `Sec-Fetch-Dest: iframe` is always this: it gets a page that tells the
 * preview where it was, and the preview reopens the site there.
 */
export function proxy(request: NextRequest) {
   if (request.headers.get('sec-fetch-dest') !== 'iframe') return NextResponse.next();
   const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
   const html = `<!doctype html><meta charset="utf-8"><script>try{parent.postMessage({type:"berry-preview:lost",path:${JSON.stringify(path)}+location.hash},"*")}catch(e){}</script>`;
   return new NextResponse(html, {
      status: 200,
      headers: {
         'content-type': 'text/html; charset=utf-8',
         'cache-control': 'no-store',
         // The frame asking is already sandboxed; this page runs nothing else.
         'content-security-policy': "sandbox allow-scripts; frame-ancestors 'self'",
      },
   });
}

export const config = {
   // Pages only: the API, the public API, health and Next's own assets pass by.
   matcher: ['/((?!api/|v1/|health|_next/|favicon.ico).*)'],
};
