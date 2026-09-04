"""Encryption for stored mailbox credentials.

An app password is a live credential for someone's real mailbox, so it never
sits in the database as plaintext. It is encrypted at rest with a key derived
from SESSION_SECRET and only decrypted in memory at the moment a connection is
opened.

Changing SESSION_SECRET makes existing stored passwords undecryptable - that is
deliberate, and the mailbox simply has to be reconnected.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("salesos.crypto")


class DecryptionError(RuntimeError):
    """The stored secret cannot be read with the current key."""


def _fernet(secret: str) -> Fernet:
    # Fernet needs a 32-byte urlsafe-base64 key; SESSION_SECRET is arbitrary text.
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str, secret: str) -> str:
    return _fernet(secret).encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str, secret: str) -> str:
    try:
        return _fernet(secret).decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError(
            "Stored mailbox password could not be decrypted. This usually means "
            "SESSION_SECRET changed - reconnect the mailbox."
        ) from exc


def mask(value: str) -> str:
    """A hint that the credential is set, without revealing it."""
    if not value:
        return ""
    if len(value) <= 4:
        return "•" * len(value)
    return "•" * (len(value) - 4) + value[-4:]
