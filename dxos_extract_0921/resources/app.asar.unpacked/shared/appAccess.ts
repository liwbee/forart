/**
 * APP 权限目录由服务端依据真实安装包动态生成。这里只保留跨端可复用的
 * 数据结构，避免新增或卸载 APP 时还要人工维护第二份 ID 清单。
 */
export interface ManagedAppAccessDescriptor {
  id: string
  name: string
  desc: string
}
