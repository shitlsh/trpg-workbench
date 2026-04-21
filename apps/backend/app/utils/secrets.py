import secrets
import base64
import json
from pathlib import Path
from cryptography.fernet import Fernet
from app.utils.paths import get_data_dir

_KEY_FILE_NAME = ".secret_key"


def _get_or_create_key() -> bytes:
    key_path = get_data_dir() / _KEY_FILE_NAME
    if key_path.exists():
        return key_path.read_bytes()
    key = Fernet.generate_key()
    key_path.write_bytes(key)
    key_path.chmod(0o600)
    return key


def encrypt_secret(value: str) -> str:
    f = Fernet(_get_or_create_key())
    return f.encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str:
    f = Fernet(_get_or_create_key())
    return f.decrypt(token.encode()).decode()
