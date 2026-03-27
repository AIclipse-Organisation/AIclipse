from typing import Any, Callable, TypeVar

import anyio

T = TypeVar("T")


class CpuPool:

    def __init__(self, max_workers: int) -> None:
        if not isinstance(max_workers, int) or max_workers < 1:
            raise ValueError("max_workers must be an int >= 1")
        self._limiter = anyio.CapacityLimiter(max_workers)

    @property
    def max_workers(self) -> int:
        return int(self._limiter.total_tokens)

    async def run(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        def _call() -> T:
            return fn(*args, **kwargs)

        return await anyio.to_thread.run_sync(_call, limiter=self._limiter)
