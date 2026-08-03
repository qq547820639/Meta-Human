import sys


def test_runtime_uses_python_312() -> None:
    assert sys.version_info[:2] == (3, 12)


def test_core_package_is_importable() -> None:
    import voxstudio_core

    assert voxstudio_core is not None
