# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

下一次发版计划为 **0.1.0**（里程碑版本）。待补充变更记录。

## [0.0.4] - 2026-04-22

### Added
- 新增 `profileSync.enabled` 配置项，可关闭启动时自动同步 SOUL+skills 到 Zapry。
- Owner skill 调用上下文透传，owner-only 工具可拿到调用方信息。

### Fixed
- 收紧 owner-only 技能权限，避免非 owner 误触发 owner 工具。
- 兼容旧的 `/bot` API 前缀配置，老配置无需改动即可继续使用。
- 在线状态每 30 秒续期心跳，避免移动端判定离线；agent 停止时清理定时器并发送 offline。

## [0.0.3] - 2026-04-08

### Changed
- 默认 OpenAPI 地址切到生产环境 `https://openapi.mimo.immo`。
- 同步 README 默认配置说明。

## [0.0.2] - 2026-04-03

### Changed
- 调整发包入口为编译产物 `./dist/index.js`，源码不再随包发布。
- 新增 `build` / `prepack` 脚本。

## [0.0.1] - 2026-03-29

### Added
- 首个可发布版本，包名更正为 `zapry-openclaw-plugin`。
- Zapry channel 基础能力：消息收发、群管理、动态 / 俱乐部、bot 自管理、技能同步。

[Unreleased]: https://github.com/cyberFlowTech/zapry-openclaw-plugin/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/cyberFlowTech/zapry-openclaw-plugin/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/cyberFlowTech/zapry-openclaw-plugin/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/cyberFlowTech/zapry-openclaw-plugin/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/cyberFlowTech/zapry-openclaw-plugin/releases/tag/v0.0.1
