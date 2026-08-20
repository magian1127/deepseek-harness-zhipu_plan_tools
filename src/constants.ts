/**
 * 顶层常量:包名、挂载行 id、provider id、端点、命名空间与预算。
 * host 与 CLI 共享(CLI 经 tsconfig.cli.json 一并编译 patch-row)。
 */

/** npm 包名,也是 loader 挂载的 name。 */
export const PKG = 'deepseek-harness-zhipu_plan_tools'

/** 挂载行 id(不可复用,见 AGENTS.md 约束 5)。 */
export const BUNDLE_ROW_ID = 'dsh-zhipu'
export const HOT_ROW_ID = 'dsh-zhipu-hot'
export const BRIDGE_ROW_ID = 'dsh-zhipu-bridge'

/** profile patch 中受管块的标记文本层。 */
export const ROW_BEGIN = '# dsh-zhipu:begin'
export const ROW_END = '# dsh-zhipu:end'

/** provider id(web 行 searchProvider / fetchProvider 指向)。 */
export const SEARCH_PROVIDER_ID = 'zhipu-web-search-prime'
export const READER_PROVIDER_ID = 'zhipu-web-reader'

/** 智谱 MCP 端点(Streamable HTTP,实测可用)。 */
export const SEARCH_MCP_URL = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
export const READER_MCP_URL = 'https://open.bigmodel.cn/api/mcp/web_reader/mcp'
export const ZREAD_MCP_URL = 'https://open.bigmodel.cn/api/mcp/zread/mcp'

/** 设置命名空间(settings.yaml)与 locale 命名空间(客户端字典)。 */
export const SETTINGS_NAMESPACE = 'dsh-zhipu'
export const LOCALE_NAMESPACE = 'settings.dsh-zhipu'

/** 默认凭据引用:智谱 GLM Coding Plan API Key。 */
export const DEFAULT_CREDENTIAL_REF = 'ZAI_CODING_CN_API_KEY'

/** MCP 单次 HTTP 请求超时(毫秒)。 */
export const MCP_TIMEOUT_MS = 60_000

/** MCP 会话终止(DELETE)超时:清理不得拖慢主调用。 */
export const MCP_TERMINATE_TIMEOUT_MS = 5_000

/** zread 工具协作超时预算(毫秒),对齐 dsh-mcp-client 默认。 */
export const ZREAD_TOOL_TIMEOUT_MS = 60_000

/** webReader 正文截断上限(字符),对齐 tool-web 的 DEFAULT_FETCH_MAX_OUTPUT_CHARS。 */
export const READER_MAX_CONTENT_CHARS = 200_000

/** webReader 服务端抓取超时(秒,其参数单位是秒)。 */
export const READER_FETCH_TIMEOUT_SECONDS = 20
