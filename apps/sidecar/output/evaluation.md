# 检索质量评估报告

- 数据来源：内置样例测试集（SAMPLE_TEST_SET），无真实飞书知识源；接入真实知识源后以真实文档重跑即可得到生产指标。
- 检索窗口 k：3
- 用例数：5

## 总体指标

| 指标 | 值 |
| --- | ---: |
| 召回率 recall@3 | 100.0% |
| 引用正确性 citation_accuracy | 100.0% |
| 无依据回答率 no_basis_rate | 20.0% |

## 分用例

| 用例 | 期望来源 | 命中来源 | recall | 引用正确 | 无依据 |
| --- | --- | --- | ---: | ---: | ---: |
| 外骨骼应该怎么穿戴 | doc-wearable | doc-wearable, doc-maintenance | 1.00 | ✅ | — |
| 飞书知识库如何增量同步 | doc-feishu | doc-feishu, doc-wearable | 1.00 | ✅ | — |
| 设备导轨多久需要润滑 | doc-maintenance | doc-maintenance, doc-tts | 1.00 | ✅ | — |
| 语音回复是怎么生成的 | doc-tts | doc-tts, doc-wearable, doc-feishu | 1.00 | ✅ | — |
| 鲸磷虾苔原矿石 | — | — | 1.00 | ✅ | ✅ |
