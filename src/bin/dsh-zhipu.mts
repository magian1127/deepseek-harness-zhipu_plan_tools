// CLI 入口:直接执行时分发命令;被 import 时不产生副作用。
import { pathToFileURL } from 'node:url'
import { main } from './cli/main.mjs'

function invokedAsEntry(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (invokedAsEntry()) {
  await main()
}
