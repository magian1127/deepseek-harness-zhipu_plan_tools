// profile 路径工具(dshHome 沿用 host 侧 patch-row/credentials 的回退语义)。
import { join } from 'node:path'
import { dshHome, patchPath } from '../patch-row.mjs'

export { dshHome, patchPath }

export function profileDir(name: string = 'web'): string {
  return join(dshHome(), 'profiles', name)
}

export function manifestPath(name: string = 'web'): string {
  return join(profileDir(name), 'package.json')
}
