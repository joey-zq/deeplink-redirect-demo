/**
 * Deep link redirect demo — routing on a tracking link.
 *
 * Standalone by design: no click recording, no attribution. It reproduces only
 * the routing decision, so the behaviour can be judged on real devices before
 * any of it is built into a real click handler.
 *
 * Routes:
 *   GET /                the links, their configuration, and a URL generator
 *   GET /1 /2 /3         the three demo links, short enough to fit a sparse QR
 *   GET /go?…            the routing decision
 *   GET /go?…&debug=1    returns the decision as JSON instead of acting on it
 *   GET /qr?d=<url>      an SVG QR code, generated here, no external service
 *   GET /.well-known/…   the two association files a verified link domain would host,
 *                        filled in with a worked example rather than real IDs
 *
 * Query parameters on /go:
 *   force_deeplink        the switch. absent/false -> today's destination
 *   deeplink_url          the screen inside the app, e.g. fb://profile
 *   deeplink_url_ios      demo-only: per-platform deeplink override
 *   deeplink_url_android  demo-only: per-platform deeplink override
 *   redirect_url_ios      where iPhone goes when the app does not open
 *   redirect_url_android  the same for Android
 *   redirect_url_web      the same for a desktop browser
 *   redirect_url          the destination for any platform not named above
 *   wait                  demo-only: ms the page waits before giving up.
 *                         0 disables the automatic fallback entirely.
 *   android               demo-only: forces `page` or `intent` on Android
 *                         instead of letting the browser check decide.
 *
 * The three destinations are whatever the customer wants — a store page, or
 * their own page. Precedence is most-specific-first: the platform's own
 * parameter, then `redirect_url`, then the app's configured store page. A link
 * that only sets `redirect_url` behaves exactly as it does today.
 *
 * One exception: keep Android on the store. The
 * store URL is what carries the install referrer, and the referrer is what
 * delivers the deeplink after an install and matches it back to this click.
 * Point Android at a landing page and deferred delivery breaks silently. iOS
 * has no equivalent mechanism, so iOS is free.
 */
import { indexPage, escapeHTML, links, params, LINKS } from './page.js'
import { qrSVG } from './qr.js'

const DEFAULT_STORE = 'https://example.com/'

/**
 * How long the iOS page waits for the app to take over before going to the
 * store.
 *
 * A first draft used 1200 ms. On a real iPhone that is far too short: iOS raises
 * its "Open in <App>?" confirmation and **keeps the page's timers running
 * behind it**, so the store loads while the user is still reading the prompt —
 * observed as the App Store sheet appearing on top of the unanswered dialog.
 * The only trustworthy signal that the app won is the page being hidden, and
 * that cannot arrive until after the user answers. So the wait has to outlast
 * a human reading a dialog, not a network round trip.
 *
 * `wait` overrides it, so the tolerable value gets settled on a device rather
 * than argued about.
 */
const IOS_WAIT_MS = 4000

const MAX_QR_LENGTH = 1200

// ---------------------------------------------------------------- decision

export function detectPlatform(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

export function isTrue(value) {
  if (value === null || value === undefined) return false
  return ['1', 'true', 't', 'yes', 'y'].includes(String(value).toLowerCase())
}

/**
 * The parameter is already typed as a URL upstream, and url.Parse accepts
 * almost anything — including `product/456`, which has no scheme and cannot
 * open an app. So the scheme check is ours. Returns null when unusable.
 */
export function parseDeeplink(raw) {
  if (!raw) return null
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const scheme = parsed.protocol.replace(/:$/, '')
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) return null

  const sep = raw.indexOf('://')
  const rest = sep === -1 ? raw.slice(parsed.protocol.length) : raw.slice(sep + 3)
  return { raw, scheme, rest }
}

/**
 * Chrome's intent syntax. S.browser_fallback_url is Chrome's own field, not a
 * tracking-link parameter: Chrome follows it when nothing on the device handles the
 * scheme. No package targeting — the scheme is enough, and we do not reliably
 * hold a package name.
 */
/**
 * `intent://` is Chrome's syntax. Everything else on Android — WebViews, the
 * OEM browsers, Samsung Internet — either answers it with
 * ERR_UNKNOWN_URL_SCHEME or silently does nothing, which is what a browser
 * does with a Location header it cannot parse: no page, no error.
 *
 * So this is an allowlist, not a blocklist. A blocklist would have to name
 * every browser shipped on every Android phone sold in China; an allowlist
 * only has to recognise the one browser we know handles intent://, and
 * anything unrecognised falls back to the interstitial, which works anywhere
 * the browser can navigate a custom scheme at all.
 */
const NOT_PLAIN_CHROME = [
  '; wv)',            // any Android WebView, which is what in-app browsers embed
  'MicroMessenger',   // WeChat
  'SamsungBrowser',
  'HuaweiBrowser',
  'MiuiBrowser',      // Xiaomi
  'HeyTapBrowser',    // OPPO / realme
  'VivoBrowser',
  'QQBrowser',
  'MQQBrowser',
  'UCBrowser',
  'Quark',
  'Weibo',
  'EdgA/',
  'OPR/',
]

export function androidUsesIntent(ua) {
  if (!/Chrome\//.test(ua)) return false
  return !NOT_PLAIN_CHROME.some((token) => ua.includes(token))
}

export function isWebLink(deeplink) {
  return deeplink.scheme === 'http' || deeplink.scheme === 'https'
}

export function buildIntent(deeplink, fallback) {
  const rest = deeplink.rest.split('#')[0]
  return (
    'intent://' + rest +
    '#Intent;scheme=' + deeplink.scheme +
    ';S.browser_fallback_url=' + encodeURIComponent(fallback) +
    ';end'
  )
}

/**
 * The routing decision in one place. `action` is either 'redirect' (302 to
 * `location`) or 'html' (serve the iOS page, which attempts `deeplink` and
 * falls back to `location`).
 */
export function decide({
  ua, force, deeplinkURL, iosDeeplink, androidDeeplink, iosURL, androidURL, webURL, defaultURL,
  androidMode,
}) {
  const platform = detectPlatform(ua || '')

  // Most specific first: this platform's own destination, then the catch-all,
  // then what the link does today.
  const named = platform === 'ios' ? iosURL : platform === 'android' ? androidURL : webURL
  const destination = named || defaultURL || DEFAULT_STORE

  if (!force) {
    return { platform, branch: 'no_force', action: 'redirect', location: destination }
  }

  const namedDeeplink =
    platform === 'ios' ? iosDeeplink : platform === 'android' ? androidDeeplink : ''
  const deeplink = parseDeeplink(namedDeeplink || deeplinkURL)
  if (!deeplink) {
    return { platform, branch: 'invalid_deeplink', action: 'redirect', location: destination }
  }

  const useIntent =
    androidMode === 'intent' || (androidMode !== 'page' && androidUsesIntent(ua || ''))

  if (platform === 'android' && !useIntent) {
    // Verified on a Chinese-market Honor phone: the interstitial fires the
    // scheme in the phone's own browser, and in WeChat — where the scheme is
    // blocked outright — the Continue link still reaches the store.
    return { platform, branch: 'android_page', action: 'html', location: destination, deeplink: deeplink.raw }
  }

  if (platform === 'android') {
    // An http(s) deeplink is an App Link: Android matches it to the app on its
    // own, and wrapping it in an intent would offer it to every browser too.
    // Send it straight through and let the OS decide.
    if (isWebLink(deeplink)) {
      return {
        platform,
        branch: 'android_app_link',
        action: 'redirect',
        location: deeplink.raw,
        fallbackURL: destination,
        deeplink: deeplink.raw,
      }
    }
    return {
      platform,
      branch: 'android_intent',
      action: 'redirect',
      location: buildIntent(deeplink, destination),
      fallbackURL: destination,
      deeplink: deeplink.raw,
    }
  }

  if (platform === 'ios') {
    return { platform, branch: 'ios_page', action: 'html', location: destination, deeplink: deeplink.raw }
  }

  return { platform, branch: 'desktop', action: 'redirect', location: destination, deeplink: deeplink.raw }
}

// ---------------------------------------------------------------- iOS page

/**
 * Self-contained, no external assets, no branding.
 *
 * Two things here are deliberate and belong in the real handler:
 *
 * 1. The cancel listeners are registered *before* the deeplink attempt. The
 *    attempt can hand off to the OS at any moment, and a listener registered
 *    after it may never run.
 *
 * 2. `visibilitychange` / `pagehide` are the only trustworthy signal that the
 *    app won. Nothing distinguishes "the user declined" from "no app" — both
 *    leave the page visible — so a declined prompt still ends at the store.
 */
export function iosPage(deeplink, storeURL, waitMs) {
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Opening…</title>',
    '</head><body style="margin:0;padding:3rem 1.5rem;text-align:center;',
    'font:16px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif">',
    '<p>Opening…</p>',
    '<p><a href="' + escapeHTML(storeURL) + '">Continue</a></p>',
    '<script>(function(){',
    'var store=' + JSON.stringify(storeURL) + ';',
    'var deeplink=' + JSON.stringify(deeplink) + ';',
    'var done=false;',
    'function stop(){done=true;}',
    "document.addEventListener('visibilitychange',function(){if(document.hidden)stop();});",
    "window.addEventListener('pagehide',stop);",
    waitMs > 0
      ? 'setTimeout(function(){if(!done&&!document.hidden){window.location.replace(store);}},' + waitMs + ');'
      : '',
    'window.location.replace(deeplink);',
    '})();</script>',
    '</body></html>',
  ].join('')
}

// ---------------------------------------------------------------- handler

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function json(value) {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function redirect(location) {
  // Not Response.redirect(): that validates the URL, and `intent://` is not
  // one the URL parser will accept as a redirect target.
  return new Response('<a href="' + escapeHTML(location) + '">Found</a>', {
    status: 302,
    headers: {
      location,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export function parseWait(raw) {
  if (raw === null || raw === undefined || raw === '') return IOS_WAIT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return IOS_WAIT_MS
  return Math.min(n, 30000)
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (path === '/') return html(indexPage(url.origin, IOS_WAIT_MS))

    // The server half of a verified link domain, shown rather than described. These are the
    // real shapes; the identifiers are a worked example. Serving them proves
    // nothing on its own — an app has to declare the domain and ship a release
    // before either file does anything — which is precisely the cost.
    if (path === '/.well-known/apple-app-site-association') {
      return json({
        applinks: {
          details: [
            {
              appIDs: ['ABCDE12345.com.example.app'],
              components: [{ '/': '/c/*', comment: 'click links for this app' }],
            },
          ],
        },
        _comment:
          'appIDs is <Apple Team ID>.<bundle ID>. The Team ID is the piece we would have to ' +
          'collect from each app developer.',
      })
    }

    if (path === '/.well-known/assetlinks.json') {
      return json([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.example.app',
            sha256_cert_fingerprints: [
              '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5',
            ],
          },
        },
      ])
    }

    if (path === '/qr') {
      const data = url.searchParams.get('d') || ''
      if (!data || data.length > MAX_QR_LENGTH) return new Response('Bad request', { status: 400 })
      let svg
      try {
        svg = qrSVG(data, { size: 256 })
      } catch (err) {
        return new Response(String(err.message), { status: 400 })
      }
      return new Response(svg, {
        headers: {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'public, max-age=86400',
        },
      })
    }

    // /1 /2 /3 are the demo links by number. Same routing as /go — they exist
    // only so the QR codes stay sparse enough to scan off a laptop screen.
    const numbered = LINKS.find((item) => path === '/' + item.n)
    const q = numbered
      ? new URLSearchParams(params(numbered))
      : path === '/go'
        ? url.searchParams
        : null
    if (!q) return new Response('Not found', { status: 404 })

    // the wait override still comes from the real query string
    const waitParam = url.searchParams.get('wait')
    const debugParam = url.searchParams.get('debug')
    const result = decide({
      ua: request.headers.get('user-agent') || '',
      force: isTrue(q.get('force_deeplink')),
      deeplinkURL: q.get('deeplink_url') || '',
      iosDeeplink: q.get('deeplink_url_ios') || '',
      androidDeeplink: q.get('deeplink_url_android') || '',
      iosURL: q.get('redirect_url_ios') || '',
      androidURL: q.get('redirect_url_android') || '',
      webURL: q.get('redirect_url_web') || '',
      defaultURL: q.get('redirect_url') || '',
      androidMode: (url.searchParams.get('android') || '').toLowerCase(),
    })

    if (isTrue(debugParam)) {
      return new Response(
        JSON.stringify(
          { ...result, wait: parseWait(waitParam), userAgent: request.headers.get('user-agent') || '' },
          null,
          2,
        ),
        { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
      )
    }

    if (result.action === 'html') {
      return html(iosPage(result.deeplink, result.location, parseWait(waitParam)))
    }
    return redirect(result.location)
  },
}

export { links, params, LINKS, indexPage }
