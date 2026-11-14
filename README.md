# 余録 · YUROKU — 个人书影游评分与观后感日志

零构建（Zero-Build）、原生现代 Web 标准驱动的个人书影游记录与可视化网站，已部署于 GitHub Pages：

- 在线访问：https://yule1048596-art.github.io/yule-media-log/

## 支持品类

- **电影** (`movie`)
- **日本电视剧** (`jdrama`)
- **日本漫画** (`manga`)
- **动漫** (`anime`)
- **日本小说** (`novel`，细分为 `轻小说` / `网络小说` / `一般小说`)
- **游戏** (`game`)

## 核心功能

- **多维可视化看板**：总览指标、六大品类占比与均分、评分直方图、12 个月完结趋势及 52 周热力图。
- **四视图切换**：海报画廊（含腰封短评与进度条）、个人殿堂墙、年月时间轴、响应式可排序归档表格。
- **0.0–10.0 小数评分 + 殿堂神作印章**：支持“暂不评分（想看）”及进度追踪。
- **Markdown 观后感 + 双模式防剧透**：支持 `||行内黑条剧透||` 与 `:::spoiler 标题 ... :::` 折叠块，通过浏览器原生 `Sanitizer` / `setHTML` 安全渲染。
- **一键检索自动补全**：内置 Bangumi v0 接口与 Wikipedia（中文/日文）回退搜索，自动补全封面、原作/监督、年份与话数/卷数；无封面时自动生成日语库本风格 SVG 封面。
- **双轨数据持久化（无后端）**：
  1. **本地写回仓库**：在支持的桌面浏览器中直接通过 File System Access API 覆写 `data/works.json`（不支持时自动导出下载）。
  2. **在线 GitHub 直提交**：在设置弹窗中输入 Fine-grained PAT（仅存本地浏览器 `localStorage`，不入库），直接提交更新至仓库 `data/works.json`。

## 本地预览

```bash
python3 -m http.server 8791 --directory .
```

然后访问 `http://127.0.0.1:8791/` 即可使用全部功能。

## 部署到 GitHub Pages

1. 将本目录推送到 GitHub 仓库（`yule1048596-art/yule-media-log`）。
2. 打开仓库 `Settings -> Pages -> Build and deployment`，选择 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`。
3. 保存后等待约 1 分钟即可通过 https://yule1048596-art.github.io/yule-media-log/ 访问。
4. 若需在线从网页直接提交新记录到仓库，可在站内「数据与同步」中确认仓库路径（已默认识别 `yule1048596-art/yule-media-log`）并填写仅对该仓库有 `Contents: Read and write` 权限的 Fine-grained Token。
