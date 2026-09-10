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
 *   app_name              demo-only: the app name shown on the page. A real
 *                         link takes name and icon from the app record.
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
/**
 * What the fallback is, from its URL: a store (with its glyph and the
 * store's own wording) or a web page. Drives the copy on the page.
 */
export function destinationInfo(url) {
  let host = ''
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    host = ''
  }
  if (host === 'apps.apple.com' || host === 'itunes.apple.com') {
    return { kind: 'store', label: 'the App Store', cta: 'Download on the App Store', glyph: 'apple' }
  }
  if (host === 'play.google.com') {
    return { kind: 'store', label: 'Google Play', cta: 'Get it on Google Play', glyph: 'play' }
  }
  return { kind: 'web', label: host || 'the website', cta: 'Continue to ' + (host || 'the website'), glyph: 'globe' }
}

export function destinationLabel(url) {
  return destinationInfo(url).label
}

// Inline glyphs, 24×24, drawn in currentColor. No external assets on this page.
const GLYPH = {
  apple:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"/></svg>',
  play:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3.5v17a1 1 0 0 0 1.5.87l14-8.5a1 1 0 0 0 0-1.74l-14-8.5A1 1 0 0 0 4 3.5z"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 0c-2.8 2.6-2.8 16.4 0 19m0-19c2.8 2.6 2.8 16.4 0 19M2.5 12h19M4 7.5h16M4 16.5h16"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M8.5 7H17v8.5"/></svg>',
}

/**
 * The interstitial. Two zones, two states.
 *
 * Top zone = the deeplink: icon, app name, "Opening <App>…", and a manual
 * "Not opening? Open <App>" link for when the automatic attempt did nothing
 * (in-app browsers), which as a tap is a real user gesture.
 * Bottom zone = the fallback: "Don't have <App>?", the store button with the
 * store's glyph, and the countdown to it.
 *
 *   Opening  — the first `waitMs` after load. If the page is still visible
 *              when the wait ends, it goes to the fallback by itself.
 *   Waiting  — the wait was cancelled (the page was hidden: the app opened,
 *              or the user switched away) and the page is visible again, or
 *              the user tapped, or `waitMs` is 0. No automatic redirect: a
 *              user who comes back may have the app open already. The status
 *              line and the countdown go away; the two actions stay.
 *
 * Self-contained: the only asset is the icon, inlined. Both actions are plain
 * links, so the page works with JavaScript off. The cancel listeners are
 * registered before the deeplink attempt on purpose: the hand-off to the OS
 * can happen at once, and a listener registered after it may never run.
 */
export function iosPage(deeplink, storeURL, waitMs, app = {}) {
  const name = (app && app.name) || ''
  const icon = (app && app.icon) || ''
  const dest = destinationInfo(storeURL)
  const title = name ? 'Opening ' + name : 'Opening the app'
  const openLabel = name ? 'Open ' + name : 'Open the app'
  const askLabel = dest.kind === 'store' ? (name ? "Don't have " + name + '?' : "Don't have the app?") : 'Or continue on the web'
  const seconds = Math.ceil(waitMs / 1000)
  const style = [
    ':root{color-scheme:light dark;--fg:#1c1c1e;--muted:rgba(60,60,67,.6);--line:rgba(60,60,67,.29);--tint:#0a84ff;--bg:#fff}',
    '@media (prefers-color-scheme:dark){:root{--fg:#f2f2f7;--muted:rgba(235,235,245,.6);--line:rgba(84,84,88,.65);--bg:#000}}',
    'html,body{height:100%}',
    'body{margin:0;background:var(--bg);color:var(--fg);',
    'font:16px/1.45 -apple-system,BlinkMacSystemFont,system-ui,Segoe UI,Roboto,sans-serif;-webkit-text-size-adjust:100%}',
    'main{min-height:100%;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;',
    'justify-content:space-between;padding:max(12vh,3rem) 1.5rem max(env(safe-area-inset-bottom),1.5rem)}',
    '.top,.bottom{width:100%;max-width:22rem;text-align:center}',
    '.icon{width:72px;height:72px;border-radius:16px;display:block;margin:0 auto 1rem;',
    'box-shadow:0 1px 3px rgba(0,0,0,.15)}',
    '.icon.blank{background:var(--line)}',
    'h1{font-size:1.35rem;font-weight:600;margin:0 0 .25rem;letter-spacing:-.01em}',
    '.status{margin:0 0 1rem;color:var(--muted);font-size:.95rem}',
    '.link{display:inline-flex;align-items:center;gap:.3rem;color:var(--tint);text-decoration:none;font-weight:500;font-size:.95rem}',
    '.link svg{width:1.05em;height:1.05em}',
    '.ask{margin:0 0 .6rem;color:var(--muted);font-size:.85rem}',
    '.btn{display:flex;align-items:center;justify-content:center;gap:.6rem;box-sizing:border-box;width:100%;',
    'padding:.85rem 1rem;margin:0 0 .6rem;border-radius:12px;text-decoration:none;font-weight:600;font-size:1rem;',
    'border:1px solid var(--tint);color:var(--tint);background:transparent}',
    '.btn svg{width:1.3em;height:1.3em;flex:0 0 auto}',
    '.count{margin:0;color:var(--muted);font-size:.85rem}',
    '[hidden]{display:none!important}',
    '.dots::after{content:"…";display:inline-block;width:1.2em;text-align:left;animation:d 1.5s steps(4,end) infinite}',
    '@keyframes d{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"…"}}',
  ].join('')
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<title>' + escapeHTML(title) + '…</title>',
    '<style>' + style + '</style>',
    '</head><body><main>',
    // top zone: the deeplink
    '<div class="top">',
    icon
      ? '<img class="icon" src="' + escapeHTML(icon) + '" alt="">'
      : '<div class="icon blank"></div>',
    '<h1>' + escapeHTML(name || 'Your app') + '</h1>',
    '<p id="status" class="status"><span class="dots">' + escapeHTML(title) + '</span></p>',
    '<a id="open" class="link" href="' + escapeHTML(deeplink) + '">' +
      '<span id="opentext">Not opening? ' + escapeHTML(openLabel) + '</span>' + GLYPH.open + '</a>',
    '</div>',
    // bottom zone: the fallback
    '<div class="bottom">',
    '<p class="ask">' + escapeHTML(askLabel) + '</p>',
    '<a id="store" class="btn" href="' + escapeHTML(storeURL) + '">' + GLYPH[dest.glyph] + '<span>' + escapeHTML(dest.cta) + '</span></a>',
    waitMs > 0
      ? '<p id="count" class="count">Continuing to ' + escapeHTML(dest.label) + ' in <b id="n">' + seconds + '</b>s</p>'
      : '',
    '</div>',
    '</main>',
    '<script>(function(){',
    'var store=' + JSON.stringify(storeURL) + ';',
    'var deeplink=' + JSON.stringify(deeplink) + ';',
    'var wait=' + waitMs + ';',
    'var done=false;',
    "var count=document.getElementById('count'),n=document.getElementById('n'),status=document.getElementById('status'),opentext=document.getElementById('opentext');",
    'var deadline=Date.now()+wait,tick=null;',
    // Waiting state: no countdown, no status line, the manual link reads as the action itself.
    "function rest(){if(count)count.hidden=true;if(status)status.hidden=true;if(opentext)opentext.textContent=" + JSON.stringify(openLabel) + ";if(tick){clearInterval(tick);tick=null;}}",
    'function stop(){if(done)return;done=true;if(tick){clearInterval(tick);tick=null;}}',
    "document.addEventListener('visibilitychange',function(){if(document.hidden){stop();}else if(done){rest();}});",
    "window.addEventListener('pagehide',stop);",
    "document.getElementById('open').addEventListener('click',function(){stop();rest();});",
    waitMs > 0
      ? 'tick=setInterval(function(){if(n)n.textContent=Math.max(0,Math.ceil((deadline-Date.now())/1000));},250);' +
        'setTimeout(function(){if(!done&&!document.hidden){window.location.replace(store);}},' + waitMs + ');'
      : 'rest();',
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
      // A real link takes name and icon from the app record. The demo links
      // carry them; /go accepts a demo-only `app_name`.
      const appName = (url.searchParams.get('app_name') || '').slice(0, 60)
      const known = numbered || LINKS.find((item) => item.app === appName)
      const app = known ? { name: known.app, icon: known.icon } : { name: appName }
      return html(iosPage(result.deeplink, result.location, parseWait(waitParam), app))
    }
    return redirect(result.location)
  },
}

export { links, params, LINKS, indexPage }
