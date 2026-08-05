"""Retrieval-quality evaluation harness.

Measures three headline metrics on a labelled testset:
  * recall@k        - fraction of expected sources that were retrieved
  * citation_accuracy - share of queries whose expected sources were all found
  * no_basis_rate   - share of queries that returned zero sources (the answer
                      would have no reliable knowledge basis)

When no real Feishu knowledge source is available the module ships a built-in
``SAMPLE_TEST_SET`` whose documents are indexed into a scratch database, so the
harness produces genuine, reproducible numbers.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.database import Database

#: Data-source note surfaced in evaluation output.
DATA_SOURCE_NOTE = (
    "数据来源：内置样例测试集（SAMPLE_TEST_SET），无真实飞书知识源；"
    "接入真实知识源后以真实文档重跑即可得到生产指标。"
)


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    query: str
    expected_document_ids: tuple[str, ...]
    description: str = ""


@dataclass(frozen=True, slots=True)
class SampleDocument:
    document_id: str
    title: str
    content: str


@dataclass(frozen=True, slots=True)
class CaseResult:
    query: str
    expected: tuple[str, ...]
    retrieved: tuple[str, ...]
    recall_at_k: float
    citation_accurate: bool
    no_basis: bool


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    cases: tuple[CaseResult, ...]
    k: int
    data_source: str = DATA_SOURCE_NOTE

    @property
    def recall_at_k(self) -> float:
        relevant = [
            result for result in self.cases if result.expected
        ]
        if not relevant:
            return 0.0
        return sum(result.recall_at_k for result in relevant) / len(relevant)

    @property
    def citation_accuracy(self) -> float:
        relevant = [
            result for result in self.cases if result.expected
        ]
        if not relevant:
            return 0.0
        accurate = sum(1 for result in relevant if result.citation_accurate)
        return accurate / len(relevant)

    @property
    def no_basis_rate(self) -> float:
        if not self.cases:
            return 0.0
        return sum(1 for result in self.cases if result.no_basis) / len(
            self.cases
        )


# ---------------------------------------------------------------------------
# Built-in sample testset (documents + labelled queries)
# ---------------------------------------------------------------------------

SAMPLE_DOCUMENTS: tuple[SampleDocument, ...] = (
    SampleDocument(
        document_id="doc-wearable",
        title="可穿戴外骨骼使用指南",
        content=(
            "可穿戴外骨骼采用后入式穿戴机制，用户先坐下，将髋部与背部"
            "贴合到支撑结构，再依次固定大腿和小腿绑带。穿戴完成后可通过"
            "髋关节电机辅助行走，并支持按步幅调节助力大小。"
        ),
    ),
    SampleDocument(
        document_id="doc-feishu",
        title="飞书知识库同步说明",
        content=(
            "通过飞书开放平台可自动同步 Wiki 知识库到本地数字人知识索引。"
            "每次同步会增量对比文档内容哈希，仅有变化的知识文档才会重新"
            "分块并写入倒排索引，未变化的文档仅刷新同步时间。"
        ),
    ),
    SampleDocument(
        document_id="doc-maintenance",
        title="设备维护指南",
        content=(
            "线性导轨应每月润滑一次，建议使用锂基润滑脂。电机轴承每季度"
            "检查一次磨损情况，若出现异响应立即停机并联系售后。"
        ),
    ),
    SampleDocument(
        document_id="doc-tts",
        title="语音合成(TTS)功能说明",
        content=(
            "数字人的语音回复由本地 TTS 服务实时合成，支持多音色选择与"
            "语速调节。合成结果以 WAV 音频流返回，前端播放完成后自动释放。"
        ),
    ),
)

SAMPLE_TEST_SET: tuple[EvaluationCase, ...] = (
    EvaluationCase(
        query="外骨骼应该怎么穿戴",
        expected_document_ids=("doc-wearable",),
        description="召回可穿戴外骨骼使用指南",
    ),
    EvaluationCase(
        query="飞书知识库如何增量同步",
        expected_document_ids=("doc-feishu",),
        description="召回飞书知识库同步说明",
    ),
    EvaluationCase(
        query="设备导轨多久需要润滑",
        expected_document_ids=("doc-maintenance",),
        description="召回设备维护指南",
    ),
    EvaluationCase(
        query="语音回复是怎么生成的",
        expected_document_ids=("doc-tts",),
        description="召回语音合成功能说明",
    ),
    EvaluationCase(
        query="鲸磷虾苔原矿石",
        expected_document_ids=(),
        description="知识库不覆盖的主题，期望无依据（无来源命中）",
    ),
)


async def build_sample_database(path: Path) -> Database:
    """Index the sample documents into a fresh database and return it."""
    database = Database(path)
    await database.connect()
    await database.migrate()
    indexer = KnowledgeIndexer(database)
    synced_at = datetime.now(UTC)
    for document in SAMPLE_DOCUMENTS:
        await indexer.upsert_document(
            document_id=document.document_id,
            title=document.title,
            content=document.content,
            source_url=f"https://feishu.cn/docx/{document.document_id}",
            synced_at=synced_at,
        )
    return database


async def run_evaluation(
    retriever: KnowledgeRetriever,
    cases: tuple[EvaluationCase, ...] = SAMPLE_TEST_SET,
    *,
    k: int = 3,
) -> EvaluationReport:
    results: list[CaseResult] = []
    for case in cases:
        passages = await retriever.search(query=case.query, limit=k)
        retrieved = tuple(passage.document_id for passage in passages)
        retrieved_set = set(retrieved)
        expected_set = set(case.expected_document_ids)
        if case.expected_document_ids:
            recall = len(expected_set & retrieved_set) / len(expected_set)
            citation_accurate = expected_set <= retrieved_set
        else:
            recall = 1.0 if not retrieved else 0.0
            citation_accurate = not bool(retrieved)
        results.append(
            CaseResult(
                query=case.query,
                expected=case.expected_document_ids,
                retrieved=retrieved,
                recall_at_k=recall,
                citation_accurate=citation_accurate,
                no_basis=not bool(retrieved),
            )
        )
    return EvaluationReport(cases=tuple(results), k=k)


def report_to_json(report: EvaluationReport) -> str:
    payload = {
        "k": report.k,
        "data_source": report.data_source,
        "metrics": {
            "recall_at_k": round(report.recall_at_k, 4),
            "citation_accuracy": round(report.citation_accuracy, 4),
            "no_basis_rate": round(report.no_basis_rate, 4),
        },
        "cases": [
            {
                "query": case.query,
                "expected": list(case.expected),
                "retrieved": list(case.retrieved),
                "recall_at_k": round(case.recall_at_k, 4),
                "citation_accurate": case.citation_accurate,
                "no_basis": case.no_basis,
            }
            for case in report.cases
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def report_to_markdown(report: EvaluationReport) -> str:
    lines = [
        "# 检索质量评估报告",
        "",
        f"- {report.data_source}",
        f"- 检索窗口 k：{report.k}",
        f"- 用例数：{len(report.cases)}",
        "",
        "## 总体指标",
        "",
        "| 指标 | 值 |",
        "| --- | ---: |",
        f"| 召回率 recall@{report.k} | {report.recall_at_k * 100:.1f}% |",
        f"| 引用正确性 citation_accuracy | {report.citation_accuracy * 100:.1f}% |",
        f"| 无依据回答率 no_basis_rate | {report.no_basis_rate * 100:.1f}% |",
        "",
        "## 分用例",
        "",
        "| 用例 | 期望来源 | 命中来源 | recall | 引用正确 | 无依据 |",
        "| --- | --- | --- | ---: | ---: | ---: |",
    ]
    for case in report.cases:
        lines.append(
            "| {} | {} | {} | {:.2f} | {} | {} |".format(
                case.query,
                ", ".join(case.expected) if case.expected else "—",
                ", ".join(case.retrieved) if case.retrieved else "—",
                case.recall_at_k,
                "✅" if case.citation_accurate else "❌",
                "✅" if case.no_basis else "—",
            )
        )
    lines.append("")
    return "\n".join(lines)


async def run_sample_evaluation(
    *,
    db_path: Path | str | None = None,
    out_dir: Path | str | None = None,
    k: int = 3,
) -> EvaluationReport:
    """Run the built-in testset and write ``evaluation.json`` + ``evaluation.md``.

    Returns the report so callers and tests can inspect the metrics directly.
    """
    resolved_db = Path(db_path) if db_path else Path("sample_knowledge.sqlite3")
    database = await build_sample_database(resolved_db)
    try:
        report = await run_evaluation(
            KnowledgeRetriever(database),
            SAMPLE_TEST_SET,
            k=k,
        )
    finally:
        await database.close()

    if out_dir is not None:
        output = Path(out_dir)
        output.mkdir(parents=True, exist_ok=True)
        (output / "evaluation.json").write_text(
            report_to_json(report), encoding="utf-8"
        )
        (output / "evaluation.md").write_text(
            report_to_markdown(report), encoding="utf-8"
        )
    return report
