# Deep link redirect demo

A standalone Cloudflare Worker that reproduces the routing decision of a
tracking link that can open an app: `force_deeplink=1` plus a `deeplink_url`,
with a store or web fallback. It exists so the behaviour can be judged on real
devices before any of it is built into a real click handler.

Deliberately standalone: no click recording, no attribution, no database. It is
a redirect and nothing else.

**Live:** https://deeplink-demo.joeyzhq.workers.dev — free Cloudflare plan,
public and unauthenticated.

## Deploy

```
npm install
npx wrangler login          # once per machine
node test.mjs && npx wrangler deploy
```

New code takes a few seconds to reach every edge; a request right after `deploy`
can still hit the previous version. Confirm with a request that looks for
something only the new version says before trusting a live check.

## Routes

| Route | What it does |
| --- | --- |
| `/` | the links with their full configuration, plus a URL generator |
| `/1` `/2` `/3` | the three demo links |
| `/go?…` | the same routing, spelled out in parameters |
| `?debug=1` | returns the decision as JSON instead of acting on it |
| `/qr?d=<url>` | an SVG QR code, generated here — no external service |

Parameters: `force_deeplink`, `deeplink_url`, three destinations
(`redirect_url_ios` / `redirect_url_android` / `redirect_url_web`), the
catch-all `redirect_url`, and demo-only `wait` (ms the iOS page waits; `0`
disables the automatic fallback).

**Destination precedence, most specific first:** the platform's own parameter →
`redirect_url` → the app's configured store page. A link that sets only
`redirect_url` behaves exactly as a plain tracking link does, so nothing existing breaks.

None of the three has to be a store page — a landing page is equally
valid, and on iOS it is better: a web URL loads invisibly under the "Open in
<App>?" dialog where an `apps.apple.com` URL throws the App Store sheet over
Safari. **The exception is Android.** The store URL carries the install
referrer, and the referrer is what delivers the deeplink after an install and
matches it back to this click. Point Android at a landing page and deferred
delivery breaks silently.

`/1` `/2` `/3` exist for the QR codes. The parameterised form is ~330
characters, which needs a version 13 symbol — too dense for a phone to read off
a laptop screen at any size a page can reasonably show. `/1` needs version 3.

## The QR encoder

`src/qr.js` is a byte-mode encoder written here rather than pulled from a CDN,
because the page must not depend on anything external. It is checked three ways
in `test.mjs`, not trusted:

- the Reed–Solomon step against the published version 1-Q test vector, also
  confirmed against the `reedsolo` package
- the version tables in `qr-tables.js` are generated from `segno`, not recalled
- every placed matrix is read back through the mask and the zig-zag and compared
  to the codewords that went in

Rendered output was decoded with OpenCV end to end, including off the deployed
`/qr` route at the size the page displays it.

## The two links

| Link | Job | Scheme |
| --- | --- | --- |
| Facebook | nearly everyone has it → the app-opens branch | `fb://profile`, watched working on a real iPhone |
| Wikipedia | nothing answers it → the app-not-installed branch | `wikipediademo://home`, invented on purpose and labelled as such on the page |

Two links, two jobs. A scheme nothing can answer is the *requirement* for the
second one, not a defect — which is why it is fine there and was not fine as a
half-claim that it might open something. Anything in between belongs in the
generator, where nobody mistakes it for a working example.

## What it proves, and what it does not

Proves — everything that is browser or OS behaviour:

- iOS installed: the confirmation alert, and whether the store loads behind
- iOS not installed: the "cannot open" alert, then the store
- **iOS, user taps Cancel**: the page is still visible, so the wait expires and
  sends them to the store anyway. Unavoidable with a custom scheme — there is no JS-visible difference between "declined"
  and "no app"
- Android: whether Chrome follows `S.browser_fallback_url`, and whether a
  **302 into `intent://` counts as a user gesture** — the one item that is not
  settled by platform documentation
- desktop: `web_url`, no app attempt, no pause

Does not prove — anything needing a real app in a real store:

- deferred delivery (no app → store → install → land on the target screen)
- that a real tracking link still records the click and still carries the
  install referrer

## Findings for the real handler

1. **1200 ms is too short, and the reason matters.** iOS does *not*
   pause the page while its "Open in <App>?" dialog is up. A short timer fires
   underneath the dialog and loads the App Store before the user has answered —
   observed on a real iPhone with Facebook installed: the store sheet appeared
   on top of the prompt. The only trustworthy signal that the app won is
   `visibilitychange`/`pagehide`, which cannot arrive until after the answer, so
   the wait has to outlast a human reading a dialog. Default here is 4000 ms and
   `wait` overrides it — the tolerable value is a device question, not a
   design-review question. An earlier theory that the dialog *froze* the page's
   timers was wrong, and the freeze-detection built on it did nothing.
2. **A store fallback is visibly worse than a web fallback, which is why hosted
   link tools look smoother.** An `apps.apple.com` URL makes iOS
   throw the App Store sheet over Safari; an ordinary web URL just changes the
   page underneath the dialog, invisibly. Same mechanism, different blast
   radius — and a real re-engagement link always falls back to the store.
3. **Register the cancel listeners before the deeplink attempt.** The attempt can
   hand off to the OS at any moment; a listener registered after it may never run.
4. **`Response.redirect()` rejects `intent://`** — set the `Location` header
   directly. workerd verified not to mangle it.
5. **Strip the fragment from the deeplink before composing the intent**, or a `#`
   terminates Chrome's own `#Intent;…` block.
6. **A deeplink with no host composes to `intent://#Intent;…`.** Chrome's
   documented syntax always has a host, and real links will carry bare `myapp://`.
   Avoided here by giving every demo scheme a host; the real handler needs a rule.
7. **iPadOS Safari reports a Mac user agent**, so an iPad takes the desktop branch.
8. Scheme validation is the handler's job, not the URL parser's: `product/456` parses fine in
   both Go and JS but cannot open an app.

## Changing the demo

`LINKS` in `src/page.js` is the list rendered on the index page and served at
`/1` `/2` `/3`; `OTHER_SCHEMES` is the paste-in list underneath it. Adding a
fourth link means adding a fourth entry — the number is the route.

Screenshots of the real iPhone behaviour live in `shots/`; `tools/embed-shots.mjs`
bakes them into `src/shots.js`.
