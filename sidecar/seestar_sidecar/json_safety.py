"""Make a decoded tool payload representable as JSON again.

JSON has no NaN or Infinity, but Python's json module reads and writes them
by default, so a tool payload can carry one across the MCP boundary and into
this process. Starlette's JSONResponse renders with `allow_nan=False`, so the
first route to return such a payload raised ValueError and answered with a
bare, non-JSON 500 — and for a cached QA report, on every poll, for good.

Non-finite floats become `null`. Every metric these payloads carry is already
nullable ("not measured"), which is the honest reading of a NaN; the
alternative, failing the whole response, would hide a 1,400-sub report
because one sub's FWHM did not compute.
"""
import math
from typing import Any


def replace_non_finite(value: Any) -> Any:
    """`value` with every NaN/+Inf/-Inf float, at any depth, replaced by None.

    Returns the same object when nothing needed replacing, so the common
    case costs one walk and no copies.
    """
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        cleaned = {key: replace_non_finite(item) for key, item in value.items()}
        return value if all(cleaned[k] is value[k] for k in value) else cleaned
    if isinstance(value, list):
        cleaned_list = [replace_non_finite(item) for item in value]
        return value if all(a is b for a, b in zip(cleaned_list, value, strict=True)) else cleaned_list
    return value
