/**
 * 内置 web_fetch 回退:关闭智谱网页读取后,使用受限的 Node fetch 抓取
 * 公开 HTTP(S) 文本资源。传输边界对齐 DSH 的 web-fetch-http provider:
 * URL 基础校验、同源重定向、超时、响应字节/字符上限与内容类型检查。
 */
import { HTTP_FALLBACK_FETCH_TIMEOUT_MS } from './constants.js'
import { promises as dns } from 'node:dns'
import { WEB_PROVIDER_ERROR_CODE, ZhipuError, abortedError, isAbortError } from './errors.js'

const HTTP_FALLBACK_MAX_URL_LENGTH = 2_048
const HTTP_FALLBACK_MAX_RESPONSE_BYTES = 5_000_000
const HTTP_FALLBACK_MAX_CONTENT_CHARS = 200_000
const HTTP_FALLBACK_MAX_REDIRECTS = 5
const HTTP_FALLBACK_DNS_TIMEOUT_MS = 3_000

function webError(message: string, code: string = WEB_PROVIDER_ERROR_CODE, cause?: unknown): ZhipuError {
  return new ZhipuError(`[${code}] ${message}`, code, cause === undefined ? undefined : { cause })
}

function isBlockedIpv4(octets: number[]): boolean {
  if (octets.length !== 4 || !octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false
  const [a, b] = octets as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
}

function parseHexWord(part: string): number | undefined {
  if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined
  return Number.parseInt(part, 16)
}

/** IPv4 点分尾段(如 ::ffff:127.0.0.1 的尾段)解析为两个 16 位 word。 */
function ipv4TailWords(part: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(part)) return undefined
  const [a, b, c, d] = part.split('.').map((o) => Number(o)) as [number, number, number, number]
  if (a > 255 || b > 255 || c > 255 || d > 255) return undefined
  return [(a << 8) | b, (c << 8) | d]
}

function ipv6Words(host: string): number[] | undefined {
  const halves = host.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0]?.length ? halves[0].split(':') : []
  const right = halves[1]?.length ? halves[1].split(':') : []
  // IPv4 尾段占 32 位:按点分规则展开为两个 word,避免十六进制 parseInt 误读
  // 点分段(旧实现对 ::ffff:127.0.0.1 会拼出错误地址而漏拦环回)。
  const tail = right[right.length - 1]
  const mapped = tail !== undefined && tail.includes('.') ? ipv4TailWords(tail) : undefined
  if (tail !== undefined && tail.includes('.') && mapped === undefined) return undefined
  const rightWords = mapped === undefined ? right.map(parseHexWord) : [...right.slice(0, -1).map(parseHexWord), ...mapped]
  const leftWords = left.map(parseHexWord)
  if (leftWords.some((word) => word === undefined) || rightWords.some((word) => word === undefined)) return undefined
  const missing = 8 - leftWords.length - rightWords.length
  if (missing < 0) return undefined
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined
  // :: 压缩的零组补在左右段之间,不能追加到末尾。
  const words = [...(leftWords as number[]), ...new Array<number>(missing).fill(0), ...(rightWords as number[])]
  return words.length === 8 ? words : undefined
}

/** 按解析出的 IP 拒绝本机、私网、保留、组播及未指定地址。 */
function isBlockedIp(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '')
  const octets = host.split('.').map((part) => Number(part))
  if (isBlockedIpv4(octets)) return true
  if (!host.includes(':')) return false
  const words = ipv6Words(host)
  if (words === undefined) return true
  const first = words[0] as number
  if (words.every((word) => word === 0) || words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00) return true
  // IPv4-mapped IPv6 地址复用 IPv4 规则。
  if (words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff)) {
    if (isBlockedIpv4([words[6] >>> 8, words[6] & 0xff, words[7] >>> 8, words[7] & 0xff])) return true
  }
  return false
}

/** 拒绝显式本机/私网地址。 */
function isBlockedLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || isBlockedIp(host)
}

function validateUrl(input: string): URL {
  if (input.length > HTTP_FALLBACK_MAX_URL_LENGTH) {
    throw webError(`URL 超过 ${HTTP_FALLBACK_MAX_URL_LENGTH} 字符上限`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw webError(`无效 URL: ${input}`, 'WEB_INVALID_URL', error)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw webError(`不支持 URL scheme ${url.protocol},只允许 http/https`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw webError('URL 不允许携带用户名或密码', 'WEB_BLOCKED_URL')
  }
  if (isBlockedLiteralHost(url.hostname)) {
    throw webError(`拒绝访问本机或私网地址 ${url.hostname}`, 'WEB_BLOCKED_URL')
  }
  return url
}

type LookupAll = (hostname: string, options: { all: true; verbatim: true }) => Promise<ReadonlyArray<{ address: string; family: number }>>
const defaultLookup = ((hostname: string, options: { all: true; verbatim: true }) => dns.lookup(hostname, options)) as LookupAll

/**
 * DNS 预解析防护。校验与 fetch 连接之间仍存在毫秒级 TOCTOU 窗口，理论上可被 DNS
 * 重绑定利用；未来应改用 undici Agent + 自定义 lookup 固定通过校验的地址。当前 Node
 * 环境没有可解析的 undici runtime 包，因此这里只做务实的预解析校验。
 */
async function validateResolvedHostname(hostname: string, lookup: LookupAll, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timeout')), HTTP_FALLBACK_DNS_TIMEOUT_MS)
    })
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DOMException('aborted', 'AbortError'))
      if (signal?.aborted === true) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
    const addresses = await Promise.race([lookup(hostname, { all: true, verbatim: true }), timeout, aborted])
    if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
      throw webError(`拒绝访问解析到本机或私网地址的主机 ${hostname}`, 'WEB_BLOCKED_URL')
    }
  } catch (error: unknown) {
    if (isAbortError(error)) throw error
    if (error instanceof ZhipuError && error.code === 'WEB_BLOCKED_URL') throw error
    throw webError(`无法安全解析主机 ${hostname}`, 'WEB_BLOCKED_URL', error)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

function classifyContentType(value: string | null): 'html' | 'text' | undefined {
  const mime = (value ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

function decoderForContentType(value: string | null): TextDecoder {
  const charset = (value ?? '').match(/;\s*charset\s*=\s*"?([^";]+)"?/i)?.[1]?.trim().toLowerCase()
  try {
    return new TextDecoder(charset ?? 'utf-8')
  } catch (error: unknown) {
    throw webError(`不支持响应字符集 ${charset ?? ''}`, 'WEB_UNSUPPORTED_CONTENT_TYPE', error)
  }
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

async function readCapped(response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > HTTP_FALLBACK_MAX_RESPONSE_BYTES) {
      await cancelBody(response)
      throw webError(`响应超过 ${HTTP_FALLBACK_MAX_RESPONSE_BYTES} 字节上限`, 'WEB_FETCH_TOO_LARGE')
    }
  }
  if (response.body === null) return { bytes: new Uint8Array(0), truncated: false }

  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = HTTP_FALLBACK_MAX_RESPONSE_BYTES - total
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining))
        total += remaining
        truncated = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

async function followAndRead(initialUrl: string, signal: AbortSignal, lookup: LookupAll = defaultLookup): Promise<{
  url: string
  statusCode: number
  body: { kind: 'html' | 'text'; content: string }
  truncated: boolean
}> {
  let current = validateUrl(initialUrl)
  let redirects = 0

  for (;;) {
    await validateResolvedHostname(current.hostname, lookup, signal)
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
        'user-agent': 'deepseek-harness/0.0.1',
      },
      signal,
    })

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= HTTP_FALLBACK_MAX_REDIRECTS) {
        await cancelBody(response)
        throw webError(`重定向超过 ${HTTP_FALLBACK_MAX_REDIRECTS} 次上限`, 'WEB_REDIRECT_BLOCKED')
      }
      const location = response.headers.get('location')
      if (location === null) {
        await cancelBody(response)
        throw webError(`HTTP ${response.status} 重定向缺少 Location`)
      }
      let target: URL
      try {
        target = validateUrl(new URL(location, current).toString())
      } catch (error: unknown) {
        await cancelBody(response)
        throw error
      }
      if (target.origin !== current.origin) {
        await cancelBody(response)
        throw webError(`拒绝自动跟随跨源重定向到 ${target.origin}`, 'WEB_REDIRECT_BLOCKED')
      }
      await cancelBody(response)
      current = target
      redirects++
      continue
    }

    const contentType = response.headers.get('content-type')
    const kind = classifyContentType(contentType)
    if (kind === undefined) {
      await cancelBody(response)
      throw webError(`不支持响应内容类型 ${contentType ?? 'unknown'}`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    }
    let decoder: TextDecoder
    try {
      decoder = decoderForContentType(contentType)
    } catch (error: unknown) {
      await cancelBody(response)
      throw error
    }
    const { bytes, truncated: truncatedByBytes } = await readCapped(response)
    const decoded = decoder.decode(bytes)
    const truncatedByChars = decoded.length > HTTP_FALLBACK_MAX_CONTENT_CHARS
    const content = truncatedByChars ? decoded.slice(0, HTTP_FALLBACK_MAX_CONTENT_CHARS) : decoded
    return {
      url: current.toString(),
      statusCode: response.status,
      body: { kind, content },
      truncated: truncatedByBytes || truncatedByChars,
    }
  }
}

/** 直接抓取一个 URL 并映射为 WebFetchResult。 */
export async function httpFetchFallback(url: string, signal?: AbortSignal, lookup: LookupAll = defaultLookup): Promise<{
  url: string
  statusCode: number
  body: { kind: 'html' | 'text'; content: string }
  truncated: boolean
}> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, HTTP_FALLBACK_FETCH_TIMEOUT_MS)
  const onOuterAbort = (): void => { controller.abort(signal?.reason) }
  if (signal?.aborted === true) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onOuterAbort, { once: true })

  try {
      return await followAndRead(url, controller.signal, lookup)
  } catch (error: unknown) {
    if (error instanceof ZhipuError) throw error
    if (signal?.aborted === true) throw abortedError('web', signal, error)
    if (timedOut) throw webError(`网页读取超过 ${HTTP_FALLBACK_FETCH_TIMEOUT_MS}ms`, 'WEB_FETCH_TIMEOUT', error)
    if (isAbortError(error)) throw abortedError('web', controller.signal, error)
    throw webError(`内置网页读取请求失败: ${error instanceof Error ? error.message : String(error)}`, WEB_PROVIDER_ERROR_CODE, error)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
