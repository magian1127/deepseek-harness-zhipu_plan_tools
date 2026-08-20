// react 在浏览器工厂参数中由宿主 require 提供;client 源码只需 any 形状。
declare module 'react' {
  const React: any
  export default React
}
