from __future__ import annotations

import argparse
import ipaddress
import os
import socket
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import uvicorn
from pydantic import SecretStr

from voxstudio_core.api.app import create_app
from voxstudio_core.capabilities.knowledge import FeishuKnowledgeAdapter
from voxstudio_core.capabilities.local import (
    LocalChatAdapter,
    LocalEmbeddingAdapter,
    LocalSttAdapter,
)
from voxstudio_core.capabilities.remote import (
    RemoteAvatarEnrollAdapter,
    RemoteAvatarStreamAdapter,
    RemoteTtsAdapter,
    RemoteVoiceEnrollAdapter,
)
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.capabilities.unconfigured import (
    UnconfiguredCapabilityAdapter,
)
from voxstudio_core.config import SidecarConfig
from voxstudio_core.knowledge.feishu import FeishuClient
from voxstudio_core.knowledge.conversation import ConversationService
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.memory import ConversationMemoryStore, MemoryService
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.lifecycle import SidecarLifecycle
from voxstudio_core.persistence.build_job_repository import BuildJobRepository
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryRepository,
)
from voxstudio_core.persistence.readiness_repository import ReadinessRepository
from voxstudio_core.providers.build_job_service import BuildJobService
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig
from voxstudio_core.readiness.models import CapabilityId
from voxstudio_core.readiness.service import ReadinessService


@dataclass(frozen=True, slots=True)
class FeishuProviderConfig:
    access_token: SecretStr
    space_id: str
    refresh_token: SecretStr | None = None
    app_id: str | None = None
    app_secret: SecretStr | None = None


def build_app(
    *,
    config: SidecarConfig,
    database_path: Path | str,
    registry: CapabilityAdapterRegistry | None = None,
):
    database = Database(database_path)
    repository = ReadinessRepository(database)
    digital_humans = DigitalHumanRepository(database)
    build_jobs = BuildJobRepository(database)
    remote_config = _remote_provider_config_from_environment()
    service = ReadinessService(
        repository=repository,
        registry=registry or _default_registry(database),
        required_capability_ids=None,
    )
    lifecycle = SidecarLifecycle(
        database=database,
        repository=repository,
        readiness_service=service,
    )
    local_config = _local_provider_config_from_environment()
    conversation_service = None
    build_job_service = None
    remote_client = None
    if remote_config is not None:
        remote_client = RemoteGpuClient(remote_config)
        build_job_service = BuildJobService(
            repository=build_jobs,
            digital_humans=digital_humans,
            client=remote_client,
        )
    if local_config is not None:
        local_client = OpenAICompatibleClient(local_config)
        memory_service = MemoryService(
            repository=MemoryEntryRepository(database),
            chat_client=local_client,
            chat_model=local_config.chat_model,
        )
        conversation_service = ConversationService(
            retriever=KnowledgeRetriever(database),
            chat_client=local_client,
            chat_model=local_config.chat_model,
            tts_client=remote_client,
            history=ConversationHistoryStore(database),
            memory_store=ConversationMemoryStore(database),
            memory_service=memory_service,
            stt_client=local_client,
            stt_model=local_config.stt_model,
            conversations=ConversationRepository(database),
        )
    else:
        memory_service = None
    return create_app(
        config=config,
        lifecycle=lifecycle,
        conversation_service=conversation_service,
        build_job_service=build_job_service,
        digital_humans=digital_humans,
        avatar_stream_client=remote_client,
        knowledge_sources=KnowledgeSourceStore(database),
        privacy_database=database,
        startup_resume=build_job_service,
        memory_service=memory_service,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    bearer_token = os.environ.get("VOXSTUDIO_BEARER_TOKEN")
    if bearer_token is None:
        parser.error("VOXSTUDIO_BEARER_TOKEN is required")

    listener = _listener_from_fd(arguments.listener_fd)
    try:
        host, port = listener.getsockname()
        config = SidecarConfig(
            host=host,
            port=port,
            bearer_token=bearer_token,
        )
        app = build_app(
            config=config,
            database_path=arguments.database,
        )
        server = uvicorn.Server(
            uvicorn.Config(
                app=app,
                host=config.host,
                port=config.port,
                access_log=False,
            )
        )
        server.run(sockets=[listener])
    finally:
        listener.close()
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="voxstudio-sidecar",
        description="Run the loopback-only VoxStudio readiness sidecar.",
    )
    parser.add_argument("--listener-fd", type=int, required=True)
    parser.add_argument(
        "--database",
        type=Path,
        required=True,
        help="SQLite database path.",
    )
    return parser


def _listener_from_fd(file_descriptor: int) -> socket.socket:
    try:
        listener = socket.socket(fileno=file_descriptor)
    except (OSError, ValueError) as error:
        raise ValueError("listener file descriptor is invalid") from error

    try:
        if listener.family != socket.AF_INET:
            raise ValueError("listener must be an IPv4 socket")
        if listener.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM:
            raise ValueError("listener must be a TCP STREAM socket")
        if not _is_listening(listener):
            raise ValueError("listener socket must already be listening")

        address = listener.getsockname()
        if not isinstance(address, tuple) or len(address) != 2:
            raise ValueError("listener must have an IPv4 endpoint")
        host, port = address
        parsed_host = ipaddress.ip_address(host)
        if not isinstance(parsed_host, ipaddress.IPv4Address):
            raise ValueError("listener must have an IPv4 endpoint")
        if not parsed_host.is_loopback:
            raise ValueError("listener must be bound to a loopback endpoint")
        if not isinstance(port, int) or port == 0:
            raise ValueError("listener must be bound to a nonzero port")
        listener.set_inheritable(False)
        return listener
    except BaseException:
        listener.close()
        raise


def _is_listening(listener: socket.socket) -> bool:
    try:
        return listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1
    except OSError:
        previous_timeout = listener.gettimeout()
        listener.setblocking(False)
        try:
            connection, _ = listener.accept()
        except BlockingIOError:
            return True
        except OSError:
            return False
        else:
            connection.close()
            return True
        finally:
            listener.settimeout(previous_timeout)


def _default_registry(database: Database) -> CapabilityAdapterRegistry:
    adapters = {
        capability_id: UnconfiguredCapabilityAdapter(capability_id)
        for capability_id in CapabilityId
    }
    local_config = _local_provider_config_from_environment()
    if local_config is not None:
        client = OpenAICompatibleClient(local_config)
        adapters[CapabilityId.LLM_CHAT] = LocalChatAdapter(
            client,
            local_config.chat_model,
        )
        adapters[CapabilityId.EMBEDDING_TEXT] = LocalEmbeddingAdapter(
            client,
            local_config.embedding_model,
        )
        adapters[CapabilityId.STT_TRANSCRIBE] = LocalSttAdapter(
            client,
            local_config.stt_model,
        )
    remote_config = _remote_provider_config_from_environment()
    if remote_config is not None:
        remote_client = RemoteGpuClient(remote_config)
        adapters[CapabilityId.VOICE_ENROLL] = RemoteVoiceEnrollAdapter(
            remote_client
        )
        adapters[CapabilityId.AVATAR_ENROLL] = RemoteAvatarEnrollAdapter(
            remote_client
        )
        adapters[CapabilityId.AVATAR_STREAM] = RemoteAvatarStreamAdapter(
            remote_client
        )
        adapters[CapabilityId.TTS_SYNTHESIZE] = RemoteTtsAdapter(
            remote_client
        )
    feishu_config = _feishu_provider_config_from_environment()
    if feishu_config is not None:
        feishu_client = FeishuClient(
            access_token=feishu_config.access_token,
            refresh_token=feishu_config.refresh_token,
            app_id=feishu_config.app_id,
            app_secret=feishu_config.app_secret,
            base_url=os.environ.get(
                "VOXSTUDIO_FEISHU_BASE_URL",
                "https://open.feishu.cn",
            ),
        )
        adapters[CapabilityId.EMBEDDING_TEXT] = FeishuKnowledgeAdapter(
            client=feishu_client,
            indexer=KnowledgeIndexer(database),
            retriever=KnowledgeRetriever(database),
            space_id=feishu_config.space_id,
        )
    return CapabilityAdapterRegistry(adapters)


def _local_provider_config_from_environment() -> LocalProviderConfig | None:
    base_url = os.environ.get("VOXSTUDIO_LOCAL_BASE_URL")
    if base_url is None:
        return None
    return LocalProviderConfig(
        base_url=base_url,
        chat_model=os.environ.get("VOXSTUDIO_LOCAL_CHAT_MODEL", "local-chat"),
        embedding_model=os.environ.get(
            "VOXSTUDIO_LOCAL_EMBEDDING_MODEL",
            "local-embed",
        ),
        stt_model=os.environ.get("VOXSTUDIO_LOCAL_STT_MODEL") or None,
        timeout_seconds=float(
            os.environ.get("VOXSTUDIO_LOCAL_TIMEOUT_SECONDS", "5")
        ),
        allow_remote=os.environ.get("VOXSTUDIO_LOCAL_ALLOW_REMOTE") == "1",
    )


def _remote_provider_config_from_environment() -> RemoteGpuConfig | None:
    base_url = os.environ.get("VOXSTUDIO_REMOTE_BASE_URL")
    if base_url is None:
        return None
    api_key = os.environ.get("VOXSTUDIO_REMOTE_API_KEY")
    return RemoteGpuConfig(
        base_url=base_url,
        api_key=SecretStr(api_key) if api_key else None,
        voice_enroll_path=os.environ.get(
            "VOXSTUDIO_REMOTE_VOICE_ENROLL_PATH",
            "/v1/voice/enrollments",
        ),
        avatar_enroll_path=os.environ.get(
            "VOXSTUDIO_REMOTE_AVATAR_ENROLL_PATH",
            "/v1/avatar/enrollments",
        ),
        avatar_stream_path=os.environ.get(
            "VOXSTUDIO_REMOTE_AVATAR_STREAM_PATH",
            "/v1/avatar/streams",
        ),
        avatar_stream_stop_path=os.environ.get(
            "VOXSTUDIO_REMOTE_AVATAR_STREAM_STOP_PATH",
            "/v1/avatar/streams/{session_id}",
        ),
        tts_path=os.environ.get(
            "VOXSTUDIO_REMOTE_TTS_PATH",
            "/v1/audio/speech",
        ),
        tts_voice=os.environ.get("VOXSTUDIO_REMOTE_TTS_VOICE") or None,
        timeout_seconds=float(
            os.environ.get("VOXSTUDIO_REMOTE_TIMEOUT_SECONDS", "15")
        ),
    )


def _feishu_provider_config_from_environment() -> FeishuProviderConfig | None:
    access_token = os.environ.get("VOXSTUDIO_FEISHU_ACCESS_TOKEN")
    space_id = os.environ.get("VOXSTUDIO_FEISHU_SPACE_ID")
    if access_token is None or space_id is None:
        return None
    refresh_token = os.environ.get("VOXSTUDIO_FEISHU_REFRESH_TOKEN")
    app_id = os.environ.get("VOXSTUDIO_FEISHU_APP_ID")
    app_secret = os.environ.get("VOXSTUDIO_FEISHU_APP_SECRET")
    return FeishuProviderConfig(
        access_token=SecretStr(access_token),
        space_id=space_id,
        refresh_token=SecretStr(refresh_token) if refresh_token else None,
        app_id=app_id,
        app_secret=SecretStr(app_secret) if app_secret else None,
    )


if __name__ == "__main__":
    raise SystemExit(main())
