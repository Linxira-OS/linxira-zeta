# 安全政策

[English](SECURITY.md) · **简体中文**

## 支持的版本

只有最新的稳定 Zeta 版本接收安全更新。预发布构建是开发产物，只有在维护者为特定
调查明确说明时才受支持。

## 报告漏洞

不要为安全漏洞开公开 issue。

使用本仓库的 GitHub 私有安全 advisory 流程：

<https://github.com/Linxira-OS/linxira-zeta/security/advisories/new>

请包含：

- 受影响的 Zeta 版本与平台；
- 影响说明，以及受影响的命令、工具或端点；
- 最小复现步骤或概念验证；
- 已移除密钥、令牌和个人数据的相关日志。

如果 advisory 表单不可用，请通过 GitHub 私下联系仓库维护者，不要公开发布细节。
不要在 issue、日志或报告中包含密钥、配对码、TOTP secret、实时令牌或带凭据的
截图。

## IM 与 server 漏洞

**IM 与 server 安全问题必须走这个私有 advisory。** 禁止为它们开公开 issue 或
pull request。尤其包括：

- 令牌或凭据泄漏；
- webhook 签名校验失败或伪造；
- allowlist 或授权绕过；
- 跨聊天、跨会话、跨实例或跨工作区路由；
- 未认证的命令执行；
- 远程令牌、配对或 TOTP 绕过；
- SSRF 或传输/来源暴露。

负责角色是 **Zeta server maintainers** 与 **Zeta IM maintainers**。不要在
issue、日志、聊天或报告中包含密钥、配对码、TOTP secret、实时令牌或带凭据的
截图。

如果缺陷属于上游，使用上游项目的私有安全通道（不要开公开 issue）；Zeta 受影响
时并行开我们的 advisory。协调前不要披露。

## 响应

报告按尽力而为的方式处理。预计几天内会收到初步确认。在发布细节前，请给修复与
协调披露留出时间。

[English](SECURITY.md) · **简体中文**
