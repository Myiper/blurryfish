"""
Pluggable image storage for BlurryFish.

Backend is selected via the STORAGE_BACKEND environment variable:
  STORAGE_BACKEND=memory      (default) — in-process dict with TTL eviction
  STORAGE_BACKEND=cloudinary  — Cloudinary free tier (needs CLOUDINARY_URL env var)
  STORAGE_BACKEND=supabase    — Supabase Storage (needs SUPABASE_URL + SUPABASE_KEY)

Every backend exposes the same interface:
  save(file_id, step, image_bytes, ext) -> str   (URL or download path)
  get(file_id, step)                    -> bytes | None
  delete(file_id)                       -> None

For the in-memory backend a /download/{file_id}/{step} endpoint is
registered by main.py so the client can actually retrieve the bytes.
"""

from __future__ import annotations

import io
import logging
import os
import time
import threading
from abc import ABC, abstractmethod
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Abstract base
# ─────────────────────────────────────────────────────────────────────────────

class StorageBackend(ABC):
    @abstractmethod
    def save(self, file_id: str, step: str, image_bytes: bytes, ext: str = "png") -> str:
        """Persist image bytes and return the URL or local path."""

    @abstractmethod
    def get(self, file_id: str, step: str) -> Optional[bytes]:
        """Retrieve image bytes, or None if not found / expired."""

    @abstractmethod
    def delete(self, file_id: str) -> None:
        """Remove all images associated with a job id."""


# ─────────────────────────────────────────────────────────────────────────────
# Backend 1: In-memory (default)
# ─────────────────────────────────────────────────────────────────────────────
# Files live in a dict keyed by (file_id, step).
# A background thread evicts entries older than TTL_SECONDS.
# The API server must mount GET /download/{file_id}/{step} to serve bytes.
# ─────────────────────────────────────────────────────────────────────────────

_TTL_SECONDS = int(os.getenv("STORAGE_TTL_SECONDS", "3600"))  # 1 hour default


class MemoryBackend(StorageBackend):
    def __init__(self, ttl: int = _TTL_SECONDS):
        self._store: Dict[Tuple[str, str], Tuple[bytes, float]] = {}
        self._lock = threading.Lock()
        self._ttl = ttl
        self._start_eviction_thread()

    def _start_eviction_thread(self):
        def _evict():
            while True:
                time.sleep(60)
                now = time.time()
                with self._lock:
                    expired = [k for k, (_, ts) in self._store.items() if now - ts > self._ttl]
                    for k in expired:
                        del self._store[k]
                if expired:
                    logger.info("Memory storage: evicted %d expired entries.", len(expired))

        t = threading.Thread(target=_evict, daemon=True)
        t.start()

    def save(self, file_id: str, step: str, image_bytes: bytes, ext: str = "png") -> str:
        with self._lock:
            self._store[(file_id, step)] = (image_bytes, time.time())
        # Return a relative path that the /download endpoint will serve
        return f"/download/{file_id}/{step}"

    def get(self, file_id: str, step: str) -> Optional[bytes]:
        with self._lock:
            entry = self._store.get((file_id, step))
        if entry is None:
            return None
        data, ts = entry
        if time.time() - ts > self._ttl:
            self.delete(file_id)
            return None
        return data

    def delete(self, file_id: str) -> None:
        with self._lock:
            keys = [k for k in self._store if k[0] == file_id]
            for k in keys:
                del self._store[k]

    @property
    def store(self):
        """Expose internal store for the download endpoint."""
        return self._store


# ─────────────────────────────────────────────────────────────────────────────
# Backend 2: Cloudinary (free 25 GB/month)
# ─────────────────────────────────────────────────────────────────────────────
# Setup:
#   1. Create a free account at https://cloudinary.com
#   2. Copy your "API Environment variable" from the dashboard
#   3. Set CLOUDINARY_URL=cloudinary://key:secret@cloud_name  in Render env vars
#   4. Set STORAGE_BACKEND=cloudinary
# ─────────────────────────────────────────────────────────────────────────────

class CloudinaryBackend(StorageBackend):
    def __init__(self):
        try:
            import cloudinary                      # type: ignore
            import cloudinary.uploader             # type: ignore
            import cloudinary.api                  # type: ignore
            self._cloudinary = cloudinary
            self._uploader = cloudinary.uploader
            # CLOUDINARY_URL env var is read automatically by the SDK
            logger.info("Cloudinary backend ready (cloud: %s).",
                        cloudinary.config().cloud_name)
        except ImportError:
            raise RuntimeError(
                "cloudinary package not installed. "
                "Add 'cloudinary' to requirements.txt and set STORAGE_BACKEND=cloudinary."
            )

    def _public_id(self, file_id: str, step: str) -> str:
        return f"blurryfish/{file_id}/{step}"

    def save(self, file_id: str, step: str, image_bytes: bytes, ext: str = "png") -> str:
        result = self._uploader.upload(
            io.BytesIO(image_bytes),
            public_id=self._public_id(file_id, step),
            resource_type="image",
            format=ext,
            overwrite=True,
        )
        url: str = result["secure_url"]
        logger.info("Cloudinary upload: %s → %s", self._public_id(file_id, step), url)
        return url

    def get(self, file_id: str, step: str) -> Optional[bytes]:
        # For Cloudinary, callers use the URL directly; get() is a no-op.
        return None

    def delete(self, file_id: str) -> None:
        try:
            self._cloudinary.api.delete_resources_by_prefix(f"blurryfish/{file_id}/")
            logger.info("Cloudinary: deleted resources for job %s", file_id)
        except Exception as exc:
            logger.warning("Cloudinary delete failed: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Backend 3: Supabase Storage (free 1 GB)
# ─────────────────────────────────────────────────────────────────────────────
# Setup:
#   1. Create a free project at https://supabase.com
#   2. Create a Storage bucket called "blurryfish" (set to public)
#   3. Set SUPABASE_URL and SUPABASE_KEY (anon key) in Render env vars
#   4. Set STORAGE_BACKEND=supabase
# ─────────────────────────────────────────────────────────────────────────────

class SupabaseBackend(StorageBackend):
    def __init__(self):
        url  = os.getenv("SUPABASE_URL")
        key  = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set.")
        try:
            from supabase import create_client  # type: ignore
            self._client = create_client(url, key)
            self._bucket = "blurryfish"
            logger.info("Supabase Storage backend ready (bucket: %s).", self._bucket)
        except ImportError:
            raise RuntimeError(
                "supabase package not installed. "
                "Add 'supabase' to requirements.txt and set STORAGE_BACKEND=supabase."
            )

    def _path(self, file_id: str, step: str, ext: str = "png") -> str:
        return f"{file_id}/{step}.{ext}"

    def save(self, file_id: str, step: str, image_bytes: bytes, ext: str = "png") -> str:
        path = self._path(file_id, step, ext)
        self._client.storage.from_(self._bucket).upload(
            path,
            image_bytes,
            {"content-type": f"image/{ext}", "upsert": "true"},
        )
        public_url: str = (
            self._client.storage.from_(self._bucket).get_public_url(path)
        )
        logger.info("Supabase upload: %s → %s", path, public_url)
        return public_url

    def get(self, file_id: str, step: str) -> Optional[bytes]:
        # For Supabase, callers use the public URL directly.
        return None

    def delete(self, file_id: str) -> None:
        try:
            # List and remove all files under the job prefix
            files = self._client.storage.from_(self._bucket).list(file_id)
            paths = [f"{file_id}/{f['name']}" for f in files]
            if paths:
                self._client.storage.from_(self._bucket).remove(paths)
                logger.info("Supabase: deleted %d files for job %s", len(paths), file_id)
        except Exception as exc:
            logger.warning("Supabase delete failed: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Factory — selects backend from STORAGE_BACKEND env var
# ─────────────────────────────────────────────────────────────────────────────

def create_storage() -> StorageBackend:
    backend = os.getenv("STORAGE_BACKEND", "memory").lower().strip()
    logger.info("Storage backend: %s", backend)

    if backend == "memory":
        return MemoryBackend()
    elif backend == "cloudinary":
        return CloudinaryBackend()
    elif backend == "supabase":
        return SupabaseBackend()
    else:
        logger.warning("Unknown STORAGE_BACKEND '%s' — falling back to memory.", backend)
        return MemoryBackend()
