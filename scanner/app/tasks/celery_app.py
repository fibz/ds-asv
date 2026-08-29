"""Celery application, task registration, and beat schedule for ASV scanning.

Scan executors live in ``app/tasks/scanner_tasks.py`` and are registered here as
Celery tasks. The API dispatches them through ``dispatch_scan`` which uses
``.delay()`` when a broker is configured and falls back to FastAPI
``BackgroundTasks`` for local/test runs (no broker available), so the same code
path is exercised without a live worker.

Beat schedules the quarterly PCI DSS 11.3.2 rescan sweep.
"""

from __future__ import annotations

import os

from celery import Celery
from celery.schedules import crontab

broker_url = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
result_backend = os.environ.get("CELERY_RESULT_BACKEND", broker_url)

celery_app = Celery(
    "asv_scanner",
    broker=broker_url,
    backend=result_backend,
    include=["app.tasks.scanner_tasks"],
)

celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_time_limit=60 * 60,
    task_soft_time_limit=60 * 55,
)

# Quarterly PCI DSS 11.3.2 external scan rescan (run on the first day of each
# quarter at 02:00 UTC).
celery_app.conf.beat_schedule = {
    "quarterly-rescan": {
        "task": "app.tasks.scanner_tasks.run_quarterly_rescan",
        "schedule": crontab(
            minute=0, hour=2, day_of_month="1-7", month_of_year="1,4,7,10"
        ),
    },
}


def broker_configured() -> bool:
    """True when a non-empty broker URL is explicitly set."""
    return bool(os.environ.get("CELERY_BROKER_URL"))


def dispatch_scan(func, *args):
    """Dispatch a scan task via Celery when a broker is configured.

    Returns ``None`` (the caller's FastAPI BackgroundTasks path is used when no
    broker is available).
    """
    if broker_configured():
        return func.delay(*args)
    return None
