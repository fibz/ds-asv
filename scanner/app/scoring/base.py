"""CVESource protocol — the pluggable seam between the scoring engine and
CVE databases (Greenbone, NVD, VulDB...). 5b spec §3 checkpoint."""

from __future__ import annotations

from typing import List, Optional, Protocol, runtime_checkable

from app.scoring.types import CVEData


@runtime_checkable
class CVESource(Protocol):
    """Answers "which CVEs affect this product:version?".

    Implementations MUST NOT fabricate data: an unknown product/version,
    a missing or corrupt cache, or an unreachable upstream return ``[]``
    (plus a warning log) — never invented entries. ``refresh()`` rebuilds
    the local cache and may raise a clear error when the upstream is
    unreachable; a failed refresh must leave the previous cache usable.
    """

    def lookup(
        self,
        product: str,
        version: Optional[str],
        os_hint: Optional[str] = None,
    ) -> List[CVEData]: ...

    def refresh(self) -> None: ...

    def describe(self) -> str: ...
