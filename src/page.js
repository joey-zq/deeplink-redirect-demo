/**
 * The index page: the demo links with their full configuration, and a
 * generator for building your own.
 */
import { qrSVG } from './qr.js'
import { SHOTS } from './shots.js'
import { ICONS } from './icons.js'

export function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const FACEBOOK = {
  ios: 'https://apps.apple.com/us/app/facebook/id284882215',
  android: 'https://play.google.com/store/apps/details?id=com.facebook.katana',
  web: 'https://www.facebook.com/',
}
const WIKIPEDIA = {
  ios: 'https://apps.apple.com/us/app/wikipedia/id324715238',
  android: 'https://play.google.com/store/apps/details?id=org.wikipedia',
  web: 'https://www.wikipedia.org/',
}

/**
 * Two links, two jobs. The first uses a scheme we have watched open an app.
 * The second uses one that is made up on purpose — for showing what happens
 * when the app is missing, a scheme nothing can answer is the requirement, not
 * a defect. Anything in between belongs in the generator, where nobody
 * mistakes it for a working example.
 */
export const LINKS = [
  {
    n: 1,
    app: 'Facebook',
    icon: ICONS.facebook,
    scheme: 'fb://profile',
    urls: FACEBOOK,
    tag: 'app opens',
  },
  {
    n: 2,
    app: 'Wikipedia',
    icon: ICONS.wikipedia,
    scheme: 'wikipediademo://home',
    urls: WIKIPEDIA,
    tag: 'nothing opens — on purpose',
    note:
      'The scheme is wrong on purpose, so it will not open even if you have the app.',
  },
]

/** Tap-to-fill examples, all seen opening their app on a real device. */
export const OTHER_SCHEMES = [
  'fb://profile',
  'instagram://user?username=nasa',
  'comgooglemaps://?q=Tokyo',
]

export function params(item) {
  return [
    ['force_deeplink', '1'],
    ['deeplink_url', item.scheme],
    ['redirect_url_ios', item.urls.ios],
    ['redirect_url_android', item.urls.android],
    ['redirect_url_web', item.urls.web],
  ]
}

export function linkURL(origin, item) {
  const url = new URL('/go', origin)
  for (const [k, v] of params(item)) url.searchParams.set(k, v)
  // demo-only: a real link takes the name (and icon) from the app record
  url.searchParams.set('app_name', item.app)
  return url.toString()
}

/**
 * The same link, as a short path. Only so the QR code stays sparse: the full
 * form is ~330 characters, which needs a version 13 symbol that a phone
 * struggles to read off a laptop screen. `/1` needs version 3.
 */
export function shortURL(origin, item) {
  return new URL('/' + item.n, origin).toString()
}

export function links(origin) {
  return LINKS.map((item) => ({
    ...item,
    href: linkURL(origin, item),
    short: shortURL(origin, item),
  }))
}

/** An <img> pointing at our own /qr route, so nothing is fetched off-site. */
function qrImg(href, px = 128) {
  return (
    `<img class="qr" width="${px}" height="${px}" alt="QR code" ` +
    `src="/qr?d=${encodeURIComponent(href)}">`
  )
}

/**
 * A "Not tested" chip. Only the gaps are labelled: a chip on every verified
 * cell would be twenty chips saying the expected thing.
 */
function chip(seen) {
  if (!SEEN_LABEL[seen]) return ''
  const [label, title] = SEEN_LABEL[seen]
  return `<span class="seen ${seen}" title="${escapeHTML(title)}">${label}</span>`
}

function pill(st) {
  if (!STATUS[st]) return ''
  const [sym, label, title] = STATUS[st]
  return (
    `<span class="st ${st}" title="${escapeHTML(title)}">` +
    `<b aria-hidden="true">${sym}</b>${label}</span>`
  )
}

/**
 * A custom-scheme cell: one figure per screen the user is shown, which is
 * sometimes two. Cells with no screenshot yet say so rather than being blank.
 */
function shotCell(figs, alt, group) {
  return (
    `<td${group ? ' class="g"' : ''}>` +
    figs
      .map((f) => {
        const shot = f.shot && SHOTS[f.shot]
        return (
          '<figure>' +
          (shot
            ? `<img src="${shot}" alt="${escapeHTML(alt + ' — ' + f.text)}">`
            : '<div class="pending">screenshot to come</div>') +
          `<figcaption>${pill(f.st)}${escapeHTML(f.text)}${chip(f.seen)}</figcaption>` +
          '</figure>'
        )
      })
      .join('') +
    '</td>'
  )
}

/**
 * A Universal Link cell. There is no screenshot because there is no screen —
 * drawing that as a box rather than leaving it empty is the whole comparison.
 */
function noneCell(c, group) {
  return (
    `<td${group ? ' class="g"' : ''}>` +
    `<div class="none ${c.st}">${escapeHTML(c.none)}</div>` +
    `<div>${pill(c.st)}${chip(c.seen)}</div>` +
    '</td>'
  )
}

function paramTable(item) {
  const rows = params(item)
    .map(([k, v]) => `<tr><td><code>${k}</code></td><td><code>${escapeHTML(v)}</code></td></tr>`)
    .join('')
  return `<table class="cfg">${rows}</table>`
}

/**
 * One row per browser, four cells: each mechanism in each case. The custom
 * scheme cells carry screenshots because the user is shown something every
 * time; the Universal Link cells carry a phrase because the whole point is
 * that nothing is shown. That contrast is the argument, so the columns are
 * kept the same width and the emptiness is drawn, not omitted.
 */
const MATRIX = [
  {
    env: 'iPhone — Safari',
    ulInstalled: { none: 'the app opens', st: 'auto' },
    ulMissing: { none: 'the web page loads', st: 'auto' },
    csInstalled: [{ shot: '1-safari-installed', text: 'tap Open', st: 'tap1' }],
    csMissing: [
      { shot: '4-safari-not-installed', text: 'after the wait, tap Open', st: 'tap1' },
      { shot: '5-safari-cancel', text: 'or tap Cancel, then OK', st: 'tap2' },
    ],
  },
  {
    env: 'iPhone — Chrome',
    ulInstalled: { none: 'the app opens', st: 'auto' },
    ulMissing: { none: 'the web page loads', st: 'auto' },
    csInstalled: [{ shot: '2-chrome-prompt', text: 'tap Allow', st: 'tap1' }],
    csMissing: [{ shot: '3-chrome-not-installed', text: 'tap Allow, then Got it', st: 'tap2' }],
  },
  {
    env: 'Android — Chrome',
    ulInstalled: { none: 'the app opens', st: 'auto' },
    ulMissing: { none: 'the web page loads', st: 'auto' },
    csInstalled: [{ text: 'the app opens', st: 'auto', seen: 'guess' }],
    csMissing: [{ text: 'the store', st: 'auto', seen: 'guess' }],
  },
  {
    env: 'Android — OEM browsers',
    sub: 'Samsung Internet, Xiaomi, OPPO, vivo, Honor',
    ulInstalled: { none: 'Samsung: the app does not open', st: 'blocked', seen: 'guess' },
    ulMissing: { none: 'the web page loads', st: 'auto' },
    csInstalled: [{ text: 'the app opens', st: 'auto', seen: 'guess' }],
    csMissing: [{ text: 'the store', st: 'auto' }],
  },
  {
    env: 'In-app browser',
    sub: 'ads inside other apps — most retargeting inventory',
    ulInstalled: { none: 'the app does not open', st: 'blocked', seen: 'guess' },
    ulMissing: { none: 'the web page loads', st: 'auto' },
    csInstalled: [{ text: 'nothing fires; tap Continue', st: 'tap1', seen: 'guess' }],
    csMissing: [{ text: 'nothing fires; tap Continue', st: 'tap1' }],
  },
]

const SEEN_LABEL = {
  guess: ['Assumed', 'our half is checked; nobody has watched the phone half'],
}

/**
 * The friction marker. This is the column people actually decide on, so it is
 * a symbol first and a word second — never colour alone, which some of us
 * cannot read as a distinction.
 */
const STATUS = {
  auto: ['✓', 'no tap', 'happens by itself'],
  tap1: ['●', '1 tap', 'the user has to tap something'],
  tap2: ['●', '2 taps', 'the user has to tap twice'],
  blocked: ['✕', 'blocked', 'the app cannot be opened at all here'],
}

// A real Universal Link, on a domain Google already verified. We cannot make
// any app declare our domain, but we can borrow one that has — the experience
// is identical to what a hosted verified domain would give.
const MAPS_UNIVERSAL = 'https://www.google.com/maps/place/Tokyo+Tower/@35.6585805,139.7454329,17z'

const MAPS_SCHEME = 'comgooglemaps://?q=Tokyo'

/**
 * The two link formats, side by side, each with something to tap. The
 * Universal Link has to be its own href: routing it through /go would be a
 * redirect, and a redirect into a Universal Link does not open the app.
 */
const FORMATS = [
  {
    k: 'Custom scheme',
    url: MAPS_SCHEME,
    body: 'Only an app can answer it, so the OS asks first.',
    href:
      '/go?force_deeplink=1&deeplink_url=' + encodeURIComponent(MAPS_SCHEME) +
      '&redirect_url_ios=' +
      encodeURIComponent('https://apps.apple.com/us/app/google-maps/id585027354') +
      '&redirect_url_android=' +
      encodeURIComponent('https://play.google.com/store/apps/details?id=com.google.android.apps.maps') +
      '&redirect_url_web=' + encodeURIComponent('https://www.google.com/maps') +
      '&app_name=' + encodeURIComponent('Google Maps'),
  },
  {
    k: 'Universal Link',
    url: 'https://www.google.com/maps/place/…',
    body: 'An ordinary web address, which the app has claimed as its own.',
    href: MAPS_UNIVERSAL,
  },
]

const STYLE = [
  // Never colour alone: every status carries a symbol too, and the axis is
  // blue/amber rather than red/green.
  ':root{color-scheme:light dark;--line:rgba(128,128,128,.35);--warn:#a8590a;--calm:#2b6cb0}',
  '@media (prefers-color-scheme:dark){:root{--warn:#e0a35c;--calm:#7db3e8}}',
  'body{margin:0 auto;padding:2rem 1.25rem 4rem;max-width:44rem;',
  'font:16px/1.6 -apple-system,BlinkMacSystemFont,system-ui,Segoe UI,sans-serif}',
  'h1{font-size:1.35rem;margin:0 0 .5rem}',
  'h2{font-size:.82rem;margin:2.5rem 0 .75rem;text-transform:uppercase;letter-spacing:.08em;opacity:.55}',
  'p{margin:0 0 1rem}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;word-break:break-all}',
  '.item{padding:1.25rem 0;border-top:1px solid var(--line);display:flex;gap:1.25rem;',
  'align-items:flex-start;flex-wrap:wrap}',
  '.body{flex:1 1 20rem;min-width:0}',
  '.qr{flex:0 0 auto;background:#fff;border-radius:4px;padding:4px}',
  '.t{font-weight:600;font-size:1.05rem;text-decoration:none;display:inline-block;margin-bottom:.15rem}',
  '.short{display:block;margin-bottom:.6rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
  'font-size:.82rem}',
  '.t:hover{text-decoration:underline}',
  'table.cfg{border-collapse:collapse;width:100%;margin:0 0 .6rem}',
  'table.cfg td{padding:.14rem .8rem .14rem 0;vertical-align:top;border:0}',
  'table.cfg td:first-child{white-space:nowrap;opacity:.6}',
  '.url{display:block;opacity:.65;font-size:.75rem;word-break:break-all}',
  'form{border-top:1px solid var(--line);padding-top:1.25rem}',
  'label{display:block;margin:0 0 .7rem}',
  'label .lab{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
  'font-size:.82rem;font-weight:600;margin-bottom:.1rem}',
  'label .lab em{font-family:inherit;font-style:normal;font-weight:400;font-size:.68rem;',
  'text-transform:uppercase;letter-spacing:.06em;opacity:.5;margin-left:.5rem}',
  'em.inline{font-style:normal;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;',
  'opacity:.6}',
  'label .desc{display:block;font-size:.82rem;opacity:.75;margin-bottom:.3rem}',
  '.note{margin:.3rem 0 0;padding-left:.6rem;border-left:2px solid var(--line);',
  'font-size:.76rem;opacity:.55}',
  '.chips{margin:.4rem 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:.35rem}',
  '.chips{margin:.45rem 0 0}',
  '.chips button{margin:0;padding:.22rem .5rem;font-size:.76rem;font-family:ui-monospace,',
  'SFMono-Regular,Menlo,monospace;opacity:.85}',
  '.chips button:hover{opacity:1}',
  '.chips .seen{font-family:inherit;opacity:.5;align-self:center;font-size:.74rem}',
  'input{width:100%;box-sizing:border-box;padding:.45rem .55rem;border:1px solid var(--line);',
  'border-radius:5px;background:transparent;color:inherit;font-family:ui-monospace,SFMono-Regular,',
  'Menlo,monospace;font-size:.82rem}',
  '.out{display:flex;gap:1.25rem;align-items:flex-start;flex-wrap:wrap;margin-top:1.25rem}',
  '.out .box{flex:1 1 20rem;min-width:0}',
  '#gen{display:block;padding:.6rem .7rem;border:1px solid var(--line);border-radius:5px;',
  'word-break:break-all;font-size:.78rem;text-decoration:none}',
  'button{margin-top:.6rem;padding:.4rem .8rem;border:1px solid var(--line);border-radius:5px;',
  'background:transparent;color:inherit;font:inherit;font-size:.85rem;cursor:pointer}',
  'ul{margin:0;padding-left:1.1rem}',
  'li{margin:.2rem 0}',
  '.seen{display:inline-block;white-space:nowrap;font-size:.68rem;text-transform:uppercase;',
  'letter-spacing:.05em;padding:.06rem .35rem;border:1px solid var(--line);border-radius:4px;opacity:.7}',
  '.seen.yes{border-width:2px;opacity:1}',
  '.wrap{overflow-x:auto}',
  'footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--line);font-size:.88rem;opacity:.75}',
  // The matrix is wider than the reading column, so it breaks out of it.
  '.bleed{width:92vw;max-width:78rem;margin-left:calc(50% - 46vw);margin-right:calc(50% - 46vw)}',
  '@media (max-width:50rem){.bleed{width:auto;margin-left:0;margin-right:0}}',
  'table.matrix{border-collapse:collapse;width:100%;font-size:.8rem;min-width:46rem}',
  'table.matrix th{text-align:left;font-weight:600;font-size:.78rem;padding:0 .7rem .5rem;',
  'border-bottom:1px solid var(--line);vertical-align:bottom}',
  'table.matrix th small{display:block;font-weight:400;opacity:.5;font-size:.72rem;',
  'text-transform:uppercase;letter-spacing:.05em;margin-bottom:.15rem}',
  'table.matrix th.g{border-left:1px solid var(--line)}',
  'table.matrix td{padding:.8rem .7rem;border-top:1px solid var(--line);vertical-align:top;width:20%}',
  'table.matrix td.g{border-left:1px solid var(--line)}',
  'table.matrix td.env{font-weight:600;width:11rem;padding-left:0}',
  'table.matrix .sub{display:block;font-weight:400;opacity:.5;font-size:.74rem;margin-top:.2rem}',
  'table.matrix figure{margin:0 0 .7rem}',
  'table.matrix figure:last-child{margin-bottom:0}',
  'table.matrix img{width:100%;max-width:8.5rem;height:auto;border:1px solid var(--line);',
  'border-radius:6px;display:block;margin-bottom:.3rem}',
  'table.matrix figcaption{font-size:.76rem;opacity:.75}',
  'table.matrix .seen{display:block;width:fit-content;margin-top:.3rem}',
  '.pending,.none{max-width:8.5rem;min-height:5rem;box-sizing:border-box;border-radius:6px;',
  'display:flex;align-items:center;justify-content:center;text-align:center;font-size:.76rem;',
  'padding:.5rem;margin-bottom:.3rem}',
  '.pending{border:1px dashed var(--line);opacity:.4}',
  '.none{border:1px solid var(--line);opacity:.75}',
  '.none.blocked{border:2px solid var(--warn);color:var(--warn);opacity:1;font-weight:600}',
  '.st{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap;font-size:.72rem;',
  'text-transform:uppercase;letter-spacing:.04em;padding:.1rem .4rem;border-radius:4px;',
  'border:1px solid var(--line);margin-right:.4rem;vertical-align:middle}',
  '.st b{font-size:.85rem;line-height:1}',
  '.st.auto{color:var(--calm);border-color:var(--calm)}',
  '.st.tap1,.st.tap2{color:var(--warn);border-color:var(--warn)}',
  '.st.blocked{color:var(--warn);border:2px solid var(--warn);font-weight:700}',
  '.fmt{margin:0 0 1.5rem;padding:0;list-style:none;display:flex;gap:1.5rem;flex-wrap:wrap}',
  '.fmt li{flex:1 1 18rem;min-width:15rem}',
  '.fmt .k{font-weight:600}',
  '.fmt code{display:block;margin:.2rem 0 .25rem}',
  '.fmt p{margin:0 0 .3rem;font-size:.85rem;opacity:.75}',
  '.tag{display:inline-block;margin-left:.5rem;font-size:.68rem;text-transform:uppercase;',
  'letter-spacing:.06em;padding:.08rem .4rem;border:1px solid var(--line);border-radius:4px;',
  'opacity:.7;vertical-align:middle;font-weight:400}',
  '.note.warn{border-left-width:3px;opacity:.9;font-size:.82rem;padding:.15rem 0 .15rem .7rem}',
  '.vs{display:flex;gap:1.5rem;flex-wrap:wrap;margin:0 0 1rem;padding:0;list-style:none}',
  '.vs li{flex:1 1 16rem;min-width:13rem;padding:.9rem 0 0;border-top:1px solid var(--line)}',
  '.vs .body{margin:.3rem 0 0;font-size:.85rem;opacity:.75}',
].join('')

export function indexPage(origin, waitMs) {
  const items = links(origin)
    .map(
      (item) =>
        '<div class="item"><div class="body">' +
        `<a class="t" href="${escapeHTML(item.short)}">${item.n}. ${item.app}</a>` +
        (item.tag ? `<span class="tag">${escapeHTML(item.tag)}</span>` : '') +
        `<a class="short" href="${escapeHTML(item.short)}">${escapeHTML(item.short)}</a>` +
        (item.note ? `<p class="note warn">${item.note}</p>` : '') +
        paramTable(item) +
        `<a class="url" href="${escapeHTML(item.href)}">${escapeHTML(item.href)}</a>` +
        '</div>' +
        qrImg(item.short, 144) +
        '</div>',
    )
    .join('')

  const field = (name, value, placeholder, { desc = '', note = '', demo = false, after = '' } = {}) =>
    '<label>' +
    `<span class="lab">${name}${demo ? '<em>demo only</em>' : ''}</span>` +
    (desc ? `<span class="desc">${desc}</span>` : '') +
    `<input id="f_${name}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" ` +
    'spellcheck="false" autocapitalize="off">' +
    '</label>' +
    (note ? `<p class="note">${note}</p>` : '') +
    after

  const chips =
    '<ul class="chips">' +
    OTHER_SCHEMES.map((scheme) => {
      const short = scheme.length > 44 ? scheme.slice(0, 41) + '…' : scheme
      return (
        `<li><button type="button" class="fill" data-v="${escapeHTML(scheme)}" ` +
        `title="${escapeHTML(scheme)}">${escapeHTML(short)}</button></li>`
      )
    }).join('') +
    '</ul>'

  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Deep link routing — demo</title>',
    `<style>${STYLE}</style>`,
    '</head><body>',

    '<h1>Deep link routing — demo</h1>',
    '<p>Tap a link, or scan its code from another device. Nothing is recorded.</p>',

    '<h2>Links</h2>',
    items,

    '<h2>Custom scheme vs Universal Link</h2>',
    '<ul class="fmt">',
    FORMATS.map(
      (f) =>
        '<li>' +
        `<span class="k">${escapeHTML(f.k)}</span>` +
        `<code>${escapeHTML(f.url)}</code>` +
        `<p>${escapeHTML(f.body)}</p>` +
        `<a href="${escapeHTML(f.href)}">Try it</a>` +
        '</li>',
    ).join(''),
    '</ul>',
    '<div class="bleed wrap"><table class="matrix">',
    '<tr><th></th>',
    '<th class="g"><small>Universal Link</small>Installed</th>',
    '<th><small>Universal Link</small>Not installed</th>',
    '<th class="g"><small>Custom scheme</small>Installed</th>',
    '<th><small>Custom scheme</small>Not installed</th></tr>',
    MATRIX.map(
      (row) =>
        '<tr>' +
        `<td class="env">${escapeHTML(row.env)}` +
        (row.sub ? `<span class="sub">${escapeHTML(row.sub)}</span>` : '') +
        '</td>' +
        noneCell(row.ulInstalled, true) +
        noneCell(row.ulMissing) +
        shotCell(row.csInstalled, row.env + ', installed', true) +
        shotCell(row.csMissing, row.env + ', not installed') +
        '</tr>',
    ).join(''),
    '</table></div>',

    '<h2>Build your own</h2>',
    '<p>A real link carries one <code>deeplink_url</code> and one <code>redirect_url</code>: it ',
    'already knows its app and its platform, so both come from the app record. The fields marked ',
    '<em class="inline">demo only</em> exist so that one demo link can serve an iPhone and an ',
    'Android phone at the same time.</p>',
    '<form onsubmit="return false">',
    field('deeplink_url_ios', LINKS[0].scheme, 'myapp://product/456', {
      demo: true,
      desc: 'The screen to open on iPhone.',
      after: chips,
    }),
    field('deeplink_url_android', LINKS[0].scheme, 'myapp://product/456', {
      demo: true,
      desc: 'The same on Android — it does not have to match iOS. Schemes are declared ' +
        'separately in each app, so the two can differ.',
    }),
    field('redirect_url_ios', FACEBOOK.ios, 'https://apps.apple.com/…', {
      demo: true,
      desc: 'Where iPhone goes when the app does not open.',
      note: 'A store page, or your own page — it does not have to be the store.',
    }),
    field('redirect_url_android', FACEBOOK.android, 'https://play.google.com/…', {
      demo: true,
      desc: 'The same for Android.',
      note: 'Keep this one on the store: the store URL carries the install referrer, which is ' +
        'what delivers the deeplink after an install and matches it back to this click.',
    }),
    field('redirect_url_web', FACEBOOK.web, 'https://example.com', {
      desc: 'Where a desktop browser goes. No app attempt, no waiting.',
    }),
    field('redirect_url', '', 'https://example.com', {
      desc: 'Used for any platform left blank above.',
      note: 'Leave them all empty and the link falls back to the app’s own store page, which is ' +
        'what it does today.',
    }),
    field('app_name', LINKS[0].app, 'My App', {
      demo: true,
      desc: 'The app name shown on the page. A real link takes it from the app record, with the icon.',
    }),
    field('wait', String(waitMs), '4000', {
      demo: true,
      desc: 'How long iPhone waits for the app before giving up.',
      note: '<code>0</code> means never give up: the page stays where it is and the user taps ' +
        'Continue instead.',
    }),
    '<div class="out"><div class="box">',
    '<a id="gen" href="#"></a>',
    '<button id="copy" type="button">Copy</button>',
    '</div><img id="genqr" class="qr" width="220" height="220" alt="QR code"></div>',
    '</form>',

    '<footer>',
    '<p>Flags: <code>&amp;debug=1</code> answers instead of redirecting · ',
    '<code>&amp;android=page</code> / <code>&amp;android=intent</code> forces the Android route · ',
    '<code>&amp;wait=0</code> never gives up.</p>',
    '</footer>',

    '<script>(function(){',
    "var names=['deeplink_url_ios','deeplink_url_android','redirect_url_ios',",
    "'redirect_url_android','redirect_url_web','redirect_url','app_name','wait'];",
    "var out=document.getElementById('gen'),qr=document.getElementById('genqr');",
    'function build(){',
    "var u=new URL('/go',location.origin);u.searchParams.set('force_deeplink','1');",
    "names.forEach(function(n){var v=document.getElementById('f_'+n).value.trim();",
    'if(v)u.searchParams.set(n,v);});',
    'var s=u.toString();out.textContent=s;out.href=s;',
    "qr.src='/qr?d='+encodeURIComponent(s);}",
    "names.forEach(function(n){document.getElementById('f_'+n).addEventListener('input',build);});",
    "Array.prototype.forEach.call(document.querySelectorAll('.fill'),function(b){",
    "b.addEventListener('click',function(){var v=b.getAttribute('data-v');",
    "document.getElementById('f_deeplink_url_ios').value=v;",
    "document.getElementById('f_deeplink_url_android').value=v;build();});});",
    "document.getElementById('copy').addEventListener('click',function(){",
    'navigator.clipboard.writeText(out.textContent);',
    "var b=this;b.textContent='Copied';setTimeout(function(){b.textContent='Copy';},1200);});",
    'build();',
    '})();</script>',
    '</body></html>',
  ].join('')
}

export { qrSVG }
