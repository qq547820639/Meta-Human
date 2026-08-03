import hashlib
import hmac
from collections.abc import Iterable
from typing import NoReturn

from fastapi import HTTPException, Request, status
from pydantic import SecretStr

from voxstudio_core.config import validate_startup_token


class BearerTokenGuard:
    __slots__ = ("_expected_digest",)

    def __init__(self, expected_token: str | SecretStr) -> None:
        token = (
            expected_token.get_secret_value()
            if isinstance(expected_token, SecretStr)
            else expected_token
        )
        validate_startup_token(token)
        self._expected_digest = hashlib.sha256(token.encode("ascii")).digest()

    def matches(self, candidate: str) -> bool:
        candidate_digest = hashlib.sha256(candidate.encode("utf-8")).digest()
        return hmac.compare_digest(candidate_digest, self._expected_digest)

    async def __call__(self, request: Request) -> None:
        if request.headers.getlist("cookie"):
            raise _unauthorized()
        if self._contains_forbidden_transport(request.query_params.multi_items()):
            raise _unauthorized()

        authorization_headers = request.headers.getlist("authorization")
        if len(authorization_headers) != 1:
            raise _unauthorized()
        authorization = authorization_headers[0]
        parts = authorization.split()
        if len(parts) != 2 or parts[0].casefold() != "bearer":
            raise _unauthorized()
        if not self.matches(parts[1]):
            raise _unauthorized()

    def _contains_forbidden_transport(
        self,
        values: Iterable[tuple[str, str]],
    ) -> bool:
        return any(
            _is_token_parameter(name) or self.matches(value)
            for name, value in values
        )

    def __repr__(self) -> str:
        return f"{type(self).__name__}()"

    def __reduce_ex__(self, protocol: int) -> NoReturn:
        del protocol
        raise TypeError("BearerTokenGuard secrets must not be serialized")


def _is_token_parameter(name: str) -> bool:
    normalized = name.casefold().replace("-", "_")
    return normalized in {"authorization", "token"} or normalized.endswith(
        "_token"
    )


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized",
        headers={"WWW-Authenticate": "Bearer"},
    )
