from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from typing import Any, Callable, TypeVar

import anyio
from anyio import CapacityLimiter

T = TypeVar("T")


@dataclass(frozen=True)
class CpuPool:
    limiter: CapacityLimiter

    @classmethod
    def from_max_concurrency(cls, max_concurrency: int) -> "CpuPool":
        return cls(limiter=CapacityLimiter(max_concurrency))

    async def run(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        call = partial(fn, *args, **kwargs)
        return await anyio.to_thread.run_sync(call, limiter=self.limiter)
