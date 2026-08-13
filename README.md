<p align="center">
  <img src="icons/icon-128.png" width="96" alt="LitMedix 图标">
</p>

<h1 align="center">LitMedix</h1>

<p align="center">为 PubMed 增加期刊指标、智能筛选、历年趋势和本地 Markdown 文献笔记。</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/mnhemcidnfciakknjnaenljdmhogoobk">Chrome 应用商店</a> ·
  <a href="https://microsoftedge.microsoft.com/addons/detail/amokcibabcndajpjdpjabcgkdjhmlked">Edge 加载项商店</a> ·
  <a href="https://shupengstyle.github.io/litmedix-site/">官方网站</a> ·
  <a href="PRIVACY.md">隐私政策</a>
</p>

## 主要功能

- 在 PubMed 检索结果页和详情页显示用户导入的期刊指标；
- 按最低 IF、JCR 分区等条件筛选文献；
- 悬停查看历年影响因子折线图；
- 创建、搜索、标记、导入、导出和备份本地 Markdown 笔记；
- 在任意网页选中 PMID 或 DOI，通过右键菜单直达 PubMed；
- 笔记、设置和用户导入的数据默认保存在浏览器本地。

## 官方安装

- [从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/mnhemcidnfciakknjnaenljdmhogoobk)
- [从 Microsoft Edge 加载项商店安装](https://microsoftedge.microsoft.com/addons/detail/amokcibabcndajpjdpjabcgkdjhmlked)

## 开发者模式安装

适合无法访问 Chrome 应用商店的用户：

1. 下载仓库：点击 GitHub 页面右上角 **Code → Download ZIP**；
2. 解压到一个固定文件夹；
3. Chrome 打开 `chrome://extensions/`，Edge 打开 `edge://extensions/`；
4. 开启右上角的“开发者模式”；
5. 点击“加载已解压的扩展程序”；
6. 选择包含 `manifest.json` 的 LitMedix 文件夹。

Windows 和 macOS 版 Chrome 通常限制普通用户直接安装本地 CRX，因此更推荐以上 ZIP 开发者模式；Edge 用户优先使用 Edge 商店。

## 期刊指标数据

本仓库和商店发行包**不包含** JCR、JIF、期刊分区或其他商业数据库的批量数据。用户只能导入本人合法获得且有权使用的数据。

项目支持 JSON、CSV 和 TSV 数据导入。若需作者整理的 LitMedix 离线安装包及可导入数据，请关注项目微信公众号“骨与关节资讯”并回复：`JCR`免费获取。

相关文件仅供个人学习与科研使用。使用者应遵守数据来源的许可条件，不得进行未经授权的商业传播或再分发。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、筛选条件、笔记、标签和导入数据 |
| `unlimitedStorage` | 支持较大的本地期刊历史数据和笔记库 |
| `contextMenus` | 提供选中 PMID/DOI 后的“PubMed 检索”菜单 |
| PubMed 主机权限 | 在检索页和详情页显示增强信息及笔记入口 |
| NCBI E-utilities | 获取用户查看或保存文献的公开元数据 |

扩展不使用远程代码，不要求注册或登录。

## 数据格式

导入入口位于扩展弹窗。字段名称可参考弹窗内的导入模板及说明；历年字段可使用 `history_IF_2021`、`history_IF_2022` 等年度列。建议导入前保留原始文件备份。

## 隐私与安全

- 不出售或共享用户数据；
- 不上传本地笔记和用户导入的数据文件；
- 不内置受许可限制的商业期刊指标数据库；
- 仅访问 PubMed 与 NCBI E-utilities。

完整说明见 [PRIVACY.md](PRIVACY.md)。

## 支持项目

如果 LitMedix 对你的科研工作有帮助，欢迎通过赞赏支持后续维护。

<p align="center">
  <img src="docs/assets/wechat-reward.jpg" width="320" alt="LitMedix 作者微信赞赏码">
</p>

<p align="center"><strong>微信赞赏码｜感谢支持 LitMedix 的持续维护</strong></p>

赞赏完全自愿，不影响插件全部功能的免费使用。请仅认准本仓库展示的二维码，并在付款前核对收款方信息。

## 问题反馈与贡献

- 使用问题和功能建议：请提交 [GitHub Issue](https://github.com/shupengstyle/litmedix/issues)；
- 代码贡献说明：参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 免责声明

LitMedix 用于辅助文献检索与管理，不提供医学诊疗建议。期刊指标仅供科研选刊和文献阅读参考。

LitMedix 与 PubMed、NCBI、Clarivate 或 Journal Citation Reports 无隶属或背书关系。相关名称和商标归各自权利人所有。

## 许可证

源代码采用 [MIT License](LICENSE) 发布。第三方数据及商标不属于该许可证授权范围。
