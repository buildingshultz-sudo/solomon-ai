"""
Solomon Memory Loader
Loads persistent business context from sol_memory.md
"""

from pathlib import Path


def load_memory(memory_file: Path) -> str:
    """Load the persistent memory/context file."""
    if memory_file.exists():
        content = memory_file.read_text()
        print(f"[MEMORY] Loaded: {len(content)} chars from {memory_file}")
        return content
    else:
        print(f"[MEMORY] WARNING: Memory file not found at {memory_file}")
        return "No business context loaded. Operate with general knowledge."
