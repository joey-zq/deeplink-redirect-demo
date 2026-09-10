/**
 * Verifies the routing decision against the routing table before anything is
 * deployed. Run: node test.mjs
 */
import assert from 'node:assert/strict'
import worker, {
  decide, detectPlatform, parseDeeplink, buildIntent, links, parseWait, iosPage, indexPage, destinationLabel,
} from './src/index.js'
import { encode, qrSVG, _internals } from './src/qr.js'

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
}

const STORE_IOS = 'https://apps.apple.com/us/app/facebook/id284882215'
const STORE_ANDROID = 'https://play.google.com/store/apps/details?id=com.facebook.katana'
const WEB = 'https://www.facebook.com/'
const ORIGIN = 'https://deeplink-demo.example.workers.dev'

const base = {
  force: true,
  deeplinkURL: 'fb://profile',
  iosURL: STORE_IOS,
  androidURL: STORE_ANDROID,
  webURL: WEB,
}

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log('  ok  ' + name)
}

const get = (path, ua) => worker.fetch(new Request(ORIGIN + path, { headers: { 'user-agent': ua } }))

console.log('\nplatform detection')
check('iPhone -> ios', () => assert.equal(detectPlatform(UA.ios), 'ios'))
check('Android -> android', () => assert.equal(detectPlatform(UA.android), 'android'))
check('Mac -> other', () => assert.equal(detectPlatform(UA.desktop), 'other'))
check('empty UA -> other', () => assert.equal(detectPlatform(''), 'other'))

console.log('\ndeeplink validation')
check('custom scheme passes', () => {
  const d = parseDeeplink('fb://profile')
  assert.deepEqual({ scheme: d.scheme, rest: d.rest }, { scheme: 'fb', rest: 'profile' })
})
check('bare scheme passes', () => {
  const d = parseDeeplink('wikipediademo://')
  assert.deepEqual({ scheme: d.scheme, rest: d.rest }, { scheme: 'wikipediademo', rest: '' })
})
check('no scheme rejected', () => assert.equal(parseDeeplink('product/456'), null))
check('empty rejected', () => assert.equal(parseDeeplink(''), null))
check('garbage rejected', () => assert.equal(parseDeeplink('://///'), null))

console.log('\nintent composition')
check('intent carries scheme and encoded store URL', () => {
  assert.equal(
    buildIntent(parseDeeplink('fb://profile'), STORE_ANDROID),
    'intent://profile#Intent;scheme=fb;S.browser_fallback_url=' +
      'https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.facebook.katana;end',
  )
})
check('a # in the deeplink cannot break the intent syntax', () => {
  const intent = buildIntent(parseDeeplink('myapp://a/b#frag'), WEB)
  assert.equal(intent.split('#').length, 2)
  assert.ok(intent.startsWith('intent://a/b#Intent;scheme=myapp;'))
})

console.log('\nrouting — force + valid deeplink')
check('android -> 302 to intent://, falling back to Play', () => {
  const r = decide({ ...base, ua: UA.android })
  assert.equal(r.branch, 'android_intent')
  assert.ok(r.location.startsWith('intent://profile#Intent;scheme=fb;'))
  assert.ok(r.location.includes(encodeURIComponent(STORE_ANDROID)))
})
check('ios -> html page, falling back to the App Store', () => {
  const r = decide({ ...base, ua: UA.ios })
  assert.equal(r.branch, 'ios_page')
  assert.equal(r.action, 'html')
  assert.equal(r.deeplink, 'fb://profile')
  assert.equal(r.location, STORE_IOS)
})

console.log('\nrouting — the web fallback (desktop only)')
check('desktop -> the website, not the store', () => {
  const r = decide({ ...base, ua: UA.desktop })
  assert.equal(r.branch, 'desktop')
  assert.equal(r.action, 'redirect')
  assert.equal(r.location, WEB)
})
check('desktop with no redirect_url_web -> the catch-all, then the default', () => {
  assert.equal(decide({ ...base, ua: UA.desktop, webURL: '' }).location, 'https://example.com/')
  assert.equal(
    decide({ ...base, ua: UA.desktop, webURL: '', defaultURL: 'https://catch.all/' }).location,
    'https://catch.all/',
  )
})
check('a named destination beats redirect_url, which beats the default', () => {
  const withBoth = { ...base, defaultURL: 'https://catch.all/' }
  assert.equal(decide({ ...withBoth, ua: UA.ios }).location, STORE_IOS)
  assert.equal(decide({ ...withBoth, ua: UA.ios, iosURL: '' }).location, 'https://catch.all/')
  assert.equal(decide({ ...base, ua: UA.ios, iosURL: '' }).location, 'https://example.com/')
})
check('redirect_url alone drives every platform', () => {
  const only = { force: true, deeplinkURL: 'fb://profile', defaultURL: 'https://only.one/' }
  assert.equal(decide({ ...only, ua: UA.ios }).location, 'https://only.one/')
  assert.equal(decide({ ...only, ua: UA.desktop }).location, 'https://only.one/')
  assert.ok(decide({ ...only, ua: UA.android }).location.includes(encodeURIComponent('https://only.one/')))
})
check('a phone uses its own destination, not the web one — iOS', () => {
  assert.equal(decide({ ...base, ua: UA.ios }).location, STORE_IOS)
})
check('a phone uses its own destination, not the web one — Android', () => {
  const r = decide({ ...base, ua: UA.android })
  assert.ok(r.location.includes(encodeURIComponent(STORE_ANDROID)))
  assert.ok(!r.location.includes(encodeURIComponent(WEB)))
})

console.log('\nrouting — the switch off, and a malformed deeplink')
check('no force_deeplink -> the store on a phone', () => {
  const r = decide({ ...base, ua: UA.ios, force: false })
  assert.equal(r.branch, 'no_force')
  assert.equal(r.location, STORE_IOS)
})
for (const [name, ua] of Object.entries(UA)) {
  check(name + ': malformed deeplink falls back, never an error page', () => {
    const r = decide({ ...base, ua, deeplinkURL: 'product/456' })
    assert.equal(r.branch, 'invalid_deeplink')
    assert.equal(r.action, 'redirect')
    assert.equal(r.location, ua === UA.desktop ? WEB : name === 'ios' ? STORE_IOS : STORE_ANDROID)
  })
}

console.log('\nthe three demo links')
const all = links(ORIGIN)
check('two links: one that opens an app, one that cannot', () => {
  assert.deepEqual(all.map((l) => l.app), ['Facebook', 'Wikipedia'])
  assert.deepEqual(all.map((l) => new URL(l.short).pathname), ['/1', '/2'])
  assert.ok(!all[0].note, 'the working one needs no caveat')
  assert.ok(/wrong on purpose/.test(all[1].note), 'the other says its scheme is deliberately bad')
})
check('every link carries the switch, a scheme, both stores and a web fallback', () => {
  for (const item of all) {
    const q = new URL(item.href).searchParams
    assert.equal(q.get('force_deeplink'), '1')
    assert.ok(q.get('deeplink_url').includes('://'))
    assert.ok(q.get('redirect_url_ios').startsWith('https://apps.apple.com/'))
    assert.ok(q.get('redirect_url_android').startsWith('https://play.google.com/'))
    assert.ok(q.get('redirect_url_web').startsWith('https://'))
  }
})
check('no demo link composes to an empty intent host', () => {
  for (const item of all) {
    const intent = buildIntent(parseDeeplink(item.scheme), 'https://example.com/')
    assert.ok(!intent.startsWith('intent://#'), item.app + ' -> ' + intent)
  }
})

console.log('\nend-to-end through the worker')
const androidRes = await get(new URL(all[0].href).pathname + new URL(all[0].href).search, UA.android)
check('Facebook link on Android 302s to intent://', () => {
  assert.equal(androidRes.status, 302)
  assert.ok(androidRes.headers.get('location').startsWith('intent://profile#Intent;scheme=fb;'))
})

const iosRes = await get(new URL(all[0].href).pathname + new URL(all[0].href).search, UA.ios)
const iosBody = await iosRes.text()
check('the Facebook link on iOS serves the page', () => {
  assert.equal(iosRes.status, 200)
  assert.ok(iosBody.includes('var deeplink="fb://profile"'))
  assert.ok(iosBody.includes('apps.apple.com/us/app/facebook/id284882215'))
})
check('the iOS page waits long enough to outlast the confirmation dialog', () => {
  assert.ok(iosBody.includes('},4000);'), 'default wait, not 1200 ms')
  assert.ok(iosBody.includes('visibilitychange') && iosBody.includes('pagehide'))
  assert.ok(
    iosBody.indexOf('visibilitychange') < iosBody.indexOf('window.location.replace(deeplink)'),
    'cancel listeners registered before the attempt',
  )
  assert.ok(iosBody.includes('href="https://apps.apple.com/us/app/facebook/id284882215">Continue to Facebook on the App Store</a>'))
})
check('the page names the app, offers both destinations, and counts down', () => {
  assert.ok(iosBody.includes('<title>Opening Facebook…</title>'))
  assert.ok(iosBody.includes('<h1>Facebook</h1>'))
  assert.ok(iosBody.includes('<img class="icon" src="data:image/jpeg;base64,'), 'the icon travels inline')
  assert.ok(iosBody.includes('href="fb://profile">Open Facebook</a>'), 'the deeplink as a tappable button')
  assert.ok(iosBody.includes('Continuing to the App Store in <b id="n">4</b>s'))
  assert.ok(iosBody.indexOf('<h1>') < iosBody.indexOf('id="count"'), 'name above, countdown and buttons below the dialog')
})
check('destination labels follow the fallback URL', () => {
  assert.equal(destinationLabel('https://apps.apple.com/us/app/x/id1'), 'the App Store')
  assert.equal(destinationLabel('https://play.google.com/store/apps/details?id=a.b'), 'Google Play')
  assert.equal(destinationLabel('https://www.example.com/landing'), 'example.com')
  const p = iosPage('myapp://x', 'https://play.google.com/store/apps/details?id=a.b', 4000, { name: 'My App' })
  assert.ok(p.includes('>Continue to My App on Google Play</a>'))
  const q = iosPage('myapp://x', 'https://www.example.com/landing', 4000)
  assert.ok(q.includes('<title>Opening the app…</title>') && q.includes('>Continue to example.com</a>'))
  assert.ok(q.includes('class="icon blank"'), 'no icon known: a blank tile, never a broken image')
})

console.log('\nthe wait override')
check('wait defaults, clamps and rejects nonsense', () => {
  assert.equal(parseWait(null), 4000)
  assert.equal(parseWait(''), 4000)
  assert.equal(parseWait('abc'), 4000)
  assert.equal(parseWait('-5'), 4000)
  assert.equal(parseWait('4000'), 4000)
  assert.equal(parseWait('999999'), 30000)
  assert.equal(parseWait('0'), 0)
})
check('wait=0 removes the automatic store redirect entirely', () => {
  const page = iosPage('fb://profile', STORE_IOS, 0)
  assert.ok(!page.includes('setTimeout'))
  assert.ok(page.includes('window.location.replace(deeplink)'), 'still attempts the app')
  assert.ok(page.includes('href="' + STORE_IOS + '">Continue to the App Store</a>'), 'manual route still there')
  assert.ok(!page.includes('id="count"'), 'nothing to count down to')
})
const waitRes = await get(
  new URL(all[0].href).pathname + new URL(all[0].href).search + '&wait=6000',
  UA.ios,
)
const waitBody = await waitRes.text()
check('wait=6000 reaches the served page', () => {
  assert.ok(waitBody.includes('},6000);'))
})

const desktopRes = await get(new URL(all[0].href).pathname + new URL(all[0].href).search, UA.desktop)
check('the link on desktop goes to the web destination', () => {
  assert.equal(desktopRes.status, 302)
  assert.equal(desktopRes.headers.get('location'), 'https://www.facebook.com/')
})

const debugRes = await get('/go?force_deeplink=1&deeplink_url=fb%3A%2F%2Fprofile&debug=1', UA.android)
const debugBody = JSON.parse(await debugRes.text())
check('debug=1 returns the decision instead of acting on it', () => {
  assert.equal(debugRes.status, 200)
  assert.equal(debugBody.branch, 'android_intent')
  assert.equal(debugBody.platform, 'android')
})

const notFound = await get('/nope', UA.ios)
check('unknown path 404s', () => assert.equal(notFound.status, 404))



console.log('\nthe numbered short links')
const short1A = await get('/1', UA.android)
const short1I = await get('/1', UA.ios)
const short1D = await get('/1', UA.desktop)
const long1A = await get(new URL(all[0].href).pathname + new URL(all[0].href).search, UA.android)
check('/1 routes identically to its long form', () => {
  assert.equal(short1A.status, 302)
  assert.equal(short1A.headers.get('location'), long1A.headers.get('location'))
})
const short1Body = await short1I.text()
check('/1 on iOS serves the same page', () => {
  assert.ok(short1Body.includes('var deeplink="fb://profile"'))
  assert.ok(short1Body.includes('},4000);'))
})
check('/1 on desktop uses the web destination', () => {
  assert.equal(short1D.headers.get('location'), 'https://www.facebook.com/')
})
const short1Wait = await get('/1?wait=0', UA.ios)
const short1WaitBody = await short1Wait.text()
check('the wait override still applies to a numbered link', () => {
  assert.ok(!short1WaitBody.includes('setTimeout'))
})
const short1Debug = await get('/1?debug=1', UA.android)
const short1DebugBody = JSON.parse(await short1Debug.text())
check('debug still works on a numbered link', () => {
  assert.equal(short1Debug.status, 200)
  assert.equal(short1DebugBody.branch, 'android_intent')
})
const unknownNumber = await get('/9', UA.ios)
check('an unknown number is not a link', () => assert.equal(unknownNumber.status, 404))


console.log('\nper-platform deeplinks and App Links')
check('Android can carry a different scheme from iOS', () => {
  const both = { force: true, deeplinkURL: 'fb://profile', androidDeeplink: 'fb://page/123',
                 androidURL: STORE_ANDROID, iosURL: STORE_IOS }
  assert.ok(decide({ ...both, ua: UA.android }).location.startsWith('intent://page/123#'))
  assert.equal(decide({ ...both, ua: UA.ios }).deeplink, 'fb://profile')
})
check('a platform with no override falls back to the shared deeplink', () => {
  const r = decide({ force: true, deeplinkURL: 'fb://profile', iosURL: STORE_IOS, ua: UA.ios })
  assert.equal(r.deeplink, 'fb://profile')
})
check('an http(s) deeplink is sent straight through on Android, not wrapped in an intent', () => {
  const maps = 'https://www.google.com/maps/place/x/@1,2,3m/data=!3m2'
  const r = decide({ force: true, deeplinkURL: maps, androidURL: STORE_ANDROID, ua: UA.android })
  assert.equal(r.branch, 'android_app_link')
  assert.equal(r.location, maps, 'the OS matches an App Link itself; an intent would offer it to every browser')
})
check('an http(s) deeplink still goes through the page on iOS', () => {
  const maps = 'https://www.google.com/maps/place/x'
  const r = decide({ force: true, deeplinkURL: maps, iosURL: STORE_IOS, ua: UA.ios })
  assert.equal(r.branch, 'ios_page')
  assert.equal(r.deeplink, maps)
})

console.log('\nthe Android interstitial fallback')
check('Chrome on Android gets the intent, everything else gets the page', () => {
  const chrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'
  assert.equal(decide({ ...base, ua: chrome }).branch, 'android_intent')
  const others = {
    webview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
    wechat: 'Mozilla/5.0 (Linux; Android 13; PGT-AN20; wv) AppleWebKit/537.36 Chrome/107.0.0.0 MicroMessenger/8.0.49',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    huawei: 'Mozilla/5.0 (Linux; Android 12; ELS-NX9) AppleWebKit/537.36 Chrome/92.0.4515.105 HuaweiBrowser/13.0.5.303 Mobile Safari/537.36',
    miui: 'Mozilla/5.0 (Linux; U; Android 13; 2201123C) AppleWebKit/537.36 Chrome/108.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.2.4',
    firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
    uc: 'Mozilla/5.0 (Linux; U; Android 13; zh-CN) AppleWebKit/537.36 Chrome/100.0.0.0 UCBrowser/15.5.8.1206 Mobile Safari/537.36',
  }
  for (const [name, ua] of Object.entries(others)) {
    assert.equal(decide({ ...base, ua }).branch, 'android_page', name)
  }
})
check('an unrecognised Android browser fails safe to the page', () => {
  const unknown = 'Mozilla/5.0 (Linux; Android 14; SomePhone) AppleWebKit/537.36 NewBrowser/1.0 Mobile'
  assert.equal(decide({ ...base, ua: unknown }).branch, 'android_page')
})
check('android=intent forces the redirect even where we would not choose it', () => {
  const wechat = 'Mozilla/5.0 (Linux; Android 13; PGT-AN20; wv) AppleWebKit/537.36 MicroMessenger/8.0.49'
  assert.equal(decide({ ...base, ua: wechat, androidMode: 'intent' }).branch, 'android_intent')
})
check('android=page serves the interstitial instead of an intent redirect', () => {
  const r = decide({ ...base, ua: UA.android, androidMode: 'page' })
  assert.equal(r.branch, 'android_page')
  assert.equal(r.action, 'html')
  assert.equal(r.deeplink, 'fb://profile')
  assert.equal(r.location, STORE_ANDROID, 'still falls back to the Play listing')
})
check('android=page does not disturb iOS or desktop', () => {
  assert.equal(decide({ ...base, ua: UA.ios, androidMode: 'page' }).branch, 'ios_page')
  assert.equal(decide({ ...base, ua: UA.desktop, androidMode: 'page' }).branch, 'desktop')
})
const androidPage = await get('/1?android=page', UA.android)
const androidPageBody = await androidPage.text()
check('the served Android page is the same interstitial, with the same wait', () => {
  assert.equal(androidPage.status, 200)
  assert.ok(androidPageBody.includes('var deeplink="fb://profile"'))
  assert.ok(androidPageBody.includes('},4000);'))
  assert.ok(androidPageBody.includes('visibilitychange'))
})
const androidDefault = await get('/1', UA.android)
check('plain Chrome still gets the intent redirect with no flag', () => {
  assert.equal(androidDefault.status, 302)
  assert.ok(androidDefault.headers.get('location').startsWith('intent://'))
})
const wechatRes = await get('/1', 'Mozilla/5.0 (Linux; Android 13; PGT-AN20; wv) AppleWebKit/537.36 Chrome/107.0.0.0 MicroMessenger/8.0.49')
check('WeChat gets the page with no flag at all', () => {
  assert.equal(wechatRes.status, 200)
})


console.log('\nthe association files')
const aasa = await get('/.well-known/apple-app-site-association', UA.desktop)
const aasaBody = JSON.parse(await aasa.text())
check('the AASA file is served as JSON in the shape Apple expects', () => {
  assert.equal(aasa.status, 200)
  assert.equal(aasa.headers.get('content-type'), 'application/json; charset=utf-8')
  const detail = aasaBody.applinks.details[0]
  assert.ok(/^[A-Z0-9]+\.[a-z0-9.]+$/i.test(detail.appIDs[0]), 'TeamID.bundleID')
  assert.ok(detail.components[0]['/'])
})
const assetlinks = await get('/.well-known/assetlinks.json', UA.desktop)
const assetlinksBody = JSON.parse(await assetlinks.text())
check('the assetlinks file is served in the shape Android expects', () => {
  assert.equal(assetlinks.status, 200)
  const entry = assetlinksBody[0]
  assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls'])
  assert.equal(entry.target.namespace, 'android_app')
  assert.ok(entry.target.package_name)
  assert.equal(entry.target.sha256_cert_fingerprints[0].split(':').length, 32, 'a real fingerprint length')
})

console.log('\nthe QR encoder')
check('Reed-Solomon matches the published QR test vector', () => {
  // 13 error-correction codewords for the version 1-Q "HELLO WORLD" example;
  // independently confirmed against the reedsolo package.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]
  assert.deepEqual(
    _internals.rsRemainder(data, 13),
    [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16],
  )
})
check('version is the smallest that fits', () => {
  assert.equal(encode('HELLO', 'L').version, 1)
  assert.equal(encode('x'.repeat(200), 'L').version, 9)
  assert.equal(encode('x'.repeat(300), 'L').version, 11)
})
check('content beyond version 20 is rejected rather than silently truncated', () => {
  assert.throws(() => encode('x'.repeat(3000), 'L'), /too long/)
})
check('function patterns land where the spec puts them', () => {
  const { matrix, size } = encode('https://example.com/', 'L')
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    assert.equal(matrix[r][c], 1, 'finder outer ring')
    assert.equal(matrix[r + 1][c + 1], 0, 'finder inner ring')
    assert.equal(matrix[r + 3][c + 3], 1, 'finder centre')
  }
  assert.equal(matrix[6][8], 1, 'timing row starts dark')
  assert.equal(matrix[6][9], 0, 'timing row alternates')
  assert.equal(matrix[size - 8][8], 1, 'the always-dark module')
})
check('a placed matrix reads back as exactly the codewords that went in', () => {
  // Undo the mask, walk the same zig-zag, and compare. Catches any drift
  // between how bits are written and how a scanner reads them.
  for (const text of ['HELLO', 'https://deeplink-demo.example.workers.dev', 'x'.repeat(300)]) {
    const { matrix, mask, size, version } = encode(text, 'L')
    const { reserved } = _internals.buildFunctionPatterns(version)
    const m = matrix.map((row) => row.slice())
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && _internals.maskBit(mask, r, c)) m[r][c] ^= 1
      }
    }
    const bits = []
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const col = right - j
          const row = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
          if (!reserved[row][col]) bits.push(m[row][col])
        }
      }
    }
    const read = []
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      let b = 0
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
      read.push(b)
    }
    const expected = _internals.encodeCodewords(text, 'L').final
    assert.deepEqual(read.slice(0, expected.length), expected, text.slice(0, 20))
  }
})
check('the SVG is self-contained and sized to the module grid', () => {
  const svg = qrSVG('https://deeplink-demo.example.workers.dev', { size: 256 })
  assert.ok(svg.startsWith('<svg '))
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no external references')
  assert.ok(svg.includes('viewBox="0 0 37 37"'), '29 modules plus a 4-module quiet zone')
})

const escapeHTMLish = (t) => t.replace(/&/g, '&amp;')

console.log('\nthe page')
const page = indexPage(ORIGIN, 4000)
check('every link appears with its full configuration and a QR code', () => {
  for (const item of all) {
    assert.ok(page.includes(item.app))
    assert.ok(page.includes('/qr?d=' + encodeURIComponent(item.short)), item.app + ' QR')
    assert.ok(page.includes(escapeHTMLish(item.href)), item.app + ' full URL as text')
    for (const k of ['deeplink_url', 'redirect_url_ios', 'redirect_url_android', 'redirect_url_web']) {
      assert.ok(page.includes('<code>' + k + '</code>'), k)
    }
  }
})
check('the failing link says it is meant to fail, in one sentence', () => {
  assert.ok(page.includes('wikipediademo://home'))
  assert.ok(page.includes('nothing opens — on purpose'), 'a tag on the link itself')
  const note = page.slice(page.indexOf('note warn'), page.indexOf('</p>', page.indexOf('note warn')))
  assert.ok(note.includes('not open even if you have the app'), 'answers the misreading')
  assert.ok(note.split(' ').length < 22, 'one sentence — the long version lost people')
  assert.ok(!page.includes('snakeio://'))
})
check('the removed sections stay removed', () => {
  assert.ok(!page.includes('What should happen'))
  assert.ok(!page.includes('almost certainly have'))
  assert.ok(!page.includes('most people do not have'))
})
check('the generator offers every configurable parameter, wait included', () => {
  for (const n of [
    'deeplink_url_ios', 'deeplink_url_android', 'redirect_url_ios', 'redirect_url_android',
    'redirect_url_web', 'redirect_url', 'wait',
  ]) {
    assert.ok(page.includes('id="f_' + n + '"'), n)
  }
  assert.ok(page.includes('Build your own'))
  assert.ok(page.includes("'wait'"), 'wait is part of the generated URL')
})
check('each destination says which platform it is for', () => {
  assert.ok(page.includes('How long iPhone waits for the app'), 'wait descriptor')
  assert.ok(page.includes('Where iPhone goes when the app does not open'))
  assert.ok(page.includes('it does not have to be the store'), 'the store is not privileged')
  assert.ok(page.includes('carries the install referrer'), 'why Android is the exception')
  assert.ok(page.includes('Schemes are declared separately in each app'), 'why per-platform')
  assert.ok(page.includes('Where a desktop browser goes'))
  assert.ok(page.includes('Used for any platform left blank above'), 'redirect_url precedence')
  assert.ok(page.includes('the user taps Continue instead'), 'wait=0 explained in place')
})
check('the scheme examples sit under the iOS deeplink field and fill both', () => {
  const fieldAt = page.indexOf('id="f_deeplink_url_ios"')
  const chipsAt = page.indexOf('class="chips"')
  const nextFieldAt = page.indexOf('id="f_deeplink_url_android"')
  assert.ok(fieldAt < chipsAt && chipsAt < nextFieldAt, 'chips between the two deeplink fields')
  assert.ok(page.includes('data-v="fb://profile"'))
  assert.ok(page.includes("f_deeplink_url_android').value=v"), 'tap fills both')
  assert.ok(!page.includes('waze://'), 'the one that did not work is gone')
  assert.ok(!page.includes('twitter://'))
  assert.ok(!page.includes('has been checked on a real device'), 'caveat dropped, all checked')
  assert.ok(!page.includes('Schemes to try'))
})
check('demo-only fields are marked, and the reason is stated once', () => {
  assert.ok(page.includes('<em>demo only</em>'))
  assert.ok(page.includes('it already knows its app and its platform'))
  const labelled = (page.match(/<em>demo only<\/em>/g) || []).length
  assert.equal(labelled, 6, 'both deeplinks, both stores, app name, and wait')
})
check('a label and a caveat are told apart visually', () => {
  assert.ok(page.includes('class="lab"'), 'parameter name')
  assert.ok(page.includes('class="desc"'), 'what the field is')
  assert.ok(page.includes('class="note"'), 'the caveat')
})
check('one section, four columns: each mechanism in each case', () => {
  assert.ok(page.includes('Custom scheme vs Universal Link'))
  const tableAt = page.indexOf('<table class="matrix">')
  const head = page.slice(tableAt, page.indexOf('</tr>', tableAt))
  const cols = ['<small>Universal Link</small>Installed', '<small>Universal Link</small>Not installed',
    '<small>Custom scheme</small>Installed', '<small>Custom scheme</small>Not installed']
  let at = -1
  for (const col of cols) {
    const i = head.indexOf(col)
    assert.ok(i > at, col + ' — installed comes first, in the order things happen')
    at = i
  }
  // Merged in from two separate sections; neither may come back.
  assert.ok(!page.includes('What you will see'))
  assert.ok(!page.includes('Where this works'))
})
check('no “step 1 / step 2” wording on the page', () => {
  assert.ok(!/step [12]/i.test(page))
})
check('the two link formats are shown as formats, each tappable', () => {
  const fmt = page.slice(page.indexOf('class="fmt"'), page.indexOf('</ul>', page.indexOf('class="fmt"')))
  assert.ok(fmt.includes('<code>comgooglemaps://?q=Tokyo</code>'), 'the scheme, literally')
  assert.ok(fmt.includes('https://www.google.com/maps/place/'), 'the https one, literally')
  assert.ok((fmt.match(/Try it/g) || []).length === 2, 'both are tappable')
  const ulAt = fmt.indexOf('Universal Link')
  const href = fmt.slice(fmt.indexOf('href="', ulAt), fmt.indexOf('"', fmt.indexOf('href="', ulAt) + 6))
  assert.ok(href.includes('google.com/maps/place'), 'a real verified domain')
  assert.ok(!href.includes('/go?'), 'not through us — a redirect would not open the app')
})
check('the Universal Link cells draw the absence of a screen', () => {
  const none = (page.match(/class="none /g) || []).length
  assert.equal(none, 10, 'two per row, five rows')
  assert.ok(page.includes('>the web page loads<'))
  assert.ok(page.includes('>the app opens<'))
  assert.ok(
    page.includes('Samsung: the app does not open'),
    'App Links are not universal — AppsFlyer documents Samsung as the exception',
  )
})
check('the scheme cells carry every screenshot, including the two Safari ones', () => {
  const shots = (page.match(/<img src="data:image/g) || []).length
  assert.equal(shots, 5, 'five captures')
  assert.ok(page.includes('after the wait, tap Open'), 'Safari, app missing: the store prompt')
  assert.ok(page.includes('or tap Cancel, then OK'), 'Safari, app missing: the invalid-address error')
  const pending = (page.match(/class="pending"/g) || []).length
  assert.equal(pending, 6, 'both Android rows and in-app say a screenshot is coming')
})
check('in-app browsers are on the page, with the answer that flips the story', () => {
  assert.ok(page.includes('In-app browser'))
  assert.ok(page.includes('most retargeting inventory'), 'says why it matters for this project')
  // Apple blocks Universal Links on direct navigation inside a WKWebView, and
  // the documented workaround is an interstitial firing the scheme — i.e. the
  // thing this demo does. In the environment retargeting actually runs in, the
  // scheme is not the legacy path, it is the only one.
  const row = page.slice(page.indexOf('In-app browser'))
  assert.ok(row.includes('the app does not open'), 'Universal Link fails here')
  assert.ok(row.includes('nothing fires; tap Continue'), 'the scheme costs a tap here')
  assert.ok(!page.includes('>unknown<'), 'replaced with a stated assumption')
})
check('friction is marked per cell, by symbol and word, never colour alone', () => {
  for (const [cls, sym, label] of [['auto', '✓', 'no tap'], ['tap1', '●', '1 tap'],
    ['tap2', '●', '2 taps'], ['blocked', '✕', 'blocked']]) {
    assert.ok(page.includes(`<span class="st ${cls}"`), cls)
    assert.ok(page.includes(`>${sym}</b>${label}<`), cls + ' carries symbol + word')
  }
  // Never colour alone: the palette is blue/amber and every state
  // is legible with the colour stripped out.
  assert.ok(!/#[0-9a-f]*(00ff00|ff0000)/i.test(page), 'no red/green')
  assert.ok(page.includes('--warn:#a8590a') && page.includes('--calm:#2b6cb0'))
  assert.ok(page.includes('.none.blocked{border:2px'), 'the blocked box is heavier, not just tinted')
})
check('the blocked marker lands only where the app truly cannot open', () => {
  const blocked = (page.match(/class="st blocked"/g) || []).length
  assert.equal(blocked, 2, 'Samsung App Links, and Universal Links in an in-app browser')
})
check('only the gaps are chipped, and the small print is gone', () => {
  assert.ok(page.includes('>Assumed<'))
  assert.ok(!page.includes('>Verified<'), 'a chip on every good cell is twenty chips of noise')
  assert.ok(!page.includes('>Not tested<'), 'we took a position instead')
  // The builder keeps its per-field notes.
  // What goes is the explanatory small print that sat under the comparison.
  const after = page.slice(page.indexOf('</table>'), page.indexOf('Build your own'))
  assert.ok(!after.includes('class="note"'), 'no small print under the comparison')
  for (const gone of [
    'a redirect into a Universal Link does not open the app',
    'iPadOS reports a Mac user agent',
    'watched it happen on a real device',
    '/.well-known/apple-app-site-association',
  ]) {
    assert.ok(!page.includes(gone), gone)
  }
  const footer = page.slice(page.indexOf('<footer>'))
  assert.ok(footer.split(' ').length < 45, 'footer is a flag list, not prose')
  assert.ok(footer.includes('&amp;debug=1'))
})

const qrRes = await get('/qr?d=' + encodeURIComponent('https://example.com/'), UA.desktop)
const qrBody = await qrRes.text()
check('/qr serves an SVG', () => {
  assert.equal(qrRes.status, 200)
  assert.equal(qrRes.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.ok(qrBody.startsWith('<svg '))
})
const qrBad = await get('/qr?d=' + encodeURIComponent('y'.repeat(2000)), UA.desktop)
check('/qr rejects content it cannot encode', () => assert.equal(qrBad.status, 400))

console.log('\n' + passed + ' checks passed\n')
