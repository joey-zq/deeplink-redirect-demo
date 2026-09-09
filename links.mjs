/**
 * Prints the demo links for a deployed origin.
 * Run: node links.mjs https://deeplink-demo.<your-subdomain>.workers.dev
 */
import { links } from './src/index.js'

const origin = (process.argv[2] || '').replace(/\/+$/, '')
if (!origin) {
  console.error('usage: node links.mjs https://deeplink-demo.<your-subdomain>.workers.dev')
  process.exit(1)
}

console.log('\nIndex:\n  ' + origin + '\n')
console.log('Direct links — each one works on its own, paste any of them anywhere:')
for (const item of links(origin)) {
  console.log('\n  ' + item.n + '. ' + item.app + ' — ' + item.title)
  console.log('  ' + item.href)
}
console.log('')
