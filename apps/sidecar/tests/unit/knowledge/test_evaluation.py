from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.evaluation import (
    SAMPLE_TEST_SET,
    EvaluationCase,
    build_sample_database,
    report_to_json,
    report_to_markdown,
    run_evaluation,
    run_sample_evaluation,
)
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    db = await build_sample_database(tmp_path / "eval.sqlite3")
    try:
        yield db
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_sample_evaluation_recalls_expected_sources(database: Database) -> None:
    report = await run_evaluation(
        KnowledgeRetriever(database), SAMPLE_TEST_SET, k=3
    )

    assert len(report.cases) == len(SAMPLE_TEST_SET)
    assert report.recall_at_k == 1.0
    assert report.citation_accuracy == 1.0
    # Exactly one no-basis case (the out-of-scope query).
    assert report.no_basis_rate == 1 / len(SAMPLE_TEST_SET)


@pytest.mark.asyncio
async def test_evaluation_marks_no_basis_when_no_source(database: Database) -> None:
    report = await run_evaluation(
        KnowledgeRetriever(database),
        (EvaluationCase(query="鲸磷虾苔原矿石", expected_document_ids=()),),
    )

    assert report.cases[0].no_basis is True
    assert report.cases[0].retrieved == ()
    assert report.no_basis_rate == 1.0


@pytest.mark.asyncio
async def test_report_serializes_to_json(database: Database) -> None:
    report = await run_evaluation(
        KnowledgeRetriever(database), SAMPLE_TEST_SET
    )

    payload = report_to_json(report)

    assert '"recall_at_k"' in payload
    assert '"citation_accuracy"' in payload
    assert '"no_basis_rate"' in payload


@pytest.mark.asyncio
async def test_report_serializes_to_markdown(database: Database) -> None:
    report = await run_evaluation(
        KnowledgeRetriever(database), SAMPLE_TEST_SET
    )

    markdown = report_to_markdown(report)

    assert "# 检索质量评估报告" in markdown
    assert "召回率" in markdown
    assert "无依据回答率" in markdown


@pytest.mark.asyncio
async def test_run_sample_evaluation_writes_outputs(tmp_path: Path) -> None:
    report = await run_sample_evaluation(
        db_path=tmp_path / "sample.sqlite3",
        out_dir=tmp_path / "out",
    )

    assert (tmp_path / "out" / "evaluation.json").exists()
    assert (tmp_path / "out" / "evaluation.md").exists()
    assert report.recall_at_k == 1.0
