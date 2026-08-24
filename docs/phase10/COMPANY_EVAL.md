# Company Eval Corpus v1

位置：`tests/phase10/company-eval/cases.v1.json`。

这是一个版本化、脱敏的公司研究评估语料，服务于 Company core / Contract 的回归检查，不是客户库、线索库或报价数据集。样本从 Workbench 已有的公开公司查询形态、seed/test fixtures 和市场源边界中抽象而来；公司名称均为合成占位名称。

## 数据边界

- 不包含客户姓名、联系人、电话、地址、私有报价、库存、订单、成本、凭据或可识别业务主体。
- 每条都有稳定 `company-v1-###` ID、`input`、机器可读 `expected` 约束和人工标签 `humanLabel`。
- `minimumEvidenceSources` 是评估约束，不把来源推断为事实；品牌、型号和任何结论都必须引用 `evidence[]` 中存在的 ID。

## v1 覆盖（22 条）

| 形态 | 条数 | 评估要点 |
| --- | ---: | --- |
| 贸易 | 5 | 公开商铺/名片不等于成交能力或授权 |
| 代理 | 4 | 授权与公开库存分别举证 |
| 工厂 | 4 | 名称后缀不能替代公开主体证据 |
| 同名歧义 | 3 | 必须先消歧，不合并法人主体 |
| 空证据 | 2 | 输出未知，不编品牌或型号 |
| 多来源冲突 | 2 | 保留低置信度，人工裁决 |
| 错误公司 | 2 | 不以相似结果补全主体 |

## 通过条件

`eval.test.mjs` 直接以 `node --test` 执行，检查：

1. 合同拒绝无 evidence ID 的品牌、型号和 verdict claims；
2. Company core 在没有证据时维持 `未知` / `low`，不编品牌或型号；
3. 歧义、冲突、空证据和错误公司样本均显式要求 `requiresHumanReview`。

语料的 `companyType` 与置信度是人工期望标签，不授权模型写库、自动建档或替代人做最终主体判定。
