"""Default LLM parameters by logical task (temperature, etc.)."""

# task_type keys are stable string ids used in code and (optionally) metrics.
TASK_TEMPERATURE: dict[str, float] = {
    "chat": 0.7,
    "summary": 0.3,
    "toc_analysis": 0.2,
    "prompt_generation": 0.7,
    "consistency_check": 0.2,
}
DEFAULT_TEMPERATURE: float = 0.7


def task_temperature(task_type: str) -> float:
    return TASK_TEMPERATURE.get(task_type, DEFAULT_TEMPERATURE)
