import hmac
import json
import logging
import pickle

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.security import BearerTokenGuard


def make_client(token: str) -> TestClient:
    app = FastAPI()
    guard = BearerTokenGuard(token)

    @app.get("/protected", dependencies=[Depends(guard)])
    def protected() -> dict[str, bool]:
        return {"ok": True}

    return TestClient(app)


@pytest.mark.parametrize(
    "host",
    ("localhost", "127.0.0.1", "127.42.18.9", "::1"),
)
def test_config_accepts_only_explicit_loopback_hosts(host: str) -> None:
    config = SidecarConfig(host=host, bearer_token=generate_startup_token())

    assert config.host == host


@pytest.mark.parametrize(
    "host",
    (
        "0.0.0.0",
        "::",
        "192.168.1.10",
        "example.test",
        "localhost.example.test",
        "",
    ),
)
def test_config_rejects_non_loopback_hosts(host: str) -> None:
    with pytest.raises(ValidationError, match="loopback"):
        SidecarConfig(host=host, bearer_token=generate_startup_token())


def test_config_requires_a_startup_bearer_token() -> None:
    with pytest.raises(ValidationError, match="bearer_token"):
        SidecarConfig(host="127.0.0.1")


def test_config_rejects_weak_tokens_without_echoing_them() -> None:
    weak_token = "predictable-token"

    with pytest.raises(ValidationError) as error:
        SidecarConfig(host="127.0.0.1", bearer_token=weak_token)

    assert weak_token not in str(error.value)


@pytest.mark.parametrize("forbidden_character", ("+", "/", "=", ".", "~"))
def test_config_rejects_tokens_outside_the_urlsafe_generator_alphabet(
    forbidden_character: str,
) -> None:
    token = f"{'A' * 42}{forbidden_character}"

    with pytest.raises(ValidationError):
        SidecarConfig(host="127.0.0.1", bearer_token=token)


def test_generated_startup_tokens_have_at_least_256_bits_of_random_material() -> None:
    first = generate_startup_token()
    second = generate_startup_token()

    assert len(first) >= 43
    assert first != second
    SidecarConfig(host="127.0.0.1", bearer_token=first)


def test_token_is_excluded_from_repr_logs_and_model_serialization(
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = generate_startup_token()
    config = SidecarConfig(host="127.0.0.1", bearer_token=token)
    guard = BearerTokenGuard(config.bearer_token)

    caplog.set_level(logging.INFO)
    logging.getLogger("test.security").info("%r %r", config, guard)
    serialized = json.dumps(config.model_dump(mode="json"))

    assert token not in repr(config)
    assert token not in repr(guard)
    assert token not in caplog.text
    assert token not in serialized
    assert "bearer_token" not in config.model_dump()


def test_secret_holding_objects_cannot_be_pickled() -> None:
    token = generate_startup_token()
    config = SidecarConfig(host="127.0.0.1", bearer_token=token)
    guard = BearerTokenGuard(config.bearer_token)

    with pytest.raises(TypeError, match="must not be serialized"):
        pickle.dumps(config)
    with pytest.raises(TypeError, match="must not be serialized"):
        pickle.dumps(guard)


def test_token_validation_uses_constant_time_digest_comparison(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    comparisons: list[tuple[bytes, bytes]] = []

    def record_comparison(left: bytes, right: bytes) -> bool:
        comparisons.append((left, right))
        return True

    monkeypatch.setattr(hmac, "compare_digest", record_comparison)
    guard = BearerTokenGuard(generate_startup_token())

    assert guard.matches("candidate-token") is True
    assert len(comparisons) == 1
    assert len(comparisons[0][0]) == 32
    assert len(comparisons[0][1]) == 32


def test_guard_accepts_only_the_expected_authorization_bearer_token() -> None:
    token = generate_startup_token()
    response = make_client(token).get(
        "/protected",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.parametrize(
    "headers",
    (
        {},
        {"Authorization": "Basic dXNlcjpwYXNz"},
        {"Authorization": "Bearer wrong-token"},
        {"Authorization": "Bearer"},
    ),
)
def test_guard_denies_missing_malformed_or_incorrect_headers(
    headers: dict[str, str],
) -> None:
    response = make_client(generate_startup_token()).get(
        "/protected",
        headers=headers,
    )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json() == {"detail": "Unauthorized"}


@pytest.mark.parametrize("reverse_headers", (False, True))
def test_guard_rejects_multiple_authorization_headers_regardless_of_order(
    reverse_headers: bool,
) -> None:
    token = generate_startup_token()
    authorization_headers = [
        ("Authorization", f"Bearer {token}"),
        ("Authorization", "Bearer wrong-token"),
    ]
    if reverse_headers:
        authorization_headers.reverse()

    response = make_client(token).get(
        "/protected",
        headers=authorization_headers,
    )

    assert response.status_code == 401


def test_guard_explicitly_rejects_query_string_tokens() -> None:
    token = generate_startup_token()
    response = make_client(token).get(
        "/protected",
        params={"access_token": token},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert token not in response.text


def test_guard_rejects_cookie_tokens_even_with_a_valid_header() -> None:
    token = generate_startup_token()
    client = make_client(token)
    client.cookies.set("token", token)

    response = client.get(
        "/protected",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert token not in response.text


def test_guard_rejects_raw_duplicate_cookies_before_framework_parsing() -> None:
    token = generate_startup_token()
    response = make_client(token).get(
        "/protected",
        headers=[
            ("Authorization", f"Bearer {token}"),
            ("Cookie", f"foo={token}; foo=bar"),
        ],
    )

    assert response.status_code == 401
    assert token not in response.text


def test_guard_allows_non_authentication_query_parameters() -> None:
    token = generate_startup_token()
    response = make_client(token).get(
        "/protected",
        params={"page": "1"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
